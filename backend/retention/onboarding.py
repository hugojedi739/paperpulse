"""Onboarding de 2 minutos con un primer reto guiado: primera compra, primera orden stop y primera visita al foro.

Cada paso se comprueba con datos del servidor (fills, orders) salvo la visita al foro, que avisa el cliente.
Es saltable y se puede reabrir.
"""
import time
from typing import Dict

from backend.db import transaction
from backend.retention import achievements

STEPS = [
    ("first_buy", "Haz tu primera compra", "Compra una pequeña cantidad de cualquier activo con tu saldo virtual.", "/trade"),
    ("first_stop", "Coloca una orden stop", "Una orden stop vende sola si el precio cae hasta tu nivel: así limitas pérdidas.", "/trade"),
    ("visit_forum", "Visita el foro", "Mira cómo comparte la comunidad sus análisis. Recuerda: es una simulación.", "/community/forum"),
]


def _done(conn, user_id: int, state) -> Dict[str, bool]:
    return {
        "first_buy": conn.execute("SELECT 1 FROM fills WHERE user_id = ? AND side = 'buy' LIMIT 1", (user_id,)).fetchone() is not None,
        "first_stop": conn.execute("SELECT 1 FROM orders WHERE user_id = ? AND type = 'stop' LIMIT 1", (user_id,)).fetchone() is not None,
        "visit_forum": bool(state and state["forum_visited_at"]),
    }


def state(user_id: int) -> Dict:
    """Estado del onboarding. Al completarse el último paso concede el logro (una sola vez)."""
    with transaction() as conn:
        conn.execute("INSERT OR IGNORE INTO onboarding (user_id, created_at) VALUES (?, ?)", (user_id, int(time.time())))
        row = conn.execute("SELECT * FROM onboarding WHERE user_id = ?", (user_id,)).fetchone()
        done = _done(conn, user_id, row)
        completed = all(done.values())
        if completed and not row["completed_at"]:
            conn.execute("UPDATE onboarding SET completed_at = ? WHERE user_id = ?", (int(time.time()), user_id))
            achievements.grant(conn, user_id, "onboarding_done")
    return {
        "steps": [{"id": i, "title": t, "description": d, "link": l, "done": done[i]} for i, t, d, l in STEPS],
        "completed": completed, "skipped": bool(row["skipped_at"]),
        "visible": not completed and not row["skipped_at"],
    }


def act(user_id: int, action: str) -> Dict:
    if action not in ("skip", "reopen", "visit-forum"):
        raise ValueError("Acción no válida. Usa skip, reopen o visit-forum.")
    col = {"skip": "skipped_at = ?", "visit-forum": "forum_visited_at = COALESCE(forum_visited_at, ?)", "reopen": "skipped_at = NULL, completed_at = completed_at"}[action]
    with transaction() as conn:
        conn.execute("INSERT OR IGNORE INTO onboarding (user_id, created_at) VALUES (?, ?)", (user_id, int(time.time())))
        if action == "reopen":
            conn.execute(f"UPDATE onboarding SET {col} WHERE user_id = ?", (user_id,))
        else:
            conn.execute(f"UPDATE onboarding SET {col} WHERE user_id = ?", (int(time.time()), user_id))
    return state(user_id)
