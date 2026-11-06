"""Respuestas fijas del asistente: las sugerencias del chat se responden sin llamar a la IA.

Solo se reconoce el texto EXACTO de los botones de sugerencia (SUGGESTIONS de frontend/js/ui/chat.js; un test
comprueba que coinciden). Cualquier otra pregunta, aunque se parezca, va a la IA.
Los enlaces [texto](#/ruta) son internos; el chat del frontend solo convierte en enlace las rutas que empiezan por #/.
"""
from typing import Dict, List, Optional

MARKET = "¿Cómo está el mercado hoy?"

EDUCATIONAL = {
    "¿Cómo leo las velas?": (
        "Cada **vela japonesa** resume el precio de un periodo (un minuto, una hora, un día…) con cuatro datos:\n"
        "- **Apertura y cierre**: forman el cuerpo. Si el cierre queda por encima de la apertura, la vela es alcista (suele pintarse en verde); si queda por debajo, bajista (en rojo).\n"
        "- **Máximo y mínimo**: son las mechas, las líneas finas por encima y por debajo del cuerpo.\n"
        "\n"
        "Un cuerpo largo indica que el precio se movió con decisión en una dirección; mechas largas, que llegó lejos pero acabó retrocediendo. "
        "Una vela sola dice poco: se interpretan en su contexto y junto con la temporalidad que estés mirando.\n"
        "\n"
        "Para verlo con calma: [Cómo leer una vela japonesa](#/learn/leer-velas)."
    ),
    "Explícame el RSI": (
        "El **RSI** (índice de fuerza relativa) es un oscilador que resume el impulso reciente del precio en una escala de 0 a 100. "
        "Compara las subidas medias con las bajadas medias de un periodo, normalmente 14 velas.\n"
        "- Por encima de **70** se suele hablar de *sobrecompra*: las subidas han dominado.\n"
        "- Por debajo de **30**, de *sobreventa*: han dominado las bajadas.\n"
        "\n"
        "No predice el futuro: en tendencias fuertes puede quedarse mucho tiempo en esas zonas. Se usa como una pista más, junto con el precio y una gestión del riesgo clara.\n"
        "\n"
        "Más conceptos para empezar en [Aprender](#/learn)."
    ),
    "¿Cómo gestiono el riesgo?": (
        "Gestionar el riesgo es decidir **antes de entrar** cuánto estás dispuesto a perder en cada operación:\n"
        "1. **Fija el stop-loss**: el precio en el que aceptas que te has equivocado.\n"
        "2. **Limita la pérdida a un 1-2 % de tu capital** por operación. Con 10.000 de capital, serían 100-200 como máximo.\n"
        "3. **Calcula el tamaño de la posición** a partir de esa pérdida: tamaño = pérdida máxima ÷ distancia al stop. Con 100 de pérdida máxima y el stop a un 2 %, la posición sería de 5.000.\n"
        "4. **Compara riesgo y beneficio**: si lo que puedes ganar no compensa lo que arriesgas, quizá no merezca la pena entrar.\n"
        "\n"
        "Lecciones: [Cuánto arriesgar en cada operación](#/learn/tamano-posicion) y [El stop-loss](#/learn/stop-loss)."
    ),
    "¿Qué es una orden límite?": (
        "Una **orden límite** fija el precio máximo al que compras (o el mínimo al que vendes). Solo se ejecuta a ese precio o a uno mejor.\n"
        "- Ejemplo: si el precio es 100 y colocas una compra límite a 95, solo se ejecutará si baja hasta 95 o menos.\n"
        "- Si el precio nunca llega a tu nivel, la orden se queda pendiente y puede no ejecutarse.\n"
        "\n"
        "La diferencia con una **orden a mercado** es que esta se ejecuta al momento, al mejor precio disponible, a cambio de no controlar el precio exacto.\n"
        "\n"
        "Lección: [Orden a mercado y orden límite](#/learn/orden-mercado-vs-limite)."
    ),
}

SUGGESTIONS = [MARKET, *EDUCATIONAL]


def _clean(value, limit: int) -> str:
    return str(value if value is not None else "").replace("\n", " ").replace("\r", " ")[:limit].strip()


def market_items(raw_market) -> List[Dict]:
    """Datos de mercado enviados por el navegador, saneados (máx. 6 activos, longitudes acotadas)."""
    items = []
    if not isinstance(raw_market, list):
        return items
    for item in raw_market[:6]:
        if not isinstance(item, dict):
            continue
        sym = "".join(c for c in str(item.get("symbol", ""))[:10] if c.isalnum() or c in "/-").upper()
        if not sym:
            continue
        pair = "".join(c for c in str(item.get("pair", ""))[:15] if c.isalnum() or c in "/-").upper() or f"{sym}/USDT"
        native = _clean(item.get("priceNativeFormatted", item.get("price", "No disponible")), 30)
        display = _clean(item.get("priceDisplayFormatted", ""), 35)
        available = native not in ("No disponible", "0", "0.00", "")
        items.append({
            "symbol": sym, "pair": pair, "native": native, "available": available,
            "display": display if display and display != native and "No disponible" not in display else "",
            "change": _clean(item.get("change24h", "No disponible"), 15),
            "updated": _clean(item.get("lastUpdate", "No disponible"), 15),
            "status": _clean(item.get("status", "No disponible"), 30),
        })
    return items


def market_overview(items: List[Dict]) -> str:
    if not items:
        return "No tengo cotizaciones ahora mismo."
    lines = []
    for m in items:
        if not m["available"]:
            lines.append(f"- **{m['pair']}**: no tengo cotización ahora mismo.")
            continue
        disp = f" ({m['display']})" if m["display"] else ""
        state = "cierre de ayer" if m["status"] == "cierre de ayer" else f"dato {m['status']}" if m["status"] else ""
        lines.append(f"- **{m['pair']}**: {m['native']}{disp}, {m['change']} en 24 h" + (f" ({state})" if state else "") + ".")
    return ("Así están ahora los principales activos:\n" + "\n".join(lines) +
            "\n\nLas acciones con «cierre de ayer» muestran el último cierre, no un precio en vivo. Pregúntame por cualquier activo si quieres más detalle.")


def answer(message: str, raw_market) -> Optional[str]:
    """Texto fijo si el mensaje es exactamente una sugerencia; None si hay que preguntar a la IA."""
    text = message.strip()
    if text == MARKET:
        return market_overview(market_items(raw_market))
    return EDUCATIONAL.get(text)
