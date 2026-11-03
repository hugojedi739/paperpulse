"""Foro: categorías, hilos, respuestas, votos, denuncias y operaciones compartidas.

Reglas de visibilidad de un mensaje (posts.status):
  - visible: se muestra a todos.
  - deleted: lo borró su autor. Se muestra «Mensaje eliminado por su autor», sin el texto, ni siquiera a admins.
  - hidden:  lo ocultó un moderador. Se muestra «Oculto por moderación»; los admins ven el texto para revisarlo.
Si el mensaje es el primero de un hilo, el hilo sigue el mismo estado: oculto (desaparece, 404 para no admins) o
borrado (no aparece en las listas ni admite respuestas, pero sus respuestas siguen accesibles por enlace).
"""
from contextlib import closing
from typing import Dict, List, Optional

from backend import db
from backend.community import text
from backend.community.common import CommunityError, Conflict, Forbidden, NotFound, check_quota, log, now, require_member
from backend.trading import prices
from backend.trading.ledger import transaction
from backend.trading.rules import E8

PAGE = 20
SORTS = ("top", "recent")
REPORT_REASONS = ("spam", "abuso", "estafa", "otro")
_assets_ready = set()  # bases (ruta o URL) donde ya se han creado los hilos de activo


# ---------------------------------------------------------------- categorías e hilos de activo
def ensure_asset_threads(conn) -> None:
    """Un hilo automático por activo del catálogo (idempotente; los activos nuevos reciben su hilo solos)."""
    key = db.DB_LABEL if db.USE_TURSO else db.DB_PATH
    if key in _assets_ready:
        return
    cat = conn.execute("SELECT id FROM forum_categories WHERE kind = 'asset'").fetchone()[0]
    t = now()
    for sym, a in prices.ASSETS.items():
        conn.execute("INSERT OR IGNORE INTO threads (category_id, author_id, title, symbol, created_at, last_post_at) "
                     "VALUES (?, NULL, ?, ?, ?, ?)", (cat, f"{sym} · {a['name']}", sym, t, t))
    _assets_ready.add(key)


def categories() -> Dict:
    with closing(db.connect()) as conn:
        ensure_asset_threads(conn)
        rows = conn.execute(
            "SELECT c.slug, c.name, c.description, c.kind, (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id "
            "AND t.status = 'visible') AS threads, (SELECT MAX(t.last_post_at) FROM threads t WHERE t.category_id = c.id "
            "AND t.status = 'visible') AS last_post_at FROM forum_categories c ORDER BY c.position").fetchall()
    return {"categories": [{"slug": r["slug"], "name": r["name"], "description": r["description"], "kind": r["kind"],
                            "threads": r["threads"], "lastPostAt": r["last_post_at"]} for r in rows]}


def _category(conn, slug: str) -> Dict:
    r = conn.execute("SELECT * FROM forum_categories WHERE slug = ?", (str(slug or ""),)).fetchone()
    if not r:
        raise NotFound("Esa categoría no existe.")
    return dict(r)


# ---------------------------------------------------------------- serialización (sin emails, nunca)
def _trade_json(conn, fill_id: Optional[int]) -> Optional[Dict]:
    """Datos de la operación compartida, leídos SIEMPRE de fills (el usuario no puede escribirlos)."""
    if not fill_id:
        return None
    f = conn.execute("SELECT * FROM fills WHERE id = ?", (fill_id,)).fetchone()
    if not f:
        return None
    a = prices.ASSETS.get(f["symbol"], {})
    pnl_pct = f["pnl_cents"] * 100 / f["cost_basis_cents"] if f["pnl_cents"] is not None and f["cost_basis_cents"] else None
    return {
        "symbol": f["symbol"], "name": a.get("name", f["symbol"]), "quote": a.get("quote"), "side": f["side"],
        "quantity": f["qty_e8"] / E8, "price": f["price_e8"] / E8,
        "entryPrice": f["entry_price_e8"] / E8 if f["entry_price_e8"] else None,
        "pnlCents": f["pnl_cents"], "pnlPct": round(pnl_pct, 2) if pnl_pct is not None else None,
        "executedAt": f["executed_at"],
    }


def _post_json(r, viewer_id: Optional[int], is_admin: bool, my_votes: Dict[int, int]) -> Dict:
    status = r["status"]
    show_body = status == "visible" or (status == "hidden" and is_admin)
    return {
        "id": r["id"], "threadId": r["thread_id"],
        "author": r["alias"],  # alias público; nunca email ni id de usuario
        "body": r["body"] if show_body else None,
        "status": status,
        "notice": {"deleted": "Mensaje eliminado por su autor.", "hidden": "Mensaje oculto por moderación."}.get(status),
        "score": r["score"], "myVote": my_votes.get(r["id"], 0),
        "mine": viewer_id is not None and r["author_id"] == viewer_id,
        "createdAt": r["created_at"],
    }


