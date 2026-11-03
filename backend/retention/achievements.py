"""Logros e insignias. El catálogo está en el código; la tabla `achievements` solo guarda qué consiguió cada usuario.

La concesión es idempotente (PRIMARY KEY + INSERT OR IGNORE) y avisa con una notificación solo la primera vez.
evaluate() se llama dentro de la transacción de cada evento (operación, hilo, seguidor...) y concede lo que toque.
"""
import time
from typing import Dict, List

from backend.retention import notifications, streak

CATALOG: Dict[str, Dict[str, str]] = {
    "first_trade": {"name": "Primera operación", "description": "Has ejecutado tu primera operación.", "icon": "play"},
    "ten_trades": {"name": "10 operaciones", "description": "Has ejecutado 10 operaciones.", "icon": "layers"},
    "first_win": {"name": "Primera ganancia", "description": "Has cerrado una operación con beneficio.", "icon": "trending-up"},
    "win_streak_5": {"name": "Racha de 5", "description": "Cinco operaciones ganadoras seguidas.", "icon": "flame"},
    "first_stop": {"name": "Protegido", "description": "Has colocado tu primera orden stop.", "icon": "shield"},
    "trading_week": {"name": "Semana constante", "description": "Has operado 7 días seguidos.", "icon": "calendar"},
    "first_thread": {"name": "Voz propia", "description": "Has abierto tu primer hilo en el foro.", "icon": "message-square"},
    "first_follower": {"name": "Primer seguidor", "description": "Alguien ha empezado a seguirte.", "icon": "users"},
    "survive_drop": {"name": "Resistencia", "description": "Superaste una caída del 10 % de tu patrimonio y recuperaste tu máximo.", "icon": "target"},
    "challenge_join": {"name": "Retador", "description": "Te has apuntado a un reto mensual.", "icon": "trophy"},
    "onboarding_done": {"name": "Primeros pasos", "description": "Has completado el primer reto guiado.", "icon": "graduation-cap"},
}


def grant(conn, user_id: int, code: str) -> bool:
    """Concede un logro si no lo tenía. Devuelve True solo la primera vez."""
    if code not in CATALOG:
        raise KeyError(code)
    if conn.execute("INSERT OR IGNORE INTO achievements (user_id, code, earned_at) VALUES (?, ?, ?)", (user_id, code, int(time.time()))).rowcount:
        notifications.notify(conn, user_id, "achievement", f"Logro conseguido: {CATALOG[code]['name']}", CATALOG[code]["description"], "/community/me")
        return True
    return False


def longest_win_run(pnls: List[int]) -> int:
    best = run = 0
    for p in pnls:
        run = run + 1 if p > 0 else 0
        best = max(best, run)
    return best


def survived_drop(values: List[int], drop: float = 0.10) -> bool:
    """¿Hubo una caída de al menos `drop` desde un máximo y después se recuperó ese máximo?"""
    peak, floor, hit = 0, None, False
    for v in values:
        if hit and v >= floor:
            return True
        if v > peak:
            peak = v
            hit, floor = False, None  # nuevo máximo: la caída anterior (si no se recuperó) ya no cuenta
        elif peak and not hit and v <= peak * (1 - drop):
            hit, floor = True, peak
    return False


def evaluate(conn, user_id: int) -> None:
    """Concede los logros que correspondan según el estado actual. No hace nada para usuarios sombra de retos."""
    row = conn.execute("SELECT owner_id FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row or row["owner_id"]:
        return
    one = lambda sql: conn.execute(sql, (user_id,)).fetchone()[0]
    fills = one("SELECT COUNT(*) FROM fills WHERE user_id = ?")
    if fills >= 1:
        grant(conn, user_id, "first_trade")
    if fills >= 10:
        grant(conn, user_id, "ten_trades")
    pnls = [r[0] for r in conn.execute("SELECT pnl_cents FROM fills WHERE user_id = ? AND side = 'sell' ORDER BY executed_at DESC, id DESC LIMIT 200", (user_id,))]
    if any(p > 0 for p in pnls):
        grant(conn, user_id, "first_win")
    if longest_win_run(list(reversed(pnls))) >= 5:
        grant(conn, user_id, "win_streak_5")
    if one("SELECT COUNT(*) FROM orders WHERE user_id = ? AND type = 'stop'"):
        grant(conn, user_id, "first_stop")
    if streak.current(conn, user_id)["best"] >= 7:
        grant(conn, user_id, "trading_week")
    if one("SELECT COUNT(*) FROM threads WHERE author_id = ?"):
        grant(conn, user_id, "first_thread")
    if one("SELECT COUNT(*) FROM follows WHERE followee_id = ?"):
        grant(conn, user_id, "first_follower")
    if one("SELECT COUNT(*) FROM challenge_entries WHERE user_id = ?"):
        grant(conn, user_id, "challenge_join")


def earned(conn, user_id: int) -> List[Dict]:
    rows = conn.execute("SELECT code, earned_at FROM achievements WHERE user_id = ? ORDER BY earned_at, code", (user_id,)).fetchall()
    return [{"code": r["code"], **CATALOG[r["code"]], "earnedAt": r["earned_at"]} for r in rows if r["code"] in CATALOG]


def catalog(conn, user_id: int) -> List[Dict]:
    mine = {r["code"]: r["earned_at"] for r in conn.execute("SELECT code, earned_at FROM achievements WHERE user_id = ?", (user_id,))}
    return [{"code": c, **v, "earnedAt": mine.get(c)} for c, v in CATALOG.items()]
