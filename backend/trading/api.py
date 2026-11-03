"""Endpoints de la cuenta del servidor (requieren sesión).

GET    /api/portfolio            saldo, posiciones, órdenes pendientes y operaciones cerradas (resuelve antes las pendientes)
GET    /api/orders?status=&limit=&before=   historial de órdenes paginado
POST   /api/orders               {clientOrderId, symbol, side, type, quantity, triggerPrice?, journal?}
DELETE /api/orders/{id}          cancela una orden pendiente y libera su reserva
PATCH  /api/orders/{id}          {journal: {setup, emotion, notes}} notas del diario
"""
from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend.http import current_user, error, ok, read_json, same_origin
from backend.security import IP_TRADING_CALLS, USER_TRADING_CALLS, check_ip_rate_limit, get_client_ip
from backend.trading import ledger
from backend.trading.rules import OrderError

# Peticiones por minuto. Las escrituras tienen un tope más bajo que las lecturas.
LIMITS = {"read": {"ip": 120, "user": 60}, "write": {"ip": 60, "user": 30}}
STATUSES = ("open", "filled", "cancelled", "rejected", "expired")


async def _guard(request, kind: str):
    """Sesión + CSRF + límites por IP y por usuario. Devuelve (usuario, None) o (None, respuesta de error)."""
    if kind == "write" and not same_origin(request):
        return None, error("Origen no permitido.", 403)
    if not check_ip_rate_limit(get_client_ip(request), IP_TRADING_CALLS, LIMITS[kind]["ip"]):
        return None, error("Demasiadas peticiones. Espera un minuto.", 429)
    user = await current_user(request)
    if not user:
        return None, error("Inicia sesión para usar la cuenta del servidor.", 401)
    # Clave distinta para lecturas y escrituras: consultar la cartera no agota el cupo de órdenes
    if not check_ip_rate_limit(f"u{user['id']}:{kind}", USER_TRADING_CALLS, LIMITS[kind]["user"]):
        return None, error("Demasiadas peticiones. Espera un minuto.", 429)
    return user, None


def _status(exc: OrderError) -> int:
    return 404 if isinstance(exc, ledger.NotFound) else 409 if isinstance(exc, ledger.Conflict) else 400


async def api_portfolio(request):
    user, err = await _guard(request, "read")
    if err:
        return err
    events = await run_in_threadpool(ledger.resolve, user["id"])
    data = await run_in_threadpool(ledger.portfolio, user["id"])
    return ok({**data, "events": events})


async def api_list_orders(request):
    user, err = await _guard(request, "read")
    if err:
        return err
    q = request.query_params
    status = q.get("status") or None
    if status and status not in STATUSES:
        return error(f"Estado no válido. Usa uno de: {', '.join(STATUSES)}.", 400)
    try:
        limit = min(100, max(1, int(q.get("limit", "50"))))
        before = int(q["before"]) if q.get("before") else None
    except ValueError:
        return error("limit y before deben ser números.", 400)
    return ok(await run_in_threadpool(ledger.list_orders, user["id"], status, limit, before))


async def api_place_order(request):
    user, err = await _guard(request, "write")
    if err:
        return err
    body, err = await read_json(request, limit=4096)
    if err:
        return err
    try:
        # Antes de operar se resuelven las pendientes: el saldo y las posiciones están al día
        await run_in_threadpool(ledger.resolve, user["id"], None, True)
        order, created = await run_in_threadpool(ledger.place_order, user["id"], body)
    except OrderError as exc:
        return error(str(exc), _status(exc))
    return ok({"order": order, "replayed": not created}, 201 if created else 200)


def _order_id(request):
    try:
        return int(request.path_params["order_id"])
    except (KeyError, ValueError):
        return None


async def api_cancel_order(request):
    user, err = await _guard(request, "write")
    if err:
        return err
    try:
        return ok({"order": await run_in_threadpool(ledger.cancel_order, user["id"], _order_id(request))})
    except OrderError as exc:
        return error(str(exc), _status(exc))


async def api_update_order(request):
    user, err = await _guard(request, "write")
    if err:
        return err
    body, err = await read_json(request, limit=4096)
    if err:
        return err
    try:
        return ok({"order": await run_in_threadpool(ledger.update_journal, user["id"], _order_id(request), body.get("journal"))})
    except OrderError as exc:
        return error(str(exc), _status(exc))


routes = [
    Route("/api/portfolio", api_portfolio, methods=["GET"]),
    Route("/api/orders", api_list_orders, methods=["GET"]),
    Route("/api/orders", api_place_order, methods=["POST"]),
    Route("/api/orders/{order_id:int}", api_cancel_order, methods=["DELETE"]),
    Route("/api/orders/{order_id:int}", api_update_order, methods=["PATCH"]),
]
