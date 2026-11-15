"""Contador anónimo de visitas para Administración → Resumen. La portada NO lo toca: es una petición aparte.

- La portada ("/") se sirve sin consultar la base. Cuando la aplicación termina de cargar, el navegador envía
  POST /api/visit (lib/visit.js, una vez por carga, sin cookies: credentials 'omit'). Así el conteo nunca frena
  la portada, aunque la base esté lejos (en producción la función corre en iad1 y Turso en Dublín) o caída.
- Identificador anónimo: HMAC-SHA256(secreto 'visits' de server_secrets, día | IP | user-agent), recortado. La IP y el
  user-agent solo se usan en memoria para calcularlo; no se guardan. Como el día entra en el cálculo, el valor cambia
  cada día y no permite seguir a nadie de un día a otro (igual que ai_usage).
- Tres tipos: 'bot' (user-agent de robot evidente o vacío), 'user' (la app dice que hay sesión: `signedIn`) y 'anon'.
  `signedIn` lo envía el navegador sin cookies, así que no se verifica: solo reparte cifras agregadas.
- Una sentencia por tabla, en autocommit y SIN transacción (sin BEGIN IMMEDIATE): no bloquea otras escrituras.
  visit_seen (hashes del día, solo para deduplicar) y visit_days (agregados). El cron diario borra los hashes de
  días pasados y los agregados de más de RETENTION_DAYS (migración 0014).
- Tolerante a fallos: con el contador apagado, la base caída o cualquier error, responde 204 igual.
"""
import datetime
import hashlib
import hmac
import re
import sys
from contextlib import closing
from typing import Dict, List

from starlette.concurrency import run_in_threadpool
from starlette.responses import Response
from starlette.routing import Route

from backend import db, settings
from backend.http import read_json, same_origin, error
from backend.security import IP_VISIT_CALLS, check_ip_rate_limit, get_client_ip

RETENTION_DAYS = 90
VISITS_PER_MINUTE = 30  # por IP: una carga normal envía una; esto solo frena abusos
KINDS = ("anon", "user", "bot")

# Robots evidentes por su user-agent (buscadores, previsualizaciones de enlaces, monitores y clientes de línea de órdenes).
# No pretende ser perfecto: lo que no se reconozca cuenta como persona. La mayoría de robots no ejecutan JavaScript
# y ni siquiera llegan a enviar la petición.
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


def record(ip: str, user_agent: str, signed_in: bool) -> str:
    """Cuenta una carga de la app. Dos sentencias en autocommit, una por tabla, sin transacción. Devuelve el tipo."""
    user_agent = user_agent[:512]
    day = today()
    kind = "bot" if is_bot(user_agent) else "user" if signed_in else "anon"
    with closing(db.connect()) as conn:
        new = conn.execute("INSERT OR IGNORE INTO visit_seen (day, visitor, kind) VALUES (?, ?, ?)",
                           (day, visitor_key(ip, user_agent, day), kind)).rowcount == 1
        conn.execute("INSERT INTO visit_days (day, kind, visitors, views) VALUES (?, ?, ?, 1) "
                     "ON CONFLICT(day, kind) DO UPDATE SET visitors = visitors + excluded.visitors, views = views + 1",
                     (day, kind, 1 if new else 0))
    return kind


def _record_if_enabled(ip: str, user_agent: str, signed_in: bool):
    return record(ip, user_agent, signed_in) if settings.get("visits_enabled") else None


async def api_visit(request):
    """POST /api/visit {signedIn: bool}. Siempre 204 salvo origen ajeno (403), abuso (429) o petición mal formada."""
    if not same_origin(request):
        return error("Origen no permitido.", 403)
    if not check_ip_rate_limit(get_client_ip(request), IP_VISIT_CALLS, VISITS_PER_MINUTE):
        return error("Demasiadas peticiones. Espera un minuto.", 429)
    body, err = await read_json(request, limit=256)
    if err:
        return err
    signed_in = isinstance(body, dict) and body.get("signedIn") is True
    try:
        await run_in_threadpool(_record_if_enabled, get_client_ip(request), request.headers.get("user-agent", ""), signed_in)
    except Exception as exc:  # base caída, migración pendiente...: no es asunto de quien navega
        print(f"[Visitas] No se pudo contar la visita: {type(exc).__name__}", file=sys.stderr)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


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


routes = [Route("/api/visit", api_visit, methods=["POST"])]
