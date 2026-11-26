"""API del panel de administración (/api/admin/*). Todas las rutas exigen una sesión con rol admin."""
import time

from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend import admin_log, admin_stats, ai_usage, auth, contact, db, settings, visits
from backend.config import DAILY_GLOBAL_TOKEN_LIMIT
from backend.http import error, ok, read_json, require_admin
from backend.market import stream
from backend.market.hours import is_market_open
from backend.security import USAGE_STATS


def usage() -> dict:
    """Consumo de IA del día (de la base de datos, común a todas las instancias) y diagnóstico de esta instancia.
    Bloqueante: llámala con run_in_threadpool."""
    ai = ai_usage.summary()
    used = ai["tokensToday"]
    return {
        **ai,
        "uptimeSeconds": int(time.time() - USAGE_STATS["start_time"]),
        "tokenLimit": DAILY_GLOBAL_TOKEN_LIMIT,
        "percentUsed": round(used / DAILY_GLOBAL_TOKEN_LIMIT * 100, 2) if DAILY_GLOBAL_TOKEN_LIMIT else 0,
        "stockRequests": USAGE_STATS["stock_requests"],
        "errors": USAGE_STATS["errors"],
    }


async def overview(request):
    _, err = await require_admin(request)
    if err:
        return err
    us_open, us_msg = is_market_open("US")
    es_open, es_msg = is_market_open("ES")
    return ok({
        "users": await run_in_threadpool(db.stats),
        "usage": await run_in_threadpool(usage),
        "unreadMessages": await run_in_threadpool(contact.unread_count),
        "activity": await run_in_threadpool(admin_stats.activity),
        "aiHistory": await run_in_threadpool(ai_usage.history, 14),
        "visits": await run_in_threadpool(visits.summary, 14),
        "stream": stream.status(),
        "integrations": {
            "anthropic": {"configured": bool(settings.get("anthropic_api_key")), "model": settings.get("anthropic_model")},
            "stocks": {"provider": settings.get("stock_data_provider"), "finnhubConfigured": bool(settings.get("finnhub_api_key"))},
            "oauth": {pid: bool(auth.provider_config(pid)) for pid in auth.PROVIDERS},
        },
        "markets": {"us": {"open": us_open, "status": us_msg}, "es": {"open": es_open, "status": es_msg}},
    })


async def users(request):
    _, err = await require_admin(request)
    if err:
        return err
    q = request.query_params
    try:
        limit, offset = min(100, max(1, int(q.get("limit", "25")))), max(0, int(q.get("offset", "0")))
    except ValueError:
        return error("limit y offset deben ser números.", 400)
    filters = {"role": q.get("role"), "status": q.get("status"), "verified": q.get("verified")}
    allowed = {"role": db.ROLES, "status": ("active", "disabled", "suspended"), "verified": ("yes", "no")}
    for name, value in filters.items():
        if value not in (None, "") and value not in allowed[name]:
            return error(f"Valor no válido para {name}.", 400)
    sort, direction = q.get("sort", "created"), q.get("dir", "desc")
    if sort not in db.USER_SORTS or direction not in ("asc", "desc"):
        return error("Orden no válido.", 400)
    filters = {k: (v or None) for k, v in filters.items()}
    return ok(await run_in_threadpool(lambda: db.list_users(q.get("q", "")[:100], limit, offset, sort=sort, direction=direction, **filters)))


async def user_detail(request):
    admin, err = await require_admin(request)
    if err:
        return err
    try:
        uid = int(request.path_params["id"])
    except ValueError:
        return error("Usuario no válido.", 400)
    target = await run_in_threadpool(db.get_user, uid)
    if not target:
        return error("El usuario no existe.", 404)
    if request.method == "DELETE":
        if uid == admin["id"]:
            return error("No puedes eliminar tu propia cuenta desde el panel.", 400)
        body, err = await read_json(request)
        if err:
            return err
        if str(body.get("confirmEmail", "")).strip().lower() != (target["email"] or "").lower():
            return error("Escribe el email de la cuenta para confirmar su eliminación.", 400)
        await run_in_threadpool(db.delete_user, uid)
        await run_in_threadpool(admin_log.record, admin["id"], "user_delete", uid)
        return ok({"ok": True})

    body, err = await read_json(request)
    if err:
        return err
    role, disabled = body.get("role"), body.get("disabled")
    if role is not None and role not in db.ROLES:
        return error("Rol no válido.", 400)
    if disabled is not None and not isinstance(disabled, bool):
        return error("disabled debe ser verdadero o falso.", 400)
    if role == "admin" and not target["emailVerified"]:
        return error("Solo se puede dar el rol de administrador a cuentas con el email verificado (acceso con Google).", 400)
    if uid == admin["id"] and (role == "user" or disabled):
        return error("No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.", 400)
    if target["role"] == "admin" and (role == "user" or disabled) and await run_in_threadpool(db.count_admins) <= 1:
        return error("Debe quedar al menos un administrador activo.", 400)
    user = await run_in_threadpool(db.update_user, uid, role, disabled)
    if role is not None and role != target["role"]:
        await run_in_threadpool(admin_log.record, admin["id"], "user_role", uid, f"{target['role']} → {role}")
    if disabled is not None and disabled != bool(target["disabled"]):
        await run_in_threadpool(admin_log.record, admin["id"], "user_disable" if disabled else "user_enable", uid)
    return ok({"user": user})