POST_COLS = "po.id, po.thread_id, po.author_id, po.body, po.score, po.status, po.created_at, pr.alias"
POST_FROM = "FROM posts po LEFT JOIN profiles pr ON pr.user_id = po.author_id"


def _my_votes(conn, viewer_id: Optional[int], post_ids: List[int]) -> Dict[int, int]:
    if not viewer_id or not post_ids:
        return {}
    rows = conn.execute(f"SELECT post_id, value FROM votes WHERE user_id = ? AND post_id IN ({','.join('?' * len(post_ids))})",
                        (viewer_id, *post_ids)).fetchall()
    return {r["post_id"]: r["value"] for r in rows}


def _thread_summary(conn, t, viewer_id: Optional[int]) -> Dict:
    first = None
    if t["first_post_id"]:
        r = conn.execute(f"SELECT {POST_COLS} {POST_FROM} WHERE po.id = ?", (t["first_post_id"],)).fetchone()
        first = dict(r) if r else None
    replies = conn.execute("SELECT COUNT(*) FROM posts WHERE thread_id = ? AND status = 'visible' AND id IS NOT ?",
                           (t["id"], t["first_post_id"])).fetchone()[0]
    return {
        "id": t["id"], "title": t["title"], "symbol": t["symbol"], "status": t["status"],
        "author": first["alias"] if first else None, "score": first["score"] if first else 0,
        "replies": replies, "createdAt": t["created_at"], "lastPostAt": t["last_post_at"],
        "trade": _trade_json(conn, t["fill_id"]),
        "mine": bool(viewer_id) and t["author_id"] == viewer_id,
    }


# ---------------------------------------------------------------- lectura
def list_threads(slug: str, sort: str, page: int, viewer_id: Optional[int]) -> Dict:
    if sort not in SORTS:
        raise CommunityError("Orden no válido. Usa top o recent.")
    with closing(db.connect()) as conn:
        ensure_asset_threads(conn)
        cat = _category(conn, slug)
        order = "COALESCE(fp.score, 0) DESC, t.last_post_at DESC" if sort == "top" else "t.last_post_at DESC"
        if cat["kind"] == "asset":
            order = "t.title" if sort == "top" else "t.last_post_at DESC"  # los hilos de activo no reciben votos
        rows = conn.execute(
            f"SELECT t.* FROM threads t LEFT JOIN posts fp ON fp.id = t.first_post_id WHERE t.category_id = ? AND t.status = 'visible' "
            f"ORDER BY {order}, t.id DESC LIMIT ? OFFSET ?", (cat["id"], PAGE + 1, (page - 1) * PAGE)).fetchall()
        threads = [_thread_summary(conn, t, viewer_id) for t in rows[:PAGE]]
    return {"category": {"slug": cat["slug"], "name": cat["name"], "kind": cat["kind"], "description": cat["description"]},
            "sort": sort, "page": page, "hasMore": len(rows) > PAGE, "threads": threads}


def asset_thread(symbol: str) -> Dict:
    with closing(db.connect()) as conn:
        ensure_asset_threads(conn)
        r = conn.execute("SELECT id FROM threads WHERE symbol = ?", (str(symbol or "").upper(),)).fetchone()
    if not r:
        raise NotFound("Ese activo no tiene hilo en el foro.")
    return {"threadId": r["id"]}


def get_thread(thread_id: int, sort: str, page: int, viewer_id: Optional[int], is_admin: bool) -> Dict:
    if sort not in SORTS:
        raise CommunityError("Orden no válido. Usa top o recent.")
    with closing(db.connect()) as conn:
        t = conn.execute("SELECT * FROM threads WHERE id = ?", (thread_id,)).fetchone()
        if not t or (t["status"] == "hidden" and not is_admin):
            raise NotFound("Ese hilo no existe o ha sido retirado.")
        summary = _thread_summary(conn, t, viewer_id)
        first = None
        if t["first_post_id"]:
            first = conn.execute(f"SELECT {POST_COLS} {POST_FROM} WHERE po.id = ?", (t["first_post_id"],)).fetchone()
        order = "po.score DESC, po.id ASC" if sort == "top" else "po.id ASC"
        # Respuestas: las borradas/ocultas se muestran como aviso para no romper la conversación
        replies = conn.execute(f"SELECT {POST_COLS} {POST_FROM} WHERE po.thread_id = ? AND po.id IS NOT ? ORDER BY {order} LIMIT ? OFFSET ?",
                               (thread_id, t["first_post_id"], PAGE + 1, (page - 1) * PAGE)).fetchall()
        ids = [r["id"] for r in replies[:PAGE]] + ([first["id"]] if first else [])
        votes = _my_votes(conn, viewer_id, ids)
        cat = conn.execute("SELECT slug, name, kind FROM forum_categories WHERE id = ?", (t["category_id"],)).fetchone()
    return {
        "thread": {**summary, "category": {"slug": cat["slug"], "name": cat["name"], "kind": cat["kind"]},
                   "acceptsReplies": t["status"] == "visible"},
        "firstPost": _post_json(first, viewer_id, is_admin, votes) if first else None,
        "replies": [_post_json(r, viewer_id, is_admin, votes) for r in replies[:PAGE]],
        "sort": sort, "page": page, "hasMore": len(replies) > PAGE,
    }


