"""Endpoints de la comunidad (/api/community/*, /api/forum/*) y de moderación (/api/admin/...).

Leer el foro, los perfiles públicos y la clasificación no exige sesión. Publicar, votar, denunciar y seguir sí,
además de tener perfil y no estar suspendido (lo comprueba la capa de datos dentro de la transacción).
"""
import hmac
from typing import Optional

from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend.community import forum, moderation, profiles, ranking
from backend.community.common import CommunityError
from backend.config import ADMIN_API_KEY
from backend.http import current_user, error, ok, read_json, require_admin, same_origin
from backend.security import IP_COMMUNITY_CALLS, USER_COMMUNITY_CALLS, check_ip_rate_limit, cleanup_stale_ip_data, get_client_ip

# Peticiones por minuto. Publicar (hilos, respuestas, compartir) es lo más restringido.
# Además hay cuotas diarias en la base de datos (common.QUOTAS), más bajas para cuentas de menos de 24 h.
LIMITS = {
    "read": {"ip": 180, "user": 120},
    "act": {"ip": 60, "user": 30},  # votar, seguir, denunciar, editar perfil, borrar
    "post": {"ip": 20, "user": 5},
}
MAX_PAGE = 500


async def _guard(request, kind: str, need_user: bool):
    """Límites por IP y por usuario + CSRF en escrituras. Devuelve (usuario o None, respuesta de error o None)."""
    if kind != "read" and not same_origin(request):
        return None, error("Origen no permitido.", 403)
    if len(IP_COMMUNITY_CALLS) + len(USER_COMMUNITY_CALLS) > 20000:  # en serverless no hay hilo de limpieza
        cleanup_stale_ip_data()
    if not check_ip_rate_limit(f"{kind}:{get_client_ip(request)}", IP_COMMUNITY_CALLS, LIMITS[kind]["ip"]):
        return None, error("Demasiadas peticiones. Espera un minuto.", 429)
    user = await current_user(request)
    if need_user and not user:
        return None, error("Inicia sesión para participar en la comunidad.", 401)
    if user and not check_ip_rate_limit(f"u{user['id']}:{kind}", USER_COMMUNITY_CALLS, LIMITS[kind]["user"]):
        return None, error("Demasiadas peticiones. Espera un minuto.", 429)
    return user, None


async def _run(fn, *args):
    """Ejecuta la capa de datos en un hilo y convierte sus errores en respuestas HTTP."""
    try:
        return ok(await run_in_threadpool(fn, *args))
    except CommunityError as exc:
        return error(str(exc), getattr(exc, "status", 400))


def _int(value, default: Optional[int] = None, low: int = 1, high: int = 10**12) -> Optional[int]:
    try:
        n = int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        raise CommunityError("Parámetro numérico no válido.") from None
    if n is not None and not low <= n <= high:
        raise CommunityError("Parámetro numérico fuera de rango.")
    return n


def _uid(user) -> Optional[int]:
    return user["id"] if user else None


# ---------------------------------------------------------------- perfiles
async def api_me(request):
    user, err = await _guard(request, "read" if request.method == "GET" else "act", True)
    if err:
        return err
    if request.method == "GET":
        return await _run(profiles.mine, user["id"])
    body, err = await read_json(request, limit=4096)
    return err or await _run(profiles.save_mine, user["id"], body)


async def api_profiles(request):
    user, err = await _guard(request, "read", False)
    if err:
        return err
    try:
        limit = _int(request.query_params.get("limit"), 20, 1, 50)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(profiles.search, request.query_params.get("q", "")[:20], limit)


async def api_profile(request):
    user, err = await _guard(request, "read", False)
    return err or await _run(profiles.public, request.path_params["alias"], _uid(user))


async def api_profile_threads(request):
    user, err = await _guard(request, "read", False)
    if err:
        return err
    try:
        page = _int(request.query_params.get("page"), 1, 1, MAX_PAGE)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(profiles.threads_of, request.path_params["alias"], _uid(user), page)


async def api_follow(request):
    user, err = await _guard(request, "act", True)
    return err or await _run(profiles.follow, user["id"], request.path_params["alias"], request.method == "POST")


async def api_following(request):
    user, err = await _guard(request, "read", True)
    return err or await _run(profiles.following, user["id"])


async def api_feed(request):
    user, err = await _guard(request, "read", True)
    if err:
        return err
    try:
        before = _int(request.query_params.get("before"))
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(profiles.feed, user["id"], before, 20)


# ---------------------------------------------------------------- clasificación
async def api_leaderboard(request):
    _, err = await _guard(request, "read", False)
    if err:
        return err
    q = request.query_params
    try:
        page = _int(q.get("page"), 1, 1, MAX_PAGE)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(ranking.leaderboard, q.get("period", "total"), 50, (page - 1) * 50)


async def api_leaderboard_refresh(request):
    """Recalcular ya (panel de admin o un cron con la cabecera X-Admin-Key, p. ej. Vercel Cron una vez al día)."""
    key = request.headers.get("x-admin-key", "")
    if not (ADMIN_API_KEY and hmac.compare_digest(key.encode(), ADMIN_API_KEY.encode())):
        _, err = await require_admin(request)
        if err:
            return err
    await run_in_threadpool(ranking.refresh, True)
    return ok({"computedAt": ranking._state["computed_at"]})


# ---------------------------------------------------------------- foro
def _list_params(request):
    q = request.query_params
    return q.get("sort", "top"), _int(q.get("page"), 1, 1, MAX_PAGE)


async def api_categories(request):
    _, err = await _guard(request, "read", False)
    return err or await _run(forum.categories)


