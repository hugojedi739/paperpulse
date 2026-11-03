"""Histórico de velas unificado para cripto (Binance) y bolsa (Yahoo Finance / Finnhub).

GET /api/candles?symbol=BTCUSDT&type=crypto&interval=1h&limit=500[&end=<epoch s>]

Devuelve las `limit` velas anteriores a `end` (o las más recientes) y `hasMore`, para que el gráfico vaya pidiendo
páginas más antiguas al desplazarse hacia la izquierda. Los intervalos que Yahoo no ofrece (3m, 2h, 4h) se construyen
agregando velas de un intervalo menor dentro de cada sesión.
"""
import math
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

from starlette.responses import JSONResponse

from backend.market import stocks
from backend.market.crypto import PAIR_RE, cached, fetch_klines, limited, remember, run

DAY = 86400
# clave: (segundos, intervalo de Binance, intervalo de Yahoo, velas de Yahoo agregadas por vela)
INTERVALS: Dict[str, Tuple[int, str, str, int]] = {
    "1m": (60, "1m", "1m", 1),
    "3m": (180, "3m", "1m", 3),
    "5m": (300, "5m", "5m", 1),
    "15m": (900, "15m", "15m", 1),
    "30m": (1800, "30m", "30m", 1),
    "1h": (3600, "1h", "60m", 1),
    "2h": (7200, "2h", "60m", 2),
    "4h": (14400, "4h", "60m", 4),
    "1d": (DAY, "1d", "1d", 1),
    "1w": (7 * DAY, "1w", "1wk", 1),
    "1M": (30 * DAY, "1M", "1mo", 1),
}
# Límites de Yahoo: antigüedad máxima disponible y rango máximo por petición para datos intradía
YAHOO_LOOKBACK = {"1m": 29 * DAY, "5m": 59 * DAY, "15m": 59 * DAY, "30m": 59 * DAY, "60m": 729 * DAY}
YAHOO_MAX_SPAN = {"1m": 7 * DAY, "5m": 59 * DAY, "15m": 59 * DAY, "30m": 59 * DAY, "60m": 365 * DAY}
STOCK_RE = re.compile(r"^\^?[A-Z0-9.\-]{1,14}$")
SESSION_SECONDS = 6.5 * 3600  # sesión más corta (Wall Street): garantiza pedir suficiente rango


def resolve_stock(raw: str) -> Optional[str]:
    sym = stocks.STOCK_SYMBOL_ALIASES.get(raw, raw)
    info = stocks.STOCK_SYMBOLS.get(sym)
    if info:
        return info["ticker"]
    return raw if STOCK_RE.match(raw) else None


def stock_window(yahoo: str, bar_seconds: int, limit: int, end: int, now: int) -> Tuple[int, int, bool]:
    """Rango [start, end) que contiene aprox. `limit` velas y si quedan datos más antiguos tras él."""
    if yahoo in ("1d", "1wk", "1mo"):
        span = int(limit * bar_seconds * (365 / 252 if yahoo == "1d" else 1.05))
        floor = 0
    else:
        trading_days = math.ceil(limit * bar_seconds / SESSION_SECONDS)
        span = int((trading_days * 7 / 5 + 3) * DAY)
        span = min(span, YAHOO_MAX_SPAN[yahoo])
        floor = now - YAHOO_LOOKBACK[yahoo]
    start = max(end - span, floor)
    return start, end, start > floor


def aggregate(candles: List[Dict[str, Any]], seconds: int) -> List[Dict[str, Any]]:
    """Agrupa velas en bloques de `seconds` contados desde la primera vela de cada sesión (día UTC)."""
    out: List[Dict[str, Any]] = []
    key = None
    day_start: Dict[int, int] = {}
    for c in candles:
        day = c["time"] // DAY
        first = day_start.setdefault(day, c["time"])
        k = (day, (c["time"] - first) // seconds)
        if k != key:
            key = k
            out.append(dict(c, time=first + k[1] * seconds))
        else:
            o = out[-1]
            o.update(high=max(o["high"], c["high"]), low=min(o["low"], c["low"]), close=c["close"], volume=o["volume"] + c["volume"])
    return out


def fetch_stock(ticker: str, interval: str, limit: int, end: Optional[int]) -> Tuple[List[Dict[str, Any]], bool]:
    bar_seconds, _, yahoo, group = INTERVALS[interval]
    now = int(time.time())
    end = min(end or now + 60, now + 60)
    start, end, more = stock_window(yahoo, bar_seconds, limit, end, now)
    if start >= end:
        return [], False
    candles = stocks.provider().fetch_history(ticker, yahoo, start, end)
    if group > 1:
        candles = aggregate(candles, bar_seconds)
    candles = [c for c in candles if c["time"] < end]
    return candles, more and bool(candles)


async def api_candles(request):
    if (err := limited(request)):
        return err
    q = request.query_params
    kind = q.get("type", "crypto")
    interval = q.get("interval", "1h")
    if interval not in INTERVALS:
        return JSONResponse({"error": f"Intervalo no válido. Usa uno de: {', '.join(INTERVALS)}"}, status_code=400)
    try:
        limit = min(1000, max(10, int(q.get("limit", "500"))))
        end = int(q["end"]) if q.get("end") else None
    except ValueError:
        return JSONResponse({"error": "limit y end deben ser números."}, status_code=400)
    raw = q.get("symbol", "").upper().strip()

    if kind == "stock":
        symbol = resolve_stock(raw)
    else:
        symbol = raw.replace("/", "").replace("-", "")
        symbol = symbol if PAIR_RE.match(symbol) else None
    if not symbol:
        return JSONResponse({"error": "Símbolo no válido."}, status_code=400)

    # Las páginas antiguas no cambian: caché larga. La última página se refresca en segundos.
    bar_seconds = INTERVALS[interval][0]
    historical = end is not None and end < time.time() - 2 * bar_seconds
    ttl = 3600 if historical else (5 if bar_seconds < 900 else 30 if kind == "crypto" else 60)
    key = ("candles", kind, symbol, interval, limit, end)
    if (hit := cached(key, ttl)) is not None:
        return JSONResponse({**hit, "source": "cache"})

    try:
        if kind == "stock":
            candles, more = await run(fetch_stock, symbol, interval, limit, end)
        else:
            candles = await run(fetch_klines, symbol, INTERVALS[interval][1], limit, end)
            more = len(candles) == limit
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)
    except Exception as e:
        print(f"[Candles] {kind} {symbol} {interval}: {e}", file=sys.stderr)
        return JSONResponse({"error": f"No se pudieron obtener velas de {symbol}."}, status_code=502)

    result = {"symbol": symbol, "type": kind, "interval": interval, "candles": candles, "hasMore": more}
    if candles:
        remember(key, result)
    return JSONResponse({**result, "source": "live"})
