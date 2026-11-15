"""Ajustes editables desde el panel de administración.

Cada ajuste tiene un valor en la base de datos (si el admin lo ha guardado) y, si no, el de la variable de entorno
equivalente o un valor por defecto. Los secretos nunca salen del servidor: el panel solo ve si están configurados
y sus últimos 4 caracteres.
"""
import os
import time
from typing import Any, Dict, Optional

from backend import db

# clave -> (variable de entorno, valor por defecto, tipo, secreto)
SCHEMA: Dict[str, tuple] = {
    # Inicio de sesión
    "auth_password_enabled": ("AUTH_PASSWORD_ENABLED", True, bool, False),
    "auth_registration_enabled": ("AUTH_REGISTRATION_ENABLED", True, bool, False),
    "oauth_google_enabled": ("OAUTH_GOOGLE_ENABLED", False, bool, False),
    "oauth_google_client_id": ("OAUTH_GOOGLE_CLIENT_ID", "", str, False),
    "oauth_google_client_secret": ("OAUTH_GOOGLE_CLIENT_SECRET", "", str, True),
    "oauth_okta_enabled": ("OAUTH_OKTA_ENABLED", False, bool, False),
    "oauth_okta_issuer": ("OAUTH_OKTA_ISSUER", "", str, False),
    "oauth_okta_client_id": ("OAUTH_OKTA_CLIENT_ID", "", str, False),
    "oauth_okta_client_secret": ("OAUTH_OKTA_CLIENT_SECRET", "", str, True),
    # Servicios de terceros (siempre se usan desde el backend)
    "anthropic_api_key": ("ANTHROPIC_API_KEY", "", str, True),
    "anthropic_model": ("ANTHROPIC_MODEL", "claude-haiku-5-5", str, False),
    # Esfuerzo (output_config.effort): cuánto razona el modelo antes de responder. «auto» = el del modelo
    "anthropic_effort": ("ANTHROPIC_EFFORT", "low", str, False),
    "stock_data_provider": ("STOCK_DATA_PROVIDER", "yfinance", str, False),
    "finnhub_api_key": ("FINNHUB_API_KEY", "", str, True),
    # Simulación de la cuenta del servidor (usuarios con sesión)
    "trading_initial_balance_usd": ("TRADING_INITIAL_BALANCE_USD", 10000, int, False),
    "trading_fee_bps": ("TRADING_FEE_BPS", 10, int, False),
    "trading_slippage_bps": ("TRADING_SLIPPAGE_BPS", 5, int, False),
    # Comunidad: operaciones mínimas para aparecer en la clasificación
    "community_min_trades": ("COMMUNITY_MIN_TRADES", 5, int, False),
    # Retos mensuales: saldo inicial igual para todos los participantes
    "challenge_initial_balance_usd": ("CHALLENGE_INITIAL_BALANCE_USD", 10000, int, False),
    # Luz roja de mercado (cabecera): caída que la enciende, en puntos básicos (1000 = 10 %); 0 = regla desactivada.
    # Reglas objetivas sobre cotizaciones que ya tenemos, sin IA ni predicciones (frontend/js/lib/market-alert.js)
    "market_alert_btc_drop_bps": ("MARKET_ALERT_BTC_DROP_BPS", 1000, int, False),  # BTC en 24 h
    "market_alert_index_drop_bps": ("MARKET_ALERT_INDEX_DROP_BPS", 400, int, False),  # IBEX 35 en la sesión, con la bolsa abierta
    # Contador de visitas de la portada (Administración → Resumen): anónimo, sin cookies ni IP (backend/visits.py).
    # Desactivado por defecto: en producción (función en iad1, base en Dublín) hacía esperar a la portada ~0,8 s.
    "visits_enabled": ("VISITS_ENABLED", False, bool, False),
}
CHOICES = {"stock_data_provider": ("yfinance", "finnhub"), "anthropic_effort": ("low", "medium", "high", "auto")}
# Rangos válidos de los ajustes enteros. bps = puntos básicos (10 bps = 0,10 %)
INT_RANGES = {
    "trading_initial_balance_usd": (100, 10_000_000),
    "trading_fee_bps": (0, 500),
    "trading_slippage_bps": (0, 500),
    "community_min_trades": (0, 1000),
    "challenge_initial_balance_usd": (100, 10_000_000),
    "market_alert_btc_drop_bps": (0, 5000),
    "market_alert_index_drop_bps": (0, 5000),
}

