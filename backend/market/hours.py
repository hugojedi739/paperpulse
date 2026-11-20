"""Horarios reales de las bolsas (zonas horarias y festivos) y estado de los mercados mundiales."""
import time
import asyncio
import datetime
import zoneinfo
from typing import Dict, Any, List, Tuple

from starlette.responses import JSONResponse

from backend.market.crypto import limited
from backend.market.alert import alert_rules

# ==============================================================================
# Horarios de Mercado Reales con Zonas Horarias y Detección de Festivos
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
            return False, "Wall Street cerrado por festivo bursátil. Próxima apertura: Mañana 09:30 ET"

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
            return False, "Bolsa de Madrid cerrada por festivo BME. Próxima apertura: Mañana 09:00 CET"

        t = now_local.time()
        open_time = datetime.time(9, 0)
        close_time = datetime.time(17, 30)
        is_open = open_time <= t < close_time

        if is_open:
            return True, "Bolsa de Madrid abierta (09:00 - 17:30 CET)"
        elif t < open_time:
            return False, "Bolsa de Madrid abre hoy a las 09:00 CET"
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
            next_event_text = "Abre el próximo día hábil 09:30 ET"
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
    if (err := limited(request)):  # límite por IP, como el resto de datos de mercado
        return err
    now = time.time()
    loop = asyncio.get_running_loop()
    # Umbrales de la luz roja de la cabecera (ajustes del panel; settings.get puede leer la base: en un hilo)
    rules = await loop.run_in_executor(None, alert_rules)
    if now - MARKETS_CACHE["timestamp"] < 30 and MARKETS_CACHE["data"]:
        return JSONResponse({
            "status": "success",
            "source": "cache",
            "updated_at": MARKETS_CACHE["timestamp"],
            "markets": MARKETS_CACHE["data"],
            "alertRules": rules,
        })

    markets_data = await loop.run_in_executor(None, build_markets_data_sync)
    MARKETS_CACHE["data"] = markets_data
    MARKETS_CACHE["timestamp"] = now

    return JSONResponse({
        "status": "success",
        "source": "live",
        "updated_at": now,
        "markets": markets_data,
        "alertRules": rules,
    })
