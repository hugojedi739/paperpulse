"""Cotizaciones e históricos de bolsa (Wall Street e IBEX 35) con proveedor intercambiable (yfinance / Finnhub)."""
import sys
import time
import asyncio
import datetime
import math
from typing import Dict, Any, List

import requests
from starlette.responses import JSONResponse

from backend import settings
from backend.market.hours import is_market_open
from backend.security import IP_STOCK_CALLS, USAGE_STATS, check_ip_rate_limit, get_client_ip

try:
    import yfinance as yf
except ImportError:
    yf = None

# ==============================================================================
# 5. Proveedor de Datos de Bolsa: Arquitectura Desacoplada y Política Cero Mock
# ==============================================================================
# Catálogo sin precios base estáticos (cero datos inventados)
STOCK_SYMBOLS = {
    # Wall Street (US)
    "NVDA": {"ticker": "NVDA", "name": "NVIDIA Corp.", "market": "US"},
    "AAPL": {"ticker": "AAPL", "name": "Apple Inc.", "market": "US"},
    "TSLA": {"ticker": "TSLA", "name": "Tesla Inc.", "market": "US"},
    "MSFT": {"ticker": "MSFT", "name": "Microsoft Corp.", "market": "US"},
    "AMZN": {"ticker": "AMZN", "name": "Amazon.com Inc.", "market": "US"},
    "GOOGL": {"ticker": "GOOGL", "name": "Alphabet Inc.", "market": "US"},
    "META": {"ticker": "META", "name": "Meta Platforms", "market": "US"},
    # IBEX 35 (España)
    "IBEX": {"ticker": "^IBEX", "name": "IBEX 35", "market": "ES"},
    "SAN": {"ticker": "SAN.MC", "name": "Banco Santander", "market": "ES"},
    "BBVA": {"ticker": "BBVA.MC", "name": "BBVA", "market": "ES"},
    "ITX": {"ticker": "ITX.MC", "name": "Inditex", "market": "ES"},
    "IBE": {"ticker": "IBE.MC", "name": "Iberdrola", "market": "ES"},
    "REP": {"ticker": "REP.MC", "name": "Repsol", "market": "ES"},
    "TEF": {"ticker": "TEF.MC", "name": "Telefónica", "market": "ES"}
}

STOCKS_CACHE: Dict[str, Dict[str, Any]] = {}
STOCKS_CACHE_TIME = 0

