"""API de retención: notificaciones, resumen (racha, logros, onboarding), reto mensual y tarea diaria (cron).

Todo exige sesión salvo la clasificación del reto y el estado del reto (lectura pública). Cada usuario solo puede
ver y modificar SUS notificaciones: las consultas filtran siempre por user_id de la sesión.
"""
import hmac
import os
from contextlib import closing

from starlette.concurrency import run_in_threadpool
from starlette.routing import Route

from backend import admin_log, ai_usage, contact, db, visits
from backend.community import ranking
from backend.community.api import MAX_PAGE, _guard, _int, _run
from backend.community.common import CommunityError
from backend.config import ADMIN_API_KEY
from backend.db import transaction
from backend.http import error, ok, read_json
from backend.retention import achievements, challenges, notifications, onboarding, streak
from backend.trading import prices


# ---------------------------------------------------------------- notificaciones
async def api_notifications(request):
    user, err = await _guard(request, "read", True)
    if err:
        return err
    try:
        before, limit = _int(request.query_params.get("before")), _int(request.query_params.get("limit"), 20, 1, 50)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(notifications.list_for, user["id"], before, limit)


async def api_notifications_read(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=4096)
    if err:
        return err
    ids = None if body.get("all") is True else body.get("ids")
    return await _run(_validated, notifications.mark_read, user["id"], ids)


async def api_notifications_delete(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    if "notification_id" in request.path_params:
        return await _run(_validated, notifications.delete, user["id"], [request.path_params["notification_id"]])
    body, err = await read_json(request, limit=4096)
    if err:
        return err
    ids = None if body.get("all") is True else body.get("ids")
    return await _run(_validated, notifications.delete, user["id"], ids)


def _validated(fn, user_id, ids):
    try:
        return fn(user_id, ids)
    except ValueError as exc:
        raise CommunityError(str(exc)) from None


async def api_notifications_alert(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=1024)
    if err:
        return err

    def create():
        try:
            notifications.price_alert(user["id"], str(body.get("symbol", "")).upper(), body.get("condition"), body.get("target"))
        except ValueError as exc:
            raise CommunityError(str(exc)) from None
        return {"ok": True}

    return await _run(create)


# ---------------------------------------------------------------- resumen y onboarding
def _summary(user_id: int):
    with closing(db.connect()) as conn:
        return {"streak": streak.current(conn, user_id), "achievements": achievements.catalog(conn, user_id)}


async def api_summary(request):
    user, err = await _guard(request, "read", True)
    if err:
        return err
    return await _run(lambda: {**_summary(user["id"]), "onboarding": onboarding.state(user["id"])})


async def api_onboarding(request):
    user, err = await _guard(request, "act", True)
    if err:
        return err
    body, err = await read_json(request, limit=512)
    if err:
        return err

    def act():
        try:
            return onboarding.act(user["id"], str(body.get("action", "")))
        except ValueError as exc:
            raise CommunityError(str(exc)) from None

    return await _run(act)


# ---------------------------------------------------------------- reto del mes
async def api_challenge(request):
    user, err = await _guard(request, "read", False)
    if err:
        return err
    return await _run(lambda: {**challenges.status(user["id"] if user else None),
                               "assets": [{"symbol": a["symbol"], "name": a["name"], "quote": a["quote"]} for a in prices.ASSETS.values()]})


async def api_challenge_leaderboard(request):
    _, err = await _guard(request, "read", False)
    if err:
        return err
    try:
        page = _int(request.query_params.get("page"), 1, 1, MAX_PAGE)
    except CommunityError as exc:
        return error(str(exc), 400)
    return await _run(lambda: challenges.leaderboard(request.query_params.get("slug") or None, 50, (page - 1) * 50))


async def api_challenge_join(request):
    user, err = await _guard(request, "act", True)
    return err or await _run(challenges.join, user["id"])


# ---------------------------------------------------------------- tarea diaria (Vercel Cron)
def _cron_authorized(request) -> bool:
    """Acepta `X-Admin-Key` o `Authorization: Bearer <token>` (así llama Vercel Cron con CRON_SECRET). El token
    válido es ADMIN_API_KEY o CRON_SECRET (conviene que valgan lo mismo). Sin ninguno configurado, siempre rechaza."""
    given = request.headers.get("x-admin-key", "") or request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    valid = [k for k in (ADMIN_API_KEY, os.getenv("CRON_SECRET", "")) if k]
    return bool(given) and any(hmac.compare_digest(given.encode(), k.encode()) for k in valid)


def daily_job() -> dict:
    ranking.refresh(True)
    with transaction() as conn:
        challenges.ensure_current(conn)
        conn.execute("DELETE FROM oauth_states WHERE expires_at < ?", (ranking.now(),))
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (ranking.now(),))
    return {"ranking": True, "notificationsDeleted": notifications.cleanup(), **ai_usage.cleanup(), **visits.cleanup(),
            **contact.cleanup(), **admin_log.cleanup()}


async def api_cron_daily(request):
    if not _cron_authorized(request):
        return error("No autorizado.", 401)
    return ok(await run_in_threadpool(daily_job))


routes = [
    Route("/api/notifications", api_notifications, methods=["GET"]),
    Route("/api/notifications/read", api_notifications_read, methods=["POST"]),
    Route("/api/notifications/clear", api_notifications_delete, methods=["POST"]),
    Route("/api/notifications/alert", api_notifications_alert, methods=["POST"]),
    Route("/api/notifications/{notification_id:int}", api_notifications_delete, methods=["DELETE"]),
    Route("/api/retention/summary", api_summary, methods=["GET"]),
    Route("/api/retention/onboarding", api_onboarding, methods=["POST"]),
    Route("/api/challenge", api_challenge, methods=["GET"]),
    Route("/api/challenge/leaderboard", api_challenge_leaderboard, methods=["GET"]),
    Route("/api/challenge/join", api_challenge_join, methods=["POST"]),
    Route("/api/cron/daily", api_cron_daily, methods=["GET", "POST"]),
]
