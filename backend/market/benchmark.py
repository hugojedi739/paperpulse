"""Referencia de mercado para el comparador del Resumen: rentabilidad del S&P 500 desde una fecha.

GET /api/benchmark/sp500?since=<epoch en segundos>
    {available: true, since, startDate, startClose, lastClose, asOf, returnPct, source}
    {available: false} si el proveedor no da datos (la tarjeta del Resumen no se pinta)

- Reutiliza el proveedor de bolsa configurado (stocks.provider()): ^GSPC con yfinance y el ETF SPY con Finnhub,
  que no ofrece índices. En ambos casos es rentabilidad de precio: sin dividendos ni costes.
- Caché acotada: una sola serie de cierres diarios en memoria (como mucho ~2.500 puntos desde MIN_SINCE),
  que caduca a la hora. Las peticiones con fechas distintas se calculan sobre la misma serie, así que nadie
  puede forzar descargas variando `since`; solo se amplía si se pide una fecha anterior al inicio de la serie.
- Base: el último cierre de una sesión terminada antes de `since` (lo que costaba entrar al abrir la cuenta).
  Final: la última vela disponible (la sesión en curso, si la hay).
"""
import asyncio
import sys
import time
from typing import Any, Dict, List, Optional

from starlette.responses import JSONResponse
from starlette.routing import Route

from backend.market import stocks
from backend.security import IP_STOCK_CALLS, check_ip_rate_limit, get_client_ip

MIN_SINCE = 1577836800  # 01/01/2020 UTC: ninguna cuenta es anterior; acota el tamaño de la serie
CACHE_TTL = 3600
RETRY_AFTER_FAILURE = 300  # si el proveedor no da datos, no se reintenta en 5 minutos (no se le martillea)
MARGIN = 10 * 86400  # días de más antes de `since` para encontrar un cierre anterior (fines de semana, festivos)
SESSION_CLOSE = 16 * 3600  # las velas diarias empiezan a las 00:00 de Nueva York; la sesión cierra a las 16:00

_CACHE: Dict[str, Any] = {"start": None, "fetched": 0.0, "source": None, "bars": [], "failed": 0.0}
_LOCK = asyncio.Lock()


def _ticker(provider) -> str:
    return "SPY" if isinstance(provider, stocks.FinnhubStockProvider) else "^GSPC"


def _fetch(start: int, now: int) -> Dict[str, Any]:
    """Descarga los cierres diarios desde `start`. Nunca lanza: sin datos devuelve una lista vacía."""
    provider = stocks.provider()
    source = _ticker(provider)
    try:
        bars = provider.fetch_history(source, "1d", start, now) or []
    except Exception as exc:  # el proveedor falla de muchas formas (red, formato, límites)
        print(f"[Benchmark] Error descargando {source}: {exc}", file=sys.stderr)
        bars = []
    clean = sorted(({"time": int(b["time"]), "close": float(b["close"])} for b in bars
                    if b.get("close") and float(b["close"]) > 0), key=lambda b: b["time"])
    return {"source": source, "bars": clean}


def compute(bars: List[Dict[str, Any]], since: int) -> Optional[Dict[str, Any]]:
    """Rentabilidad desde el último cierre anterior a `since` hasta la última vela. None si no se puede calcular."""
    base = None
    for b in bars:
        if b["time"] + SESSION_CLOSE <= since:
            base = b
        else:
            break
    if not base or not bars:
        return None
    last = bars[-1]
    return {
        "startDate": time.strftime("%Y-%m-%d", time.gmtime(base["time"] + SESSION_CLOSE)),
        "startClose": round(base["close"], 4),
        "lastClose": round(last["close"], 4),
        "asOf": last["time"],
        "returnPct": round((last["close"] / base["close"] - 1) * 100, 4),
    }


async def series_since(since: int) -> Dict[str, Any]:
    """Serie en caché que cubre `since`; la descarga (en un hilo) si caducó o empieza después."""
    async with _LOCK:
        now = int(time.time())
        start = max(MIN_SINCE, since - MARGIN)
        fresh = now - _CACHE["fetched"] < CACHE_TTL
        covers = _CACHE["start"] is not None and _CACHE["start"] <= start
        if not (fresh and covers) and now - _CACHE["failed"] >= RETRY_AFTER_FAILURE:
            start = min(start, _CACHE["start"]) if _CACHE["start"] is not None else start
            data = await asyncio.get_running_loop().run_in_executor(None, _fetch, start, now)
            if data["bars"]:
                _CACHE.update(start=start, fetched=now, source=data["source"], bars=data["bars"], failed=0.0)
            else:
                _CACHE["failed"] = now
        if now - _CACHE["fetched"] >= CACHE_TTL:
            # Caducada y sin poder renovarla: no se enseñan cifras viejas como actuales
            return {"source": None, "bars": []}
        return {"source": _CACHE["source"], "bars": _CACHE["bars"]}


def _parse_since(raw: Optional[str]) -> Optional[int]:
    try:
        since = int(raw)
    except (TypeError, ValueError):
        return None
    return since if MIN_SINCE <= since <= time.time() + 60 else None


async def api_sp500(request):
    if not check_ip_rate_limit(get_client_ip(request), IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"error": "Demasiadas peticiones. Espera un minuto."}, status_code=429, headers={"Retry-After": "60"})
    since = _parse_since(request.query_params.get("since"))
    if since is None:
        return JSONResponse({"error": "Parámetro since no válido (segundos desde 1970, a partir de 2020)."}, status_code=400)
    data = await series_since(since)
    result = compute(data["bars"], since)
    if not result:
        return JSONResponse({"available": False}, headers={"Cache-Control": "no-store"})
    return JSONResponse({"available": True, "since": since, "source": data["source"], **result},
                        headers={"Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600"})


routes = [Route("/api/benchmark/sp500", api_sp500, methods=["GET"])]