async def api_category(request):
    user, err = await _guard(request, "read", False)
    if err:
        return err
    try:
        sort, page = _list_params(request)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(forum.list_threads, request.path_params["slug"], sort, page, _uid(user))


async def api_asset_thread(request):
    _, err = await _guard(request, "read", False)
    return err or await _run(forum.asset_thread, request.path_params["symbol"])


async def api_thread(request):
    user, err = await _guard(request, "read", False)
    if err:
        return err
    try:
        sort, page = _list_params(request)
    except CommunityError as exc:
        return error(str(exc), 400)
    is_admin = bool(user) and user["role"] == "admin"
    return await _run(forum.get_thread, request.path_params["thread_id"], sort, page, _uid(user), is_admin)


async def api_create_thread(request):
    user, err = await _guard(request, "post", True)
    if err:
        return err
    body, err = await read_json(request, limit=16384)
    return err or await _run(forum.create_thread, user["id"], body.get("category"), body.get("title"), body.get("body"))


async def api_reply(request):
    user, err = await _guard(request, "post", True)
    if err:
        return err
    body, err = await read_json(request, limit=16384)
    return err or await _run(forum.reply, user["id"], request.path_params["thread_id"], body.get("body"))


async def api_share(request):
    user, err = await _guard(request, "post", True)
    if err:
        return err
    body, err = await read_json(request, limit=8192)
    return err or await _run(forum.share_fill, user["id"], body.get("fillId"), body.get("comment", ""))


async def api_delete_post(request):
    user, err = await _guard(request, "act", True)
    return err or await _run(forum.delete_own, user["id"], request.path_params["post_id"])


async def api_vote(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=256)
    return err or await _run(forum.vote, user["id"], request.path_params["post_id"], body.get("value"))


async def api_report(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=4096)
    return err or await _run(forum.report, user["id"], request.path_params["post_id"], body.get("reason"), body.get("details", ""))


# ---------------------------------------------------------------- moderación (admin)
async def _admin_body(request):
    admin, err = await require_admin(request)
    if err:
        return None, None, err
    body, err = await read_json(request, limit=4096)
    return admin, body, err


async def api_admin_reports(request):
    _, err = await require_admin(request)
    if err:
        return err
    try:
        page = _int(request.query_params.get("page"), 1, 1, MAX_PAGE)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(moderation.list_reports, request.query_params.get("status", "open"), 25, (page - 1) * 25)


async def api_admin_post(request):
    admin, body, err = await _admin_body(request)
    if err:
        return err
    action = {"hide": moderation.hide_post, "restore": moderation.restore_post, "dismiss": moderation.dismiss_reports}
    if request.path_params["action"] not in action:
        return error("Acción no válida. Usa hide, restore o dismiss.", 404)
    return await _run(action[request.path_params["action"]], admin["id"], request.path_params["post_id"], body.get("reason", ""))


async def api_admin_suspend(request):
    admin, body, err = await _admin_body(request)
    if err:
        return err
    uid = request.path_params["user_id"]
    if request.path_params["action"] not in ("suspend", "unsuspend"):
        return error("Acción no válida. Usa suspend o unsuspend.", 404)
    if request.path_params["action"] == "suspend":
        return await _run(moderation.suspend, admin["id"], uid, body.get("days"), body.get("reason", ""))
    return await _run(moderation.unsuspend, admin["id"], uid, body.get("reason", ""))


async def api_admin_log(request):
    _, err = await require_admin(request)
    if err:
        return err
    try:
        before = _int(request.query_params.get("before"))
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(moderation.moderation_log, 50, before)


routes = [
    Route("/api/community/me", api_me, methods=["GET", "PUT"]),
    Route("/api/community/profiles", api_profiles, methods=["GET"]),
    Route("/api/community/profiles/{alias}", api_profile, methods=["GET"]),
    Route("/api/community/profiles/{alias}/threads", api_profile_threads, methods=["GET"]),
    Route("/api/community/profiles/{alias}/follow", api_follow, methods=["POST", "DELETE"]),
    Route("/api/community/following", api_following, methods=["GET"]),
    Route("/api/community/feed", api_feed, methods=["GET"]),
    Route("/api/community/leaderboard", api_leaderboard, methods=["GET"]),
    Route("/api/community/leaderboard/refresh", api_leaderboard_refresh, methods=["POST"]),
    Route("/api/forum/categories", api_categories, methods=["GET"]),
    Route("/api/forum/categories/{slug}", api_category, methods=["GET"]),
    Route("/api/forum/assets/{symbol}", api_asset_thread, methods=["GET"]),
    Route("/api/forum/threads", api_create_thread, methods=["POST"]),
    Route("/api/forum/threads/{thread_id:int}", api_thread, methods=["GET"]),
    Route("/api/forum/threads/{thread_id:int}/posts", api_reply, methods=["POST"]),
    Route("/api/forum/share", api_share, methods=["POST"]),
    Route("/api/forum/posts/{post_id:int}", api_delete_post, methods=["DELETE"]),
    Route("/api/forum/posts/{post_id:int}/vote", api_vote, methods=["PUT"]),
    Route("/api/forum/posts/{post_id:int}/report", api_report, methods=["POST"]),
    Route("/api/admin/reports", api_admin_reports, methods=["GET"]),
    Route("/api/admin/posts/{post_id:int}/{action:str}", api_admin_post, methods=["POST"]),
    Route("/api/admin/users/{user_id:int}/{action:str}", api_admin_suspend, methods=["POST"]),
    Route("/api/admin/moderation-log", api_admin_log, methods=["GET"]),
]
