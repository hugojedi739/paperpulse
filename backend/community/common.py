"""Piezas comunes de la comunidad: errores con su código HTTP, quién es el usuario y cuotas anti-spam."""
import re
import time
from typing import Dict, Optional

NEW_ACCOUNT_SECONDS = 24 * 3600
# Cuotas por 24 h (se cuentan en la base de datos, así que valen aunque haya varias instancias serverless).
# Las cuentas sin verificar de menos de 24 h tienen cuotas mucho menores (y no pueden publicar enlaces);
# las verificadas (Google/Okta) y los administradores están exentos.
QUOTAS = {
    "new": {"posts": 10, "threads": 3},
    "regular": {"posts": 100, "threads": 20},
}
LINK_RE = re.compile(r"(https?://|www\.|t\.me/|wa\.me/|\b[a-z0-9-]+\.(com|net|org|io|es|app|xyz|me|ly)/)", re.I)
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
        "SELECT u.id, u.role, u.created_at, u.disabled, u.email_verified, u.terms_version, u.suspended_until, u.suspension_reason, p.alias, p.is_private "
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
    if a["terms_version"] is None:
        raise Forbidden("Acepta los términos y la política de privacidad para participar en la comunidad.")
    if not a["alias"]:
        raise Forbidden("Crea tu perfil público (alias) antes de participar en la comunidad.")
    return a


def check_quota(conn, a: Dict, new_thread: bool, body: Optional[str]) -> None:
    """Cuotas diarias, más estrictas para cuentas nuevas, y rechazo de mensajes duplicados (si se pasa `body`)."""
    t = now()
    # Límites de cuentas NO verificadas (email y contraseña) durante sus primeras 24 h. Las cuentas verificadas
    # (Google) y las de administrador quedan exentas; el administrador, además, de las cuotas diarias.
    tier = "new" if (not a["email_verified"] and a["role"] != "admin" and t - a["created_at"] < NEW_ACCOUNT_SECONDS) else "regular"
    since = t - 24 * 3600
    if tier == "new" and body and LINK_RE.search(body):
        raise Forbidden("Las cuentas sin verificar no pueden publicar enlaces durante sus primeras 24 horas.")
    # Se cuentan también los mensajes borrados u ocultos: borrar no devuelve cupo
    posts = conn.execute("SELECT COUNT(*) FROM posts WHERE author_id = ? AND created_at > ?", (a["id"], since)).fetchone()[0]
    if a["role"] != "admin" and posts >= QUOTAS[tier]["posts"]:
        extra = " Las cuentas nuevas tienen un límite menor durante sus primeras 24 horas." if tier == "new" else ""
        raise TooMany(f"Has alcanzado el máximo de {QUOTAS[tier]['posts']} mensajes en 24 horas.{extra}")
    if new_thread and a["role"] != "admin":
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
