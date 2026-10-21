"""
PaperPulse Terminal Trading Backend
Starlette + Uvicorn server providing:
- Anthropic Claude AI Chat Streaming with Server-Side Key Security (claude-haiku-5-5)
- Real Stock Market Data (US Equities & IBEX 35) via Abstract Provider Architecture
- Exact Real-World Timezone Market Hours (America/New_York & Europe/Madrid) with Holiday Awareness
- Zero-Mock Policy: No Fake Fallback Prices or Synthetic Changes (+0.45%)
- Real-Time WebSocket Channel for Stock Ticks (Unified with Binance Format)
- FX Exchange Rates Proxy (ECB / Frankfurter) with In-Memory Caching (Zero CORS)
- Multi-Tier Security: Isolated public/ Directory, Strict CORS, Trusted Proxy Resolution
- Cost & Usage Control: Global & Per-IP Daily Token & Request Caps, 80% Spend Alert
"""

import os
import sys
import json
import time
import asyncio
import datetime
import zoneinfo
import re
import math
import urllib.request
import html
import email.utils
import xml.etree.ElementTree as ET
import hmac
import hashlib
import secrets
from typing import Dict, Any, List, Optional, Tuple, Set

# Third-party libraries
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Route, WebSocketRoute, Mount
from starlette.responses import JSONResponse, Response, StreamingResponse, FileResponse
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect
import requests

# Optional providers
try:
    import yfinance as yf
except ImportError:
    yf = None

try:
    import anthropic
except ImportError:
    anthropic = None

# ==============================================================================
# 1. Configuración de Entorno y Seguridad (.env)
# ==============================================================================
def load_dotenv():
    env_file = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_file):
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except Exception as e:
            print(f"[Config] Error leyendo .env: {e}", file=sys.stderr)

load_dotenv()

# Modelo de IA PaperPulse: Claude Haiku 5.5 (lanzado en oct 2026, coste ultra-bajo)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")
ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "1800"))
PORT = int(os.getenv("PORT", "8000"))
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1")

# Orígenes CORS permitidos
raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000")
ALLOWED_ORIGINS = [orig.strip() for orig in raw_origins.split(",") if orig.strip()]
if not ALLOWED_ORIGINS:
    ALLOWED_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"]

# Proxies de confianza para resolución de IP real
raw_proxies = os.getenv("TRUSTED_PROXIES", "127.0.0.1,::1")
TRUSTED_PROXIES: Set[str] = {p.strip() for p in raw_proxies.split(",") if p.strip()}

# Límites de coste y cuota diaria
DAILY_GLOBAL_TOKEN_LIMIT = int(os.getenv("DAILY_GLOBAL_TOKEN_LIMIT", "1000000"))
DAILY_USER_TOKEN_LIMIT = int(os.getenv("DAILY_USER_TOKEN_LIMIT", "100000"))
DAILY_USER_CHAT_REQUESTS = int(os.getenv("DAILY_USER_CHAT_REQUESTS", "100"))
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")
STOCK_DATA_PROVIDER = os.getenv("STOCK_DATA_PROVIDER", "yfinance").lower()

PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")

# ==============================================================================
# 2. Control de Uso, Límites (Rate Limiting) y Diagnóstico
# ==============================================================================
USAGE_STATS = {
    "start_time": time.time(),
    "today": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
    "chat_requests": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "daily_input_tokens": 0,
    "daily_output_tokens": 0,
    "daily_total_tokens": 0,
    "daily_token_limit": DAILY_GLOBAL_TOKEN_LIMIT,
    "estimated_cost_usd": 0.0,
    "stock_requests": 0,
    "errors": 0,
    "alert_80_triggered": False
}

IP_CHAT_CALLS: Dict[str, List[float]] = {}
IP_STOCK_CALLS: Dict[str, List[float]] = {}
IP_DAILY_DATA: Dict[str, Dict[str, Any]] = {}

def get_client_ip(request) -> str:
    """Extrae la IP real del cliente respetando proxies de confianza."""
    direct_host = request.client.host if request.client else "127.0.0.1"
    if direct_host in TRUSTED_PROXIES:
        x_forwarded = request.headers.get("x-forwarded-for")
        if x_forwarded:
            first_ip = x_forwarded.split(",")[0].strip()
            if first_ip:
                return first_ip
    return direct_host

def check_date_rollover():
    """Reinicia contadores diarios a las 00:00 UTC."""
    today_utc = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    if USAGE_STATS["today"] != today_utc:
        USAGE_STATS["today"] = today_utc
        USAGE_STATS["daily_input_tokens"] = 0
        USAGE_STATS["daily_output_tokens"] = 0
        USAGE_STATS["daily_total_tokens"] = 0
        USAGE_STATS["alert_80_triggered"] = False
        # Limpiar registros diarios de IP antiguos
        IP_DAILY_DATA.clear()

def record_token_usage(client_ip: str, input_tokens: int, output_tokens: int):
    """Registra y acumula el consumo exacto de tokens de Anthropic."""
    check_date_rollover()
    total = input_tokens + output_tokens

    # Global
    USAGE_STATS["input_tokens"] += input_tokens
    USAGE_STATS["output_tokens"] += output_tokens
    USAGE_STATS["daily_input_tokens"] += input_tokens
    USAGE_STATS["daily_output_tokens"] += output_tokens
    USAGE_STATS["daily_total_tokens"] += total
    
    # Precios claude-haiku-5-5: $0.10/M in, $0.50/M out
    cost = (USAGE_STATS["daily_input_tokens"] * 0.00000010) + (USAGE_STATS["daily_output_tokens"] * 0.00000050)
    USAGE_STATS["estimated_cost_usd"] = round(cost, 5)

    # Per-IP
    today = USAGE_STATS["today"]
    ip_rec = IP_DAILY_DATA.setdefault(client_ip, {"date": today, "chat_count": 0, "tokens": 0})
    if ip_rec["date"] != today:
        ip_rec["date"] = today
        ip_rec["chat_count"] = 0
        ip_rec["tokens"] = 0
    ip_rec["tokens"] += total

    # Alerta del 80% del tope global
    if not USAGE_STATS["alert_80_triggered"]:
        if USAGE_STATS["daily_total_tokens"] >= DAILY_GLOBAL_TOKEN_LIMIT * 0.8:
            print(f"[ALERTA DE SEGURIDAD] Consumo diario de IA al 80% del límite global ({USAGE_STATS['daily_total_tokens']}/{DAILY_GLOBAL_TOKEN_LIMIT} tokens).", file=sys.stderr)
            USAGE_STATS["alert_80_triggered"] = True

def check_ip_rate_limit(ip: str, store: Dict[str, List[float]], max_calls_per_minute: int = 20) -> bool:
    """Ventana deslizante de 60 segundos por IP."""
    now = time.time()
    calls = store.get(ip, [])
    calls = [t for t in calls if now - t < 60]
    if len(calls) >= max_calls_per_minute:
        store[ip] = calls
        return False
    calls.append(now)
    store[ip] = calls
    return True

def cleanup_stale_ip_data():
    """Evita fugas de memoria limpiando IPs inactivas."""
    now = time.time()
    for store in (IP_CHAT_CALLS, IP_STOCK_CALLS):
        stale_keys = [ip for ip, calls in store.items() if not calls or (now - calls[-1] > 600)]
        for k in stale_keys:
            store.pop(k, None)

# ==============================================================================
# 3. Tipos de Cambio (FX) con Caché (Frankfurter / BCE)
# ==============================================================================
FX_CACHE = {
    "timestamp": 0,
    "rates": {
        "USD": 1.0,
        "EUR": 0.925,
        "GBP": 0.792,
        "JPY": 154.50,
        "CHF": 0.890,
        "CAD": 1.380
    }
}

async def get_exchange_rates(request):
    """Retorna tipos de cambio actualizados con caché de 1 hora."""
    now = time.time()
    if now - FX_CACHE["timestamp"] < 3600 and FX_CACHE["rates"]:
        return JSONResponse({
            "status": "success",
            "source": "cache",
            "base": "USD",
            "rates": FX_CACHE["rates"],
            "updated_at": FX_CACHE["timestamp"]
        })

    try:
        loop = asyncio.get_event_loop()
        def fetch_fx():
            resp = requests.get("https://api.frankfurter.app/latest?from=USD", timeout=4)
            if resp.status_code == 200:
                data = resp.json()
                rates = data.get("rates", {})
                rates["USD"] = 1.0
                return rates
            return None

        new_rates = await loop.run_in_executor(None, fetch_fx)
        if new_rates:
            FX_CACHE["rates"] = new_rates
            FX_CACHE["timestamp"] = now
            return JSONResponse({
                "status": "success",
                "source": "frankfurter_ecb",
                "base": "USD",
                "rates": FX_CACHE["rates"],
                "updated_at": FX_CACHE["timestamp"]
            })
    except Exception as e:
        print(f"[FX] Advertencia obteniendo divisas: {e}", file=sys.stderr)

    return JSONResponse({
        "status": "fallback",
        "source": "fallback_offline",
        "base": "USD",
        "rates": FX_CACHE["rates"],
        "updated_at": FX_CACHE["timestamp"]
    })

