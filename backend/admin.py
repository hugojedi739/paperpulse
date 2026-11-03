"""API del panel de administración (/api/admin/*). Todas las rutas exigen una sesión con rol admin."""
import time

from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend import auth, db, settings
from backend.config import DAILY_GLOBAL_TOKEN_LIMIT
from backend.http import error, ok, read_json, require_admin
from backend.market import stream
from backend.market.hours import is_market_open
from backend.security import USAGE_STATS, check_date_rollover


def usage() -> dict:
    check_date_rollover()
    used = USAGE_STATS["daily_total_tokens"]
    return {
        "uptimeSeconds": int(time.time() - USAGE_STATS["start_time"]),
        "chatRequests": USAGE_STATS["chat_requests"],
        "tokensToday": used,
        "tokenLimit": DAILY_GLOBAL_TOKEN_LIMIT,
        "percentUsed": round(used / DAILY_GLOBAL_TOKEN_LIMIT * 100, 2) if DAILY_GLOBAL_TOKEN_LIMIT else 0,
        "costTodayUsd": USAGE_STATS["estimated_cost_usd"],
        "stockRequests": USAGE_STATS["stock_requests"],
        "errors": USAGE_STATS["errors"],
    }


async def overview(request):
    _, err = await require_admin(request)
    if err:
        return err
    us_open, us_msg = is_market_open("US")
    es_open, es_msg = is_market_open("ES")
    return ok({
        "users": await run_in_threadpool(db.stats),
        "usage": usage(),
        "stream": stream.status(),
        "integrations": {
            "anthropic": {"configured": bool(settings.get("anthropic_api_key")), "model": settings.get("anthropic_model")},
            "stocks": {"provider": settings.get("stock_data_provider"), "finnhubConfigured": bool(settings.get("finnhub_api_key"))},
            "oauth": {pid: bool(auth.provider_config(pid)) for pid in auth.PROVIDERS},
        },
        "markets": {"us": {"open": us_open, "status": us_msg}, "es": {"open": es_open, "status": es_msg}},
    })


async def users(request):
    _, err = await require_admin(request)
    if err:
        return err
    q = request.query_params
    try:
        limit, offset = min(100, max(1, int(q.get("limit", "25")))), max(0, int(q.get("offset", "0")))
    except ValueError:
        return error("limit y offset deben ser números.", 400)
    return ok(await run_in_threadpool(db.list_users, q.get("q", "")[:100], limit, offset))


async def user_detail(request):
    admin, err = await require_admin(request)
    if err:
        return err
    try:
        uid = int(request.path_params["id"])
    except ValueError:
        return error("Usuario no válido.", 400)
    target = await run_in_threadpool(db.get_user, uid)
    if not target:
        return error("El usuario no existe.", 404)
    if request.method == "DELETE":
        if uid == admin["id"]:
            return error("No puedes eliminar tu propia cuenta desde el panel.", 400)
        await run_in_threadpool(db.delete_user, uid)
        return ok({"ok": True})

    body, err = await read_json(request)
    if err:
        return err
    role, disabled = body.get("role"), body.get("disabled")
    if role is not None and role not in db.ROLES:
        return error("Rol no válido.", 400)
    if disabled is not None and not isinstance(disabled, bool):
        return error("disabled debe ser verdadero o falso.", 400)
    if role == "admin" and not target["emailVerified"]:
        return error("Solo se puede dar el rol de administrador a cuentas con el email verificado (acceso con Google).", 400)
    if uid == admin["id"] and (role == "user" or disabled):
        return error("No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.", 400)
    if target["role"] == "admin" and (role == "user" or disabled) and await run_in_threadpool(db.count_admins) <= 1:
        return error("Debe quedar al menos un administrador activo.", 400)
    return ok({"user": await run_in_threadpool(db.update_user, uid, role, disabled)})


async def settings_view(request):
    admin, err = await require_admin(request)
    if err:
        return err
    if request.method == "PUT":
        body, err = await read_json(request, 32768)
        if err:
            return err
        values = body.get("values")
        if not isinstance(values, dict):
            return error("Envía {\"values\": {...}}.", 400)
        problem = settings.validate(values)
        if problem:
            return error(problem, 400)
        await run_in_threadpool(settings.save, values, admin["id"])
    return ok({
        "settings": settings.public_view(),
        "redirectUris": {pid: auth.redirect_uri(request, pid) for pid in auth.PROVIDERS},
    })


async def oauth_test(request):
    """Comprueba que el issuer responde con un documento OpenID válido (no envía credenciales)."""
    _, err = await require_admin(request)
    if err:
        return err
    pid = request.path_params["provider"]
    if pid not in auth.PROVIDERS:
        return error("Proveedor desconocido.", 404)
    issuer = auth.PROVIDERS[pid]["issuer"]()
    if not issuer:
        return error("Configura primero el issuer.", 400)
    try:
        doc = await run_in_threadpool(auth.discovery, issuer)
    except Exception as e:
        return ok({"ok": False, "error": f"{type(e).__name__}: {e}"[:300]})
    return ok({"ok": True, "issuer": doc["issuer"], "authorization_endpoint": doc.get("authorization_endpoint"),
               "configured": bool(auth.provider_config(pid))})


routes = [
    Route("/api/admin/overview", overview, methods=["GET"]),
    Route("/api/admin/users", users, methods=["GET"]),
    Route("/api/admin/users/{id}", user_detail, methods=["PATCH", "DELETE"]),
    Route("/api/admin/settings", settings_view, methods=["GET", "PUT"]),
    Route("/api/admin/oauth/{provider}/test", oauth_test, methods=["POST"]),
]
