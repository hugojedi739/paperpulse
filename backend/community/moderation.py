"""Moderación (solo administradores): denuncias, ocultar/restaurar mensajes, suspender usuarios y registro.

Toda acción queda en moderation_log con quién, qué, sobre qué y por qué.
"""
from contextlib import closing
from typing import Dict, Optional

from backend import db
from backend.community import text
from backend.community.common import CommunityError, Conflict, Forbidden, NotFound, log, now
from backend.trading.ledger import transaction

FOREVER = 253402300799  # 31/12/9999: suspensión indefinida
MAX_DAYS = 3650


def list_reports(status: str, limit: int, offset: int) -> Dict:
    """Denuncias agrupadas por mensaje: el texto completo (también si está oculto) para poder revisarlo."""
    if status not in ("open", "resolved", "dismissed"):
        raise CommunityError("Estado no válido. Usa open, resolved o dismissed.")
    with closing(db.connect()) as conn:
        total = conn.execute("SELECT COUNT(DISTINCT post_id) FROM reports WHERE status = ?", (status,)).fetchone()[0]
        rows = conn.execute(
            "SELECT r.post_id, COUNT(*) AS n, GROUP_CONCAT(DISTINCT r.reason) AS reasons, MAX(r.created_at) AS last_at, "
            "po.body, po.status AS post_status, po.author_id, pa.alias AS author, po.thread_id, t.title, t.first_post_id, "
            "u.suspended_until FROM reports r JOIN posts po ON po.id = r.post_id JOIN threads t ON t.id = po.thread_id "
            "JOIN users u ON u.id = po.author_id LEFT JOIN profiles pa ON pa.user_id = po.author_id "
            "WHERE r.status = ? GROUP BY r.post_id ORDER BY n DESC, last_at DESC LIMIT ? OFFSET ?",
            (status, limit, offset)).fetchall()
        out = []
        for r in rows:
            reports = conn.execute(
                "SELECT r.id, r.reason, r.details, r.created_at, r.post_body, r.post_author_alias, p.alias AS reporter FROM reports r "
                "LEFT JOIN profiles p ON p.user_id = r.reporter_id WHERE r.post_id = ? AND r.status = ? ORDER BY r.id",
                (r["post_id"], status)).fetchall()
            first = reports[0] if reports else None
            out.append({
                # Texto actual: no se muestra si lo borró su autor (lo que se denunció está en reportedBody)
                "postId": r["post_id"], "body": None if r["post_status"] == "deleted" else r["body"], "postStatus": r["post_status"], "isThreadStart": r["post_id"] == r["first_post_id"],
                # Lo que se denunció, copiado al denunciar (sigue ahí aunque el autor lo borre o cambie de alias)
                "reportedBody": first["post_body"] if first and first["post_body"] is not None else None,
                "reportedAuthor": first["post_author_alias"] if first and first["post_author_alias"] else r["author"],
                "threadId": r["thread_id"], "threadTitle": r["title"],
                "author": {"userId": r["author_id"], "alias": r["author"], "suspended": (r["suspended_until"] or 0) > now()},
                "count": r["n"], "reasons": (r["reasons"] or "").split(","), "lastAt": r["last_at"],
                "reports": [{"id": x["id"], "reason": x["reason"], "details": x["details"], "reporter": x["reporter"],
                             "createdAt": x["created_at"]} for x in reports],
            })
    return {"status": status, "total": total, "items": out}


def _set_post(admin_id: int, post_id: int, hide: bool, reason) -> Dict:
    reason = text.clean(reason, "reason")
    with transaction() as conn:
        p = conn.execute("SELECT po.status, po.thread_id, t.first_post_id FROM posts po JOIN threads t ON t.id = po.thread_id "
                         "WHERE po.id = ?", (post_id,)).fetchone()
        if not p:
            raise NotFound("Ese mensaje no existe.")
        if p["status"] == "deleted":
            raise Conflict("Ese mensaje lo borró su autor: no se puede ocultar ni restaurar.")
        new = "hidden" if hide else "visible"
        conn.execute("UPDATE posts SET status = ?, updated_at = ? WHERE id = ?", (new, now(), post_id))
        if p["first_post_id"] == post_id:
            conn.execute("UPDATE threads SET status = ? WHERE id = ?", (new, p["thread_id"]))
        if hide:  # ocultar resuelve las denuncias abiertas del mensaje
            conn.execute("UPDATE reports SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE post_id = ? AND status = 'open'",
                         (now(), admin_id, post_id))
        log(conn, admin_id, "hide_post" if hide else "restore_post", "post", post_id, reason)
    return {"postId": post_id, "status": new}


