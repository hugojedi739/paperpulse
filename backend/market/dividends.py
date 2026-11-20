"""Próximos dividendos de las acciones del catálogo (informativo).

GET /api/dividends
    {data: {SÍMBOLO: {exDate: "AAAA-MM-DD", amount: número|null, lastAmount: número|null, currency}}, updatedAt}
    Solo dividendos con fecha ex-dividendo de hoy en adelante. `amount` es el importe anunciado por acción;
    si aún no se ha anunciado es null y `lastAmount` es el último pagado. Sin datos, `data` va vacío.

- Reutiliza el proveedor de bolsa configurado (stocks.provider().fetch_dividends). Con Finnhub no hay datos
  (su plan gratuito no ofrece el calendario de dividendos) y el frontend no pinta nada.
- Caché acotada en memoria: una sola entrada con, como mucho, las acciones del catálogo (los índices no reparten
  dividendos y no se piden). Dura 6 horas; si el proveedor falla, se reintenta a los 15 minutos y mientras tanto
  se sirve lo último bueno durante un máximo de 24 horas.
- La simulación NO abona dividendos (ver docs/referencia.md): esto solo informa.
"""
import asyncio
import time
from typing import Any, Dict

from starlette.responses import JSONResponse
from starlette.routing import Route

from backend.market import stocks
from backend.security import IP_STOCK_CALLS, check_ip_rate_limit, get_client_ip

CACHE_TTL = 6 * 3600
RETRY_AFTER_FAILURE = 15 * 60
MAX_STALE = 24 * 3600

_CACHE: Dict[str, Any] = {"fetched": 0.0, "failed": 0.0, "data": {}}
_LOCK = asyncio.Lock()


def catalog_tickers() -> Dict[str, str]:
    """{ticker del proveedor: símbolo del catálogo}, sin índices (empiezan por ^)."""
    return {info["ticker"]: sym for sym, info in stocks.STOCK_SYMBOLS.items() if not info["ticker"].startswith("^")}


def _fetch() -> Dict[str, Dict[str, Any]]:
    tickers = catalog_tickers()
    try:
        raw = stocks.provider().fetch_dividends(list(tickers)) or {}
    except Exception as exc:
        print(f"[Dividendos] Error del proveedor: {exc}")
        raw = {}
    return {tickers[t]: d for t, d in raw.items() if t in tickers and isinstance(d, dict) and d.get("exDate")}


def upcoming(data: Dict[str, Dict[str, Any]], today: str) -> Dict[str, Dict[str, Any]]:
    """Solo los que aún no han pasado su fecha ex-dividendo (comparación de fechas AAAA-MM-DD)."""
    return {sym: d for sym, d in data.items() if d["exDate"] >= today}


async def dividends() -> Dict[str, Dict[str, Any]]:
    async with _LOCK:
        now = time.time()
        if now - _CACHE["fetched"] >= CACHE_TTL and now - _CACHE["failed"] >= RETRY_AFTER_FAILURE:
            data = await asyncio.get_running_loop().run_in_executor(None, _fetch)
            if data:
                _CACHE.update(fetched=now, failed=0.0, data=data)
            else:
                _CACHE["failed"] = now
        if now - _CACHE["fetched"] >= MAX_STALE:
            return {}
        return _CACHE["data"]


async def api_dividends(request):
    if not check_ip_rate_limit(get_client_ip(request), IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"error": "Demasiadas peticiones. Espera un minuto."}, status_code=429, headers={"Retry-After": "60"})
    data = upcoming(await dividends(), time.strftime("%Y-%m-%d", time.gmtime()))
    headers = {"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600"} if data else {"Cache-Control": "no-store"}
    return JSONResponse({"data": data, "updatedAt": int(_CACHE["fetched"]) or None}, headers=headers)


routes = [Route("/api/dividends", api_dividends, methods=["GET"])]