# ==============================================================================
# 4. Horarios de Mercado Reales con Zonas Horarias y Detección de Festivos
# ==============================================================================
TZ_NY = zoneinfo.ZoneInfo("America/New_York")
TZ_MADRID = zoneinfo.ZoneInfo("Europe/Madrid")

# Festivos bursátiles de Wall Street (NYSE / NASDAQ)
US_HOLIDAYS_FIXED = {(1, 1), (6, 19), (7, 4), (12, 25)}
# Festivos bursátiles de la Bolsa de Madrid (BME)
ES_HOLIDAYS_FIXED = {(1, 1), (5, 1), (12, 25), (12, 26)}

def is_market_open(market: str = "US") -> Tuple[bool, str]:
    """
    Verifica horario de mercado usando zonas horarias exactas (sin aproximaciones UTC+2):
    - Wall Street: America/New_York (09:30 - 16:00 ET, L-V)
    - Bolsa de Madrid: Europe/Madrid (09:00 - 17:30 CET/CEST, L-V)
    """
    now_utc = datetime.datetime.now(datetime.timezone.utc)

    if market == "US":
        now_local = now_utc.astimezone(TZ_NY)
        weekday = now_local.weekday()
        month, day = now_local.month, now_local.day

        if weekday >= 5:
            return False, "Wall Street cerrado (Fin de semana). Próxima apertura: Lunes 09:30 ET"
        if (month, day) in US_HOLIDAYS_FIXED:
            return False, f"Wall Street cerrado por festivo bursátil. Próxima apertura: Mañana 09:30 ET"

        t = now_local.time()
        open_time = datetime.time(9, 30)
        close_time = datetime.time(16, 0)
        is_open = open_time <= t < close_time

        if is_open:
            return True, "Mercado de Wall Street abierto (09:30 - 16:00 ET)"
        elif t < open_time:
            return False, f"Wall Street abre hoy a las 09:30 ET ({open_time.strftime('%H:%M')} NY)"
        else:
            return False, "Wall Street cerrado. Próxima sesión mañana a las 09:30 ET"

    else:
        now_local = now_utc.astimezone(TZ_MADRID)
        weekday = now_local.weekday()
        month, day = now_local.month, now_local.day

        if weekday >= 5:
            return False, "Bolsa de Madrid cerrada (Fin de semana). Próxima apertura: Lunes 09:00 CET"
        if (month, day) in ES_HOLIDAYS_FIXED:
            return False, f"Bolsa de Madrid cerrada por festivo BME. Próxima apertura: Mañana 09:00 CET"

        t = now_local.time()
        open_time = datetime.time(9, 0)
        close_time = datetime.time(17, 30)
        is_open = open_time <= t < close_time

        if is_open:
            return True, "Bolsa de Madrid abierta (09:00 - 17:30 CET)"
        elif t < open_time:
            return False, f"Bolsa de Madrid abre hoy a las 09:00 CET"
        else:
            return False, "Bolsa de Madrid cerrada. Próxima sesión mañana a las 09:00 CET"

TZ_LONDON = zoneinfo.ZoneInfo("Europe/London")
TZ_BERLIN = zoneinfo.ZoneInfo("Europe/Berlin")
TZ_TOKYO = zoneinfo.ZoneInfo("Asia/Tokyo")

MARKETS_CACHE = {
    "timestamp": 0,
    "data": []
}

def build_markets_data_sync() -> List[Dict[str, Any]]:
    """Calcula el estado verificado en tiempo real de los mercados financieros mundiales."""
    now_utc = datetime.datetime.now(datetime.timezone.utc)
    markets = []

    # 1. Nueva York (Wall Street - NYSE / NASDAQ)
    now_ny = now_utc.astimezone(TZ_NY)
    is_open_us, msg_us = is_market_open("US")
    t_ny = now_ny.time()
    weekday_ny = now_ny.weekday()
    open_us = datetime.time(9, 30)

    if is_open_us:
        next_dt = now_ny.replace(hour=16, minute=0, second=0, microsecond=0)
        next_event_text = f"Cierra hoy a las 16:00 ET ({next_dt.strftime('%H:%M')} NY)"
    else:
        if weekday_ny < 5 and t_ny < open_us and (now_ny.month, now_ny.day) not in US_HOLIDAYS_FIXED:
            next_dt = now_ny.replace(hour=9, minute=30, second=0, microsecond=0)
            next_event_text = "Abre hoy a las 09:30 ET"
        else:
            days = 1
            if weekday_ny == 4:
                days = 3
            elif weekday_ny >= 5:
                days = 7 - weekday_ny
            next_date = now_ny.date() + datetime.timedelta(days=days)
            next_dt = datetime.datetime.combine(next_date, open_us, tzinfo=TZ_NY)
            next_event_text = f"Abre el próximo día hábil 09:30 ET"
    next_event_utc_us = next_dt.astimezone(datetime.timezone.utc).isoformat()

    markets.append({
        "id": "us",
        "name": "Bolsa de Nueva York (Wall Street)",
        "city": "Nueva York",
        "country": "EE.UU.",
        "flag": "🇺🇸",
        "latitude": 40.7128,
        "longitude": -74.0060,
        "timezone": "America/New_York",
        "local_time": now_ny.strftime("%H:%M"),
        "open": is_open_us,
        "status": msg_us,
        "hours": "09:30 - 16:00 ET (L-V)",
        "next_event_utc": next_event_utc_us,
        "next_event_text": next_event_text
    })

    # 2. Bolsa de Madrid (BME / IBEX 35)
    now_madrid = now_utc.astimezone(TZ_MADRID)
    is_open_es, msg_es = is_market_open("ES")
    t_es = now_madrid.time()
    weekday_es = now_madrid.weekday()
    open_es = datetime.time(9, 0)
    tz_es_name = now_madrid.strftime("%Z") or "CEST"

    if is_open_es:
        next_dt = now_madrid.replace(hour=17, minute=30, second=0, microsecond=0)
        next_event_text = f"Cierra hoy a las 17:30 {tz_es_name}"
    else:
        if weekday_es < 5 and t_es < open_es and (now_madrid.month, now_madrid.day) not in ES_HOLIDAYS_FIXED:
            next_dt = now_madrid.replace(hour=9, minute=0, second=0, microsecond=0)
            next_event_text = f"Abre hoy a las 09:00 {tz_es_name}"
        else:
            days = 1
            if weekday_es == 4:
                days = 3
            elif weekday_es >= 5:
                days = 7 - weekday_es
            next_date = now_madrid.date() + datetime.timedelta(days=days)
            next_dt = datetime.datetime.combine(next_date, open_es, tzinfo=TZ_MADRID)
            next_event_text = f"Abre el próximo día hábil 09:00 {tz_es_name}"
    next_event_utc_es = next_dt.astimezone(datetime.timezone.utc).isoformat()

    markets.append({
        "id": "es",
        "name": "Bolsa de Madrid (BME / IBEX 35)",
        "city": "Madrid",
        "country": "España",
        "flag": "🇪🇸",
        "latitude": 40.4168,
        "longitude": -3.7038,
        "timezone": "Europe/Madrid",
        "local_time": now_madrid.strftime("%H:%M"),
        "open": is_open_es,
        "status": msg_es,
        "hours": f"09:00 - 17:30 {tz_es_name} (L-V)",
        "next_event_utc": next_event_utc_es,
        "next_event_text": next_event_text
    })

    # 3. Criptomonedas (Binance Global 24/7)
    markets.append({
        "id": "crypto",
        "name": "Mercado Cripto (Binance Global)",
        "city": "Global 24/7",
        "country": "Descentralizado",
        "flag": "🌐",
        "latitude": 1.3521,
        "longitude": 103.8198,
        "timezone": "UTC",
        "local_time": now_utc.strftime("%H:%M"),
        "open": True,
        "status": "Mercado continuo 24/7 sin cierre",
        "hours": "24/7 continuo",
        "next_event_utc": None,
        "next_event_text": "Sesión continua (sin cierre)"
    })

    # 4. Londres (LSE) - Bolsa en Reino Unido
    now_lon = now_utc.astimezone(TZ_LONDON)
    tz_lon_name = now_lon.strftime("%Z") or "GMT"
    markets.append({
        "id": "lon",
        "name": "Bolsa de Londres (LSE)",
        "city": "Londres",
        "country": "Reino Unido",
        "flag": "🇬🇧",
        "latitude": 51.5074,
        "longitude": -0.1278,
        "timezone": "Europe/London",
        "local_time": now_lon.strftime("%H:%M"),
        "open": None,
        "status": "Horario habitual",
        "hours": f"08:00 - 16:30 {tz_lon_name}",
        "next_event_utc": None,
        "next_event_text": "Horario habitual"
    })

    # 5. Fráncfort (Xetra / DAX)
    now_fra = now_utc.astimezone(TZ_BERLIN)
    tz_fra_name = now_fra.strftime("%Z") or "CEST"
    markets.append({
        "id": "fra",
        "name": "Bolsa de Fráncfort (Xetra / DAX)",
        "city": "Fráncfort",
        "country": "Alemania",
        "flag": "🇩🇪",
        "latitude": 50.1109,
        "longitude": 8.6821,
        "timezone": "Europe/Berlin",
        "local_time": now_fra.strftime("%H:%M"),
        "open": None,
        "status": "Horario habitual",
        "hours": f"09:00 - 17:30 {tz_fra_name}",
        "next_event_utc": None,
        "next_event_text": "Horario habitual"
    })

    # 6. Tokio (TSE / Nikkei)
    now_tyo = now_utc.astimezone(TZ_TOKYO)
    markets.append({
        "id": "tyo",
        "name": "Bolsa de Tokio (TSE / Nikkei)",
        "city": "Tokio",
        "country": "Japón",
        "flag": "🇯🇵",
        "latitude": 35.6762,
        "longitude": 139.6503,
        "timezone": "Asia/Tokyo",
        "local_time": now_tyo.strftime("%H:%M"),
        "open": None,
        "status": "Horario habitual",
        "hours": "09:00 - 15:30 JST",
        "next_event_utc": None,
        "next_event_text": "Horario habitual"
    })

    return markets

