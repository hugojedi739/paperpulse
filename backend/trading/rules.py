"""Reglas puras de la simulación: aritmética en enteros y cuándo y a qué precio se ejecuta una orden.

No hay red ni base de datos aquí, así que todo se puede probar con números fijos.

Unidades (ver backend/migrations/0003_cuenta_servidor.sql):
  - importes en céntimos de USD (int)
  - cantidades, precios y tipos de cambio en 1e-8 (int): E8 = 100_000_000 equivale a 1
Nunca se usa float para dinero: los decimales que llegan del cliente se leen con Decimal.
"""
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from typing import Dict, Optional

E8 = 10**8
MIN_ORDER_CENTS = 500  # 5 USD, igual que el modo local
MAX_QTY_E8 = 10**9 * E8  # mil millones de unidades: tope de cordura
MAX_PRICE_E8 = 10**8 * E8  # cien millones por unidad

# Saldo inicial que elige la persona al crear su cuenta de práctica (siempre en euros; se convierte a USD una vez)
START_MIN_EUR = 50
START_MAX_EUR = 1_000_000

SIDES = ("buy", "sell")
TYPES = ("market", "limit", "stop")


class OrderError(ValueError):
    """Error de validación o de ejecución con un mensaje para el usuario (en español)."""


def ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def parse_e8(value, field: str, maximum: int) -> int:
    """Convierte un decimal del cliente ("0.015", 0.015) a entero en 1e-8, truncando lo que sobre."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise OrderError(f"{field} no es un número válido.")
    try:
        d = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        raise OrderError(f"{field} no es un número válido.") from None
    if not d.is_finite():
        raise OrderError(f"{field} no es un número válido.")
    n = int((d * E8).to_integral_value(rounding=ROUND_DOWN))
    if n <= 0:
        raise OrderError(f"{field} debe ser mayor que cero.")
    if n > maximum:
        raise OrderError(f"{field} es demasiado grande.")
    return n


def notional_cents(qty_e8: int, price_e8: int, fx_e8: int, round_up: bool) -> int:
    """Valor en céntimos de USD de qty × precio × tipo de cambio.

    qty·price·fx está en escala 1e24 de USD; un céntimo son 1e22 de esa escala.
    Las compras redondean hacia arriba y las ventas hacia abajo: el redondeo nunca favorece al usuario,
    así que no se puede «fabricar» dinero con muchas operaciones pequeñas.
    """
    raw = qty_e8 * price_e8 * fx_e8
    return ceil_div(raw, 10**22) if round_up else raw // 10**22


def fee_cents(notional: int, fee_bps: int) -> int:
    """Comisión en puntos básicos (10 bps = 0,10 %), redondeada hacia arriba."""
    return ceil_div(notional * fee_bps, 10_000)


def apply_slippage(price_e8: int, side: str, slippage_bps: int) -> int:
    """Deslizamiento de las órdenes a mercado: la compra paga algo más y la venta recibe algo menos."""
    if side == "buy":
        return ceil_div(price_e8 * (10_000 + slippage_bps), 10_000)
    return max(1, price_e8 * (10_000 - slippage_bps) // 10_000)


def buy_cost_cents(qty_e8: int, price_e8: int, fx_e8: int, fee_bps: int) -> int:
    notional = notional_cents(qty_e8, price_e8, fx_e8, round_up=True)
    return notional + fee_cents(notional, fee_bps)


def reservation_cents(type_: str, qty_e8: int, trigger_e8: int, fx_e8: int, fee_bps: int, slippage_bps: int) -> int:
    """Efectivo que bloquea una compra pendiente.

    - Límite: se ejecuta a un precio <= límite, así que basta con reservar qty × límite + comisión.
    - Stop: se ejecuta a >= stop y con deslizamiento; se reserva qty × stop × (1 + deslizamiento) + comisión.
      Si un hueco de precio lo deja corto, al ejecutar se usa también el efectivo libre (ver ledger.execute).
    """
    price = trigger_e8 if type_ == "limit" else apply_slippage(trigger_e8, "buy", slippage_bps)
    return buy_cost_cents(qty_e8, price, fx_e8, fee_bps)


# ---------------------------------------------------------------- ejecución
def marketable_now(side: str, type_: str, trigger_e8: int, last_e8: int) -> bool:
    """¿Se ejecutaría ya la orden con el último precio? (orden límite «cruzada» o stop ya superado)."""
    if type_ == "limit":
        return last_e8 <= trigger_e8 if side == "buy" else last_e8 >= trigger_e8
    return last_e8 >= trigger_e8 if side == "buy" else last_e8 <= trigger_e8


def immediate_price(side: str, type_: str, trigger_e8: Optional[int], last_e8: int, slippage_bps: int) -> int:
    """Precio de una orden que se ejecuta al recibirse (a mercado, o límite/stop que ya se cumple).

    El precio sale siempre de la última cotización obtenida por el servidor más el deslizamiento.
    Una orden límite nunca se ejecuta peor que su límite.
    """
    px = apply_slippage(last_e8, side, slippage_bps)
    if type_ == "limit":
        return min(px, trigger_e8) if side == "buy" else max(px, trigger_e8)
    return px


def candle_fill_price(side: str, type_: str, trigger_e8: int, candle: Dict[str, int], slippage_bps: int) -> Optional[int]:
    """Precio de ejecución dentro de una vela {open, high, low} (en 1e-8), o None si no se alcanza el nivel.

    Huecos de precio (gaps): si la vela ya abre al otro lado del nivel, se ejecuta a la apertura, no al nivel.
      - Límite de compra a 100 y la vela abre a 95: se compra a 95 (mejor que el límite, como en un mercado real).
      - Stop de venta a 100 y la vela abre a 90: se vende a 90 (peor que el stop: el stop no garantiza precio).
    Las órdenes stop se convierten en órdenes a mercado, así que llevan además deslizamiento.
    Las límite no: su precio está garantizado.
    """
    o, h, low = candle["open"], candle["high"], candle["low"]
    if type_ == "limit":
        if side == "buy" and low <= trigger_e8:
            return min(o, trigger_e8)
        if side == "sell" and h >= trigger_e8:
            return max(o, trigger_e8)
        return None
    if side == "buy" and h >= trigger_e8:
        return apply_slippage(max(o, trigger_e8), "buy", slippage_bps)
    if side == "sell" and low <= trigger_e8:
        return apply_slippage(min(o, trigger_e8), "sell", slippage_bps)
    return None


def parse_start_amount(value, currency) -> int:
    """Importe elegido para la cuenta nueva, en céntimos de euro. Entre START_MIN_EUR y START_MAX_EUR y con 2 decimales como mucho."""
    if currency != "EUR":
        raise OrderError("Por ahora el saldo inicial se elige en euros (currency: «EUR»).")
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise OrderError("El importe no es un número válido.")
    try:
        d = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        raise OrderError("El importe no es un número válido.") from None
    if not d.is_finite():
        raise OrderError("El importe no es un número válido.")
    if d.as_tuple().exponent < -2:
        raise OrderError("El importe admite como mucho dos decimales.")
    if d < START_MIN_EUR or d > START_MAX_EUR:
        raise OrderError(f"El saldo inicial debe estar entre {START_MIN_EUR} y {START_MAX_EUR:,} €.".replace(",", "."))
    return int(d * 100)
