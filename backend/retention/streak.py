"""Racha de días operando, contada por fecha en hora de Madrid (no UTC: un trade a las 00:30 en Madrid es del día siguiente)."""
import datetime
import zoneinfo
from typing import Dict, Optional

MADRID = zoneinfo.ZoneInfo("Europe/Madrid")
HISTORY_DAYS = 400


def day_of(ts: float) -> str:
    return datetime.datetime.fromtimestamp(ts, MADRID).strftime("%Y-%m-%d")


def record(conn, user_id: int, ts: float) -> None:
    conn.execute("INSERT OR IGNORE INTO trading_days (user_id, day) VALUES (?, ?)", (user_id, day_of(ts)))


def current(conn, user_id: int, at: Optional[float] = None) -> Dict:
    """{current, best}. La racha vigente no se pierde hasta que pasa un día entero sin operar: si hoy aún no has
    operado pero ayer sí, sigue contando."""
    import time
    at = at or time.time()
    days = [r[0] for r in conn.execute("SELECT day FROM trading_days WHERE user_id = ? ORDER BY day DESC LIMIT ?", (user_id, HISTORY_DAYS))]
    ordinals = [datetime.date.fromisoformat(d).toordinal() for d in days]
    today = datetime.datetime.fromtimestamp(at, MADRID).date().toordinal()
    cur = 0
    if ordinals and ordinals[0] >= today - 1:
        cur, expect = 1, ordinals[0]
        for o in ordinals[1:]:
            if o != expect - 1:
                break
            cur, expect = cur + 1, o
    best = run = 0
    prev = None
    for o in sorted(ordinals):
        run = run + 1 if prev is not None and o == prev + 1 else 1
        best, prev = max(best, run), o
    return {"current": cur, "best": best}
