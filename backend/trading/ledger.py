"""Libro contable de la cuenta del servidor: saldo, órdenes, posiciones y ejecuciones.

Garantías:
  - El precio lo decide siempre el servidor (prices.py); el cliente solo envía activo, lado, cantidad, tipo y,
    en límite/stop, el nivel de activación.
  - Ejecutar una orden (saldo + posición + fill + estado de la orden) ocurre en UNA transacción.
  - Idempotencia: (user_id, client_order_id) es único. Repetir la petición devuelve la orden original.
  - Las llamadas de red (precios, velas) se hacen FUERA de la transacción, para no bloquear la base de datos
    mientras se espera a un proveedor externo.
"""
import json
import math
import re
import time
import unicodedata
from contextlib import closing, contextmanager
from typing import Dict, List, Optional, Tuple

from backend import db, settings
from backend.trading import prices
from backend.trading.rules import (
    E8, MAX_PRICE_E8, MAX_QTY_E8, MIN_ORDER_CENTS, SIDES, TYPES, OrderError, candle_fill_price, fee_cents, immediate_price, marketable_now, notional_cents, parse_e8, reservation_cents,
)

ORDER_TTL = 30 * 86400  # las órdenes pendientes caducan a los 30 días
MAX_OPEN_ORDERS = 50
RESOLVE_EVERY = 15  # segundos mínimos entre dos resoluciones del mismo usuario (salvo al operar)
# Temporalidades para resolver órdenes, de la más fina a la más gruesa. Binance devuelve hasta 1000 velas por
# petición, así que se elige la más fina que cubre el periodo en una sola descarga (1m ≈ 16 h, 1h ≈ 41 días).
RESOLUTION = [("1m", 60), ("5m", 300), ("15m", 900), ("1h", 3600)]
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
JOURNAL_LIMITS = {"setup": 60, "emotion": 30, "notes": 1000}

_last_resolve: Dict[int, float] = {}


class Conflict(OrderError):
    """La clave de idempotencia ya se usó con otros datos (HTTP 409)."""


class NotFound(OrderError):
    """La orden no existe o no es del usuario (HTTP 404)."""


# ---------------------------------------------------------------- utilidades
@contextmanager
def transaction():
    """BEGIN IMMEDIATE toma el bloqueo de escritura al empezar: dos peticiones simultáneas del mismo usuario
    se ejecutan una detrás de otra y la segunda ve el saldo ya actualizado por la primera."""
    with closing(db.connect()) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def config() -> Dict[str, int]:
    return {
        "feeBps": settings.get("trading_fee_bps"),
        "slippageBps": settings.get("trading_slippage_bps"),
        "initialCents": settings.get("trading_initial_balance_usd") * 100,
        "minOrderCents": MIN_ORDER_CENTS,
    }


def clean_text(value, limit: int) -> str:
    """Texto libre del usuario: sin caracteres de control (salvo saltos de línea) y con longitud acotada.
    No se escapa HTML aquí: se guarda el texto tal cual y el frontend lo escapa siempre al pintarlo."""
    text = unicodedata.normalize("NFC", str(value or ""))
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    return text.strip()[:limit]


def clean_journal(raw) -> Optional[str]:
    if not isinstance(raw, dict):
        return None
    journal = {k: clean_text(raw.get(k), n) for k, n in JOURNAL_LIMITS.items()}
    return json.dumps(journal, ensure_ascii=False) if any(journal.values()) else None


def ensure_account(conn, user_id: int, now: int) -> Dict:
    """Crea la cuenta con el saldo inicial configurado si aún no existe (nunca importa datos del navegador)."""
    initial = config()["initialCents"]
    conn.execute("INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)", (user_id, initial, initial, now, now))
    return dict(conn.execute("SELECT * FROM accounts WHERE user_id = ?", (user_id,)).fetchone())


def _reserved_cents(conn, user_id: int, exclude: Optional[int] = None) -> int:
    return conn.execute("SELECT COALESCE(SUM(reserved_cents), 0) FROM orders WHERE user_id = ? AND status = 'open' AND id IS NOT ?",
                        (user_id, exclude)).fetchone()[0]


