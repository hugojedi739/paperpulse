"""IP real del cliente, límites por IP y contadores de uso de la IA."""
import sys
import time
import datetime
from typing import Dict, Any, List

from backend.config import DAILY_GLOBAL_TOKEN_LIMIT, IS_VERCEL, TRUSTED_PROXIES

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
IP_CHALLENGE_CALLS: Dict[str, List[float]] = {}
IP_DAILY_DATA: Dict[str, Dict[str, Any]] = {}

def get_client_ip(request) -> str:
    """Extrae la IP real del cliente respetando proxies de confianza."""
    if IS_VERCEL:
        # Vercel sobrescribe estas cabeceras en el borde, así que el cliente no puede falsearlas
        forwarded = request.headers.get("x-real-ip") or request.headers.get("x-vercel-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
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
    for store in (IP_CHAT_CALLS, IP_STOCK_CALLS, IP_CHALLENGE_CALLS):
        stale_keys = [ip for ip, calls in store.items() if not calls or (now - calls[-1] > 600)]
        for k in stale_keys:
            store.pop(k, None)

