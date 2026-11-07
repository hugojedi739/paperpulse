"""Formulario de contacto: /api/contact (público) y bandeja de la administración (/api/admin/messages).

No envía correos ni usa servicios externos: el mensaje se guarda en la base de datos y lo lee un administrador en
Administración → Mensajes. Ninguna respuesta incluye correos: de quien escribe con sesión solo se muestra el alias.
Protección contra el abuso: mismo origen y JSON, longitudes máximas, límite por IP (security.py), un campo trampa
(honeypot) que las personas no ven y un tope global por hora guardado en la base de datos (vale con varias instancias).
"""
import time
from contextlib import closing
from typing import Optional

from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend import db
from backend.community import text
from backend.community.common import CommunityError, TooMany
from backend.db import transaction
from backend.http import current_user, error, ok, read_json, require_admin, same_origin
from backend.security import IP_CONTACT_CALLS, check_ip_rate_limit, cleanup_stale_ip_data, get_client_ip

PER_MINUTE = 3        # mensajes por minuto y por IP
PER_HOUR_GLOBAL = 60  # tope de mensajes nuevos por hora entre todos
HONEYPOT = "website"  # campo oculto en el formulario: si llega relleno, es un bot
PAGE = 25


def save(reason, message, user_id: Optional[int]) -> int:
    reason = text.clean(reason, "contact_reason", multiline=False)
    message = text.clean(message, "contact_message")
    now = int(time.time())
    with transaction() as conn:
        recent = conn.execute("SELECT COUNT(*) FROM contact_messages WHERE created_at > ?", (now - 3600,)).fetchone()[0]
        if recent >= PER_HOUR_GLOBAL:
            raise TooMany("El buzón está recibiendo demasiados mensajes. Inténtalo de nuevo en un rato.")
        cur = conn.execute("INSERT INTO contact_messages (user_id, reason, message, created_at) VALUES (?, ?, ?, ?)", (user_id, reason, message, now))
        return cur.lastrowid


def _like(term: str) -> str:
    """Patrón LIKE que busca el texto tal cual: % y _ del usuario no son comodines."""
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def listing(status: str, page: int, query: str = "") -> dict:
    conds, args = [], []
    if status == "unread":
        conds.append("m.read_at IS NULL")
    elif status == "read":
        conds.append("m.read_at IS NOT NULL")
    query = (query or "").strip()[:100]
    if query:
        conds.append("(m.reason LIKE ? ESCAPE '\\' OR m.message LIKE ? ESCAPE '\\')")
        args += [_like(query)] * 2
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with closing(db.connect()) as conn:
        rows = conn.execute(
            f"SELECT m.id, m.reason, m.message, m.created_at, m.read_at, m.user_id, p.alias FROM contact_messages m "
            f"LEFT JOIN profiles p ON p.user_id = m.user_id {where} ORDER BY m.id DESC LIMIT ? OFFSET ?", (*args, PAGE, (page - 1) * PAGE)).fetchall()
        total = conn.execute(f"SELECT COUNT(*) FROM contact_messages m {where}", args).fetchone()[0]
        unread = unread_count(conn)
    return {"items": [{"id": r["id"], "reason": r["reason"], "message": r["message"], "createdAt": r["created_at"], "read": r["read_at"] is not None,
                       "user": {"id": r["user_id"], "alias": r["alias"]} if r["user_id"] else None} for r in rows],
            "total": total, "unread": unread}


def unread_count(conn=None) -> int:
    if conn is not None:
        return conn.execute("SELECT COUNT(*) FROM contact_messages WHERE read_at IS NULL").fetchone()[0]
    with closing(db.connect()) as c:
        return unread_count(c)


# ---------------------------------------------------------------- API
async def api_contact(request):
    if not same_origin(request):
        return error("Origen no permitido.", 403)
    if len(IP_CONTACT_CALLS) > 5000:  # en serverless no hay hilo de limpieza
        cleanup_stale_ip_data()
    if not check_ip_rate_limit(get_client_ip(request), IP_CONTACT_CALLS, PER_MINUTE):
        return error("Demasiados mensajes seguidos. Espera un minuto.", 429)
    body, err = await read_json(request, limit=16384)
    if err:
        return err
    if body.get(HONEYPOT):
        return ok({"ok": True}, 201)  # parece que ha ido bien, pero se descarta
    user = await current_user(request)
    try:
        await run_in_threadpool(save, body.get("reason"), body.get("message"), user["id"] if user else None)
    except CommunityError as exc:
        return error(str(exc), getattr(exc, "status", 400))
    return ok({"ok": True}, 201)


async def api_messages(request):
    _, err = await require_admin(request)
    if err:
        return err
    q = request.query_params
    try:
        page = max(1, int(q.get("page", "1")))
    except ValueError:
        return error("Página no válida.", 400)
    return ok(await run_in_threadpool(listing, q.get("status", "all"), page, q.get("q", "")))


async def api_read_all(request):
    """Marca como leídos todos los mensajes sin leer. Devuelve cuántos eran."""
    _, err = await require_admin(request)
    if err:
        return err

    def mark_all():
        with transaction() as conn:
            return conn.execute("UPDATE contact_messages SET read_at = ? WHERE read_at IS NULL", (int(time.time()),)).rowcount
    return ok({"ok": True, "marked": await run_in_threadpool(mark_all)})


async def api_message(request):
    _, err = await require_admin(request)
    if err:
        return err
    try:
        mid = int(request.path_params["id"])
    except ValueError:
        return error("Mensaje no válido.", 400)
    if request.method == "DELETE":
        def delete():
            with transaction() as conn:
                return conn.execute("DELETE FROM contact_messages WHERE id = ?", (mid,)).rowcount
        if not await run_in_threadpool(delete):
            return error("El mensaje no existe.", 404)
        return ok({"ok": True})
    body, err = await read_json(request, limit=256)
    if err:
        return err
    if not isinstance(body.get("read"), bool):
        return error("Envía {\"read\": true|false}.", 400)

    def mark():
        with transaction() as conn:
            return conn.execute("UPDATE contact_messages SET read_at = ? WHERE id = ?", (int(time.time()) if body["read"] else None, mid)).rowcount
    if not await run_in_threadpool(mark):
        return error("El mensaje no existe.", 404)
    return ok({"ok": True, "read": body["read"]})


routes = [
    Route("/api/contact", api_contact, methods=["POST"]),
    Route("/api/admin/messages", api_messages, methods=["GET"]),
    Route("/api/admin/messages/read-all", api_read_all, methods=["POST"]),
    Route("/api/admin/messages/{id}", api_message, methods=["PATCH", "DELETE"]),
]
