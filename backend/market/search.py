"""Búsqueda multimercado: pares USDT de Binance y acciones/índices de Yahoo Finance."""
import sys
import time
import asyncio
from typing import Dict, Any, List

import requests
from starlette.responses import JSONResponse

from backend.market import stocks
from backend.market.crypto import binance_get
from backend.market.stocks import STOCK_SYMBOLS, get_yfinance
from backend.security import IP_STOCK_CALLS, check_ip_rate_limit, get_client_ip

# ==============================================================================
# Búsqueda Real Multimercado (Binance 750+ Pares USDT + Bolsa US/IBEX/Global)
# ==============================================================================
BINANCE_CACHE = {
    "timestamp": 0,
    "pairs": []
}

async def get_binance_pairs() -> List[Dict[str, Any]]:
    now = time.time()
    if now - BINANCE_CACHE["timestamp"] < 30 and BINANCE_CACHE["pairs"]:
        return BINANCE_CACHE["pairs"]

    loop = asyncio.get_running_loop()
    def fetch():
        try:
            data = binance_get("/api/v3/ticker/24hr", {}, timeout=5)
            if isinstance(data, list):
                pairs = []
                for item in data:
                    sym = item.get("symbol", "")
                    if sym.endswith("USDT") and not sym.endswith("UPUSDT") and not sym.endswith("DOWNUSDT"):
                        base = sym[:-4]
                        try:
                            price = float(item.get("lastPrice", 0))
                            change = float(item.get("priceChangePercent", 0))
                            vol = float(item.get("quoteVolume", 0))
                            if price > 0:
                                pairs.append({
                                    "symbol": base,
                                    "pair": f"{base}/USDT",
                                    "binance_symbol": sym,
                                    "name": base,
                                    "type": "crypto",
                                    "price": price,
                                    "change24h": round(change, 2),
                                    "volume": round(vol, 0),
                                    "market": "BINANCE",
                                    "exchange": "Binance Spot"
                                })
                        except (ValueError, TypeError):
                            continue
                return pairs
        except Exception as e:
            print(f"[Binance Search Cache] Error: {e}", file=sys.stderr)
        return BINANCE_CACHE["pairs"]

    res = await loop.run_in_executor(None, fetch)
    if res:
        BINANCE_CACHE["pairs"] = res
        BINANCE_CACHE["timestamp"] = now
    return BINANCE_CACHE["pairs"]

async def search_stocks_yahoo(query: str) -> List[Dict[str, Any]]:
    loop = asyncio.get_running_loop()
    def fetch():
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            r = requests.get("https://query2.finance.yahoo.com/v1/finance/search",
                             params={"q": query[:40], "quotesCount": 6, "newsCount": 0}, headers=headers, timeout=3)
            if r.status_code == 200:
                quotes = r.json().get("quotes", [])
                results = []
                for q in quotes:
                    quote_type = q.get("quoteType", "")
                    if quote_type in ("EQUITY", "ETF", "INDEX"):
                        ticker = q.get("symbol", "")
                        name = q.get("shortname") or q.get("longname") or ticker
                        exch = q.get("exchange", "")
                        clean_sym = ticker.replace("^", "").split(".")[0].upper()
                        is_es = ".MC" in ticker or ticker == "^IBEX" or exch in ("MCE", "BME")
                        base_sym = clean_sym
                        price = None
                        change = None
                        cache_key = None
                        if ticker == "^IBEX":
                            cache_key = "IBEX"
                        elif base_sym in stocks.STOCKS_CACHE and stocks.STOCKS_CACHE[base_sym].get("ticker") == ticker:
                            cache_key = base_sym

                        if cache_key and cache_key in stocks.STOCKS_CACHE and stocks.STOCKS_CACHE[cache_key].get("live"):
                            price = stocks.STOCKS_CACHE[cache_key]["price"]
                            change = stocks.STOCKS_CACHE[cache_key]["change24h"]
                        results.append({
                            "symbol": base_sym,
                            "ticker": ticker,
                            "pair": f"{base_sym}/EUR" if is_es else f"{base_sym}/USD",
                            "name": name,
                            "type": "stock",
                            "price": price,
                            "change24h": change,
                            "market": "BME" if is_es else exch,
                            "exchange": "Bolsa de Madrid" if is_es else (q.get("exchDisp") or exch)
                        })
                return results
        except Exception as e:
            print(f"[Yahoo Search] Error buscando {query}: {e}", file=sys.stderr)
        return []
    return await loop.run_in_executor(None, fetch)