async def settings_view(request):
    admin, err = await require_admin(request)
    if err:
        return err
    if request.method == "PUT":
        body, err = await read_json(request, 32768)
        if err:
            return err
        values = body.get("values")
        if not isinstance(values, dict):
            return error("Envía {\"values\": {...}}.", 400)
        problem = settings.validate(values)
        if problem:
            return error(problem, 400)
        await run_in_threadpool(settings.save, values, admin["id"])
        await run_in_threadpool(admin_log.record, admin["id"], "settings_update", None, admin_log.settings_detail(values))
    return ok({
        "settings": settings.public_view(),
        "redirectUris": {pid: auth.redirect_uri(request, pid) for pid in auth.PROVIDERS},
    })


async def oauth_test(request):
    """Comprueba que el issuer responde con un documento OpenID válido (no envía credenciales)."""
    _, err = await require_admin(request)
    if err:
        return err
    pid = request.path_params["provider"]
    if pid not in auth.PROVIDERS:
        return error("Proveedor desconocido.", 404)
    issuer = auth.PROVIDERS[pid]["issuer"]()
    if not issuer:
        return error("Configura primero el issuer.", 400)
    try:
        doc = await run_in_threadpool(auth.discovery, issuer)
    except Exception as e:
        return ok({"ok": False, "error": f"{type(e).__name__}: {e}"[:300]})
    return ok({"ok": True, "issuer": doc["issuer"], "authorization_endpoint": doc.get("authorization_endpoint"),
               "configured": bool(auth.provider_config(pid))})


def _probe(name: str, fn) -> dict:
    """Mide una comprobación de salud: {name, ok, ms, detail}. Nunca lanza ni devuelve trazas."""
    t0 = time.perf_counter()
    try:
        detail = fn()
        ok_ = True
    except Exception as exc:  # el detalle es solo el tipo de error: sin trazas ni URLs
        detail, ok_ = type(exc).__name__, False
    return {"name": name, "ok": ok_, "ms": int((time.perf_counter() - t0) * 1000), "detail": detail or ""}


def api_health() -> list:
    """Comprueba en paralelo las APIs de las que depende la app. Bloqueante: llámala con run_in_threadpool."""
    from concurrent.futures import ThreadPoolExecutor

    import requests

    from backend.market import crypto, stocks

    def database():
        from contextlib import closing
        with closing(db.connect()) as conn:
            conn.execute("SELECT 1").fetchone()

    def binance():
        crypto.binance_get("/api/v3/ping", {}, timeout=(3, 4))

    def coingecko():
        r = crypto.HTTP.get("https://api.coingecko.com/api/v3/ping", timeout=(3, 4))
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")

    def frankfurter():
        r = requests.get("https://api.frankfurter.app/latest?from=USD", timeout=4)
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}")

    def bolsa():
        if not stocks.fetch_live_stock_quotes():
            raise RuntimeError("sin cotizaciones")
        return settings.get("stock_data_provider")

    def anthropic():
        if not settings.get("anthropic_api_key"):
            raise RuntimeError("sin clave")
        return "clave configurada (no se hace ninguna llamada de pago)"

    checks = [("Base de datos", database), ("Binance", binance), ("CoinGecko", coingecko),
              ("Bolsa (cotizaciones)", bolsa), ("Divisas (Frankfurter)", frankfurter), ("Asistente (Anthropic)", anthropic)]
    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        return list(pool.map(lambda c: _probe(*c), checks))


async def health_apis(request):
    _, err = await require_admin(request)
    if err:
        return err
    return ok({"checks": await run_in_threadpool(api_health), "checkedAt": int(time.time())})


async def badges(request):
    _, err = await require_admin(request)
    if err:
        return err
    return ok(await run_in_threadpool(admin_stats.badges))


async def audit(request):
    _, err = await require_admin(request)
    if err:
        return err
    try:
        return ok(await run_in_threadpool(admin_log.audit, request.query_params.get("before") or None))
    except ValueError as exc:
        return error(str(exc), 400)


routes = [
    Route("/api/admin/audit", audit, methods=["GET"]),
    Route("/api/admin/health", health_apis, methods=["GET"]),
    Route("/api/admin/badges", badges, methods=["GET"]),
    Route("/api/admin/overview", overview, methods=["GET"]),
    Route("/api/admin/users", users, methods=["GET"]),
    Route("/api/admin/users/{id}", user_detail, methods=["PATCH", "DELETE"]),
    Route("/api/admin/settings", settings_view, methods=["GET", "PUT"]),
    Route("/api/admin/oauth/{provider}/test", oauth_test, methods=["POST"]),
]
