"""Utilidades HTTP compartidas por las rutas con sesión: CSRF, JSON, límites y cookie de sesión."""
import json
import time
from typing import Dict, List, Optional
from urllib.parse import urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from backend import db
from backend.config import IS_PRODUCTION

COOKIE = "__Host-pp_session" if IS_PRODUCTION else "pp_session"

_LIMITS: Dict[str, List[float]] = {}


def allow(key: str, per_minute: int) -> bool:
    now = time.time()
    calls = [t for t in _LIMITS.get(key, []) if now - t < 60]
    ok = len(calls) < per_minute
    if ok:
        calls.append(now)
    _LIMITS[key] = calls
    if len(_LIMITS) > 10000:  # acota memoria: primero las claves caducadas, para que una avalancha de claves no borre los contadores vivos
        for stale in [k for k, v in _LIMITS.items() if not v or now - v[-1] >= 60]:
            del _LIMITS[stale]
        if len(_LIMITS) > 10000:
            _LIMITS.clear()
    return ok


def error(msg: str, status: int) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=status, headers={"Cache-Control": "no-store"})


def ok(data, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status, headers={"Cache-Control": "no-store"})


def same_origin(request) -> bool:
    """Rechaza peticiones con Origin de otro sitio (CSRF). Sin Origin se acepta (mismo origen o herramientas)."""
    origin = request.headers.get("origin")
    return not origin or urlsplit(origin).netloc == request.headers.get("host", "")


async def read_json(request, limit: int = 8192):
    if not request.headers.get("content-type", "").startswith("application/json"):
        return None, error("Se esperaba JSON.", 415)
    length = request.headers.get("content-length", "")
    if not length.isdigit() or int(length) > limit:
        return None, error("Petición demasiado grande.", 413)
    try:
        body = json.loads(await request.body())
    except ValueError:
        return None, error("JSON no válido.", 400)
    return (body, None) if isinstance(body, dict) else (None, error("JSON no válido.", 400))


def with_session(response, token: Optional[str]):
    if token is None:
        response.delete_cookie(COOKIE, path="/", secure=IS_PRODUCTION, httponly=True, samesite="strict")
    else:
        response.set_cookie(COOKIE, token, max_age=db.SESSION_TTL, path="/", secure=IS_PRODUCTION, httponly=True, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return response


async def current_user(request) -> Optional[Dict]:
    return await run_in_threadpool(db.session_user, request.cookies.get(COOKIE))


async def require_admin(request):
    """Devuelve (usuario, None) o (None, respuesta de error). Las escrituras exigen además mismo origen."""
    if request.method != "GET" and not same_origin(request):
        return None, error("Origen no permitido.", 403)
    user = await current_user(request)
    if not user:
        return None, error("Inicia sesión.", 401)
    if user["role"] != "admin":
        return None, error("Necesitas permisos de administrador.", 403)
    return user, None