def _reserved_qty(conn, user_id: int, symbol: str, exclude: Optional[int] = None) -> int:
    return conn.execute("SELECT COALESCE(SUM(qty_e8), 0) FROM orders WHERE user_id = ? AND symbol = ? AND side = 'sell' "
                        "AND status = 'open' AND id IS NOT ?", (user_id, symbol, exclude)).fetchone()[0]


def _position(conn, user_id: int, symbol: str) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM positions WHERE user_id = ? AND symbol = ?", (user_id, symbol)).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------- ejecución (dentro de una transacción)
def execute(conn, order: Dict, price_e8: int, fx: int, executed_at: int, source: str) -> Dict:
    """Ejecuta `order` entera a `price_e8`. Todas las comprobaciones van antes de la primera escritura,
    así que si lanza OrderError no ha cambiado nada (y la transacción se deshace igualmente)."""
    uid, sym, qty = order["user_id"], order["symbol"], order["qty_e8"]
    fee_bps = config()["feeBps"]
    account = dict(conn.execute("SELECT * FROM accounts WHERE user_id = ?", (uid,)).fetchone())
    pos = _position(conn, uid, sym)

    if order["side"] == "buy":
        notional = notional_cents(qty, price_e8, fx, round_up=True)
        fee = fee_cents(notional, fee_bps)
        cost = notional + fee
        if notional < MIN_ORDER_CENTS:
            raise OrderError(f"El importe mínimo por orden es {MIN_ORDER_CENTS // 100} USD.")
        # Puede usar su propia reserva y el efectivo libre, pero no lo reservado por otras órdenes
        available = account["cash_cents"] - _reserved_cents(conn, uid, exclude=order["id"])
        if cost > available:
            raise OrderError("Saldo insuficiente para ejecutar la orden.")
        conn.execute("UPDATE accounts SET cash_cents = cash_cents - ?, updated_at = ? WHERE user_id = ?", (cost, executed_at, uid))
        if pos:
            new_qty = pos["qty_e8"] + qty
            avg = (pos["qty_e8"] * pos["avg_price_e8"] + qty * price_e8) // new_qty
            conn.execute("UPDATE positions SET qty_e8 = ?, cost_cents = cost_cents + ?, avg_price_e8 = ?, updated_at = ? "
                         "WHERE user_id = ? AND symbol = ?", (new_qty, cost, avg, executed_at, uid, sym))
        else:
            conn.execute("INSERT INTO positions VALUES (?, ?, ?, ?, ?, ?, ?)", (uid, sym, qty, cost, price_e8, executed_at, executed_at))
        extra = (None, None, None, None)
    else:
        held = pos["qty_e8"] if pos else 0
        if qty > held:
            raise OrderError("No tienes unidades suficientes para vender (no se permiten ventas en corto).")
        if qty > held - _reserved_qty(conn, uid, sym, exclude=order["id"]):
            raise OrderError("Parte de tus unidades están bloqueadas por órdenes de venta pendientes. Cancélalas antes de vender.")
        notional = notional_cents(qty, price_e8, fx, round_up=False)
        fee = fee_cents(notional, fee_bps)
        closing_all = qty == held
        if notional < MIN_ORDER_CENTS and not closing_all:  # cerrar del todo una posición pequeña sí se permite
            raise OrderError(f"El importe mínimo por orden es {MIN_ORDER_CENTS // 100} USD.")
        proceeds = notional - fee
        basis = pos["cost_cents"] if closing_all else pos["cost_cents"] * qty // held
        conn.execute("UPDATE accounts SET cash_cents = cash_cents + ?, updated_at = ? WHERE user_id = ?", (proceeds, executed_at, uid))
        if closing_all:
            conn.execute("DELETE FROM positions WHERE user_id = ? AND symbol = ?", (uid, sym))
        else:
            conn.execute("UPDATE positions SET qty_e8 = qty_e8 - ?, cost_cents = cost_cents - ?, updated_at = ? "
                         "WHERE user_id = ? AND symbol = ?", (qty, basis, executed_at, uid, sym))
        extra = (basis, pos["avg_price_e8"], proceeds - basis, pos["opened_at"])

    cur = conn.execute(
        "INSERT INTO fills (order_id, user_id, symbol, side, qty_e8, price_e8, fx_e8, notional_cents, fee_cents, "
        "cost_basis_cents, entry_price_e8, pnl_cents, opened_at, source, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (order["id"], uid, sym, order["side"], qty, price_e8, fx, notional, fee, *extra, source, executed_at),
    )
    conn.execute("UPDATE orders SET status = 'filled', reserved_cents = 0, updated_at = ? WHERE id = ?", (executed_at, order["id"]))
    return dict(conn.execute("SELECT * FROM fills WHERE id = ?", (cur.lastrowid,)).fetchone())


