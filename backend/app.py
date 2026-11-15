"""
PaperPulse — API del backend (Starlette).

Todo acceso a servicios de terceros (Binance, CoinGecko, Yahoo/Finnhub, Frankfurter, RSS, Anthropic, Google, Okta)
ocurre aquí; el frontend solo habla con /api/* y /ws/market de este mismo servidor. Por comodidad también sirve el
frontend estático de frontend/ (desactivable con SERVE_FRONTEND=false si se despliega aparte).
"""
import asyncio
import hmac
import os
import sys
import time
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from backend import account, admin, auth, contact, db, settings, visits
from backend.chat import api_chat_challenge, api_chat_stream
from backend.config import (
    ADMIN_API_KEY, ALLOWED_ORIGINS, DEBUG, FRONTEND_DIR, IS_PRODUCTION, IS_VERCEL, PORT, app_domain,
)
from backend.http import current_user
from backend.market import benchmark, dividends, stream
from backend.market.candles import api_candles
from backend.market.crypto import api_crypto_depth, api_crypto_markets, api_crypto_tickers
from backend.market.fx import get_exchange_rates
from backend.market.hours import api_markets
from backend.market.search import api_search
from backend.market.stocks import api_stock_quotes, api_stock_sparks
from backend.news import api_news
from backend.security import USAGE_STATS, get_client_ip
from backend.trading import api as trading_api
from backend.community import api as community_api
from backend.retention import api as retention_api

SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "true").lower() not in ("false", "0", "no")


async def api_health(request):
    """Estado público mínimo; con X-Admin-Key o sesión de administrador añade métricas de uso."""
    provided = request.headers.get("x-admin-key", "")
    by_key = bool(ADMIN_API_KEY) and hmac.compare_digest(provided.encode(), ADMIN_API_KEY.encode())
    user = None if by_key else await current_user(request)
    if not by_key and not (user and user["role"] == "admin"):
        return JSONResponse({"status": "healthy", "realtime": stream.realtime_available()})
    return JSONResponse({"status": "healthy", "realtime": stream.realtime_available(), **(await run_in_threadpool(admin.usage)), "stream": stream.status(),
                         "anthropicConfigured": bool(settings.get("anthropic_api_key"))})


BUILT_INDEX = os.path.join(os.path.dirname(__file__), "templates", "index.html")  # generado por `npm run build:static`


# Marcador de frontend/index.html para canonical, og:url y og:image: se sustituye por APP_DOMAIN al servirlo.
# Es un dominio .invalid (RFC 2606, nunca existe): si algo sirviera el HTML sin pasar por aquí,
# los enlaces no apuntarían a un dominio ajeno.
DOMAIN_PLACEHOLDER = "https://app-domain.invalid"


