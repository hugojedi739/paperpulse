"""Pulso público de la comunidad (GET /api/community/pulse): lo que se ve en la home sin iniciar sesión.

Tres datos, todos agregados o ya públicos: el top 5 de la semana (alias y rentabilidad, solo cuentas que empezaron con al menos
500 €), los últimos hilos del foro (título y categoría) y cuántos traders han operado esta semana (solo si son 3 o más). No
hay emails, ids de usuario ni saldos. Se cachea 5 minutos en memoria (y el CDN, con s-maxage): la home de cada visitante no
debe recalcular la clasificación ni consultar la base de datos.
"""
import threading
import time
from contextlib import closing
from typing import Dict, Optional

from backend import db, settings
from backend.community import ranking
from backend.community.common import now
from backend.trading import prices
from backend.trading.rules import E8

CACHE_SECONDS = 300
TOP_SIZE = 5
THREADS_SIZE = 3
TOP_MIN_INITIAL_EUR_CENTS = 500 * 100  # «cuentas con ≥ 500 € de saldo inicial»: así el top no lo copan las apuestas con 50 €
MIN_TRADERS_SHOWN = 3  # por debajo no se publica el contador (un «1 trader activo» no dice nada bueno)
ACTIVE_DAYS = 7
FALLBACK_USD_PER_EUR = 1.08  # solo si no hay tipo de cambio disponible; las cuentas con importe elegido ni lo necesitan

_lock = threading.Lock()
_cache: Dict = {"at": 0.0, "data": None}


def _usd_per_eur_e8() -> int:
    try:
        return prices.fx_e8("EUR")
    except Exception:  # sin tipo de cambio: el top se calcula con uno aproximado en vez de fallar la home
        return int(FALLBACK_USD_PER_EUR * E8)


def initial_eur_cents(initial_cents: int, input_cents: Optional[int], usd_per_eur_e8: int) -> int:
    """Saldo inicial en céntimos de euro: lo elegido si lo hay; si no (cuentas anteriores), el saldo en USD convertido."""
    return input_cents if input_cents else initial_cents * E8 // usd_per_eur_e8


def _top_week(conn, at: int):
    min_trades = settings.get("community_min_trades")
    rows = conn.execute(
        "SELECT p.alias, l.return_bps, l.approximate, a.initial_cents, a.initial_input_cents FROM leaderboard l "
        f"JOIN accounts a ON a.user_id = l.user_id {ranking.VISIBLE} AND l.period = ? AND l.trades >= ? "
        "ORDER BY l.return_bps DESC, l.trades DESC, p.alias LIMIT 100", (at, "7d", min_trades)).fetchall()
    fx = _usd_per_eur_e8()
    top = [r for r in rows if initial_eur_cents(r["initial_cents"], r["initial_input_cents"], fx) >= TOP_MIN_INITIAL_EUR_CENTS][:TOP_SIZE]
    return [{"rank": i + 1, "alias": r["alias"], "returnPct": r["return_bps"] / 100, "approximate": bool(r["approximate"])} for i, r in enumerate(top)]


def _latest_threads(conn):
    """Últimos hilos de personas (también los de operaciones compartidas): sin los automáticos por activo, que existen desde el principio."""
    rows = conn.execute(
        "SELECT t.id, t.title, t.created_at, c.slug, c.name FROM threads t JOIN forum_categories c ON c.id = t.category_id "
        "JOIN users u ON u.id = t.author_id WHERE t.status = 'visible' AND t.symbol IS NULL AND t.author_id IS NOT NULL "
        "AND u.deleted_at IS NULL ORDER BY t.created_at DESC, t.id DESC LIMIT ?", (THREADS_SIZE,)).fetchall()
    return [{"id": r["id"], "title": r["title"], "categorySlug": r["slug"], "categoryName": r["name"], "createdAt": r["created_at"]} for r in rows]


def _active_traders(conn, at: int) -> Optional[int]:
    """Cuentas distintas con alguna operación en los últimos 7 días (sin usuarios sombra de los retos ni cuentas desactivadas)."""
    n = conn.execute(
        "SELECT COUNT(DISTINCT f.user_id) FROM fills f JOIN users u ON u.id = f.user_id WHERE f.executed_at >= ? "
        "AND u.owner_id IS NULL AND u.deleted_at IS NULL AND u.disabled = 0", (at - ACTIVE_DAYS * 86400,)).fetchone()[0]
    return n if n >= MIN_TRADERS_SHOWN else None


def compute(at: Optional[int] = None) -> Dict:
    at = at or now()
    ranking.refresh()  # como mucho cada 5 min (el mismo límite de siempre); aquí además solo se llega con la caché vencida
    with closing(db.connect()) as conn:
        top, threads, active = _top_week(conn, at), _latest_threads(conn), _active_traders(conn, at)
    return {"activeTraders7d": active, "topWeek": top, "latestThreads": threads,
            "empty": not top and not threads,  # sin nada que enseñar la home oculta la sección (el contador solo, no cuenta)
            "computedAt": at}


def pulse() -> Dict:
    with _lock:
        if _cache["data"] is None or time.time() - _cache["at"] >= CACHE_SECONDS:
            _cache["data"], _cache["at"] = compute(), time.time()
        return _cache["data"]


def reset_cache() -> None:
    with _lock:
        _cache["data"], _cache["at"] = None, 0.0
