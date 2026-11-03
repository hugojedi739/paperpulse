"""Precios que usa el servidor para ejecutar órdenes. El cliente nunca aporta el precio.

Todo pasa por las funciones de este módulo (last_price_e8, fx_e8, market_open, candles), así los tests pueden
sustituirlas por precios fijos sin tocar la red.
"""
import time
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from backend.market import candles as candles_mod
from backend.market import stocks
from backend.market.crypto import binance_get, cached, remember
from backend.market.fx import real_rates_sync
from backend.market.hours import is_market_open
from backend.trading.rules import E8, OrderError

# Activos operables en la cuenta del servidor: el mismo catálogo que frontend/js/lib/catalog.js.
# (Los activos que el usuario encuentra con la búsqueda solo se pueden operar en el modo local.)
_CRYPTO = [("BTC", "Bitcoin"), ("ETH", "Ethereum"), ("SOL", "Solana"), ("BNB", "BNB"), ("XRP", "XRP"),
           ("ADA", "Cardano"), ("DOGE", "Dogecoin"), ("DOT", "Polkadot"), ("AVAX", "Avalanche"),
           ("LINK", "Chainlink"), ("TRX", "TRON"), ("POL", "Polygon")]
ASSETS: Dict[str, Dict] = {
    **{s: {"symbol": s, "name": n, "type": "crypto", "quote": "USDT", "pair": f"{s}USDT"} for s, n in _CRYPTO},
    **{s: {"symbol": s, "name": i["name"], "type": "stock", "quote": "EUR" if i["market"] == "ES" else "USD",
           "ticker": i["ticker"], "market": i["market"]} for s, i in stocks.STOCK_SYMBOLS.items()},
}

MAX_QUOTE_AGE = 120  # segundos: una cotización de bolsa más antigua no sirve para ejecutar a mercado


def asset(symbol: str) -> Dict:
    a = ASSETS.get(str(symbol or "").upper().strip())
    if not a:
        raise OrderError("Ese activo no se puede operar con la cuenta del servidor.")
    return a


def to_e8(value) -> int:
    """Precio de un proveedor (cadena de Binance o float de Yahoo) a entero en 1e-8."""
    return int(Decimal(str(value)) * E8)


def market_open(symbol: str) -> Tuple[bool, str]:
    a = asset(symbol)
    if a["type"] == "crypto":
        return True, "El mercado de criptomonedas abre 24/7"
    return is_market_open(a["market"])


def last_price_e8(symbol: str) -> int:
    """Último precio negociado según el proveedor. Lanza OrderError si no hay cotización fiable."""
    a = asset(symbol)
    if a["type"] == "crypto":
        key = ("trade-price", a["pair"])
        price = cached(key, 2)
        if price is None:
            try:
                price = remember(key, binance_get("/api/v3/ticker/price", {"symbol": a["pair"]})["price"])
            except Exception:
                raise OrderError(f"Sin cotización de {a['symbol']} ahora mismo. Inténtalo en unos segundos.") from None
        return to_e8(price)
    quote = stocks.fetch_live_stock_quotes().get(a["symbol"]) or {}
    if not quote.get("price") or not quote.get("live") or time.time() - quote.get("timestamp", 0) > MAX_QUOTE_AGE:
        raise OrderError(f"Sin cotización en vivo de {a['symbol']}. Inténtalo en unos segundos.")
    return to_e8(quote["price"])


def fx_e8(quote: str) -> int:
    """USD por unidad de la divisa del activo, en 1e-8. USDT se trata como 1 USD."""
    if quote in ("USD", "USDT"):
        return E8
    rates = real_rates_sync()  # base USD: rates["EUR"] = euros por dólar
    rate = (rates or {}).get(quote)
    if not rate:
        raise OrderError(f"Sin tipo de cambio {quote}/USD disponible. Inténtalo más tarde.")
    return int(Decimal(E8) / Decimal(str(rate)))


def candles(symbol: str, interval: str, limit: int, end: int) -> List[Dict[str, int]]:
    """Velas [{time, open, high, low}] (precios en 1e-8) anteriores a `end`, de la más antigua a la más reciente."""
    a = asset(symbol)
    key = ("trade-candles", symbol, interval, limit, end // 30)  # varias órdenes del mismo activo comparten descarga
    raw: Optional[List[Dict]] = cached(key, 30)
    if raw is None:
        if a["type"] == "crypto":
            raw = candles_mod.fetch_klines(a["pair"], candles_mod.INTERVALS[interval][1], limit, end)
        else:
            raw, _ = candles_mod.fetch_stock(a["ticker"], interval, limit, end)
        remember(key, raw)
    return [{"time": int(c["time"]), "open": to_e8(c["open"]), "high": to_e8(c["high"]), "low": to_e8(c["low"])}
            for c in raw if c["time"] < end]


def valuation_prices(symbols) -> Dict[str, Tuple[int, int]]:
    """Precios para VALORAR posiciones (clasificación), no para ejecutar: {símbolo: (precio_e8, fx_e8)}.

    Pocas llamadas para muchos activos: una a Binance con todos los pares, la consulta agrupada de bolsa
    (caché de 15 s) y el tipo de cambio. Con la bolsa cerrada vale el último precio conocido.
    Los activos sin precio no aparecen: quien llama los valora a su coste (y marca el resultado como aproximado).
    """
    wanted = {s: ASSETS[s] for s in symbols if s in ASSETS}
    out: Dict[str, Tuple[int, int]] = {}
    pairs = sorted(a["pair"] for a in wanted.values() if a["type"] == "crypto")
    if pairs:
        key = ("valuation-crypto", ",".join(pairs))
        raw = cached(key, 30)
        if raw is None:
            try:
                raw = remember(key, binance_get("/api/v3/ticker/price", {"symbols": "[" + ",".join(f'"{p}"' for p in pairs) + "]"}))
            except Exception:
                raw = []
        by_pair = {t["symbol"]: t["price"] for t in raw}
        for s, a in wanted.items():
            if a["type"] == "crypto" and a["pair"] in by_pair:
                out[s] = (to_e8(by_pair[a["pair"]]), E8)
    if any(a["type"] == "stock" for a in wanted.values()):
        quotes = stocks.fetch_live_stock_quotes()
        for s, a in wanted.items():
            price = (quotes.get(s) or {}).get("price") if a["type"] == "stock" else None
            if price:
                try:
                    out[s] = (to_e8(price), fx_e8(a["quote"]))
                except OrderError:
                    pass  # sin tipo de cambio: se valora a coste
    return out