def hide_post(admin_id: int, post_id: int, reason) -> Dict:
    return _set_post(admin_id, post_id, True, reason)


def restore_post(admin_id: int, post_id: int, reason) -> Dict:
    return _set_post(admin_id, post_id, False, reason)


def dismiss_reports(admin_id: int, post_id: int, reason) -> Dict:
    """Descarta las denuncias abiertas de un mensaje (no infringe las normas)."""
    reason = text.clean(reason, "reason")
    with transaction() as conn:
        n = conn.execute("UPDATE reports SET status = 'dismissed', resolved_at = ?, resolved_by = ? WHERE post_id = ? AND status = 'open'",
                         (now(), admin_id, post_id)).rowcount
        if not n:
            raise NotFound("Ese mensaje no tiene denuncias abiertas.")
        log(conn, admin_id, "dismiss_reports", "post", post_id, reason)
    return {"postId": post_id, "dismissed": n}


def suspend(admin_id: int, user_id: int, days, reason) -> Dict:
    """Suspende la participación en la comunidad `days` días (None = indefinida). La cuenta sigue pudiendo operar."""
    reason = text.clean(reason, "reason")
    if days is not None and (isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= MAX_DAYS):
        raise CommunityError(f"Los días deben ser un entero entre 1 y {MAX_DAYS} (o null para indefinida).")
    if user_id == admin_id:
        raise CommunityError("No puedes suspenderte a ti mismo.")
    until = FOREVER if days is None else now() + days * 86400
    with transaction() as conn:
        u = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if not u:
            raise NotFound("Ese usuario no existe.")
        if u["role"] == "admin":
            raise Forbidden("No se puede suspender a un administrador. Quítale antes el rol.")
        conn.execute("UPDATE users SET suspended_until = ?, suspension_reason = ? WHERE id = ?", (until, reason, user_id))
        log(conn, admin_id, "suspend_user", "user", user_id, f"{'indefinida' if days is None else f'{days} días'}: {reason}")
    return {"userId": user_id, "suspendedUntil": until}


def unsuspend(admin_id: int, user_id: int, reason) -> Dict:
    reason = text.clean(reason, "reason")
    with transaction() as conn:
        n = conn.execute("UPDATE users SET suspended_until = NULL, suspension_reason = NULL WHERE id = ?", (user_id,)).rowcount
        if not n:
            raise NotFound("Ese usuario no existe.")
        log(conn, admin_id, "unsuspend_user", "user", user_id, reason)
    return {"userId": user_id, "suspendedUntil": None}


def moderation_log(limit: int, before: Optional[int]) -> Dict:
    sql = ("SELECT m.*, ua.name AS actor_name, pa.alias AS actor_alias FROM moderation_log m "
           "LEFT JOIN users ua ON ua.id = m.actor_id LEFT JOIN profiles pa ON pa.user_id = m.actor_id")
    args = []
    if before:
        sql, args = sql + " WHERE m.id < ?", [before]
    with closing(db.connect()) as conn:
        rows = conn.execute(sql + " ORDER BY m.id DESC LIMIT ?", (*args, limit + 1)).fetchall()
        targets = {}
        for r in rows[:limit]:  # alias del usuario afectado (o del autor del mensaje), para leer el registro sin ids
            if r["target_type"] == "user":
                t = conn.execute("SELECT alias FROM profiles WHERE user_id = ?", (r["target_id"],)).fetchone()
            else:
                t = conn.execute("SELECT p.alias FROM posts po LEFT JOIN profiles p ON p.user_id = po.author_id WHERE po.id = ?",
                                 (r["target_id"],)).fetchone()
            targets[r["id"]] = t["alias"] if t else None
    return {
        "items": [{"id": r["id"], "action": r["action"], "targetType": r["target_type"], "targetId": r["target_id"],
                   "targetAlias": targets[r["id"]], "reason": r["reason"], "createdAt": r["created_at"],
                   "actor": r["actor_alias"] or r["actor_name"]} for r in rows[:limit]],
        "hasMore": len(rows) > limit,
    }