async def api_markets(request):
    """Endpoint público y ligero con estado de mercados globales."""
    now = time.time()
    if now - MARKETS_CACHE["timestamp"] < 30 and MARKETS_CACHE["data"]:
        return JSONResponse({
            "status": "success",
            "source": "cache",
            "updated_at": MARKETS_CACHE["timestamp"],
            "markets": MARKETS_CACHE["data"]
        })

    loop = asyncio.get_event_loop()
    markets_data = await loop.run_in_executor(None, build_markets_data_sync)
    MARKETS_CACHE["data"] = markets_data
    MARKETS_CACHE["timestamp"] = now

    return JSONResponse({
        "status": "success",
        "source": "live",
        "updated_at": now,
        "markets": markets_data
    })

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

    def fetch_history(self, ticker: str, period: str, interval: str) -> List[Dict[str, Any]]:
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

    def fetch_history(self, ticker: str, period: str, interval: str) -> List[Dict[str, Any]]:
        if not yf:
            return []
        try:
            t = yf.Ticker(ticker)
            df = t.history(period=period, interval=interval)
            candles = []
            for idx, row in df.iterrows():
                try:
                    o = float(row["Open"])
                    h = float(row["High"])
                    l = float(row["Low"])
                    c = float(row["Close"])
                    if math.isnan(o) or math.isnan(h) or math.isnan(l) or math.isnan(c) or o <= 0:
                        continue
                    v = row.get("Volume", 0)
                    vol = int(v) if (v is not None and not (isinstance(v, float) and math.isnan(v))) else 0
                    candles.append({
                        "time": int(idx.timestamp()),
                        "open": round(o, 2),
                        "high": round(h, 2),
                        "low": round(l, 2),
                        "close": round(c, 2),
                        "volume": vol
                    })
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

    def fetch_history(self, ticker: str, period: str, interval: str) -> List[Dict[str, Any]]:
        """Obtiene velas históricas de Finnhub si la clave está configurada."""
        resolution = "D"
        if interval in ("1m", "1"):
            resolution = "1"
        elif interval in ("5m", "5"):
            resolution = "5"
        elif interval in ("15m", "15"):
            resolution = "15"
        elif interval in ("1h", "60"):
            resolution = "60"
        elif interval in ("1D", "D"):
            resolution = "D"
        elif interval in ("1W", "W"):
            resolution = "W"

        now = int(time.time())
        from_ts = now - (30 * 86400)
        if period == "1d":
            from_ts = now - 86400
        elif period == "5d":
            from_ts = now - (5 * 86400)
        elif period == "1mo":
            from_ts = now - (30 * 86400)
        elif period in ("1y", "max"):
            from_ts = now - (365 * 86400)

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

# Inicializar proveedor seleccionado
finnhub_key = os.getenv("FINNHUB_API_KEY", "")
if STOCK_DATA_PROVIDER == "finnhub" and finnhub_key:
    stock_provider: BaseStockProvider = FinnhubStockProvider(finnhub_key)
else:
    stock_provider = YFinanceStockProvider()

def fetch_live_stock_quotes() -> Dict[str, Dict[str, Any]]:
    """Obtiene cotizaciones reales. Si el proveedor falla, NUNCA inventa precios fijos ni porcentajes."""
    global STOCKS_CACHE, STOCKS_CACHE_TIME
    now = time.time()
    if now - STOCKS_CACHE_TIME < 15 and STOCKS_CACHE:
        return STOCKS_CACHE

    try:
        fresh_data = stock_provider.fetch_quotes(STOCK_SYMBOLS)
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

BINANCE_KLINES_CACHE: Dict[Tuple[str, str, int], Tuple[float, List[Dict[str, Any]]]] = {}
STOCK_HISTORY_CACHE: Dict[Tuple[str, str, str], Tuple[float, List[Dict[str, Any]]]] = {}

async def api_stock_history(request):
    """Endpoint para velas históricas OHLC reales de bolsa (Wall Street & IBEX 35)."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 60)."}, status_code=429, headers={"Retry-After": "60"})

    params = request.query_params
    raw_sym = params.get("symbol", "NVDA").upper().strip()
    symbol = STOCK_SYMBOL_ALIASES.get(raw_sym, raw_sym)
    interval = params.get("interval", "1d").strip()
    period = params.get("period")

    # Mapeo inteligente de periodo válido para yfinance
    if not period:
        if interval in ("1m", "2m"):
            period = "1d"
        elif interval in ("5m", "15m", "30m"):
            period = "5d"
        elif interval in ("60m", "1h"):
            period = "1mo"
        elif interval == "1d":
            period = "1y"
        elif interval in ("1wk", "1w"):
            period = "2y"
        else:
            period = "1mo"

    sym_info = STOCK_SYMBOLS.get(symbol)
    if not sym_info:
        # Soporte dinámico para cualquier ticker bursátil válido (US o IBEX o índices como ^IBEX)
        if re.match(r'^\^?[A-Z0-9.\-]{1,14}$', raw_sym):
            ticker = raw_sym
            market = "ES" if (ticker.endswith(".MC") or ticker in ("^IBEX", "IBEX")) else "US"
            sym_info = {"ticker": ticker, "name": raw_sym, "market": market}
        else:
            return JSONResponse({"error": f"Símbolo no soportado o formato inválido: {raw_sym}"}, status_code=400)

    cache_key = (sym_info["ticker"], period, interval)
    now = time.time()
    if cache_key in STOCK_HISTORY_CACHE:
        c_time, c_candles = STOCK_HISTORY_CACHE[cache_key]
        if now - c_time < 30:
            return JSONResponse({
                "status": "success",
                "symbol": symbol,
                "ticker": sym_info["ticker"],
                "market": sym_info["market"],
                "count": len(c_candles),
                "candles": c_candles,
                "source": "cache"
            })

    loop = asyncio.get_event_loop()
    candles = await loop.run_in_executor(None, lambda: stock_provider.fetch_history(sym_info["ticker"], period, interval))
    if candles:
        STOCK_HISTORY_CACHE[cache_key] = (now, candles)

    return JSONResponse({
        "status": "success",
        "symbol": symbol,
        "ticker": sym_info["ticker"],
        "market": sym_info["market"],
        "count": len(candles),
        "candles": candles,
        "source": "live_provider"
    })

async def api_klines(request):
    """Proxy con caché para velas históricas OHLC de Binance (evita problemas de CORS/red)."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 60)."}, status_code=429, headers={"Retry-After": "60"})

    params = request.query_params
    raw_symbol = params.get("symbol", "BTCUSDT").upper().replace("/", "").replace("-", "")
    interval = params.get("interval", "1m").lower()
    try:
        limit = min(1000, max(10, int(params.get("limit", "500"))))
    except (ValueError, TypeError):
        limit = 500

    valid_intervals = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}
    if interval not in valid_intervals:
        interval = "1m"

    cache_key = (raw_symbol, interval, limit)
    now = time.time()
    ttl = 5 if interval in ("1m", "3m", "5m") else (15 if interval in ("15m", "30m") else 60)

    if cache_key in BINANCE_KLINES_CACHE:
        cached_time, cached_candles = BINANCE_KLINES_CACHE[cache_key]
        if now - cached_time < ttl:
            return JSONResponse({
                "status": "success",
                "symbol": raw_symbol,
                "interval": interval,
                "count": len(cached_candles),
                "candles": cached_candles,
                "source": "cache"
            })

    def fetch_binance():
        url = f"https://api.binance.com/api/v3/klines?symbol={raw_symbol}&interval={interval}&limit={limit}"
        resp = requests.get(url, timeout=6)
        if resp.status_code == 200:
            raw = resp.json()
            candles = []
            for k in raw:
                candles.append({
                    "time": int(k[0] // 1000),
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5])
                })
            return candles
        return None

    try:
        loop = asyncio.get_event_loop()
        candles = await loop.run_in_executor(None, fetch_binance)
        if candles:
            BINANCE_KLINES_CACHE[cache_key] = (now, candles)
            return JSONResponse({
                "status": "success",
                "symbol": raw_symbol,
                "interval": interval,
                "count": len(candles),
                "candles": candles,
                "source": "binance_rest"
            })
    except Exception as e:
        print(f"[Klines Proxy] Error obteniendo velas Binance: {e}", file=sys.stderr)

    if cache_key in BINANCE_KLINES_CACHE:
        _, cached_candles = BINANCE_KLINES_CACHE[cache_key]
        return JSONResponse({
            "status": "success",
            "symbol": raw_symbol,
            "interval": interval,
            "count": len(cached_candles),
            "candles": cached_candles,
            "source": "stale_cache"
        })

    return JSONResponse({
        "status": "error",
        "message": f"No se pudieron obtener velas reales para {raw_symbol} en {interval}"
    }, status_code=502)

