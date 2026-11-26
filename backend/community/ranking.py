"""Clasificación por rentabilidad, calculada SOLO con datos del servidor (accounts, positions, fills).

Patrimonio de una cuenta = efectivo (incluido el reservado en órdenes pendientes) + valor de mercado de sus
posiciones. Cada posición se valora con el último precio (prices.valuation_prices, venta: redondeo a la baja) y,
si un activo no tiene precio, a su coste; en ese caso el resultado se marca como «aproximado».

Rentabilidad:
  - total: patrimonio / saldo inicial - 1. Como no hay ingresos ni retiradas de efectivo, el cociente de
    patrimonios es la rentabilidad real, sin necesidad de ponderar por flujos de caja.
  - 7d y 30d: patrimonio / patrimonio al inicio del periodo - 1. El patrimonio pasado sale de las instantáneas
    diarias (equity_snapshots). Si la cuenta se abrió dentro del periodo, la base es su saldo inicial.

Coste en serverless: valorar requiere precios de terceros, así que no se hace en cada petición. refresh()
recalcula todo como mucho cada REFRESH_EVERY segundos (varias consultas a la base y 1-3 llamadas de precios
para todos los usuarios a la vez), guarda la instantánea del día y rellena la tabla `leaderboard`. Las lecturas
solo consultan esa tabla. Privacidad, suspensiones y el mínimo de operaciones se aplican AL LEER, así que un
cambio de perfil o de ajustes se nota al momento, sin esperar al siguiente recálculo.
"""
import threading
import time
from contextlib import closing
from typing import Dict, List, Optional

from backend import db, settings
from backend.community.common import CommunityError, now
from backend.retention import achievements
from backend.trading import prices
from backend.trading.ledger import transaction
from backend.trading.rules import notional_cents, short_value_cents

REFRESH_EVERY = 300
PERIODS = {"7d": 7, "30d": 30, "total": None}
_lock = threading.Lock()
_state = {"computed_at": 0}