_cache: Dict[str, Any] = {"time": 0.0, "values": {}}
_TTL = 5  # varios procesos (workers) ven los cambios en segundos


def _parse(kind, raw: str):
    if kind is bool:
        return str(raw).strip().lower() in ("1", "true", "yes", "on")
    if kind is int:
        return int(str(raw).strip())
    return str(raw)


def _stored() -> Dict[str, str]:
    if time.time() - _cache["time"] > _TTL:
        try:
            _cache["values"] = db.get_settings()
        except Exception:  # base de datos aún sin migrar (tests, arranque)
            _cache["values"] = {}
        _cache["time"] = time.time()
    return _cache["values"]


def source(key: str) -> str:
    env, *_ = SCHEMA[key]
    return "panel" if key in _stored() else "env" if os.getenv(env) else "default"


def get(key: str):
    env, default, kind, _ = SCHEMA[key]
    stored = _stored()
    try:
        if key in stored:
            return _parse(kind, stored[key])
        raw = os.getenv(env)
        return _parse(kind, raw) if raw not in (None, "") else default
    except ValueError:  # p. ej. un entero mal escrito en .env: se usa el valor por defecto
        return default


def _mask(value: str) -> str:
    return f"••••{value[-4:]}" if len(value) > 8 else "••••"


def public_view() -> Dict[str, Dict]:
    """Valores para el panel: los secretos solo como {configured, hint}."""
    out = {}
    for key, (env, default, kind, secret) in SCHEMA.items():
        value = get(key)
        item = {"source": source(key), "env": env, "type": kind.__name__, "secret": secret}
        if secret:
            item.update(configured=bool(value), hint=_mask(value) if value else "")
        else:
            item["value"] = value
        if key in CHOICES:
            item["choices"] = list(CHOICES[key])
        out[key] = item
    return out


def validate(values: Dict[str, Any]) -> Optional[str]:
    for key, value in values.items():
        if key not in SCHEMA:
            return f"Ajuste desconocido: {key}"
        kind = SCHEMA[key][2]
        if value is None or (kind is int and isinstance(value, str) and not value.strip()):
            continue  # None (o un número vacío en el panel) = volver al valor de .env
        if kind is bool and not isinstance(value, bool):
            return f"{key} debe ser verdadero o falso."
        if kind is str and (not isinstance(value, str) or len(value) > 2000):
            return f"{key} no es válido."
        if kind is int:
            # El panel envía los campos de texto como cadena: se acepta "25" igual que 25 (pero no true/false)
            if isinstance(value, bool) or not (isinstance(value, int) or (isinstance(value, str) and value.strip().isdigit())):
                return f"{key} debe ser un número entero."
            low, high = INT_RANGES[key]
            if not low <= int(value) <= high:
                return f"{key} debe estar entre {low} y {high}."
        if key in CHOICES and value not in CHOICES[key]:
            return f"{key} debe ser uno de: {', '.join(CHOICES[key])}."
        if key == "oauth_okta_issuer" and value and not value.startswith("https://"):
            return "El issuer de Okta debe empezar por https://"
    return None


def save(values: Dict[str, Any], by: Optional[int]) -> None:
    values = {k: (None if SCHEMA[k][2] is int and isinstance(v, str) and not v.strip() else v) for k, v in values.items()}
    serialized = {k: (None if v is None else ("true" if v is True else "false" if v is False else str(v).strip())) for k, v in values.items()}
    db.put_settings(serialized, by)
    _cache["time"] = 0