# ==============================================================================
# 6. WebSocket para Retransmisión de Bolsa en Tiempo Real
# ==============================================================================
ACTIVE_WEBSOCKETS: List[WebSocket] = []
WS_CLIENT_IPS: Dict[WebSocket, str] = {}

async def ws_stocks_endpoint(websocket: WebSocket):
    client_ip = get_client_ip(websocket)
    ip_count = sum(1 for ip in WS_CLIENT_IPS.values() if ip == client_ip)
    if len(ACTIVE_WEBSOCKETS) >= 50 or ip_count >= 5:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    ACTIVE_WEBSOCKETS.append(websocket)
    WS_CLIENT_IPS[websocket] = client_ip
    try:
        loop = asyncio.get_event_loop()
        quotes = await loop.run_in_executor(None, fetch_live_stock_quotes)
        await websocket.send_text(json.dumps({
            "type": "snapshot",
            "timestamp": int(time.time()),
            "data": quotes
        }))
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if websocket in ACTIVE_WEBSOCKETS:
            ACTIVE_WEBSOCKETS.remove(websocket)
        WS_CLIENT_IPS.pop(websocket, None)

async def stocks_broadcast_worker():
    """Bucle de fondo: envía actualizaciones WebSocket cada 5 segundos y limpia memoria."""
    loop_count = 0
    while True:
        try:
            loop_count += 1
            if loop_count % 120 == 0:  # Cada 10 minutos
                cleanup_stale_ip_data()

            if ACTIVE_WEBSOCKETS:
                loop = asyncio.get_event_loop()
                quotes = await loop.run_in_executor(None, fetch_live_stock_quotes)
                msg = json.dumps({
                    "type": "batch_tick",
                    "timestamp": int(time.time()),
                    "data": quotes
                })
                dead_sockets = []
                for ws in list(ACTIVE_WEBSOCKETS):
                    try:
                        await ws.send_text(msg)
                    except Exception:
                        dead_sockets.append(ws)
                for ws in dead_sockets:
                    if ws in ACTIVE_WEBSOCKETS:
                        ACTIVE_WEBSOCKETS.remove(ws)
                    WS_CLIENT_IPS.pop(ws, None)
        except Exception as e:
            print(f"[Worker] Error en broadcast: {e}", file=sys.stderr)
        await asyncio.sleep(5)

# ==============================================================================
# 7. Búsqueda Real Multimercado (Binance 750+ Pares USDT + Bolsa US/IBEX/Global)
# ==============================================================================
BINANCE_CACHE = {
    "timestamp": 0,
    "pairs": []
}

async def get_binance_pairs() -> List[Dict[str, Any]]:
    now = time.time()
    if now - BINANCE_CACHE["timestamp"] < 30 and BINANCE_CACHE["pairs"]:
        return BINANCE_CACHE["pairs"]

    loop = asyncio.get_event_loop()
    def fetch():
        try:
            resp = requests.get("https://api.binance.com/api/v3/ticker/24hr", timeout=3.5)
            if resp.status_code == 200:
                data = resp.json()
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
    loop = asyncio.get_event_loop()
    def fetch():
        try:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
            url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}&quotesCount=6&newsCount=0"
            r = requests.get(url, headers=headers, timeout=3)
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
                        elif base_sym in STOCKS_CACHE and STOCKS_CACHE[base_sym].get("ticker") == ticker:
                            cache_key = base_sym

                        if cache_key and cache_key in STOCKS_CACHE and STOCKS_CACHE[cache_key].get("live"):
                            price = STOCKS_CACHE[cache_key]["price"]
                            change = STOCKS_CACHE[cache_key]["change24h"]
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
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 60)."}, status_code=429, headers={"Retry-After": "60"})

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
            cache_info = STOCKS_CACHE.get(sym, {})
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
    if yf:
        stocks_needing_price = [s for s in (curated_matches + additional_stocks) if s.get("price") is None][:3]
        if stocks_needing_price:
            loop = asyncio.get_event_loop()
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

# ==============================================================================
# 7.5 Feed de Noticias Financieras Reales (CoinDesk + Google News Economía/Bolsa)
# ==============================================================================
NEWS_CACHE = {
    "timestamp": 0,
    "articles": []
}

def clean_html_text(raw_text: str) -> str:
    """Elimina etiquetas HTML y entidades para titulares y resúmenes limpios."""
    if not raw_text:
        return ""
    clean = re.sub(r'<[^>]+>', ' ', raw_text)
    clean = html.unescape(clean)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean

def parse_rss_datetime(date_str: str) -> str:
    """Convierte fechas RFC 2822 a ISO 8601 con fallback seguro."""
    if not date_str:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        return dt.isoformat()
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()

