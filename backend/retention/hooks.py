"""Enganches de retención que se llaman desde la lógica de trading, dentro de su transacción.

Todo va protegido: un fallo en notificaciones o logros NUNCA debe deshacer una operación.
"""
import sys

from backend.retention import achievements, notifications, streak

AUTO_CLOSE = ("stop loss", "take profit", "liquidación")  # fills de cierres automáticos (ledger._resolve_exits)
IMMEDIATE = "cotización"  # fills ejecutados al recibir la orden (el usuario ya ve el resultado en pantalla)


def _safe(fn):
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001
            print(f"[Retención] {fn.__name__}: {exc}", file=sys.stderr)
    return wrapper


@_safe
def after_fill(conn, user_id: int, order: dict, price_e8: int, executed_at: int, source: str) -> None:
    owner = conn.execute("SELECT owner_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if owner and not owner["owner_id"]:
        streak.record(conn, user_id, executed_at)
    if source in AUTO_CLOSE:  # Stop Loss, Take Profit o liquidación de un corto: lo cierra el servidor
        reason = order.get("reason") or "Cierre automático"
        kind = "Short" if order.get("direction") == "short" else "Long"
        notifications.notify(conn, user_id, "order", f"{reason.split(':')[0]}: {order['symbol']} ({kind})",
                             f"{reason}. {kind} de {order['symbol']} cerrado a {price_e8 / 1e8:g}.", f"/trade/{order['symbol']}")
    elif source != IMMEDIATE:  # límite/stop resuelto con velas: el usuario no estaba delante
        side = "Compra" if order["side"] == "buy" else "Venta"
        kind = "límite" if order["type"] == "limit" else "stop"
        notifications.notify(conn, user_id, "order", f"Orden {kind} ejecutada: {side.lower()} de {order['symbol']}",
                             f"{side} {kind} de {order['symbol']} ejecutada a {price_e8 / 1e8:g}.", f"/trade/{order['symbol']}")
    achievements.evaluate(conn, user_id)


@_safe
def order_rejected(conn, user_id: int, order: dict, reason: str) -> None:
    notifications.notify(conn, user_id, "order", f"Orden rechazada: {order['symbol']}", reason, f"/trade/{order['symbol']}")


@_safe
def after_order_placed(conn, user_id: int) -> None:
    achievements.evaluate(conn, user_id)


@_safe
def after_thread(conn, user_id: int) -> None:
    achievements.evaluate(conn, user_id)


@_safe
def reply_posted(conn, thread_id: int, replier_id: int, replier_alias: str) -> None:
    t = conn.execute("SELECT author_id, title FROM threads WHERE id = ?", (thread_id,)).fetchone()
    if t and t["author_id"] and t["author_id"] != replier_id:
        notifications.notify(conn, t["author_id"], "reply", "Nueva respuesta en tu hilo", f"{replier_alias} ha respondido en «{t['title']}».",
                             f"/community/thread:{thread_id}")


@_safe
def new_follower(conn, followee_id: int, follower_alias: str) -> None:
    notifications.notify(conn, followee_id, "follower", "Nuevo seguidor", f"{follower_alias} ha empezado a seguirte.", f"/community/user:{follower_alias}")
    achievements.evaluate(conn, followee_id)


@_safe
def post_hidden(conn, author_id: int, reason: str) -> None:
    notifications.notify(conn, author_id, "hidden", "Un moderador ha ocultado un mensaje tuyo",
                         f"Incumplía las normas de la comunidad. Motivo: {reason}" if reason else "Incumplía las normas de la comunidad.", "/legal/normas")