# ---------------------------------------------------------------- colocar y cancelar
def _validate(req: Dict) -> Dict:
    coid = req.get("clientOrderId")
    if not isinstance(coid, str) or not CLIENT_ID_RE.match(coid):
        raise OrderError("Falta el identificador de la orden (clientOrderId) o no es válido.")
    side, type_ = req.get("side"), req.get("type")
    if side not in SIDES:
        raise OrderError("El lado debe ser «buy» o «sell».")
    if type_ not in TYPES:
        raise OrderError("El tipo debe ser «market», «limit» o «stop».")
    out = {
        "client_order_id": coid,
        "symbol": prices.asset(req.get("symbol"))["symbol"],
        "side": side,
        "type": type_,
        "qty_e8": parse_e8(req.get("quantity"), "La cantidad", MAX_QTY_E8),
        # En una orden a mercado el cliente no aporta precio: si lo manda, se ignora
        "trigger_e8": None if type_ == "market" else parse_e8(req.get("triggerPrice"), "El precio de activación", MAX_PRICE_E8),
        "journal": clean_journal(req.get("journal")),
    }
    return out


def _same_request(row: Dict, o: Dict) -> bool:
    return all(row[k] == o[k] for k in ("symbol", "side", "type", "qty_e8", "trigger_e8"))


def _existing(user_id: int, coid: str) -> Optional[Dict]:
    with closing(db.connect()) as conn:
        row = conn.execute("SELECT * FROM orders WHERE user_id = ? AND client_order_id = ?", (user_id, coid)).fetchone()
        return dict(row) if row else None


def _replay(row: Dict, o: Dict) -> Tuple[Dict, bool]:
    if not _same_request(row, o):
        raise Conflict("Ese clientOrderId ya se usó para otra orden.")
    return order_view(row["id"]), False


def place_order(user_id: int, req: Dict, now: Optional[int] = None) -> Tuple[Dict, bool]:
    """Valida y coloca una orden. Devuelve (orden con su ejecución si la hubo, creada). creada=False si es un reintento."""
    o = _validate(req)
    if (row := _existing(user_id, o["client_order_id"])):
        return _replay(row, o)

    # Datos de mercado, fuera de la transacción
    a = prices.asset(o["symbol"])
    is_open, status_msg = prices.market_open(o["symbol"])
    if o["type"] == "market" and not is_open:
        raise OrderError(f"Mercado cerrado: {status_msg}. Usa una orden límite o stop para operar en la próxima sesión.")
    fx = prices.fx_e8(a["quote"])
    last = prices.last_price_e8(o["symbol"]) if o["type"] == "market" or is_open else None
    cfg = config()
    now = now or int(time.time())
    fill_now = o["type"] == "market" or (last is not None and marketable_now(o["side"], o["type"], o["trigger_e8"], last))

    try:
        with transaction() as conn:
            ensure_account(conn, user_id, now)
            if not fill_now and conn.execute("SELECT COUNT(*) FROM orders WHERE user_id = ? AND status = 'open'", (user_id,)).fetchone()[0] >= MAX_OPEN_ORDERS:
                raise OrderError(f"Ya tienes {MAX_OPEN_ORDERS} órdenes pendientes. Cancela alguna antes de colocar otra.")
            reserved = 0
            if not fill_now:
                reserved = _check_pending(conn, user_id, o, fx, cfg)
            cur = conn.execute(
                "INSERT INTO orders (user_id, client_order_id, symbol, side, type, qty_e8, trigger_e8, reserved_cents, status, "
                "journal, checked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
                (user_id, o["client_order_id"], o["symbol"], o["side"], o["type"], o["qty_e8"], o["trigger_e8"], reserved,
                 o["journal"], now, now, now),
            )
            order_id = cur.lastrowid
            if fill_now:
                row = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
                price = immediate_price(o["side"], o["type"], o["trigger_e8"], last, cfg["slippageBps"])
                execute(conn, row, price, fx, now, "cotización")
    except Exception as exc:
        if db.is_integrity_error(exc) and (row := _existing(user_id, o["client_order_id"])):
            return _replay(row, o)  # otra petición con la misma clave ganó la carrera
        raise
    return order_view(order_id), True


