"""Reglas de la «luz roja» de mercado de la cabecera.

Son umbrales objetivos (ajustes del panel, ver SCHEMA de backend/settings.py) que el navegador aplica a las
cotizaciones en vivo que ya recibe (frontend/js/lib/market-alert.js). Sin IA ni predicciones: solo dicen
«ha caído más de X %». Viajan en la respuesta de /api/markets, que el navegador ya consulta.
"""
from typing import Any, Dict, List

from backend import settings

# window: "24h" = variación de 24 h (cripto, mercado continuo); "session" = variación de la sesión frente al
# cierre anterior, que solo cuenta con la bolsa abierta (fuera de horario el dato de la última sesión se queda fijo).
RULES = (
    {"symbol": "BTC", "name": "Bitcoin", "window": "24h", "setting": "market_alert_btc_drop_bps"},
    {"symbol": "IBEX", "name": "IBEX 35", "window": "session", "setting": "market_alert_index_drop_bps"},
)


def alert_rules() -> List[Dict[str, Any]]:
    """Reglas activas con su umbral en %. Una regla con umbral 0 está desactivada y no se envía."""
    out = []
    for r in RULES:
        bps = int(settings.get(r["setting"]) or 0)
        if bps > 0:
            out.append({"symbol": r["symbol"], "name": r["name"], "window": r["window"], "dropPct": bps / 100})
    return out
