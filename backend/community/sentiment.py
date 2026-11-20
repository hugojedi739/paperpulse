"""Opinión de la comunidad por activo: voto alcista o bajista (uno por usuario y activo, cambiable y retirable).

Es una opinión, no una recomendación. El reparto es solo un recuento: nunca se dice quién votó qué. Votar exige
sesión, perfil, términos aceptados y no estar suspendido (como el foro). Los votos de cuentas desactivadas o
suspendidas no cuentan en el reparto. Solo se vota sobre activos del catálogo.
"""
from contextlib import closing
from typing import Dict, Optional

from backend import db
from backend.community.common import CommunityError, NotFound, now, require_member
from backend.trading import prices
from backend.trading.ledger import transaction


def _symbol(symbol) -> str:
    sym = str(symbol or "").upper().strip()
    if sym not in prices.ASSETS:
        raise NotFound("Ese activo no está en el catálogo.")
    return sym


def _summary(conn, sym: str, user_id: Optional[int]) -> Dict:
    t = now()
    rows = conn.execute(
        "SELECT v.value, COUNT(*) AS n FROM asset_votes v JOIN users u ON u.id = v.user_id "
        "WHERE v.symbol = ? AND u.disabled = 0 AND (u.suspended_until IS NULL OR u.suspended_until <= ?) GROUP BY v.value",
        (sym, t)).fetchall()
    counts = {r["value"]: r["n"] for r in rows}
    mine = conn.execute("SELECT value FROM asset_votes WHERE user_id = ? AND symbol = ?", (user_id, sym)).fetchone() if user_id else None
    thread = conn.execute("SELECT id FROM threads WHERE symbol = ? AND status = 'visible'", (sym,)).fetchone()
    bull, bear = counts.get(1, 0), counts.get(-1, 0)
    return {"symbol": sym, "bullish": bull, "bearish": bear, "total": bull + bear,
            "myVote": mine["value"] if mine else 0, "threadId": thread["id"] if thread else None}


def get(symbol, user_id: Optional[int]) -> Dict:
    sym = _symbol(symbol)
    with closing(db.connect()) as conn:
        return _summary(conn, sym, user_id)


def vote(user_id: int, symbol, value) -> Dict:
    if value not in (1, -1, 0) or isinstance(value, bool):
        raise CommunityError("El voto debe ser 1 (alcista), -1 (bajista) o 0 (retirar el voto).")
    sym = _symbol(symbol)
    with transaction() as conn:
        require_member(conn, user_id)
        if value == 0:
            conn.execute("DELETE FROM asset_votes WHERE user_id = ? AND symbol = ?", (user_id, sym))
        else:
            t = now()
            conn.execute("INSERT INTO asset_votes (user_id, symbol, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?) "
                         "ON CONFLICT(user_id, symbol) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                         (user_id, sym, value, t, t))
        return _summary(conn, sym, user_id)
