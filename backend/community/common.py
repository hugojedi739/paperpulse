"""Piezas comunes de la comunidad: errores con su código HTTP, quién es el usuario y cuotas anti-spam."""
import time
from typing import Dict, Optional

NEW_ACCOUNT_SECONDS = 24 * 3600
# Cuotas por 24 h (se cuentan en la base de datos, así que valen aunque haya varias instancias serverless).
# Las cuentas de menos de 24 h tienen cuotas mucho menores: aún no hay verificación de email (llegará en la fase 3).
QUOTAS = {
    "new": {"posts": 10, "threads": 3},
    "regular": {"posts": 100, "threads": 20},
}
DUPLICATE_WINDOW = 600  # el mismo mensaje dos veces en 10 minutos se rechaza


class CommunityError(ValueError):
    """Error con mensaje para el usuario. `status` es el código HTTP."""
    status = 400


class Forbidden(CommunityError):
    status = 403


class NotFound(CommunityError):
    status = 404


class Conflict(CommunityError):
    status = 409


class TooMany(CommunityError):
    status = 429


def now() -> int:
    return int(time.time())


def actor(conn, user_id: int) -> Optional[Dict]:
    """Datos del usuario que actúa. Nunca incluye el email."""
    row = conn.execute(
        "SELECT u.id, u.role, u.created_at, u.disabled, u.suspended_until, u.suspension_reason, p.alias, p.is_private "
        "FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def is_suspended(a: Dict, at: Optional[int] = None) -> bool:
    return bool(a.get("suspended_until")) and a["suspended_until"] > (at or now())


def require_member(conn, user_id: int) -> Dict:
    """Para publicar, votar, denunciar o seguir: tener perfil y no estar suspendido."""
    a = actor(conn, user_id)
    if not a or a["disabled"]:
        raise Forbidden("Tu cuenta no está activa.")
    if is_suspended(a):
        until = time.strftime("%d/%m/%Y %H:%M UTC", time.gmtime(a["suspended_until"]))
        reason = f" Motivo: {a['suspension_reason']}" if a["suspension_reason"] else ""
        raise Forbidden(f"Tu cuenta está suspendida en la comunidad hasta el {until}.{reason}")
    if not a["alias"]:
        raise Forbidden("Crea tu perfil público (alias) antes de participar en la comunidad.")
    return a


def check_quota(conn, a: Dict, new_thread: bool, body: Optional[str]) -> None:
    """Cuotas diarias, más estrictas para cuentas nuevas, y rechazo de mensajes duplicados (si se pasa `body`)."""
    t = now()
    tier = "new" if t - a["created_at"] < NEW_ACCOUNT_SECONDS else "regular"
    since = t - 24 * 3600
    # Se cuentan también los mensajes borrados u ocultos: borrar no devuelve cupo
    posts = conn.execute("SELECT COUNT(*) FROM posts WHERE author_id = ? AND created_at > ?", (a["id"], since)).fetchone()[0]
    if posts >= QUOTAS[tier]["posts"]:
        extra = " Las cuentas nuevas tienen un límite menor durante sus primeras 24 horas." if tier == "new" else ""
        raise TooMany(f"Has alcanzado el máximo de {QUOTAS[tier]['posts']} mensajes en 24 horas.{extra}")
    if new_thread:
        threads = conn.execute("SELECT COUNT(*) FROM threads WHERE author_id = ? AND created_at > ?", (a["id"], since)).fetchone()[0]
        if threads >= QUOTAS[tier]["threads"]:
            extra = " Las cuentas nuevas tienen un límite menor durante sus primeras 24 horas." if tier == "new" else ""
            raise TooMany(f"Has alcanzado el máximo de {QUOTAS[tier]['threads']} hilos nuevos en 24 horas.{extra}")
    if body is None:
        return
    dup = conn.execute("SELECT 1 FROM posts WHERE author_id = ? AND body = ? AND created_at > ? LIMIT 1",
                       (a["id"], body, t - DUPLICATE_WINDOW)).fetchone()
    if dup:
        raise Conflict("Ya has publicado ese mismo mensaje hace un momento.")


def log(conn, actor_id: Optional[int], action: str, target_type: str, target_id: int, reason: str = "") -> None:
    conn.execute("INSERT INTO moderation_log (actor_id, action, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                 (actor_id, action, target_type, target_id, reason, now()))
