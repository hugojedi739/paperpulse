"""Retos mensuales: una cuenta de práctica APARTE, con el mismo saldo inicial para todos y su propia clasificación.

No se duplica la lógica de trading: cada participante tiene un «usuario sombra» (users.owner_id) titular de la cuenta
del reto, y las órdenes se envían a las mismas funciones de backend/trading/ledger.py con el id del usuario sombra.
La cuenta normal del usuario no se toca. Los meses son meses naturales en hora de Madrid.
"""
import datetime
import time
from contextlib import closing
from typing import Dict, Optional

from backend import db, settings
from backend.community.common import Conflict as AlreadyJoined, require_member
from backend.db import transaction
from backend.retention import achievements
from backend.trading.ledger import Conflict, NotFound
from backend.trading.rules import OrderError
from backend.retention.streak import MADRID


def month_bounds(at: float):
    d = datetime.datetime.fromtimestamp(at, MADRID)
    start = datetime.datetime(d.year, d.month, 1, tzinfo=MADRID)
    nxt = datetime.datetime(d.year + (d.month == 12), d.month % 12 + 1, 1, tzinfo=MADRID)
    return f"{d.year}-{d.month:02d}", int(start.timestamp()), int(nxt.timestamp())


def ensure_current(conn, at: Optional[float] = None) -> Dict:
    at = at or time.time()
    slug, start, end = month_bounds(at)
    conn.execute("INSERT OR IGNORE INTO challenges (slug, starts_at, ends_at, initial_cents, created_at) VALUES (?, ?, ?, ?, ?)",
                 (slug, start, end, settings.get("challenge_initial_balance_usd") * 100, int(at)))
    return dict(conn.execute("SELECT * FROM challenges WHERE slug = ?", (slug,)).fetchone())


def _entry(conn, challenge_id: int, user_id: int):
    return conn.execute("SELECT * FROM challenge_entries WHERE challenge_id = ? AND user_id = ?", (challenge_id, user_id)).fetchone()


def join(user_id: int, at: Optional[float] = None) -> Dict:
    """Apunta al usuario al reto del mes: crea su usuario sombra y su cuenta con el saldo inicial del reto."""
    at = int(at or time.time())
    with transaction() as conn:
        require_member(conn, user_id)  # perfil, sin suspensión
        ch = ensure_current(conn, at)
        if _entry(conn, ch["id"], user_id):
            raise AlreadyJoined("Ya estás apuntado al reto de este mes.")
        cur = conn.execute("INSERT INTO users (email, name, password_hash, created_at, role, disabled, owner_id) VALUES (?, 'Reto', '', ?, 'user', 1, ?)",
                           (f"reto-{ch['slug']}-{user_id}@reto.invalid", at, user_id))
        ledger = cur.lastrowid
        conn.execute("INSERT INTO accounts (user_id, cash_cents, initial_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (ledger, ch["initial_cents"], ch["initial_cents"], at, at))
        conn.execute("INSERT INTO challenge_entries VALUES (?, ?, ?, ?)", (ch["id"], user_id, ledger, at))
        achievements.evaluate(conn, user_id)
    return status(user_id, at)


def ledger_for(user_id: int, writing: bool = False, at: Optional[float] = None) -> int:
    """Id de la cuenta del reto actual del usuario (para usar con ledger.*). Al escribir, el reto debe seguir abierto."""
    at = int(at or time.time())
    with closing(db.connect()) as conn:
        slug, _, _ = month_bounds(at)
        row = conn.execute("SELECT e.ledger_id, c.ends_at FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id "
                           "WHERE c.slug = ? AND e.user_id = ?", (slug, user_id)).fetchone()
    if not row:
        raise NotFound("No estás apuntado al reto de este mes.")
    if writing and at >= row["ends_at"]:
        raise Conflict("El reto de este mes ha terminado.")
    return row["ledger_id"]


def status(user_id: Optional[int], at: Optional[float] = None) -> Dict:
    at = int(at or time.time())
    with transaction() as conn:
        ch = ensure_current(conn, at)
        mine = _entry(conn, ch["id"], user_id) if user_id else None
        score = conn.execute("SELECT return_bps, equity_cents, trades, computed_at FROM challenge_scores WHERE challenge_id = ? AND user_id = ?",
                             (ch["id"], user_id)).fetchone() if mine else None
        n = conn.execute("SELECT COUNT(*) FROM challenge_entries WHERE challenge_id = ?", (ch["id"],)).fetchone()[0]
        past = [r["slug"] for r in conn.execute("SELECT slug FROM challenges WHERE id <> ? ORDER BY id DESC LIMIT 12", (ch["id"],))]
    return {
        "slug": ch["slug"], "startsAt": ch["starts_at"], "endsAt": ch["ends_at"], "initialCents": ch["initial_cents"],
        "open": at < ch["ends_at"], "participants": n, "joined": mine is not None, "past": past,
        "me": {"returnPct": score["return_bps"] / 100, "equityCents": score["equity_cents"], "trades": score["trades"],
               "computedAt": score["computed_at"]} if score else None,
    }


def leaderboard(slug: Optional[str], limit: int, offset: int) -> Dict:
    """Clasificación de un reto (por defecto el actual). Perfiles privados y suspendidos no aparecen."""
    if slug is not None and not (len(slug) == 7 and slug[4] == "-" and slug[:4].isdigit() and slug[5:].isdigit()):
        raise OrderError("Reto no válido.")
    with closing(db.connect()) as conn:
        ch = conn.execute("SELECT * FROM challenges WHERE slug = ?", (slug or month_bounds(time.time())[0],)).fetchone()
        if not ch:
            return {"slug": slug, "total": 0, "entries": []}
        where = ("FROM challenge_scores s JOIN profiles p ON p.user_id = s.user_id JOIN users u ON u.id = s.user_id "
                 "WHERE s.challenge_id = ? AND s.trades >= 1 AND p.is_private = 0 AND u.disabled = 0 "
                 "AND (u.suspended_until IS NULL OR u.suspended_until <= ?)")
        args = (ch["id"], int(time.time()))
        total = conn.execute(f"SELECT COUNT(*) {where}", args).fetchone()[0]
        rows = conn.execute(f"SELECT p.alias, s.return_bps, s.trades {where} ORDER BY s.return_bps DESC, s.trades DESC, p.alias LIMIT ? OFFSET ?",
                            (*args, limit, offset)).fetchall()
    return {"slug": ch["slug"], "total": total, "finalized": bool(ch["finalized"]), "initialCents": ch["initial_cents"],
            "entries": [{"rank": offset + i + 1, "alias": r["alias"], "returnPct": r["return_bps"] / 100, "trades": r["trades"]} for i, r in enumerate(rows)]}
