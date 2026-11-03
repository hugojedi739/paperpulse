"""Notificaciones dentro de la app.

Se crean con notify() DENTRO de la transacción del evento que las provoca (si la transacción se deshace, la
notificación también). Se consultan al abrir la app y al abrir la campana (sin sondeo), y se borran a los 60 días.
Los textos los fabrica el servidor; pueden incluir alias o títulos de otros usuarios, así que el frontend los pinta
siempre con textContent.
"""
import time
from contextlib import closing
from typing import Dict, List, Optional

from backend import db
from backend.db import transaction

RETENTION_DAYS = 60
MAX_PER_USER = 200  # tope duro por usuario: un spammer no puede llenar la base de datos
KINDS = ("reply", "follower", "hidden", "order", "alert", "achievement", "challenge")


def _cut(text: str, n: int) -> str:
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1] + "…"


def notify(conn, user_id: int, kind: str, title: str, body: str = "", link: str = "") -> None:
    """Crea una notificación. Si `user_id` es un usuario sombra de un reto, va a su propietario."""
    assert kind in KINDS
    row = conn.execute("SELECT owner_id, disabled FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return
    target = row["owner_id"] or user_id
    if row["owner_id"]:
        title = f"Reto del mes · {title}"
    if not row["owner_id"] and row["disabled"]:
        return
    conn.execute("INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                 (target, kind, _cut(title, 120), _cut(body, 300), link if link.startswith("/") else "", int(time.time())))
    conn.execute("DELETE FROM notifications WHERE user_id = ? AND id NOT IN "
                 "(SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?)", (target, target, MAX_PER_USER))


def _json(r) -> Dict:
    return {"id": r["id"], "kind": r["kind"], "title": r["title"], "body": r["body"], "link": r["link"],
            "read": r["read_at"] is not None, "createdAt": r["created_at"]}


def list_for(user_id: int, before: Optional[int] = None, limit: int = 20) -> Dict:
    """Página de notificaciones (más recientes primero) y nº de no leídas. `before` = id de la última de la página anterior."""
    sql, args = "SELECT * FROM notifications WHERE user_id = ?", [user_id]
    if before:
        sql, args = sql + " AND id < ?", args + [before]
    with closing(db.connect()) as conn:
        rows = conn.execute(sql + " ORDER BY id DESC LIMIT ?", (*args, limit + 1)).fetchall()
        unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", (user_id,)).fetchone()[0]
    return {"items": [_json(r) for r in rows[:limit]], "hasMore": len(rows) > limit, "unread": unread}


def _ids(ids) -> List[int]:
    if not isinstance(ids, list) or not ids or len(ids) > 200 or not all(isinstance(i, int) and not isinstance(i, bool) for i in ids):
        raise ValueError("Indica las notificaciones (lista de ids) o all=true.")
    return ids


def mark_read(user_id: int, ids=None) -> Dict:
    """Marca como leídas las indicadas o todas (ids=None). Solo toca las del propio usuario."""
    with transaction() as conn:
        if ids is None:
            conn.execute("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (int(time.time()), user_id))
        else:
            ids = _ids(ids)
            conn.execute(f"UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN ({','.join('?' * len(ids))})",
                         (int(time.time()), user_id, *ids))
        unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", (user_id,)).fetchone()[0]
    return {"unread": unread}


def delete(user_id: int, ids=None) -> Dict:
    with transaction() as conn:
        if ids is None:
            conn.execute("DELETE FROM notifications WHERE user_id = ?", (user_id,))
        else:
            ids = _ids(ids)
            conn.execute(f"DELETE FROM notifications WHERE user_id = ? AND id IN ({','.join('?' * len(ids))})", (user_id, *ids))
        unread = conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL", (user_id,)).fetchone()[0]
    return {"unread": unread}


def cleanup(now: Optional[int] = None) -> int:
    """Borra las notificaciones de más de 60 días. Devuelve cuántas."""
    limit = (now or int(time.time())) - RETENTION_DAYS * 86400
    with transaction() as conn:
        return conn.execute("DELETE FROM notifications WHERE created_at < ?", (limit,)).rowcount


def price_alert(user_id: int, symbol: str, condition: str, target: float) -> None:
    """Alerta de precio disparada. Las alertas se evalúan en el navegador (viven en localStorage), así que el
    cliente avisa; el texto lo compone el servidor solo con datos validados (activo del catálogo y números)."""
    from backend.trading import prices
    if symbol not in prices.ASSETS or condition not in ("above", "below") or isinstance(target, bool) or not isinstance(target, (int, float)) \
            or not 0 < target < 1e12:
        raise ValueError("Alerta no válida.")
    verb = "ha subido hasta" if condition == "above" else "ha bajado hasta"
    with transaction() as conn:
        notify(conn, user_id, "alert", f"Alerta de precio: {symbol}", f"{symbol} {verb} {target:g} {prices.ASSETS[symbol]['quote']}.", f"/trade/{symbol}")