def _check_pending(conn, user_id: int, o: Dict, fx: int, cfg: Dict) -> int:
    """Comprueba que una orden pendiente se pueda cubrir y devuelve el efectivo que bloquea."""
    if o["side"] == "buy":
        if notional_cents(o["qty_e8"], o["trigger_e8"], fx, round_up=True) < MIN_ORDER_CENTS:
            raise OrderError(f"El importe mínimo por orden es {MIN_ORDER_CENTS // 100} USD.")
        need = reservation_cents(o["type"], o["qty_e8"], o["trigger_e8"], fx, cfg["feeBps"], cfg["slippageBps"])
        cash = conn.execute("SELECT cash_cents FROM accounts WHERE user_id = ?", (user_id,)).fetchone()[0]
        if need > cash - _reserved_cents(conn, user_id):
            raise OrderError("Saldo insuficiente: el efectivo libre no cubre la orden y su comisión.")
        return need
    pos = _position(conn, user_id, o["symbol"])
    free = (pos["qty_e8"] if pos else 0) - _reserved_qty(conn, user_id, o["symbol"])
    if o["qty_e8"] > (pos["qty_e8"] if pos else 0):
        raise OrderError("No tienes unidades suficientes para vender (no se permiten ventas en corto).")
    if o["qty_e8"] > free:
        raise OrderError("Parte de tus unidades están bloqueadas por órdenes de venta pendientes. Cancélalas antes de vender.")
    if o["qty_e8"] < pos["qty_e8"] and notional_cents(o["qty_e8"], o["trigger_e8"], fx, round_up=False) < MIN_ORDER_CENTS:
        raise OrderError(f"El importe mínimo por orden es {MIN_ORDER_CENTS // 100} USD.")
    return 0


def cancel_order(user_id: int, order_id: int) -> Dict:
    with transaction() as conn:
        changed = conn.execute("UPDATE orders SET status = 'cancelled', reserved_cents = 0, updated_at = ? "
                               "WHERE id = ? AND user_id = ? AND status = 'open'", (int(time.time()), order_id, user_id)).rowcount
    if not changed:
        if not _owned(user_id, order_id):
            raise NotFound("La orden no existe.")
        raise OrderError("La orden ya no está pendiente (se ha ejecutado, cancelado o caducado).")
    return order_view(order_id)


