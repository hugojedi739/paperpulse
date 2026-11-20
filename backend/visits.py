"""Contador de visitas de la portada para Administración → Resumen. Sin cookies y sin guardar nada reconocible.

- Solo cuenta GET / (la portada): ni /api, ni estáticos, ni HEAD, ni /index.html, ni las precargas del navegador.
- Identificador anónimo: HMAC-SHA256(secreto 'visits' de server_secrets, día | IP | user-agent), recortado. La IP y el
  user-agent solo se usan en memoria para calcularlo; no se guardan. Como el día entra en el cálculo, el valor cambia
  cada día y no permite seguir a nadie de un día a otro (igual que ai_usage).
- Tres tipos: 'bot' (user-agent de robot evidente o vacío), 'user' (cookie de sesión válida) y 'anon' (el resto).
- Se guardan agregados por día (visit_days) y los hashes del día (visit_seen) solo para deduplicar. El cron diario
  borra los hashes de días pasados y los agregados de más de RETENTION_DAYS (migración 0014).
- La portada nunca espera más de TIMEOUT ni falla por el contador: cualquier error se ignora (sin registrar datos).
"""
import asyncio
import datetime
import hashlib
import hmac
import re
import sys
import time
from contextlib import closing
from typing import Dict, List, Optional

from starlette.concurrency import run_in_threadpool

from backend import db, settings
from backend.http import COOKIE
from backend.security import get_client_ip

RETENTION_DAYS = 90
TIMEOUT = 0.3  # segundos que la portada puede esperar como mucho al contador
KINDS = ("anon", "user", "bot")

# Robots evidentes por su user-agent (buscadores, previsualizaciones de enlaces, monitores y clientes de línea de órdenes).
# No pretende ser perfecto: lo que no se reconozca cuenta como persona.
BOT_UA = re.compile(
    r"bot\b|bot/|crawl|spider|slurp|scrap|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|"
    r"headless|lighthouse|pagespeed|pingdom|uptime|monitor|vercel|curl/|wget/|python-|httpx|aiohttp|go-http-client|"
    r"okhttp|java/|axios/|node-fetch|undici|postman|insomnia|libwww|httpclient|feedfetcher|rss",
    re.I,
)

_secret_cache: Dict[str, bytes] = {}


def today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def secret() -> bytes:
    if "visits" not in _secret_cache:
        with closing(db.connect()) as conn:
            row = conn.execute("SELECT value FROM server_secrets WHERE name = 'visits'").fetchone()
        _secret_cache["visits"] = bytes.fromhex(row[0])
    return _secret_cache["visits"]


def visitor_key(ip: str, user_agent: str, day: str) -> str:
    return hmac.new(secret(), f"{day}|{ip}|{user_agent}".encode(), hashlib.sha256).hexdigest()[:32]


def is_bot(user_agent: str) -> bool:
    return not user_agent.strip() or bool(BOT_UA.search(user_agent))


def should_count(request) -> bool:
    """Solo la carga real de la portada: GET /, sin precargas especulativas del navegador."""
    if request.method != "GET" or request.url.path != "/":
        return False
    purpose = (request.headers.get("sec-purpose") or request.headers.get("purpose") or "").lower()
    return "prefetch" not in purpose and "prerender" not in purpose


def _has_session(conn, token: Optional[str]) -> bool:
    """¿Cookie de sesión válida? Solo lectura (no toca last_login ni nada del usuario)."""
    if not token or len(token) > 100:
        return False
    row = conn.execute(
        "SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0",
        (db.token_hash(token), int(time.time())),
    ).fetchone()
    return row is not None


def record(ip: str, user_agent: str, token: Optional[str]) -> str:
    """Cuenta una carga de la portada. Devuelve el tipo contado. Se ejecuta en un hilo (bloquea en la base)."""
    user_agent = user_agent[:512]
    day = today()
    with db.transaction() as conn:
        kind = "bot" if is_bot(user_agent) else "user" if _has_session(conn, token) else "anon"
        new = conn.execute("INSERT OR IGNORE INTO visit_seen (day, visitor, kind) VALUES (?, ?, ?)",
                           (day, visitor_key(ip, user_agent, day), kind)).rowcount == 1
        conn.execute("INSERT INTO visit_days (day, kind, visitors, views) VALUES (?, ?, ?, 1) "
                     "ON CONFLICT(day, kind) DO UPDATE SET visitors = visitors + excluded.visitors, views = views + 1",
                     (day, kind, 1 if new else 0))
    return kind


def _record_if_enabled(ip: str, user_agent: str, token: Optional[str]) -> Optional[str]:
    # settings.get puede leer la base: va aquí, en el hilo y dentro del tope de tiempo, no en el bucle de eventos
    return record(ip, user_agent, token) if settings.get("visits_enabled") else None


async def count(request) -> None:
    """Para serve_index: cuenta la visita si toca, sin hacer esperar más de TIMEOUT y sin propagar errores."""
    try:
        if not should_count(request):
            return
        args = (get_client_ip(request), request.headers.get("user-agent", ""), request.cookies.get(COOKIE))
        await asyncio.wait_for(run_in_threadpool(_record_if_enabled, *args), TIMEOUT)
    except asyncio.TimeoutError:
        print("[Visitas] El contador tardó demasiado; la portada se sirvió sin esperarlo.", file=sys.stderr)
    except Exception as exc:  # la base caída, una migración pendiente...: la portada se sirve igual
        print(f"[Visitas] No se pudo contar la visita: {type(exc).__name__}", file=sys.stderr)


def summary(days: int = 14) -> Dict:
    """Resumen del panel: hoy por tipo, los últimos `days` días y los registros nuevos de hoy (día UTC)."""
    end = datetime.datetime.now(datetime.timezone.utc).date()
    start = end - datetime.timedelta(days=days - 1)
    midnight = int(datetime.datetime.combine(end, datetime.time(), datetime.timezone.utc).timestamp())
    with closing(db.connect()) as conn:
        rows = conn.execute("SELECT day, kind, visitors, views FROM visit_days WHERE day >= ?", (start.isoformat(),)).fetchall()
        signups = conn.execute("SELECT COUNT(*) FROM users WHERE owner_id IS NULL AND deleted_at IS NULL AND created_at >= ?",
                               (midnight,)).fetchone()[0]
    by = {(r[0], r[1]): (r[2], r[3]) for r in rows}
    history: List[Dict] = []
    for i in range(days):
        d = (start + datetime.timedelta(days=i)).isoformat()
        history.append({"day": d, **{k: by.get((d, k), (0, 0))[0] for k in KINDS},
                        "views": sum(by.get((d, k), (0, 0))[1] for k in KINDS if k != "bot")})
    today_row = history[-1]
    return {"today": {**{k: today_row[k] for k in KINDS}, "views": today_row["views"], "signups": signups},
            "history": history, "enabled": bool(settings.get("visits_enabled"))}


def cleanup() -> Dict:
    """Para el cron diario: borra los hashes de días pasados y los agregados de más de RETENTION_DAYS."""
    day = today()
    old = (datetime.date.fromisoformat(day) - datetime.timedelta(days=RETENTION_DAYS)).isoformat()
    with db.transaction() as conn:
        a = conn.execute("DELETE FROM visit_seen WHERE day < ?", (day,)).rowcount
        b = conn.execute("DELETE FROM visit_days WHERE day < ?", (old,)).rowcount
    return {"visitHashesDeleted": a, "visitDaysDeleted": b}
