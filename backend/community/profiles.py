"""Perfiles públicos, seguidores y feed. Ninguna respuesta incluye el email ni datos de cuentas privadas."""
import re
from contextlib import closing
from typing import Dict, Optional

from backend import db
from backend.community import ranking, text
from backend.community.common import CommunityError, Conflict, Forbidden, NotFound, actor, is_suspended, now, require_member
from backend.trading.ledger import transaction


def _suspension(a: Dict) -> Optional[Dict]:
    return {"until": a["suspended_until"], "reason": a["suspension_reason"] or ""} if is_suspended(a) else None


def mine(user_id: int) -> Dict:
    """Mi perfil (o null si aún no lo he creado) y mi estado en la comunidad."""
    with closing(db.connect()) as conn:
        a = actor(conn, user_id)
        p = conn.execute("SELECT alias, bio, is_private, created_at FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    return {
        "profile": {"alias": p["alias"], "bio": p["bio"], "isPrivate": bool(p["is_private"]), "createdAt": p["created_at"]} if p else None,
        "suspension": _suspension(a), "isAdmin": a["role"] == "admin",
    }


def save_mine(user_id: int, body: Dict) -> Dict:
    alias = text.alias(body.get("alias"))
    bio = text.clean(body.get("bio", ""), "bio")
    private = body.get("isPrivate", False)
    if not isinstance(private, bool):
        raise CommunityError("isPrivate debe ser verdadero o falso.")
    t = now()
    try:
        with transaction() as conn:
            conn.execute(
                "INSERT INTO profiles (user_id, alias, bio, is_private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET alias = excluded.alias, bio = excluded.bio, is_private = excluded.is_private, "
                "updated_at = excluded.updated_at", (user_id, alias, bio, int(private), t, t))
    except Exception as exc:
        if db.is_integrity_error(exc):
            raise Conflict("Ese alias ya está en uso. Elige otro.") from None
        raise
    return mine(user_id)


def _profile_row(conn, alias: str) -> Dict:
    if not isinstance(alias, str) or not text.ALIAS_RE.match(alias):
        raise NotFound("Ese perfil no existe.")
    r = conn.execute("SELECT p.user_id, p.alias, p.bio, p.is_private, u.created_at AS joined_at, u.disabled "
                     "FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.alias = ?", (alias,)).fetchone()
    if not r or r["disabled"]:
        raise NotFound("Ese perfil no existe.")
    return dict(r)


def public(alias: str, viewer_id: Optional[int]) -> Dict:
    ranking.refresh()
    with closing(db.connect()) as conn:
        p = _profile_row(conn, alias)
        own = viewer_id == p["user_id"]
        if p["is_private"] and not own:
            # De un perfil privado solo se confirma que existe (sus mensajes del foro siguen siendo públicos)
            return {"alias": p["alias"], "isPrivate": True}
        uid = p["user_id"]
        count = lambda sql: conn.execute(sql, (uid,)).fetchone()[0]
        return {
            "alias": p["alias"], "isPrivate": bool(p["is_private"]), "isMe": own, "bio": p["bio"],
            "joinedAt": p["joined_at"],
            "trades": count("SELECT COUNT(*) FROM fills WHERE user_id = ?"),
            "performance": ranking.user_return(conn, uid),
            "followers": count("SELECT COUNT(*) FROM follows WHERE followee_id = ?"),
            "following": count("SELECT COUNT(*) FROM follows WHERE follower_id = ?"),
            "posts": count("SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = 'visible'"),
            "isFollowing": bool(viewer_id) and conn.execute(
                "SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?", (viewer_id, uid)).fetchone() is not None,
        }


def search(q: str, limit: int) -> Dict:
    """Busca perfiles PÚBLICOS por el principio del alias. Los privados y suspendidos no aparecen."""
    q = (q or "").strip()
    if q and not re.fullmatch(r"[A-Za-z0-9_]{1,20}", q):
        return {"profiles": []}  # un alias nunca tiene otros caracteres
    like = q.replace("\\", "\\\\").replace("_", "\\_").replace("%", "\\%") + "%"
    with closing(db.connect()) as conn:
        rows = conn.execute(
            "SELECT p.alias, p.bio FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.is_private = 0 AND u.disabled = 0 "
            "AND (u.suspended_until IS NULL OR u.suspended_until <= ?) AND p.alias LIKE ? ESCAPE '\\' ORDER BY p.alias LIMIT ?",
            (now(), like, limit)).fetchall()
    return {"profiles": [{"alias": r["alias"], "bio": r["bio"]} for r in rows]}


def follow(user_id: int, alias: str, on: bool) -> Dict:
    with transaction() as conn:
        if on:
            require_member(conn, user_id)  # un suspendido no puede seguir a nadie
        target = _profile_row(conn, alias)
        if target["user_id"] == user_id:
            raise CommunityError("No puedes seguirte a ti mismo.")
        if on:
            if target["is_private"]:
                raise Forbidden("Ese perfil es privado.")
            conn.execute("INSERT OR IGNORE INTO follows VALUES (?, ?, ?)", (user_id, target["user_id"], now()))
        else:
            conn.execute("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?", (user_id, target["user_id"]))
    return {"alias": target["alias"], "isFollowing": on}


def following(user_id: int) -> Dict:
    with closing(db.connect()) as conn:
        rows = conn.execute("SELECT p.alias, p.is_private FROM follows f JOIN profiles p ON p.user_id = f.followee_id "
                            "WHERE f.follower_id = ? ORDER BY p.alias", (user_id,)).fetchall()
    return {"following": [{"alias": r["alias"], "isPrivate": bool(r["is_private"])} for r in rows]}


def feed(user_id: int, before: Optional[int], limit: int) -> Dict:
    """Mensajes visibles (hilos, respuestas y operaciones compartidas) de las personas a las que sigo."""
    from backend.community import forum  # evita importación circular
    sql = ("SELECT po.id FROM posts po JOIN follows f ON f.followee_id = po.author_id JOIN threads t ON t.id = po.thread_id "
           "WHERE f.follower_id = ? AND po.status = 'visible' AND t.status = 'visible'")
    args = [user_id]
    if before:
        sql, args = sql + " AND po.id < ?", args + [before]
    with closing(db.connect()) as conn:
        ids = [r[0] for r in conn.execute(sql + " ORDER BY po.id DESC LIMIT ?", (*args, limit + 1))]
        items = forum.feed_items(conn, ids[:limit], user_id)
    return {"items": items, "hasMore": len(ids) > limit, "nextBefore": ids[limit - 1] if len(ids) > limit else None}

