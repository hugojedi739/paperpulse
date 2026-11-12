"""IP real del cliente (respetando proxies de confianza), límites por minuto en memoria (por IP y por usuario)
y contadores de diagnóstico de esta instancia. El uso del asistente IA va aparte, en la base de datos (ai_usage.py)."""
import time
from typing import Dict, List

from backend.config import IS_VERCEL, TRUSTED_PROXIES

# ==============================================================================
# Diagnóstico de esta instancia y límites por minuto en memoria.
# El uso y los límites del asistente IA no están aquí: van en la base de datos (backend/ai_usage.py) para que
# valgan con varias instancias.
# ==============================================================================
USAGE_STATS = {
    "start_time": time.time(),
    "stock_requests": 0,
    "errors": 0,
}

IP_STOCK_CALLS: Dict[str, List[float]] = {}
IP_CHALLENGE_CALLS: Dict[str, List[float]] = {}
# Cuenta del servidor (/api/orders, /api/portfolio): por IP y por usuario (clave "u<id>")
IP_TRADING_CALLS: Dict[str, List[float]] = {}
USER_TRADING_CALLS: Dict[str, List[float]] = {}
# Comunidad (/api/community, /api/forum): claves "<nivel>:<ip>" y "u<id>:<nivel>"
IP_COMMUNITY_CALLS: Dict[str, List[float]] = {}
USER_COMMUNITY_CALLS: Dict[str, List[float]] = {}
# Formulario de contacto (/api/contact), por IP
IP_CONTACT_CALLS: Dict[str, List[float]] = {}

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
    for store in (IP_STOCK_CALLS, IP_CHALLENGE_CALLS, IP_TRADING_CALLS, USER_TRADING_CALLS,
                  IP_COMMUNITY_CALLS, USER_COMMUNITY_CALLS, IP_CONTACT_CALLS):
        stale_keys = [ip for ip, calls in store.items() if not calls or (now - calls[-1] > 600)]
        for k in stale_keys:
            store.pop(k, None)