def fetch_real_news_sync() -> List[Dict[str, Any]]:
    """Consulta feeds RSS oficiales de información financiera (CoinDesk + Google News Economía/Bolsa).
    Cero noticias inventadas, solo titulares reales, medio oficial, enlace original y fecha verificada."""
    articles = []
    seen_urls = set()
    art_id = 1

    # 1. Criptomonedas: CoinDesk RSS Oficial
    try:
        req = urllib.request.Request(
            "https://www.coindesk.com/arc/outboundfeeds/rss/",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaperPulseTerminal/2.4"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            root = ET.fromstring(resp.read())
            items = root.findall(".//item")
            for item in items[:20]:
                title = clean_html_text(item.findtext("title", ""))
                link = item.findtext("link", "").strip()
                pub_date = parse_rss_datetime(item.findtext("pubDate", ""))
                desc = clean_html_text(item.findtext("description", ""))
                creator = clean_html_text(item.findtext("{http://purl.org/dc/elements/1.1/}creator", "")) or "CoinDesk"

                img_url = ""
                media_content = item.find("{http://search.yahoo.com/mrss/}content")
                if media_content is not None and media_content.get("url"):
                    img_url = media_content.get("url")

                if title and link and link not in seen_urls:
                    seen_urls.add(link)
                    articles.append({
                        "id": art_id,
                        "title": title,
                        "excerpt": desc[:220] + ("..." if len(desc) > 220 else ""),
                        "category": "crypto",
                        "source": "CoinDesk",
                        "author": creator,
                        "date": pub_date,
                        "url": link,
                        "imageUrl": img_url
                    })
                    art_id += 1
    except Exception as e:
        print(f"[News] Error consultando feed de CoinDesk: {e}", file=sys.stderr)

    # 2. Bolsa y Economía en Español: Google News Business España
    try:
        req = urllib.request.Request(
            "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=es&gl=ES&ceid=ES:es",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PaperPulseTerminal/2.4"}
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            root = ET.fromstring(resp.read())
            items = root.findall(".//item")
            for item in items[:25]:
                raw_title = clean_html_text(item.findtext("title", ""))
                link = item.findtext("link", "").strip()
                pub_date = parse_rss_datetime(item.findtext("pubDate", ""))

                source_el = item.find("source")
                source_name = source_el.text.strip() if (source_el is not None and source_el.text) else "Google News"

                title = raw_title
                if " - " in title:
                    parts = title.rsplit(" - ", 1)
                    title = parts[0].strip()
                    if not source_name or source_name == "Google News":
                        source_name = parts[1].strip()

                lower_title = title.lower()

                # Bloque G.6: Filtro de relevancia de mercados (descartar cultivos, recetas, deportes, etc.)
                irrelevant_topics = [
                    "cultivo", "cultivos", "agrícola", "agricultura", "cosecha", "ganadería", "pesca",
                    "receta", "cocina", "farándula", "horóscopo", "moda", "belleza", "futbol", "fútbol",
                    "fichaje", "concierto", "celebridad", "lotería", "sabor", "gastronomía", "restaurante",
                    "clima", "meteorología", "carnaval", "concurso", "festival"
                ]
                stock_keywords = [
                    "ibex", "santander", "bbva", "inditex", "repsol", "telefónica", "telefonica",
                    "iberdrola", "nvidia", "apple", "tesla", "wall street", "nasdaq", "nyse",
                    "acciones", "bolsa", "dividendo", "earnings", "bpa", "capitalización", "cotización", "s&p"
                ]
                financial_keywords = [
                    "bolsa", "mercado", "mercados", "acción", "acciones", "ibex", "wall street", "nasdaq",
                    "bce", "fed", "banco central", "inflación", "tipos de interés", "deuda", "bonos", "tesoro",
                    "pib", "dividendo", "dividendos", "beneficio", "ingresos", "resultados", "trimestre", "bpa",
                    "santander", "bbva", "inditex", "telefónica", "telefonica", "repsol", "iberdrola", "caixabank",
                    "apple", "nvidia", "tesla", "microsoft", "amazon", "google", "meta", "crypto", "bitcoin",
                    "ethereum", "petróleo", "brent", "gas", "oro", "divisas", "dólar", "dolar", "euro", "cotización",
                    "cotiza", "inversión", "inversores", "capital", "opa", "fusión", "adquisición", "aranceles",
                    "banca", "entidad", "cnmv", "sec", "recesión", "crecimiento", "política monetaria", "euribor",
                    "economía", "financiero", "financiera", "arancel", "comercio exterior", "exportaciones", "empleo"
                ]

                # Descartar si coincide con temas irrelevantes sin mención bursátil
                if any(bad in lower_title for bad in irrelevant_topics) and not any(k in lower_title for k in stock_keywords):
                    continue

                # Exigir relevancia financiera mínima
                if not any(good in lower_title for good in financial_keywords):
                    continue

                cat = "stocks" if any(k in lower_title for k in stock_keywords) else "economy"

                if title and link and link not in seen_urls:
                    seen_urls.add(link)
                    articles.append({
                        "id": art_id,
                        "title": title,
                        "excerpt": f"Información de mercado y actualidad económica reportada por {source_name}.",
                        "category": cat,
                        "source": source_name,
                        "author": source_name,
                        "date": pub_date,
                        "url": link,
                        "imageUrl": ""
                    })
                    art_id += 1
    except Exception as e:
        print(f"[News] Error consultando feed de Google News: {e}", file=sys.stderr)

    # Ordenar cronológicamente descendente
    articles.sort(key=lambda x: x["date"], reverse=True)
    for i, a in enumerate(articles, 1):
        a["id"] = i

    return articles

async def api_news(request):
    """Retorna noticias financieras y de criptomonedas 100% reales desde fuentes oficiales."""
    client_ip = get_client_ip(request)
    if not check_ip_rate_limit(client_ip, IP_STOCK_CALLS, max_calls_per_minute=60):
        return JSONResponse({"status": "error", "error": "Límite de peticiones excedido por minuto (máx. 60)."}, status_code=429, headers={"Retry-After": "60"})

    now = time.time()
    if now - NEWS_CACHE["timestamp"] < 900 and NEWS_CACHE["articles"]:
        articles = NEWS_CACHE["articles"]
    else:
        loop = asyncio.get_event_loop()
        fresh_articles = await loop.run_in_executor(None, fetch_real_news_sync)
        if fresh_articles:
            NEWS_CACHE["articles"] = fresh_articles
            NEWS_CACHE["timestamp"] = now
            articles = fresh_articles
        else:
            articles = NEWS_CACHE["articles"]

    category = request.query_params.get("category", "all").lower().strip()
    if category != "all":
        filtered = [a for a in articles if a["category"] == category]
    else:
        filtered = articles

    return JSONResponse({
        "status": "success",
        "count": len(filtered),
        "updated_at": NEWS_CACHE["timestamp"],
        "articles": filtered
    })

# ==============================================================================
# 8. Chat con Claude AI (Streaming SSE, Historial, Seguridad y Control de Gasto)
# ==============================================================================
SYSTEM_PROMPT_TEMPLATE = """Eres PaperPulse AI, el analista cuantitativo y asistente de mercado en PaperPulse Terminal.
Tu función es informar al usuario con precisión sobre las cotizaciones y educarle en mercados financieros, análisis técnico, lectura de Order Flow y gestión matemática del riesgo (regla del 1-2%).
Hablas siempre en español claro, profesional, riguroso y estructurado.

SISTEMA DE PRECIOS EN TIEMPO REAL:
Dispones de conexión directa al feed de datos del terminal. Los datos reales y actualizados de mercado se te proporcionan a continuación en la sección "DATOS DE MERCADO (ÚNICAS CIFRAS QUE PUEDES CITAR)".
Por tanto, NUNCA digas que no tienes acceso a datos en tiempo real ni que desconoces las cotizaciones cuando aparezcan en dicha sección.

ESTADO DEL USUARIO (DATOS DE SOLO LECTURA):
- Modo Activo: {account_mode_label}
{account_status_details}
- Activo Actualmente Abierto en Gráfico: {active_symbol} (Temporalidad: {timeframe})
- Modo de Operativa del Terminal: {trade_mode}
- Moneda Activa del Usuario: {currency} (Formato Regional: {locale_hint})

DATOS DE MERCADO (ÚNICAS CIFRAS QUE PUEDES CITAR):
{market_context_block}

NORMAS ESTRICTAS DE RESPUESTA (OBLIGATORIAS):
1. RESPUESTA A "¿CÓMO ESTÁ EL MERCADO?" O PREGUNTAS DE COTIZACIÓN:
   - Si el usuario pregunta "¿cómo está el mercado?", "¿cómo va el mercado?" o consulta el precio de un activo: RESPONDE DE INMEDIATO EN LA PRIMERA LÍNEA citando el par (ejemplo: BTC/USDT), su cotización nativa, la equivalencia en {currency} (si difiere), la variación 24 h y su estado (en vivo, cierre de ayer o retrasado).
   - Ejemplo exacto: "BTC/USDT cotiza a 67.234,50 USDT (≈ 61.855,30 €) con una variación 24 h de +2,45% (dato en vivo)."
   - Realiza un análisis técnico o contextual más largo ÚNICAMENTE si el usuario lo solicita explícitamente.
2. REGLA FUNDAMENTAL DE PRECIOS:
   - Las cifras en "DATOS DE MERCADO" son las ÚNICAS que tienes permitido citar. No inventes ni menciones ningún otro precio numérico, soporte numérico o resistencia numérica que no esté en esa sección.
3. SI UN ACTIVO ESTÁ "NO DISPONIBLE" O FALTA COTIZACIÓN:
   - Responde obligatoriamente en una sola línea con la frase: "No tengo cotización de [Activo] ahora mismo." (ejemplo exacto: "No tengo cotización de BTC ahora mismo." o "No tengo cotización de Santander ahora mismo.").
   - NUNCA uses plantillas largas, disculpas, explicaciones sobre el gráfico ni texto adicional.
4. ACCIONES CERRADAS:
   - Si una acción tiene el estado "cierre de ayer", DEBES indicar explícitamente "cierre de ayer" o "último cierre" y NUNCA llamarlo precio "actual" ni "en vivo".
5. MODO CONSULTA (SIN CUENTA DE PRÁCTICA):
   - Si el usuario está en Modo Consulta, está TERMINANTEMENTE PROHIBIDO mencionar saldo, capital, liquidez ni poner ejemplos con el saldo del usuario. Céntrate exclusivamente en el mercado y conceptos técnicos.
6. DENOMINACIÓN DE PARES Y DIVISAS:
   - Menciona siempre el par real de cotización (BTC/USDT, ETH/USDT, SOL/USDT, SAN/EUR, NVDA/USD) y la moneda de visualización del usuario ({currency}).
7. FORMATO DE NÚMEROS Y MONEDAS:
   - Usa siempre la moneda activa ({currency}) y el formato numérico regional ({locale_hint}). En formato español/europeo: 67.234,50 USDT o 61.855,30 €.
8. Jamás des recomendaciones de inversión formal garantizadas; enfatiza la gestión matemática del riesgo, el ratio R:R y el Stop Loss."""

# ==============================================================================
# 8. Desafío Criptográfico Anti-Bot para Chat
# ==============================================================================
CHAT_CHALLENGE_SECRET = os.getenv("CHAT_CHALLENGE_SECRET", secrets.token_hex(32))
ACTIVE_CHALLENGES: Dict[str, float] = {}

def cleanup_expired_challenges():
    now = time.time()
    expired = [sig for sig, ts in ACTIVE_CHALLENGES.items() if now - ts > 300]
    for sig in expired:
        ACTIVE_CHALLENGES.pop(sig, None)

async def api_chat_challenge(request):
    """Genera un desafío criptográfico efímero anti-bots para peticiones de chat."""
    client_ip = get_client_ip(request)
    now = int(time.time())
    nonce = secrets.token_hex(8)
    message = f"{client_ip}:{now}:{nonce}".encode("utf-8")
    signature = hmac.new(CHAT_CHALLENGE_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()

    cleanup_expired_challenges()
    ACTIVE_CHALLENGES[signature] = now

    token = f"{now}:{nonce}:{signature}"
    return JSONResponse({"status": "ok", "challenge": token})

async def api_chat_stream(request):
    """Endpoint SSE para chat con Claude Haiku 5.5 con streaming y límites estrictos."""
    client_ip = get_client_ip(request)
    check_date_rollover()

    # 1. Validación de tamaño de cuerpo (anti-DDoS: máx 32KB)
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 32768:
        return JSONResponse({"error": "Petición demasiado grande."}, status_code=413)

    # 2. Rate limit por minuto
    if not check_ip_rate_limit(client_ip, IP_CHAT_CALLS, max_calls_per_minute=20):
        return JSONResponse({
            "error": "Has alcanzado el límite de preguntas por minuto. Por favor, espera unos segundos."
        }, status_code=429, headers={"Retry-After": "60"})

    # 3. Límite diario de peticiones por usuario/IP
    today = USAGE_STATS["today"]
    ip_rec = IP_DAILY_DATA.setdefault(client_ip, {"date": today, "chat_count": 0, "tokens": 0})
    if ip_rec["date"] != today:
        ip_rec["date"] = today
        ip_rec["chat_count"] = 0
        ip_rec["tokens"] = 0

    if ip_rec["chat_count"] >= DAILY_USER_CHAT_REQUESTS:
        return JSONResponse({
            "error": "Has alcanzado el límite diario de mensajes para tu sesión. Se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

    # 4. Límite diario global de tokens
    if USAGE_STATS["daily_total_tokens"] >= DAILY_GLOBAL_TOKEN_LIMIT:
        return JSONResponse({
            "error": "Se ha alcanzado el límite diario de consultas de IA. El servicio se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

    # 5. Límite diario de tokens por usuario
    if ip_rec["tokens"] >= DAILY_USER_TOKEN_LIMIT:
        return JSONResponse({
            "error": "Has alcanzado tu límite diario de consumo de IA. Se restablecerá a las 00:00 UTC."
        }, status_code=429, headers={"Retry-After": "60"})

    # Leer JSON del cuerpo con control de errores
    try:
        body_bytes = await request.body()
        if len(body_bytes) > 32768:
            return JSONResponse({"error": "Petición demasiado grande."}, status_code=413)
        body = json.loads(body_bytes.decode('utf-8'))
    except Exception:
        return JSONResponse({"error": "Petición JSON inválida."}, status_code=400)

    user_message = str(body.get("message", "")).strip()
    if not user_message:
        return JSONResponse({"error": "El mensaje no puede estar vacío."}, status_code=400)

    if len(user_message) > 2500:
        return JSONResponse({"error": "El mensaje supera el límite permitido de 2,500 caracteres."}, status_code=400)

    # Verificación Anti-bot (Desafío Criptográfico o Token de Seguridad)
    challenge_token = request.headers.get("x-chat-challenge", "") or str(body.get("challenge", "")).strip()
    if not challenge_token:
        return JSONResponse({"error": "Verificación anti-bot requerida para enviar mensajes al asistente."}, status_code=403)
    try:
        parts = challenge_token.split(":")
        if len(parts) != 3:
            return JSONResponse({"error": "Desafío de seguridad con formato inválido."}, status_code=403)
        ts_str, nonce, signature = parts
        token_ts = int(ts_str)
        now = int(time.time())
        if abs(now - token_ts) > 300:
            return JSONResponse({"error": "El desafío anti-bot ha caducado. Por favor, reenvía tu mensaje."}, status_code=403)
        expected_msg = f"{client_ip}:{ts_str}:{nonce}".encode("utf-8")
        expected_sig = hmac.new(CHAT_CHALLENGE_SECRET.encode("utf-8"), expected_msg, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return JSONResponse({"error": "Firma del desafío anti-bot incorrecta."}, status_code=403)
        if signature not in ACTIVE_CHALLENGES:
            return JSONResponse({"error": "El desafío anti-bot ya fue utilizado o ha expirado."}, status_code=403)
        # Consumir desafío (uso único)
        ACTIVE_CHALLENGES.pop(signature, None)
    except Exception:
        return JSONResponse({"error": "Error durante la verificación anti-bot."}, status_code=403)

    # Validación y sanitización rigurosa del contexto de cuenta
    account_ctx = body.get("context")
    if not isinstance(account_ctx, dict):
        account_ctx = {}

    has_practice = bool(account_ctx.get("hasPracticeAccount", False))
    raw_bal = str(account_ctx.get("balanceFormatted", account_ctx.get("balanceUsd", "0.00")))[:30].replace("\n", "").strip()
    raw_eq = str(account_ctx.get("equityFormatted", account_ctx.get("equityUsd", raw_bal)))[:30].replace("\n", "").strip()
    curr = str(account_ctx.get("currency", "EUR"))[:5].strip()
    currency = curr if curr in ("EUR", "USD", "GBP") else "EUR"
    locale = str(account_ctx.get("locale", "es-ES"))[:10].strip()
    locale_hint = "español/europeo (separador de miles con punto y decimales con coma: '1.250,50')" if locale == "es-ES" else "anglosajón"

    # Sanitizar posiciones
    raw_pos = account_ctx.get("positions", [])
    safe_positions = []
    if isinstance(raw_pos, list):
        for p in raw_pos[:10]:
            if isinstance(p, dict):
                sym = str(p.get("symbol", ""))[:10].replace("\n", "").strip()
                amt = p.get("amount", 0)
                pnl_formatted = str(p.get("pnlFormatted", f"${p.get('pnlUsd', 0)}"))[:25].replace("\n", "").strip()
                entry_formatted = str(p.get("entryPriceFormatted", p.get("entryPrice", "")))[:25].replace("\n", "").strip()
                if sym:
                    safe_positions.append(f"{sym} ({amt} ud, entrada: {entry_formatted}, PnL: {pnl_formatted})")
    positions_summary = ", ".join(safe_positions) if safe_positions else "Ninguna posición abierta actualmente."

    # Sanitizar resumen de diario
    raw_journal = str(account_ctx.get("journalSummary", "Sin operaciones recientes."))[:120].replace("\n", " ").strip()
    journal_summary = raw_journal if raw_journal else "Sin operaciones registradas."

    # Activo y temporalidad
    raw_sym = str(account_ctx.get("activeSymbol", "BTC"))[:12].replace("\n", "").strip()
    active_symbol = "".join(c for c in raw_sym if c.isalnum() or c in "/-") or "BTC"

    raw_tf = str(account_ctx.get("timeframe", "1D"))[:6].replace("\n", "").strip()
    timeframe = raw_tf if raw_tf in ("1m", "5m", "15m", "1h", "4h", "1D", "1W") else "1D"

    raw_tm = str(account_ctx.get("tradeMode", "Modo Fácil"))[:20].replace("\n", "").strip()
    trade_mode = "Modo Avanzado" if "avanzado" in raw_tm.lower() or "pro" in raw_tm.lower() else "Modo Fácil"

    if has_practice:
        account_mode_label = "Cuenta de Práctica PaperPulse Activa"
        account_status_details = (
            f"- Saldo en Efectivo Disponible: {raw_bal}\n"
            f"- Patrimonio Total (Equity): {raw_eq}\n"
            f"- Posiciones Abiertas: {positions_summary}\n"
            f"- Resumen del Diario: {journal_summary}"
        )
    else:
        account_mode_label = "Modo Consulta PaperPulse (Sin cuenta de práctica activa)"
        account_status_details = (
            "- El usuario NO tiene cuenta de práctica activa en este momento; está en Modo Consulta de mercado.\n"
            "- Está terminantemente PROHIBIDO mencionar saldo, efectivo, patrimonio o capital del usuario ni inventar ejemplos con su dinero."
        )

    # Sanitizar contexto de mercado (DATOS DE MERCADO ÚNICAS CIFRAS QUE PUEDES CITAR)
    raw_market = account_ctx.get("market", [])
    safe_market_lines = []
    if isinstance(raw_market, list):
        for item in raw_market[:6]:  # longitud limitada (máximo 6 activos)
            if isinstance(item, dict):
                m_sym = "".join(c for c in str(item.get("symbol", ""))[:10] if c.isalnum() or c in "/-").upper()
                m_pair = "".join(c for c in str(item.get("pair", ""))[:15] if c.isalnum() or c in "/-").upper() or f"{m_sym}/USDT"
                
                raw_p_native = str(item.get("priceNativeFormatted", item.get("price", "No disponible")))[:30].replace("\n", "").strip()
                raw_p_disp = str(item.get("priceDisplayFormatted", ""))[:35].replace("\n", "").strip()
                raw_chg = str(item.get("change24h", "No disponible"))[:15].replace("\n", "").strip()
                raw_upd = str(item.get("lastUpdate", "No disponible"))[:15].replace("\n", "").strip()
                raw_st = str(item.get("status", "No disponible"))[:30].replace("\n", "").strip()

                if raw_p_native in ("No disponible", "0", "0.00", ""):
                    line = f"- {m_sym} ({m_pair}): Cotización No disponible (Estado: {raw_st})"
                else:
                    disp_part = f" ({raw_p_disp})" if raw_p_disp and raw_p_disp != raw_p_native and "No disponible" not in raw_p_disp else ""
                    line = f"- {m_sym} ({m_pair}): {raw_p_native}{disp_part} | Var 24h: {raw_chg} | Estado: {raw_st} | Última actualización: {raw_upd}"
                safe_market_lines.append(line)

    if not safe_market_lines:
        safe_market_lines = [
            f"- {active_symbol}: Cotización No disponible",
            "- BTC (BTC/USDT): Cotización No disponible",
            "- ETH (ETH/USDT): Cotización No disponible",
            "- SOL (SOL/USDT): Cotización No disponible"
        ]

    market_context_block = "\n".join(safe_market_lines)

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        account_mode_label=account_mode_label,
        account_status_details=account_status_details,
        market_context_block=market_context_block,
        active_symbol=active_symbol,
        timeframe=timeframe,
        trade_mode=trade_mode,
        currency=currency,
        locale_hint=locale_hint
    )

    # Validar y formatear historial de conversación (hasta 8 mensajes anteriores)
    raw_history = body.get("history", [])
    valid_messages = []
    if isinstance(raw_history, list):
        for h in raw_history[-8:]:
            if isinstance(h, dict):
                role = h.get("role")
                content = str(h.get("content", "")).strip()
                if role in ("user", "assistant") and content:
                    valid_messages.append({"role": role, "content": content[:2500]})

    # Asegurar alternancia correcta de roles requerida por Anthropic
    anthropic_messages = []
    expected_role = "user"
    for m in valid_messages:
        if m["role"] == expected_role:
            anthropic_messages.append(m)
            expected_role = "assistant" if expected_role == "user" else "user"
        elif anthropic_messages and anthropic_messages[-1]["role"] == m["role"]:
            # Fusionar mensajes consecutivos del mismo rol
            anthropic_messages[-1]["content"] += f"\n\n{m['content']}"

    # Añadir mensaje actual del usuario
    if anthropic_messages and anthropic_messages[-1]["role"] == "user":
        anthropic_messages[-1]["content"] += f"\n\n{user_message}"
    else:
        anthropic_messages.append({"role": "user", "content": user_message})

    USAGE_STATS["chat_requests"] += 1
    ip_rec["chat_count"] += 1

    # Cabeceras anti-buffering
    sse_headers = {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Content-Type": "text/event-stream; charset=utf-8"
    }

    # Si no hay clave real de Anthropic, usar flujo local seguro (sin exponer secretos en producción)
    api_key = ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key or not anthropic:
        async def mock_stream():
            yield f"data: {json.dumps({'text': '👋 **PaperPulse AI (Modo Servidor Local)**:\n\n'})}\n\n"
            await asyncio.sleep(0.04)

            u_lower = user_message.lower()
            is_market_query = any(w in u_lower for w in ["mercado", "como esta", "cómo está", "precio", "cotiza", "cotizacion", "cotización", "btc", "bitcoin", "eth", "sol", "san", "nvda", "santander", "apple"])

            if is_market_query:
                target_item = None
                if isinstance(raw_market, list) and raw_market:
                    if any(w in u_lower for w in ["btc", "bitcoin"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "BTC"), None)
                    elif any(w in u_lower for w in ["eth", "ethereum"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "ETH"), None)
                    elif any(w in u_lower for w in ["sol", "solana"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "SOL"), None)
                    elif any(w in u_lower for w in ["san", "santander"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "SAN"), None)
                    elif any(w in u_lower for w in ["nvda", "nvidia"]):
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == "NVDA"), None)
                    elif active_symbol:
                        target_item = next((it for it in raw_market if isinstance(it, dict) and it.get("symbol") == active_symbol), None)

                    if not target_item:
                        target_item = raw_market[0]

                if not target_item or str(target_item.get("price", "")).strip() in ("No disponible", "0", "") or target_item.get("priceNativeFormatted") in ("No disponible", ""):
                    sym_name = (target_item.get("symbol") if target_item else active_symbol) or "BTC"
                    response_text = f"No tengo cotización de {sym_name} ahora mismo."
                else:
                    pair = target_item.get("pair", f"{target_item.get('symbol')}/USDT")
                    p_native = target_item.get("priceNativeFormatted")
                    p_disp = target_item.get("priceDisplayFormatted", "")
                    disp_str = f" ({p_disp})" if p_disp and p_disp != p_native and "No disponible" not in p_disp else ""
                    chg = target_item.get("change24h", "No disponible")
                    st = target_item.get("status", "en vivo")
                    if st == "cierre de ayer":
                        response_text = f"{pair} se sitúa en {p_native}{disp_str} (cierre de ayer), con una variación de {chg}."
                    else:
                        response_text = f"{pair} cotiza a {p_native}{disp_str} con una variación 24 h de {chg} (dato {st})."
            elif has_practice:
                response_text = (
                    f"Detecto que tu saldo disponible es de **{raw_bal}** (patrimonio total de **{raw_eq}**) y estás analizando **{active_symbol}**.\n\n"
                    "Recuerda mantener tu riesgo por operación en un **1-2%** como marca la regla cuantitativa de gestión del riesgo."
                )
            else:
                response_text = (
                    f"Estás en **Modo Consulta** analizando el activo **{active_symbol}**.\n\n"
                    "Si deseas simular compras y ventas con capital virtual, puedes pulsar en **Empezar a practicar** para crear una cuenta con saldo ficticio."
                )

            # En modo desarrollo exclusivamente, añadir nota para el desarrollador
            if DEBUG:
                response_text += "\n\n*(Nota de desarrollo: Añade ANTHROPIC_API_KEY en .env para activar el modelo claude-haiku-5-5 en vivo)*"

            for word in response_text.split(" "):
                if await request.is_disconnected():
                    break
                yield f"data: {json.dumps({'text': word + ' '})}\n\n"
                await asyncio.sleep(0.02)
            yield "data: [DONE]\n\n"

        return StreamingResponse(mock_stream(), media_type="text/event-stream", headers=sse_headers)

    # Llamada real con Streaming a Anthropic con claude-haiku-5-5
    async def anthropic_stream():
        try:
            # Timeout de 45 segundos
            client = anthropic.AsyncAnthropic(api_key=api_key, timeout=45.0)
            async with client.messages.stream(
                model=ANTHROPIC_MODEL,
                max_tokens=ANTHROPIC_MAX_TOKENS,
                system=system_prompt,
                messages=anthropic_messages
            ) as stream:
                async for text in stream.text_stream:
                    if await request.is_disconnected():
                        print(f"[Chat] Cliente {client_ip} cerró la conexión. Abortando streaming para proteger tokens.", file=sys.stderr)
                        break
                    yield f"data: {json.dumps({'text': text})}\n\n"

                # Obtener mensaje final y registrar consumo exacto de tokens
                try:
                    final_msg = await stream.get_final_message()
                    if final_msg and final_msg.usage:
                        in_tok = final_msg.usage.input_tokens
                        out_tok = final_msg.usage.output_tokens
                        record_token_usage(client_ip, in_tok, out_tok)

                        # Detectar si se cortó por max_tokens
                        if getattr(final_msg, 'stop_reason', None) == "max_tokens":
                            yield f"data: {json.dumps({'truncated': True, 'text': ''})}\n\n"
                except Exception as usage_err:
                    print(f"[Chat] Error extrayendo usage: {usage_err}", file=sys.stderr)

            yield "data: [DONE]\n\n"

        except anthropic.RateLimitError:
            yield f"data: {json.dumps({'error': 'Límite de cuota temporal de Anthropic alcanzado. Por favor, reintenta en unos instantes.'})}\n\n"
            yield "data: [DONE]\n\n"
        except anthropic.AuthenticationError as auth_err:
            print(f"[Seguridad] Error de autenticación en Anthropic API: {auth_err}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'El asistente no está disponible ahora mismo.'})}\n\n"
            yield "data: [DONE]\n\n"
        except asyncio.TimeoutError:
            print(f"[Chat] Timeout superado en llamada a Anthropic para IP {client_ip}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'Tiempo de respuesta del asistente agotado. Inténtalo de nuevo.'})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            USAGE_STATS["errors"] += 1
            # Nunca enviar la excepción interna al navegador
            print(f"[Chat Error] Excepción en asistente: {type(e).__name__}: {e}", file=sys.stderr)
            yield f"data: {json.dumps({'error': 'El asistente no está disponible ahora mismo.'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(anthropic_stream(), media_type="text/event-stream", headers=sse_headers)

# ==============================================================================
# 9. Diagnóstico y Salud del Servidor (/api/health)
# ==============================================================================
async def api_health(request):
    """Endpoint de estado del servidor. Métricas de uso y diagnóstico restringidas a administradores."""
    uptime_sec = int(time.time() - USAGE_STATS["start_time"])
    auth_header = request.headers.get("x-admin-key", "")
    auth_param = request.query_params.get("key", "")
    provided_key = auth_header or auth_param

    is_admin = bool(ADMIN_API_KEY and provided_key == ADMIN_API_KEY)
    if not is_admin:
        return JSONResponse({"status": "healthy"})

    check_date_rollover()
    us_open, us_msg = is_market_open("US")
    es_open, es_msg = is_market_open("ES")
    percent_used = round((USAGE_STATS["daily_total_tokens"] / DAILY_GLOBAL_TOKEN_LIMIT) * 100, 2) if DAILY_GLOBAL_TOKEN_LIMIT > 0 else 0

    return JSONResponse({
        "status": "healthy",
        "uptime_seconds": uptime_sec,
        "anthropic_configured": bool(ANTHROPIC_API_KEY or os.getenv("ANTHROPIC_API_KEY")),
        "anthropic_model": ANTHROPIC_MODEL,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "connected_ws_clients": len(ACTIVE_WEBSOCKETS),
        "markets": {
            "wall_street": {"open": us_open, "status": us_msg, "timezone": "America/New_York"},
            "ibex_madrid": {"open": es_open, "status": es_msg, "timezone": "Europe/Madrid"}
        },
        "stats": {
            "uptime_seconds": uptime_sec,
            "today_utc": USAGE_STATS["today"],
            "chat_requests_total": USAGE_STATS["chat_requests"],
            "tokens_today": USAGE_STATS["daily_total_tokens"],
            "input_tokens_today": USAGE_STATS["daily_input_tokens"],
            "output_tokens_today": USAGE_STATS["daily_output_tokens"],
            "daily_token_limit": DAILY_GLOBAL_TOKEN_LIMIT,
            "percent_used": percent_used,
            "estimated_daily_cost_usd": USAGE_STATS["estimated_cost_usd"],
            "stock_requests": USAGE_STATS["stock_requests"],
            "errors": USAGE_STATS["errors"]
        }
    })

async def serve_index(request):
    """Sirve únicamente el index.html ubicado dentro de public/."""
    index_path = os.path.join(PUBLIC_DIR, "index.html")
    if not os.path.exists(index_path):
        return Response("index.html not found in public directory", status_code=404)
    response = FileResponse(index_path, media_type="text/html")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

# ==============================================================================
# 10. Rutas y Aplicación Principal
# ==============================================================================
routes = [
    Route("/", serve_index, methods=["GET"]),
    Route("/index.html", serve_index, methods=["GET"]),
    Route("/api/health", api_health, methods=["GET"]),
    Route("/api/markets", api_markets, methods=["GET"]),
    Route("/api/news", api_news, methods=["GET"]),
    Route("/api/rates", get_exchange_rates, methods=["GET"]),
    Route("/api/stocks/quotes", api_stock_quotes, methods=["GET"]),
    Route("/api/stocks/history", api_stock_history, methods=["GET"]),
    Route("/api/klines", api_klines, methods=["GET"]),
    Route("/api/search", api_search, methods=["GET"]),
    Route("/api/chat/challenge", api_chat_challenge, methods=["GET"]),
    Route("/api/chat", api_chat_stream, methods=["POST"]),
    WebSocketRoute("/ws/stocks", ws_stocks_endpoint),
    # Montar EXCLUSIVAMENTE la subcarpeta public/ en la raíz web
    Mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")
]

class SecurityHeadersMiddleware:
    """Inyecta cabeceras HTTP de seguridad avanzada (CSP, HSTS, X-Content-Type-Options) en todas las respuestas."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Bloqueo estricto de archivos del sistema y sensibles
        path = scope.get("path", "")
        norm_path = path.lower().strip()
        blocked_exact = {"/.env", "/.env.example", "/server.py", "/requirements.txt", "/.gitignore"}
        if (norm_path in blocked_exact or 
            norm_path.startswith("/.") or 
            "/.." in norm_path or 
            ".." in norm_path or
            norm_path.endswith(".py") or 
            norm_path.endswith(".env")):
            response = Response("Not Found", status_code=404)
            await response(scope, receive, send)
            return

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                existing = {k.lower() for k, _ in headers}
                if b"x-content-type-options" not in existing:
                    headers.append((b"x-content-type-options", b"nosniff"))
                if b"x-frame-options" not in existing:
                    headers.append((b"x-frame-options", b"DENY"))
                if b"x-xss-protection" not in existing:
                    headers.append((b"x-xss-protection", b"1; mode=block"))
                if b"referrer-policy" not in existing:
                    headers.append((b"referrer-policy", b"strict-origin-when-cross-origin"))
                if b"strict-transport-security" not in existing:
                    headers.append((b"strict-transport-security", b"max-age=31536000; includeSubDomains"))
                if b"content-security-policy" not in existing:
                    csp_policy = (
                        "default-src 'self'; "
                        "script-src 'self'; "
                        "style-src 'self' 'unsafe-inline'; "
                        "font-src 'self' data:; "
                        "img-src 'self' data: blob:; "
                        "connect-src 'self' wss://stream.binance.com:* wss://data-stream.binance.vision:* ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* https://api.binance.com https://api.frankfurter.app; "
                        "frame-ancestors 'none'; "
                        "base-uri 'self'; "
                        "form-action 'self';"
                    )
                    headers.append((b"content-security-policy", csp_policy.encode("utf-8")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)

# Configuración estricta de CORS y Cabeceras de Seguridad
middleware = [
    Middleware(SecurityHeadersMiddleware),
    Middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        allow_credentials=False
    )
]

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    print("==================================================")
    print("  PaperPulse Quantitative Terminal Server")
    print(f"  Dual-Stack: http://localhost:{PORT} y http://127.0.0.1:{PORT}")
    print(f"  Public Directory: {PUBLIC_DIR}")
    print(f"  IA Model: {ANTHROPIC_MODEL} (API Key: {'Configurada' if (ANTHROPIC_API_KEY or os.getenv('ANTHROPIC_API_KEY')) else 'Pendiente en .env'})")
    print(f"  Token Limits: Global {DAILY_GLOBAL_TOKEN_LIMIT} / User {DAILY_USER_TOKEN_LIMIT}")
    print(f"  CORS Allowed Origins: {ALLOWED_ORIGINS}")
    print(f"  Bolsa: {STOCK_DATA_PROVIDER} (US + IBEX 35 con zonas horarias exactas)")
    print("==================================================")
    worker_task = asyncio.create_task(stocks_broadcast_worker())
    yield
    worker_task.cancel()

app = Starlette(debug=DEBUG, routes=routes, middleware=middleware, lifespan=lifespan)

if __name__ == "__main__":
    import uvicorn
    import socket

    # Socket dual-stack (IPv4 y IPv6) para Windows y Linux
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind(('::', PORT))
        config = uvicorn.Config(app, log_level="info")
        server = uvicorn.Server(config)
        server.run(sockets=[sock])
    except Exception as e:
        print(f"[Server] Fallback socket IPv4: {e}")
        uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