def day_of(ts: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def _base(acc: Dict, days: int, snaps: List[Dict], at: int):
    """(base en céntimos, aproximada) para un periodo de `days` días. `snaps` ordenadas por día ascendente."""
    start = at - days * 86400
    if acc["created_at"] >= start:
        return acc["initial_cents"], False  # la cuenta nació dentro del periodo
    start_day = day_of(start)
    before = [s for s in snaps if s["day"] <= start_day]
    if before:
        return before[-1]["equity_cents"], before[-1]["day"] != start_day  # exacta solo si hay foto de ese día
    after = [s for s in snaps if s["day"] > start_day]
    if after:
        return after[0]["equity_cents"], True  # la primera foto disponible dentro del periodo
    return acc["initial_cents"], True


def compute(at: Optional[int] = None) -> int:
    """Recalcula patrimonios, guarda la instantánea del día y las tablas de clasificación (principal y retos).
    Devuelve cuántas cuentas principales entraron."""
    at = at or now()
    with closing(db.connect()) as conn:
        accounts = [dict(r) for r in conn.execute(
            "SELECT a.user_id, a.cash_cents, a.initial_cents, a.created_at, u.owner_id, "
            "(SELECT COUNT(*) FROM fills f WHERE f.user_id = a.user_id) AS trades FROM accounts a JOIN users u ON u.id = a.user_id "
            "WHERE EXISTS (SELECT 1 FROM fills f WHERE f.user_id = a.user_id)")]
        positions: Dict[int, List[Dict]] = {}
        for r in conn.execute("SELECT user_id, symbol, qty_e8, cost_cents FROM positions"):
            positions.setdefault(r["user_id"], []).append(dict(r))
        for r in conn.execute("SELECT user_id, symbol, qty_e8, margin_cents, cost_cents FROM short_positions"):  # cortos: valen garantía ± resultado
            positions.setdefault(r["user_id"], []).append(dict(r, short=True))
        snaps: Dict[int, List[Dict]] = {}
        for r in conn.execute("SELECT user_id, day, equity_cents FROM equity_snapshots WHERE day >= ? ORDER BY day",
                              (day_of(at - 400 * 86400),)):
            snaps.setdefault(r["user_id"], []).append(dict(r))
        # Cuentas de retos aún abiertos de calcular: ledger_id -> (reto, usuario)
        open_ledgers = {r["ledger_id"]: (r["challenge_id"], r["user_id"]) for r in conn.execute(
            "SELECT e.ledger_id, e.challenge_id, e.user_id FROM challenge_entries e JOIN challenges c ON c.id = e.challenge_id WHERE c.finalized = 0")}

    # Red: fuera de cualquier transacción
    symbols = {p["symbol"] for ps in positions.values() for p in ps}
    px = prices.valuation_prices(symbols) if symbols else {}

    rows, challenge_rows, today, equities = [], [], day_of(at), {}
    for acc in accounts:
        uid, missing = acc["user_id"], False
        equity = acc["cash_cents"]
        for p in positions.get(uid, []):
            if p["symbol"] in px:
                price, fx = px[p["symbol"]]
                equity += (short_value_cents(p["margin_cents"], p["qty_e8"], price, fx) if p.get("short")
                           else notional_cents(p["qty_e8"], price, fx, round_up=False))
            else:
                equity += p["margin_cents"] if p.get("short") else p["cost_cents"]
                missing = True
        if acc["owner_id"]:  # cuenta de un reto: rentabilidad sobre su saldo inicial
            if uid in open_ledgers:
                cid, owner = open_ledgers[uid]
                challenge_rows.append((cid, owner, (equity - acc["initial_cents"]) * 10_000 // acc["initial_cents"], equity, acc["trades"], at))
            continue
        user_snaps = [s for s in snaps.get(uid, []) if s["day"] != today]
        for period, days in PERIODS.items():
            base, approx = (acc["initial_cents"], False) if days is None else _base(acc, days, user_snaps, at)
            base = max(base, 1)
            rows.append((period, uid, (equity - base) * 10_000 // base, equity, base, acc["trades"], int(approx or missing), at))
        equities[uid] = (equity, [s["equity_cents"] for s in user_snaps] + [equity])

    with transaction() as conn:
        for uid, (equity, series) in equities.items():
            conn.execute("INSERT INTO equity_snapshots VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET "
                         "equity_cents = excluded.equity_cents, created_at = excluded.created_at", (uid, today, equity, at))
            if achievements.survived_drop(series):
                achievements.grant(conn, uid, "survive_drop")
        conn.execute("DELETE FROM equity_snapshots WHERE day < ?", (day_of(at - 400 * 86400),))  # tamaño acotado
        conn.execute("DELETE FROM leaderboard")
        for row in rows:
            conn.execute("INSERT INTO leaderboard VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row)
        # Retos: los ya cerrados (finalized) no se recalculan; al cerrarse un mes queda su clasificación final
        conn.execute("DELETE FROM challenge_scores WHERE challenge_id IN (SELECT id FROM challenges WHERE finalized = 0)")
        for row in challenge_rows:
            conn.execute("INSERT INTO challenge_scores VALUES (?, ?, ?, ?, ?, ?)", row)
        conn.execute("UPDATE challenges SET finalized = 1 WHERE ends_at <= ? AND finalized = 0", (at,))
    _state["computed_at"] = at
    return len(equities)


def refresh(force: bool = False) -> None:
    """Recalcula si han pasado REFRESH_EVERY segundos. Solo un hilo recalcula; los demás leen lo que haya."""
    if not force and now() - _state["computed_at"] < REFRESH_EVERY:
        return
    if not _lock.acquire(blocking=force):
        return
    try:
        if force or now() - _state["computed_at"] >= REFRESH_EVERY:
            if not force:
                # Otra instancia (serverless) pudo calcular hace poco: se aprovecha su resultado
                with closing(db.connect()) as conn:
                    last = conn.execute("SELECT MAX(computed_at) FROM leaderboard").fetchone()[0] or 0
                if now() - last < REFRESH_EVERY:
                    _state["computed_at"] = last
                    return
            compute()
    except Exception as exc:  # proveedor de precios caído: se sirve la última clasificación guardada
        print(f"[Comunidad] No se pudo recalcular la clasificación: {exc}")
        _state["computed_at"] = now() - REFRESH_EVERY + 60  # reintento en un minuto
    finally:
        _lock.release()


VISIBLE = ("JOIN profiles p ON p.user_id = l.user_id JOIN users u ON u.id = l.user_id "
           "WHERE p.is_private = 0 AND u.disabled = 0 AND (u.suspended_until IS NULL OR u.suspended_until <= ?)")


def leaderboard(period: str, limit: int, offset: int) -> Dict:
    if period not in PERIODS:
        raise CommunityError("Periodo no válido. Usa 7d, 30d o total.")
    refresh()
    min_trades = settings.get("community_min_trades")
    with closing(db.connect()) as conn:
        args = (now(), period, min_trades)
        total = conn.execute(f"SELECT COUNT(*) FROM leaderboard l {VISIBLE} AND l.period = ? AND l.trades >= ?", args).fetchone()[0]
        rows = conn.execute(
            f"SELECT p.alias, l.return_bps, l.trades, l.approximate, l.computed_at FROM leaderboard l {VISIBLE} "
            "AND l.period = ? AND l.trades >= ? ORDER BY l.return_bps DESC, l.trades DESC, p.alias LIMIT ? OFFSET ?",
            (*args, limit, offset)).fetchall()
    return {
        "period": period, "minTrades": min_trades, "total": total, "computedAt": _state["computed_at"] or None,
        "entries": [{"rank": offset + i + 1, "alias": r["alias"], "returnPct": r["return_bps"] / 100, "trades": r["trades"],
                     "approximate": bool(r["approximate"])} for i, r in enumerate(rows)],
    }


def user_return(conn, user_id: int) -> Optional[Dict]:
    """Rentabilidad total de un usuario según el último cálculo (None si no tiene operaciones)."""
    r = conn.execute("SELECT return_bps, approximate, computed_at FROM leaderboard WHERE period = 'total' AND user_id = ?",
                     (user_id,)).fetchone()
    return {"returnPct": r["return_bps"] / 100, "approximate": bool(r["approximate"]), "computedAt": r["computed_at"]} if r else None