def feed_items(conn, post_ids: List[int], viewer_id: int) -> List[Dict]:
    if not post_ids:
        return []
    rows = conn.execute(f"SELECT {POST_COLS}, t.title, t.fill_id, t.first_post_id, t.symbol {POST_FROM} "
                        f"JOIN threads t ON t.id = po.thread_id WHERE po.id IN ({','.join('?' * len(post_ids))}) ORDER BY po.id DESC",
                        post_ids).fetchall()
    votes = _my_votes(conn, viewer_id, post_ids)
    return [{**_post_json(r, viewer_id, False, votes), "threadTitle": r["title"], "isThreadStart": r["id"] == r["first_post_id"],
             "trade": _trade_json(conn, r["fill_id"]) if r["id"] == r["first_post_id"] else None} for r in rows]


# ---------------------------------------------------------------- escritura
def _insert_post(conn, thread_id: int, author_id: int, body: str) -> int:
    t = now()
    cur = conn.execute("INSERT INTO posts (thread_id, author_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                       (thread_id, author_id, body, t, t))
    conn.execute("UPDATE threads SET last_post_at = ? WHERE id = ?", (t, thread_id))
    return cur.lastrowid


def _create_thread(conn, a: Dict, category_id: int, title: str, body: str, fill_id: Optional[int] = None) -> int:
    t = now()
    cur = conn.execute("INSERT INTO threads (category_id, author_id, title, fill_id, created_at, last_post_at) VALUES (?, ?, ?, ?, ?, ?)",
                       (category_id, a["id"], title, fill_id, t, t))
    tid = cur.lastrowid
    pid = _insert_post(conn, tid, a["id"], body)
    conn.execute("UPDATE threads SET first_post_id = ? WHERE id = ?", (pid, tid))
    return tid


def create_thread(user_id: int, slug: str, title, body) -> Dict:
    title = text.clean(title, "title", multiline=False)
    body = text.clean(body, "body")
    with transaction() as conn:
        a = require_member(conn, user_id)
        cat = _category(conn, slug)
        if cat["kind"] != "general":
            raise CommunityError("En esa categoría no se pueden abrir hilos: responde en el hilo del activo o comparte una operación.")
        check_quota(conn, a, new_thread=True, body=body)
        tid = _create_thread(conn, a, cat["id"], title, body)
    return {"threadId": tid}


def reply(user_id: int, thread_id: int, body) -> Dict:
    body = text.clean(body, "body")
    with transaction() as conn:
        a = require_member(conn, user_id)
        t = conn.execute("SELECT status FROM threads WHERE id = ?", (thread_id,)).fetchone()
        if not t or t["status"] == "hidden":
            raise NotFound("Ese hilo no existe o ha sido retirado.")
        if t["status"] != "visible":
            raise Conflict("Ese hilo ya no admite respuestas.")
        check_quota(conn, a, new_thread=False, body=body)
        pid = _insert_post(conn, thread_id, user_id, body)
    return {"postId": pid, "threadId": thread_id}


def share_fill(user_id: int, fill_id, comment) -> Dict:
    """Crea un hilo con una operación PROPIA y REAL. Activo, lado, precio y resultado salen de `fills`."""
    if isinstance(fill_id, bool) or not isinstance(fill_id, int):
        raise CommunityError("Indica la operación que quieres compartir.")
    comment = text.clean(comment, "comment")
    with transaction() as conn:
        a = require_member(conn, user_id)
        f = conn.execute("SELECT * FROM fills WHERE id = ? AND user_id = ?", (fill_id, user_id)).fetchone()
        if not f:
            raise NotFound("Esa operación no existe o no es tuya.")  # mismo mensaje: no revela fills ajenos
        if conn.execute("SELECT 1 FROM threads WHERE fill_id = ?", (fill_id,)).fetchone():
            raise Conflict("Ya has compartido esa operación.")
        trade = _trade_json(conn, fill_id)
        title = _trade_title(trade)
        check_quota(conn, a, new_thread=True, body=comment or None)  # sin comentario no hay duplicado que comprobar
        body = comment or "(Sin comentario)"
        cat = conn.execute("SELECT id FROM forum_categories WHERE kind = 'trades'").fetchone()[0]
        tid = _create_thread(conn, a, cat, title, body, fill_id=fill_id)
    return {"threadId": tid}


def _num(x: float, decimals: int = 2) -> str:
    s = f"{x:,.{decimals}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def _trade_title(tr: Dict) -> str:
    price = f"{_num(tr['price'], 2 if tr['price'] >= 1 else 6)} {tr['quote']}"
    if tr["side"] == "buy":
        return f"Compra de {tr['symbol']} a {price}"
    sign = "+" if (tr["pnlPct"] or 0) >= 0 else ""
    return f"Venta de {tr['symbol']} a {price} ({sign}{_num(tr['pnlPct'] or 0)} %)"


def vote(user_id: int, post_id: int, value) -> Dict:
    if value not in (1, -1, 0) or isinstance(value, bool):
        raise CommunityError("El voto debe ser 1, -1 o 0 (quitar el voto).")
    with transaction() as conn:
        require_member(conn, user_id)
        p = conn.execute("SELECT author_id, status, score FROM posts WHERE id = ?", (post_id,)).fetchone()
        if not p:
            raise NotFound("Ese mensaje no existe.")
        if p["status"] != "visible":
            raise Conflict("No se puede votar un mensaje eliminado u oculto.")
        if p["author_id"] == user_id:
            raise Forbidden("No puedes votar tus propios mensajes.")
        old = conn.execute("SELECT value FROM votes WHERE post_id = ? AND user_id = ?", (post_id, user_id)).fetchone()
        old = old["value"] if old else 0
        if value == 0:
            conn.execute("DELETE FROM votes WHERE post_id = ? AND user_id = ?", (post_id, user_id))
        else:
            conn.execute("INSERT INTO votes VALUES (?, ?, ?, ?) ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value",
                         (post_id, user_id, value, now()))
        conn.execute("UPDATE posts SET score = score + ? WHERE id = ?", (value - old, post_id))
        score = conn.execute("SELECT score FROM posts WHERE id = ?", (post_id,)).fetchone()[0]
    return {"postId": post_id, "score": score, "myVote": value}


def delete_own(user_id: int, post_id: int) -> Dict:
    """El autor borra su mensaje (borrado lógico). Si es el primero del hilo, el hilo deja de listarse."""
    with transaction() as conn:
        p = conn.execute("SELECT po.author_id, po.status, po.thread_id, t.first_post_id FROM posts po "
                         "JOIN threads t ON t.id = po.thread_id WHERE po.id = ?", (post_id,)).fetchone()
        if not p or p["author_id"] != user_id:
            raise NotFound("Ese mensaje no existe o no es tuyo.")
        if p["status"] == "deleted":
            return {"postId": post_id, "status": "deleted"}
        conn.execute("UPDATE posts SET status = 'deleted', updated_at = ? WHERE id = ?", (now(), post_id))
        if p["first_post_id"] == post_id:
            conn.execute("UPDATE threads SET status = 'deleted' WHERE id = ? AND status = 'visible'", (p["thread_id"],))
        log(conn, user_id, "author_delete", "post", post_id)
    return {"postId": post_id, "status": "deleted"}


def report(user_id: int, post_id: int, reason, details) -> Dict:
    if reason not in REPORT_REASONS:
        raise CommunityError(f"Motivo no válido. Usa uno de: {', '.join(REPORT_REASONS)}.")
    details = text.clean(details, "details")
    with transaction() as conn:
        require_member(conn, user_id)
        p = conn.execute("SELECT po.author_id, po.status, po.body, pr.alias FROM posts po "
                         "LEFT JOIN profiles pr ON pr.user_id = po.author_id WHERE po.id = ?", (post_id,)).fetchone()
        if not p or p["status"] == "deleted":
            raise NotFound("Ese mensaje no existe.")
        if p["author_id"] == user_id:
            raise CommunityError("No puedes denunciar tus propios mensajes.")
        try:
            # Copia del mensaje y del autor: el moderador verá lo denunciado aunque luego se borre o cambie
            conn.execute("INSERT INTO reports (post_id, reporter_id, reason, details, created_at, post_body, post_author_id, "
                         "post_author_alias) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                         (post_id, user_id, reason, details, now(), p["body"], p["author_id"], p["alias"]))
        except Exception as exc:
            if db.is_integrity_error(exc):
                raise Conflict("Ya has denunciado ese mensaje. Lo revisará un moderador.") from None
            raise
    return {"postId": post_id, "reported": True}

