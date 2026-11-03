"""Tipos de cambio (Frankfurter / BCE) con caché de 1 hora."""
import sys
import time
import asyncio

import requests
from starlette.responses import JSONResponse

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