async def serve_index(request):
    """index.html con el dominio real en canonical y Open Graph."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    # En Vercel los estáticos con hash salen del CDN (public/): el index generado apunta a ellos y precarga los módulos
    if IS_VERCEL and os.path.exists(BUILT_INDEX):
        index_path = BUILT_INDEX
    if not os.path.exists(index_path):
        return Response("index.html no encontrado en frontend/", status_code=404)
    domain = app_domain()
    if not domain:
        if IS_PRODUCTION:
            # Sin APP_DOMAIN no se usa la cabecera Host (la controla el cliente): evita envenenar enlaces
            return Response("APP_DOMAIN es obligatoria en producción.", status_code=500)
        domain = f"http://localhost:{PORT}"
    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read().replace(DOMAIN_PLACEHOLDER, domain)
    await visits.count(request)  # contador anónimo del panel; como mucho visits.TIMEOUT y nunca lanza
    return HTMLResponse(content, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


routes = [
    Route("/api/health", api_health, methods=["GET"]),
    # Mercado
    Route("/api/markets", api_markets, methods=["GET"]),
    Route("/api/candles", api_candles, methods=["GET"]),
    Route("/api/crypto/markets", api_crypto_markets, methods=["GET"]),
    Route("/api/crypto/tickers", api_crypto_tickers, methods=["GET"]),
    Route("/api/crypto/depth", api_crypto_depth, methods=["GET"]),
    Route("/api/stocks/quotes", api_stock_quotes, methods=["GET"]),
    Route("/api/stocks/sparks", api_stock_sparks, methods=["GET"]),
    Route("/api/search", api_search, methods=["GET"]),
    Route("/api/rates", get_exchange_rates, methods=["GET"]),
    Route("/api/news", api_news, methods=["GET"]),
    *benchmark.routes,  # S&P 500 para el comparador del Resumen
    *dividends.routes,  # próximos dividendos (ficha de Operar y Resumen)
    # Asistente
    Route("/api/chat/challenge", api_chat_challenge, methods=["GET"]),
    Route("/api/chat", api_chat_stream, methods=["POST"]),
    # Usuarios y administración
    *auth.build_routes(get_client_ip),
    *admin.routes,
    # Cuenta de práctica del servidor
    *trading_api.routes,
    # Comunidad: perfiles, foro, clasificación y moderación
    *community_api.routes,
    # Retención: notificaciones, logros, reto mensual y cron diario
    *retention_api.routes,
    # Cuenta: aceptar términos, descargar mis datos
    *account.routes,
    # Formulario de contacto y su bandeja en Administración
    *contact.routes,
    WebSocketRoute("/ws/market", stream.ws_market),
]
if SERVE_FRONTEND:
    routes += [
        Route("/", serve_index, methods=["GET"]),
        Route("/index.html", serve_index, methods=["GET"]),
        Mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="static"),
    ]

BLOCKED_SUFFIXES = (".py", ".env", ".pyc", ".log", ".md")


def build_csp() -> str:
    """CSP estricta: sin scripts ni estilos inline y sin conexiones a terceros (todo pasa por el backend)."""
    local_ws = "" if IS_PRODUCTION else " ws://localhost:* ws://127.0.0.1:*"
    directives = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data: https:",  # imágenes de noticias
        "connect-src 'self'" + local_ws,
        "manifest-src 'self'",
        "object-src 'none'",
        "worker-src 'self'",  # solo el service worker propio (/sw.js)
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
    ]
    if IS_PRODUCTION:
        directives.append("upgrade-insecure-requests")
    return "; ".join(directives)


SECURITY_HEADERS = [
    (b"content-security-policy", build_csp().encode()),
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-origin"),
] + ([(b"strict-transport-security", b"max-age=31536000; includeSubDomains")] if IS_PRODUCTION else [])


class SecurityHeadersMiddleware:
    """Bloquea rutas sensibles y añade cabeceras de seguridad y de caché a todas las respuestas HTTP."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "").lower()
        if "/." in path or ".." in path or path.endswith(BLOCKED_SUFFIXES):
            await Response("Not Found", status_code=404)(scope, receive, send)
            return

        # Las dependencias de /vendor solo cambian con `npm run vendor`; el resto se revalida por ETag
        cache = b"public, max-age=604800" if path.startswith(("/vendor/", "/img/")) else b"no-cache"

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                headers += [h for h in SECURITY_HEADERS if h[0] not in existing]
                if b"cache-control" not in existing:
                    headers.append((b"cache-control", cache))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)


middleware = [
    Middleware(SecurityHeadersMiddleware),
    # Comprime JS, CSS y JSON (el SSE del asistente queda excluido). En Vercel los estáticos ya los comprime el CDN
    Middleware(GZipMiddleware, minimum_size=1024),
    Middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Chat-Challenge"],
        allow_credentials=False,
    ),
]


@asynccontextmanager
async def lifespan(app):
    try:
        db.init_db()
    except db.UnsafeFilesystemError as exc:
        print(f"\n[DB] {exc}\n", file=sys.stderr)
        raise
    print("==================================================")
    print("  PaperPulse — backend")
    print(f"  http://localhost:{PORT}  (frontend: {'servido desde ' + FRONTEND_DIR if SERVE_FRONTEND else 'aparte'})")
    print(f"  Base de datos: {db.DB_PATH}")
    print(f"  IA: {settings.get('anthropic_model')} ({'clave configurada' if settings.get('anthropic_api_key') else 'sin clave'})")
    print(f"  Bolsa: {settings.get('stock_data_provider')} · CORS: {ALLOWED_ORIGINS}")
    print("==================================================")
    USAGE_STATS["start_time"] = time.time()
    # En serverless no hay proceso persistente para el difusor de bolsa: el cliente usa el respaldo REST
    worker = None if IS_VERCEL else asyncio.create_task(stream.stocks_broadcast_worker())
    yield
    if worker:
        worker.cancel()


app = Starlette(debug=DEBUG, routes=routes, middleware=middleware, lifespan=lifespan)