class BaseStockProvider:
    """Interfaz abstracta para proveedores de cotizaciones (yfinance, Finnhub, etc.)."""
    def fetch_quotes(self, symbols: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        raise NotImplementedError

    def fetch_history(self, ticker: str, interval: str, start: int, end: int) -> List[Dict[str, Any]]:
        raise NotImplementedError

class YFinanceStockProvider(BaseStockProvider):
    def fetch_quotes(self, symbols: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        if not yf:
            return {}
        tickers_to_query = [info["ticker"] for info in symbols.values()]
        results = {}
        now = time.time()
        try:
            tickers_str = " ".join(tickers_to_query)
            data = yf.Tickers(tickers_str)
            for sym, info in symbols.items():
                t = info["ticker"]
                ticker_obj = getattr(data.tickers, t.replace(".", "_"), None) or data.tickers.get(t)
                price = None
                change24h = None
                high24h = None
                low24h = None
                volume = None

                if ticker_obj:
                    fast_info = getattr(ticker_obj, 'fast_info', None)
                    if fast_info:
                        lp = getattr(fast_info, 'last_price', None)
                        if lp is not None and not (isinstance(lp, float) and (lp != lp or lp <= 0)):
                            price = round(float(lp), 2 if float(lp) > 1 else 4)
                        pc = getattr(fast_info, 'previous_close', None)
                        if price is not None and pc is not None and pc > 0:
                            change24h = round(((price - pc) / pc) * 100, 2)
                        dh = getattr(fast_info, 'day_high', None)
                        if dh: high24h = round(float(dh), 2)
                        dl = getattr(fast_info, 'day_low', None)
                        if dl: low24h = round(float(dl), 2)
                        lv = getattr(fast_info, 'last_volume', None)
                        if lv: volume = int(lv)

                m_open, m_msg = is_market_open(info["market"])
                results[sym] = {
                    "symbol": sym,
                    "ticker": t,
                    "name": info["name"],
                    "market": info["market"],
                    "currency": "EUR" if info["market"] == "ES" else "USD",
                    "price": price,
                    "change24h": change24h,
                    "high24h": high24h,
                    "low24h": low24h,
                    "volume": volume,
                    "timestamp": int(now),
                    "live": price is not None,
                    "marketOpen": m_open,
                    "marketStatus": m_msg if price is not None else "Cotización no disponible (sin datos en vivo)"
                }
            return results
        except Exception as e:
            print(f"[StockProvider YFinance] Error: {e}", file=sys.stderr)
            return {}

    def fetch_history(self, ticker: str, interval: str, start: int, end: int) -> List[Dict[str, Any]]:
        """Velas entre `start` y `end` (epoch en segundos) con un intervalo nativo de Yahoo (1m, 5m, 60m, 1d, 1wk, 1mo...)."""
        if not yf:
            return []
        try:
            utc = datetime.timezone.utc
            df = yf.Ticker(ticker).history(
                start=datetime.datetime.fromtimestamp(start, utc), end=datetime.datetime.fromtimestamp(end, utc),
                interval=interval, auto_adjust=False,
            )
            candles = []
            for idx, row in df.iterrows():
                try:
                    o, h, l, c = (float(row[k]) for k in ("Open", "High", "Low", "Close"))
                    if any(math.isnan(x) for x in (o, h, l, c)) or o <= 0:
                        continue
                    v = row.get("Volume", 0)
                    vol = int(v) if (v is not None and not (isinstance(v, float) and math.isnan(v))) else 0
                    digits = 2 if c >= 1 else 4
                    candles.append({"time": int(idx.timestamp()), "open": round(o, digits), "high": round(h, digits),
                                    "low": round(l, digits), "close": round(c, digits), "volume": vol})
                except (ValueError, TypeError):
                    continue
            return candles
        except Exception as e:
            print(f"[StockProvider YFinance History] Error: {e}", file=sys.stderr)
            return []

class FinnhubStockProvider(BaseStockProvider):
    def __init__(self, api_key: str):
        self.api_key = api_key

    def fetch_quotes(self, symbols: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        # Implementación Finnhub para despliegues con API key oficial
        results = {}
        now = time.time()
        for sym, info in symbols.items():
            if info["market"] == "US":
                try:
                    url = f"https://finnhub.io/api/v1/quote?symbol={info['ticker']}&token={self.api_key}"
                    r = requests.get(url, timeout=3)
                    if r.status_code == 200:
                        d = r.json()
                        p = d.get("c")
                        dp = d.get("dp")
                        m_open, m_msg = is_market_open("US")
                        results[sym] = {
                            "symbol": sym,
                            "ticker": info["ticker"],
                            "name": info["name"],
                            "market": "US",
                            "price": round(float(p), 2) if p else None,
                            "change24h": round(float(dp), 2) if dp is not None else None,
                            "timestamp": int(now),
                            "live": p is not None,
                            "marketOpen": m_open,
                            "marketStatus": m_msg
                        }
                except Exception:
                    pass
        return results

    RESOLUTIONS = {"1m": "1", "5m": "5", "15m": "15", "30m": "30", "60m": "60", "1d": "D", "1wk": "W", "1mo": "M"}

    def fetch_history(self, ticker: str, interval: str, start: int, end: int) -> List[Dict[str, Any]]:
        """Velas históricas de Finnhub (requiere un plan con acceso a /stock/candle)."""
        resolution = self.RESOLUTIONS.get(interval)
        if not resolution:
            return []
        from_ts, now = start, end
        try:
            url = f"https://finnhub.io/api/v1/stock/candle?symbol={ticker}&resolution={resolution}&from={from_ts}&to={now}&token={self.api_key}"
            r = requests.get(url, timeout=5)
            if r.status_code == 200:
                d = r.json()
                if d.get("s") == "ok":
                    candles = []
                    for t, o, h, l, c, v in zip(d.get("t", []), d.get("o", []), d.get("h", []), d.get("l", []), d.get("c", []), d.get("v", [])):
                        candles.append({
                            "time": int(t),
                            "open": round(float(o), 2),
                            "high": round(float(h), 2),
                            "low": round(float(l), 2),
                            "close": round(float(c), 2),
                            "volume": float(v)
                        })
                    return candles
        except Exception as e:
            print(f"[Finnhub] Error obteniendo historial: {e}", file=sys.stderr)
        return []

_PROVIDER: Dict[str, Any] = {"key": None, "instance": None}

def provider() -> BaseStockProvider:
    """Proveedor activo según el panel de administración (o .env). Se recrea si cambia la configuración."""
    name, key = settings.get("stock_data_provider"), settings.get("finnhub_api_key")
    if _PROVIDER["key"] != (name, key):
        _PROVIDER["instance"] = FinnhubStockProvider(key) if name == "finnhub" and key else YFinanceStockProvider()
        _PROVIDER["key"] = (name, key)
    return _PROVIDER["instance"]

def fetch_live_stock_quotes() -> Dict[str, Dict[str, Any]]:
    """Obtiene cotizaciones reales. Si el proveedor falla, NUNCA inventa precios fijos ni porcentajes."""
    global STOCKS_CACHE, STOCKS_CACHE_TIME
    now = time.time()
    if now - STOCKS_CACHE_TIME < 15 and STOCKS_CACHE:
        return STOCKS_CACHE

    try:
        fresh_data = provider().fetch_quotes(STOCK_SYMBOLS)
    except Exception as e:
        print(f"[StockProvider] Error consultando cotizaciones: {e}", file=sys.stderr)
        fresh_data = {}

    if fresh_data:
        STOCKS_CACHE = fresh_data
        STOCKS_CACHE_TIME = now
        return fresh_data

    # Si falla la red o el proveedor externo, retornar estado honesto (sin datos inventados)
    if STOCKS_CACHE:
        # Usar último valor conocido marcando 'sin datos en vivo'
        stale_results = {}
        for sym, data in STOCKS_CACHE.items():
            stale_copy = dict(data)
            stale_copy["live"] = False
            stale_copy["marketStatus"] = "Datos en diferido (sin conexión en vivo)"
            stale_results[sym] = stale_copy
        return stale_results

    # Sin datos previos: indicar 'No disponible' explícitamente por símbolo
    unavailable = {}
    for sym, info in STOCK_SYMBOLS.items():
        m_open, m_msg = is_market_open(info["market"])
        unavailable[sym] = {
            "symbol": sym,
            "ticker": info["ticker"],
            "name": info["name"],
            "market": info["market"],
            "price": None,
            "change24h": None,
            "high24h": None,
            "low24h": None,
            "volume": None,
            "timestamp": int(now),
            "live": False,
            "marketOpen": m_open,
            "marketStatus": "No disponible (sin datos en vivo)"
        }
    return unavailable

async def api_stock_quotes(request):
    """Endpoint REST para cotizaciones de bolsa."""
    USAGE_STATS["stock_requests"] += 1
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=120):
        return JSONResponse({"error": "Límite de peticiones de bolsa excedido por minuto."}, status_code=429, headers={"Retry-After": "60"})

    loop = asyncio.get_event_loop()
    quotes = await loop.run_in_executor(None, fetch_live_stock_quotes)
    return JSONResponse({
        "status": "success",
        "timestamp": int(time.time()),
        "data": quotes
    })

STOCK_SYMBOL_ALIASES = {
    "NVIDIA": "NVDA", "NVDA": "NVDA",
    "APPLE": "AAPL", "AAPL": "AAPL",
    "TESLA": "TSLA", "TSLA": "TSLA",
    "MICROSOFT": "MSFT", "MSFT": "MSFT",
    "AMAZON": "AMZN", "AMZN": "AMZN",
    "IBEX": "IBEX", "IBEX35": "IBEX", "^IBEX": "IBEX",
    "SANTANDER": "SAN", "SAN": "SAN",
    "BBVA": "BBVA",
    "INDITEX": "ITX", "ITX": "ITX",
    "TELEFONICA": "TEF", "TEF": "TEF",
    "IBERDROLA": "IBE", "IBE": "IBE", "IBE.MC": "IBE",
    "REPSOL": "REP", "REP": "REP", "REP.MC": "REP",
    "GOOGLE": "GOOGL", "GOOG": "GOOGL",
    "META": "META"
}

SPARKS_CACHE: Dict[str, Any] = {"timestamp": 0, "data": {}}
SPARKS_LOCK = asyncio.Lock()

def fetch_stock_sparks_sync() -> Dict[str, List[float]]:
    """Cierres diarios del último mes de todo el catálogo en una sola descarga (evita saturar al proveedor)."""
    if not yf:
        return {}
    tickers = {info["ticker"]: sym for sym, info in STOCK_SYMBOLS.items()}
    try:
        df = yf.download(list(tickers), period="1mo", interval="1d", group_by="ticker", progress=False, threads=False, auto_adjust=False)
    except Exception as e:
        print(f"[Sparks] Error descargando cierres: {e}", file=sys.stderr)
        return {}
    out = {}
    for ticker, sym in tickers.items():
        try:
            closes = [round(float(v), 4) for v in df[ticker]["Close"].tolist() if v == v]
            if len(closes) >= 2:
                out[sym] = closes
        except (KeyError, TypeError, ValueError):
            continue
    return out

async def api_stock_sparks(request):
    """Mini-series de 1 mes para las tendencias de la tabla de mercados (caché de 30 min)."""
    async with SPARKS_LOCK:
        if time.time() - SPARKS_CACHE["timestamp"] > 1800 or not SPARKS_CACHE["data"]:
            data = await asyncio.get_running_loop().run_in_executor(None, fetch_stock_sparks_sync)
            if data:
                SPARKS_CACHE.update(timestamp=time.time(), data=data)
    return JSONResponse({"status": "success", "data": SPARKS_CACHE["data"]})