async def api_search(request):
    """Endpoint unificado de búsqueda en tiempo real."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=120):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 120)."}, status_code=429, headers={"Retry-After": "60"})

    q = request.query_params.get("q", "").strip()
    if not q or len(q) < 2:
        return JSONResponse({"status": "success", "query": q, "results": []})

    q_norm = q.lower()

    # 1. Criptomonedas reales de Binance
    binance_pairs = await get_binance_pairs()
    matched_crypto = []
    for p in binance_pairs:
        sym_lower = p["symbol"].lower()
        if sym_lower == q_norm:
            matched_crypto.insert(0, p)
        elif sym_lower.startswith(q_norm):
            matched_crypto.append(p)
        elif q_norm in sym_lower:
            matched_crypto.append(p)
        if len(matched_crypto) >= 12:
            break

    # 2. Catálogo de acciones (solo datos reales del cache)
    curated_matches = []
    for sym, info in STOCK_SYMBOLS.items():
        if q_norm in sym.lower() or q_norm in info["name"].lower():
            cache_info = stocks.STOCKS_CACHE.get(sym, {})
            price = cache_info.get("price")  # None si no hay cotización viva
            change = cache_info.get("change24h")
            curated_matches.append({
                "symbol": sym,
                "ticker": info["ticker"],
                "pair": f"{sym}/USD" if info["market"] == "US" else f"{sym}/EUR",
                "name": info["name"],
                "type": "stock",
                "price": price,
                "change24h": change,
                "market": "BME" if info["market"] == "ES" else "NASDAQ/NYSE",
                "exchange": "Bolsa de Madrid" if info["market"] == "ES" else "Wall Street"
            })

    # 3. Búsqueda global externa
    yahoo_matches = await search_stocks_yahoo(q)
    seen_tickers = {m.get("ticker") for m in curated_matches}
    additional_stocks = []
    for ym in yahoo_matches:
        if ym.get("ticker") not in seen_tickers and len(additional_stocks) < 5:
            additional_stocks.append(ym)
            seen_tickers.add(ym.get("ticker"))

    # Intentar obtener precios reales para las acciones que no los tengan
    stocks_needing_price = [s for s in (curated_matches + additional_stocks) if s.get("price") is None][:3]
    yf = get_yfinance() if stocks_needing_price else None  # solo se carga yfinance si hace falta
    if yf:
        if stocks_needing_price:
            loop = asyncio.get_running_loop()
            def fetch_missing_prices():
                for s in stocks_needing_price:
                    try:
                        tkr = yf.Ticker(s.get("ticker", s["symbol"]))
                        fi = getattr(tkr, 'fast_info', None)
                        if fi:
                            lp = getattr(fi, 'last_price', None)
                            if lp is not None and not (isinstance(lp, float) and (lp != lp or lp <= 0)):
                                s["price"] = round(float(lp), 2)
                            pc = getattr(fi, 'previous_close', None)
                            if s["price"] is not None and pc and pc > 0:
                                s["change24h"] = round(((s["price"] - pc) / pc) * 100, 2)
                    except Exception:
                        pass
            await loop.run_in_executor(None, fetch_missing_prices)

    all_results = []
    all_results.extend(curated_matches)
    all_results.extend(matched_crypto[:8])
    all_results.extend(additional_stocks)

    return JSONResponse({
        "status": "success",
        "query": q,
        "count": len(all_results),
        "results": all_results[:16]
    })
