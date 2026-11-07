"""Registro de auditoría del panel de administración (tabla admin_log) y vista unificada con moderation_log.

Guarda quién hizo qué y sobre quién (solo ids) y, en los ajustes, los NOMBRES de las claves cambiadas: nunca valores,
porque pueden ser secretos. No se guardan emails, para que eliminar una cuenta no deje datos personales aquí.
"""
import logging
import time
from contextlib import closing
from typing import Dict, Optional, Sequence

from backend import db

log = logging.getLogger("paperpulse.admin_log")

ACTIONS = {
    "user_role": "Cambió el rol de un usuario",
    "user_disable": "Desactivó una cuenta",
    "user_enable": "Activó una cuenta",
    "user_delete": "Eliminó una cuenta",
    "settings_update": "Cambió ajustes",
}
PAGE = 50


def record(actor_id: Optional[int], action: str, target_user_id: Optional[int] = None, detail: str = "") -> None:
    """Anota una acción. Si falla no deshace la acción ya hecha (está en otra transacción): se deja constancia en el log del servidor."""
    try:
        with closing(db.connect()) as conn:
            conn.execute("INSERT INTO admin_log (actor_id, action, target_user_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                         (actor_id, action, target_user_id, str(detail)[:300], int(time.time())))
    except Exception:
        log.exception("No se pudo registrar la acción de administración %s sobre %s", action, target_user_id)


def settings_detail(values: Dict) -> str:
    """Nombres de los ajustes tocados; «(restablecido)» cuando vuelven al valor de .env. Nunca los valores."""
    return ", ".join(f"{k} (restablecido)" if v is None else k for k, v in sorted(values.items()))[:300]


def audit(before: Optional[str] = None, limit: int = PAGE) -> Dict:
    """Moderación y administración juntas, de más reciente a más antigua. `before` es el cursor «tiempo.origen.id» de la página anterior."""
    where, args = "", []
    if before:
        try:
            ts, src, rid = before.split(".")
            ts, rid = int(ts), int(rid)
        except ValueError:
            raise ValueError("Cursor no válido.")
        if src not in ("a", "m"):
            raise ValueError("Cursor no válido.")
        where = " WHERE created_at < ? OR (created_at = ? AND (src < ? OR (src = ? AND id < ?)))"
        args = [ts, ts, src, src, rid]
    sql = (
        "SELECT * FROM ("
        "SELECT 'a' AS src, id, actor_id, action, 'user' AS target_type, target_user_id AS target_id, detail, created_at FROM admin_log "
        "UNION ALL "
        "SELECT 'm', id, actor_id, action, target_type, target_id, reason, created_at FROM moderation_log"
        f"){where} ORDER BY created_at DESC, src DESC, id DESC LIMIT ?"
    )
    with closing(db.connect()) as conn:
        rows = conn.execute(sql, (*args, limit + 1)).fetchall()
        page = rows[:limit]
        names = _aliases(conn, {r["actor_id"] for r in page if r["actor_id"]} | {r["target_id"] for r in page if r["target_type"] == "user" and r["target_id"]})
    items = [{
        "source": "admin" if r["src"] == "a" else "moderation", "id": r["id"], "action": r["action"],
        "actor": names.get(r["actor_id"]), "targetType": r["target_type"], "targetId": r["target_id"],
        "target": names.get(r["target_id"]) if r["target_type"] == "user" else None,
        "detail": r["detail"], "createdAt": r["created_at"],
    } for r in page]
    cursor = f"{page[-1]['created_at']}.{page[-1]['src']}.{page[-1]['id']}" if len(rows) > limit else None
    return {"items": items, "nextCursor": cursor}


def _aliases(conn, ids: Sequence[int]) -> Dict[int, str]:
    """Alias (o nombre) de cada usuario; nunca el email."""
    ids = [i for i in ids if i]
    if not ids:
        return {}
    marks = ",".join("?" * len(ids))
    rows = conn.execute(f"SELECT u.id, COALESCE(p.alias, u.name) AS label FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id IN ({marks})", ids).fetchall()
    return {r["id"]: r["label"] for r in rows}
