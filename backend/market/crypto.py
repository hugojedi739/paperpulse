"""Datos de cripto desde el backend: Binance (REST) y CoinGecko. El navegador nunca llama a estos servicios."""
import asyncio
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import requests
from starlette.responses import JSONResponse

from backend.security import IP_STOCK_CALLS, check_ip_rate_limit, get_client_ip

# data-api.binance.vision sirve solo datos de mercado y no está bloqueado por región (api.binance.com sí, en EE. UU.)
BINANCE_HOSTS = ("https://data-api.binance.vision", "https://api.binance.com")
PAIR_RE = re.compile(r"^[A-Z0-9]{2,20}$")
COINGECKO_ID_RE = re.compile(r"^[a-z0-9-]{1,60}$")
MAX_CACHE_ENTRIES = 500

_CACHE: Dict[Tuple, Tuple[float, Any]] = {}


def cached(key: Tuple, ttl: float) -> Optional[Any]:
    hit = _CACHE.get(key)
    return hit[1] if hit and time.time() - hit[0] < ttl else None


def remember(key: Tuple, value: Any) -> Any:
    """Inserta en la caché limitando su tamaño (evita crecimiento ilimitado de memoria)."""
    if key not in _CACHE and len(_CACHE) >= MAX_CACHE_ENTRIES:
        _CACHE.pop(next(iter(_CACHE)))
    _CACHE[key] = (time.time(), value)
    return value


def stale(key: Tuple) -> Optional[Any]:
    hit = _CACHE.get(key)
    return hit[1] if hit else None


def binance_get(path: str, params: Dict[str, Any], timeout: float = 6) -> Any:
    """GET a la API pública de Binance probando los hosts en orden. Lanza la última excepción si todos fallan."""
    last: Exception = RuntimeError("sin respuesta")
    for host in BINANCE_HOSTS:
        try:
            r = requests.get(f"{host}{path}", params=params, timeout=timeout)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 400:  # símbolo inexistente: no tiene sentido reintentar en otro host
                raise ValueError(r.json().get("msg", "Petición no válida"))
            last = RuntimeError(f"HTTP {r.status_code}")
        except ValueError:
            raise
        except Exception as e:
            last = e
    raise last


async def run(fn, *args):
    return await asyncio.get_running_loop().run_in_executor(None, fn, *args)


def limited(request) -> Optional[JSONResponse]:
    if not check_ip_rate_limit(get_client_ip(request), IP_STOCK_CALLS, max_calls_per_minute=240):
        return JSONResponse({"error": "Límite de peticiones excedido por minuto."}, status_code=429, headers={"Retry-After": "60"})
    return None


# ------------------------------------------------------------------ CoinGecko
async def api_crypto_markets(request):
    """Capitalización, volumen, variación 7d y sparkline 7d (CoinGecko, caché de 5 min)."""
    if (err := limited(request)):
        return err
    ids = sorted({i for i in request.query_params.get("ids", "").split(",") if COINGECKO_ID_RE.match(i)})[:60]
    if not ids:
        return JSONResponse({"error": "Indica ids de CoinGecko."}, status_code=400)
    key = ("cg", ",".join(ids))
    if (hit := cached(key, 300)) is not None:
        return JSONResponse({"data": hit, "source": "cache"})

    def fetch():
        r = requests.get("https://api.coingecko.com/api/v3/coins/markets", timeout=8, params={
            "vs_currency": "usd", "ids": ",".join(ids), "sparkline": "true", "price_change_percentage": "7d",
        })
        r.raise_for_status()
        return [{
            "id": c.get("id"), "symbol": str(c.get("symbol", "")).upper(), "cap": c.get("market_cap"),
            "volume": c.get("total_volume"), "change7d": c.get("price_change_percentage_7d_in_currency"),
            "rank": c.get("market_cap_rank"), "spark": (c.get("sparkline_in_7d") or {}).get("price", [])[::4],
        } for c in r.json()]

    try:
        return JSONResponse({"data": remember(key, await run(fetch)), "source": "coingecko"})
    except Exception as e:
        print(f"[CoinGecko] Error: {e}", file=sys.stderr)
        return JSONResponse({"data": stale(key) or [], "source": "stale_cache"})


# ------------------------------------------------------------------ Binance: tickers y libro (respaldo REST del WebSocket)
def ticker_payload(t: Dict[str, Any]) -> Dict[str, Any]:
    """Ticker REST de 24 h con las mismas claves que el stream @ticker del WebSocket."""
    return {"s": t["symbol"], "c": t["lastPrice"], "P": t["priceChangePercent"], "h": t["highPrice"],
            "l": t["lowPrice"], "q": t["quoteVolume"], "o": t["openPrice"]}


async def api_crypto_tickers(request):
    if (err := limited(request)):
        return err
    symbols = sorted({s for s in request.query_params.get("symbols", "").upper().split(",") if PAIR_RE.match(s)})[:100]
    if not symbols:
        return JSONResponse({"error": "Indica los pares (p. ej. BTCUSDT,ETHUSDT)."}, status_code=400)
    key = ("tickers", ",".join(symbols))
    if (hit := cached(key, 3)) is None:
        try:
            raw = await run(binance_get, "/api/v3/ticker/24hr", {"symbols": "[" + ",".join(f'"{s}"' for s in symbols) + "]"})
            hit = remember(key, [ticker_payload(t) for t in raw])
        except Exception as e:
            print(f"[Binance tickers] Error: {e}", file=sys.stderr)
            hit = stale(key) or []
    return JSONResponse({"data": hit})


async def api_crypto_depth(request):
    if (err := limited(request)):
        return err
    symbol = request.query_params.get("symbol", "").upper()
    if not PAIR_RE.match(symbol):
        return JSONResponse({"error": "Par no válido."}, status_code=400)
    key = ("depth", symbol)
    if (hit := cached(key, 1)) is None:
        try:
            raw = await run(binance_get, "/api/v3/depth", {"symbol": symbol, "limit": 20})
            hit = remember(key, {"bids": raw.get("bids", []), "asks": raw.get("asks", [])})
        except Exception as e:
            print(f"[Binance depth] Error: {e}", file=sys.stderr)
            hit = stale(key) or {"bids": [], "asks": []}
    return JSONResponse(hit)


def fetch_klines(pair: str, interval: str, limit: int, end: Optional[int]) -> List[Dict[str, Any]]:
    """Velas de Binance anteriores a `end` (epoch s, exclusivo). Sin `end`, las más recientes."""
    params: Dict[str, Any] = {"symbol": pair, "interval": interval, "limit": limit}
    if end:
        params["endTime"] = end * 1000 - 1
    return [{"time": int(k[0] // 1000), "open": float(k[1]), "high": float(k[2]), "low": float(k[3]),
             "close": float(k[4]), "volume": float(k[5])} for k in binance_get("/api/v3/klines", params)]
