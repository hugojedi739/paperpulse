"""Configuración estática desde variables de entorno (.env en la raíz del proyecto).

Los ajustes que el administrador puede cambiar en caliente (claves de terceros, OAuth, registro)
viven en backend/settings.py: allí la base de datos tiene prioridad sobre estas variables.
"""
import os
import sys
from typing import List, Set

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")


def load_dotenv() -> None:
    env_file = os.path.join(ROOT_DIR, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except Exception as e:
            print(f"[Config] Error leyendo .env: {e}", file=sys.stderr)


load_dotenv()


def _csv(name: str, default: str) -> List[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


PORT = int(os.getenv("PORT", "8000"))
IS_PRODUCTION = os.environ.get("ENV", "").lower() == "production"
# Starlette con debug=True devuelve trazas al cliente: nunca en producción ni en Vercel
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1") and not IS_PRODUCTION and not os.environ.get("VERCEL")
IS_VERCEL = bool(os.environ.get("VERCEL"))
# Relay de mercado en vivo (/ws/market). Con REALTIME=false /api/health dice que no hay tiempo real y el navegador se queda en REST
# (útil si un proxy o plataforma no deja pasar WebSocket). Por defecto activo en todas partes, también en Vercel.
REALTIME_ENABLED = os.getenv("REALTIME", "true").strip().lower() not in ("0", "false", "no", "off")

# Orígenes CORS permitidos (solo hacen falta si el frontend se sirve desde otro dominio)
ALLOWED_ORIGINS = _csv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000")

# Proxies de confianza para resolución de IP real
TRUSTED_PROXIES: Set[str] = set(_csv("TRUSTED_PROXIES", "127.0.0.1,::1"))

# Asistente IA (la clave y el modelo pueden sobrescribirse desde el panel de administración)
ANTHROPIC_MAX_TOKENS = int(os.getenv("ANTHROPIC_MAX_TOKENS", "1800"))

# Límites de coste y cuota diaria
DAILY_GLOBAL_TOKEN_LIMIT = int(os.getenv("DAILY_GLOBAL_TOKEN_LIMIT", "1000000"))
DAILY_USER_TOKEN_LIMIT = int(os.getenv("DAILY_USER_TOKEN_LIMIT", "100000"))
DAILY_USER_CHAT_REQUESTS = int(os.getenv("DAILY_USER_CHAT_REQUESTS", "100"))

# Diagnóstico de /api/health con cabecera X-Admin-Key (monitorización sin sesión)
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY", "")

# Emails que reciben el rol de administrador al registrarse o iniciar sesión
ADMIN_EMAILS = {e.lower() for e in _csv("ADMIN_EMAILS", "")}


def app_domain() -> str:
    """Dominio público (sin barra final). Vacío si no está configurado."""
    domain = os.environ.get("APP_DOMAIN", "").strip().rstrip("/")
    if not domain and os.environ.get("VERCEL_PROJECT_PRODUCTION_URL"):
        domain = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"].strip().rstrip("/")
    return domain
