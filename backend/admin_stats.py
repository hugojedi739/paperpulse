"""Estadísticas de actividad para el Resumen del panel. Salen de la base de datos, así que valen con varias instancias
(a diferencia de los contadores en memoria de security.USAGE_STATS). «Hoy» es el día UTC, como el consumo de IA."""
import datetime
import time
from contextlib import closing

from backend import contact, db


def activity() -> dict:
    start = int(datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    with closing(db.connect()) as conn:
        one = lambda sql, *a: conn.execute(sql, a).fetchone()[0]
        return {
            "trading": {
                "ordersToday": one("SELECT COUNT(*) FROM orders WHERE created_at >= ?", start),
                "fillsToday": one("SELECT COUNT(*) FROM fills WHERE executed_at >= ?", start),
                "tradersToday": one("SELECT COUNT(DISTINCT user_id) FROM fills WHERE executed_at >= ?", start),
                "openOrders": one("SELECT COUNT(*) FROM orders WHERE status = 'open'"),
            },
            "community": {
                "postsToday": one("SELECT COUNT(*) FROM posts WHERE created_at >= ? AND status != 'deleted'", start),
                "threadsToday": one("SELECT COUNT(*) FROM threads WHERE created_at >= ? AND author_id IS NOT NULL AND status != 'deleted'", start),
                "openReports": one("SELECT COUNT(DISTINCT post_id) FROM reports WHERE status = 'open'"),
            },
            "generatedAt": int(time.time()),
        }


def badges() -> dict:
    """Pendientes para los contadores de las pestañas: mensajes denunciados sin resolver y mensajes de contacto sin leer."""
    with closing(db.connect()) as conn:
        reports = conn.execute("SELECT COUNT(DISTINCT post_id) FROM reports WHERE status = 'open'").fetchone()[0]
        unread = contact.unread_count(conn)
    return {"openReports": reports, "unreadMessages": unread}