def update_journal(user_id: int, order_id: int, journal) -> Dict:
    with closing(db.connect()) as conn:
        changed = conn.execute("UPDATE orders SET journal = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                               (clean_journal(journal), int(time.time()), order_id, user_id)).rowcount
    if not changed:
        raise NotFound("La orden no existe.")
    return order_view(order_id)


def _owned(user_id: int, order_id: int) -> bool:
    with closing(db.connect()) as conn:
        return conn.execute("SELECT 1 FROM orders WHERE id = ? AND user_id = ?", (order_id, user_id)).fetchone() is not None


# ---------------------------------------------------------------- resolución a demanda de límite y stop
def scan(order: Dict, start: int, end: int, slippage_bps: int, finer_than: Optional[int] = None):
    """Busca la primera vela cerrada en [start, end) que alcanza el nivel de la orden.

    Devuelve (acierto, revisado_hasta). acierto = (hora, precio_e8, temporalidad) o None.
    Solo se usan velas cerradas; la vela en curso se revisa en la siguiente llamada.
    Si una vela empezó antes de `start` (la orden se colocó a mitad de vela), sus máximo y mínimo incluyen precios
    anteriores a la orden: esa vela se revisa con una temporalidad más fina. En 1m se descarta ese primer minuto
    parcial (al colocar la orden ya se comprobó con la cotización en vivo).
    """
    choices = [(n, s) for n, s in RESOLUTION if finer_than is None or s < finer_than]
    if not choices or end <= start:
        return None, start
    name, sec = next(((n, s) for n, s in choices if (end - start) / s <= 1000), choices[-1])
    data = prices.candles(order["symbol"], name, min(1000, math.ceil((end - start) / sec) + 2), end)
    checked = start
    for c in data:
        c_end = c["time"] + sec
        if c_end <= start:
            continue
        if c_end > end:
            break  # vela aún abierta
        if c["time"] < start:
            hit, _ = scan(order, start, c_end, slippage_bps, finer_than=sec)
            if hit:
                return hit, hit[0]
        else:
            price = candle_fill_price(order["side"], order["type"], order["trigger_e8"], c, slippage_bps)
            if price:
                return (c["time"], price, name), c_end
        checked = c_end
    return None, checked


def resolve(user_id: int, now: Optional[int] = None, force: bool = False) -> List[Dict]:
    """Ejecuta, rechaza o caduca las órdenes pendientes del usuario según las velas. Devuelve los eventos."""
    now = now or int(time.time())
    if not force and now - _last_resolve.get(user_id, 0) < RESOLVE_EVERY:
        return []
    _last_resolve[user_id] = now
    if len(_last_resolve) > 10000:
        _last_resolve.clear()
    with closing(db.connect()) as conn:
        pending = [dict(r) for r in conn.execute("SELECT * FROM orders WHERE user_id = ? AND status = 'open' ORDER BY created_at, id", (user_id,))]
    if not pending:
        return []

    slippage = config()["slippageBps"]
    found = []
    for o in pending:  # red: fuera de transacciones
        deadline = min(now, o["created_at"] + ORDER_TTL)
        try:
            hit, checked = scan(o, o["checked_until"], deadline, slippage)
            fx = prices.fx_e8(prices.asset(o["symbol"])["quote"]) if hit else None
        except Exception as exc:  # proveedor caído: se reintenta en la próxima resolución
            print(f"[Trading] No se pudo resolver la orden {o['id']}: {exc}")
            continue
        found.append((o, hit, checked, fx, deadline))

    events = []
    # Se aplican en orden cronológico de ejecución: así el saldo evoluciona como lo habría hecho en tiempo real
    for o, hit, checked, fx, deadline in sorted(found, key=lambda f: (f[1][0] if f[1] else math.inf, f[0]["id"])):
        with transaction() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id = ? AND status = 'open'", (o["id"],)).fetchone()
            if not row:
                continue  # cancelada o resuelta por otra petición mientras tanto
            row = dict(row)
            if hit:
                t, price, interval = hit
                try:
                    execute(conn, row, price, fx, t, f"vela {interval}")
                    events.append({"type": "filled", "orderId": o["id"]})
                except OrderError as exc:
                    conn.execute("UPDATE orders SET status = 'rejected', reason = ?, reserved_cents = 0, updated_at = ? WHERE id = ?",
                                 (str(exc), t, o["id"]))
                    events.append({"type": "rejected", "orderId": o["id"], "reason": str(exc)})
            elif checked >= o["created_at"] + ORDER_TTL or deadline < now:
                conn.execute("UPDATE orders SET status = 'expired', reserved_cents = 0, checked_until = ?, updated_at = ? WHERE id = ?",
                             (checked, now, o["id"]))
                events.append({"type": "expired", "orderId": o["id"]})
            elif checked > row["checked_until"]:
                conn.execute("UPDATE orders SET checked_until = ? WHERE id = ?", (checked, o["id"]))
    return [dict(e, order=order_view(e["orderId"])) for e in events]


# ---------------------------------------------------------------- vistas JSON
num = lambda v: None if v is None else v / E8


def _order_json(r: Dict, fill: Optional[Dict]) -> Dict:
    a = prices.ASSETS.get(r["symbol"], {})
    return {
        "id": r["id"], "clientOrderId": r["client_order_id"], "symbol": r["symbol"], "name": a.get("name", r["symbol"]),
        "assetType": a.get("type"), "quote": a.get("quote"), "side": r["side"], "type": r["type"],
        "quantity": num(r["qty_e8"]), "triggerPrice": num(r["trigger_e8"]), "reservedCents": r["reserved_cents"],
        "status": r["status"], "reason": r["reason"], "journal": json.loads(r["journal"]) if r["journal"] else None,
        "createdAt": r["created_at"], "updatedAt": r["updated_at"],
        "fill": None if not fill else {
            "id": fill["id"],  # para compartir la operación en el foro (POST /api/forum/share)
            "price": num(fill["price_e8"]), "fx": num(fill["fx_e8"]), "notionalCents": fill["notional_cents"],
            "feeCents": fill["fee_cents"], "pnlCents": fill["pnl_cents"], "costBasisCents": fill["cost_basis_cents"],
            "entryPrice": num(fill["entry_price_e8"]), "openedAt": fill["opened_at"], "source": fill["source"],
            "executedAt": fill["executed_at"],
        },
    }


def order_view(order_id: int) -> Dict:
    with closing(db.connect()) as conn:
        r = dict(conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone())
        f = conn.execute("SELECT * FROM fills WHERE order_id = ?", (order_id,)).fetchone()
    return _order_json(r, dict(f) if f else None)


def list_orders(user_id: int, status: Optional[str], limit: int, before: Optional[int]) -> Dict:
    """Historial paginado por id descendente (`before` = id de la última orden de la página anterior)."""
    sql, args = "SELECT o.*, f.id AS f_id FROM orders o LEFT JOIN fills f ON f.order_id = o.id WHERE o.user_id = ?", [user_id]
    if status:
        sql, args = sql + " AND o.status = ?", args + [status]
    if before:
        sql, args = sql + " AND o.id < ?", args + [before]
    with closing(db.connect()) as conn:
        rows = [dict(r) for r in conn.execute(sql + " ORDER BY o.id DESC LIMIT ?", (*args, limit + 1))]
        fills = {r["order_id"]: dict(r) for r in conn.execute(
            f"SELECT * FROM fills WHERE order_id IN ({','.join('?' * len(rows)) or 'NULL'})", [r["id"] for r in rows])}
    return {"orders": [_order_json(r, fills.get(r["id"])) for r in rows[:limit]], "hasMore": len(rows) > limit}


def portfolio(user_id: int) -> Dict:
    now = int(time.time())
    with transaction() as conn:
        acc = ensure_account(conn, user_id, now)
    with closing(db.connect()) as conn:
        reserved = _reserved_cents(conn, user_id)
        positions = [dict(r) for r in conn.execute("SELECT * FROM positions WHERE user_id = ? ORDER BY opened_at DESC", (user_id,))]
        open_orders = [dict(r) for r in conn.execute("SELECT * FROM orders WHERE user_id = ? AND status = 'open' ORDER BY id", (user_id,))]
        trades = [dict(r) for r in conn.execute(
            "SELECT f.*, o.journal, (SELECT t.id FROM threads t WHERE t.fill_id = f.id) AS shared_thread_id "
            "FROM fills f JOIN orders o ON o.id = f.order_id WHERE f.user_id = ? AND f.side = 'sell' "
            "ORDER BY f.executed_at DESC LIMIT 500", (user_id,))]
        n_fills = conn.execute("SELECT COUNT(*) FROM fills WHERE user_id = ?", (user_id,)).fetchone()[0]
    asset = lambda s: prices.ASSETS.get(s, {"name": s})
    return {
        "account": {"cashCents": acc["cash_cents"], "reservedCents": reserved, "availableCents": acc["cash_cents"] - reserved,
                    "initialCents": acc["initial_cents"], "createdAt": acc["created_at"], "fills": n_fills},
        "positions": [{"symbol": p["symbol"], "name": asset(p["symbol"])["name"], "assetType": asset(p["symbol"]).get("type"),
                       "quote": asset(p["symbol"]).get("quote"), "quantity": num(p["qty_e8"]), "avgPrice": num(p["avg_price_e8"]),
                       "costCents": p["cost_cents"], "openedAt": p["opened_at"]} for p in positions],
        "orders": [_order_json(o, None) for o in open_orders],
        "trades": [{"id": t["id"], "orderId": t["order_id"], "symbol": t["symbol"], "name": asset(t["symbol"])["name"],
                    "assetType": asset(t["symbol"]).get("type"), "quote": asset(t["symbol"]).get("quote"),
                    "quantity": num(t["qty_e8"]), "entryPrice": num(t["entry_price_e8"]), "exitPrice": num(t["price_e8"]),
                    "costBasisCents": t["cost_basis_cents"], "feeCents": t["fee_cents"], "pnlCents": t["pnl_cents"],
                    "openedAt": t["opened_at"], "executedAt": t["executed_at"], "source": t["source"],
                    "sharedThreadId": t["shared_thread_id"],  # hilo del foro si ya se compartió
                    "journal": json.loads(t["journal"]) if t["journal"] else None} for t in trades],
        "config": config(),
    }
