"""Rutas de sesión: email + contraseña, Google y Okta (OpenID Connect) y copia de la cuenta de práctica.

OIDC: flujo authorization code con PKCE (S256), `state` de un solo uso guardado en la base de datos y ligado al
navegador con una cookie Lax, y `nonce` comprobado en el id_token. El id_token llega directamente del endpoint de
tokens del proveedor por TLS, así que (OIDC Core §3.1.3.7) se validan iss/aud/exp/nonce sin verificar la firma.
"""
import base64
import hashlib
import hmac
import json
import re
import secrets
import sys
import time
from typing import Callable, Dict, List, Optional
from urllib.parse import urlencode

import requests
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, RedirectResponse
from starlette.routing import Route

from backend import db, settings
from backend.config import IS_PRODUCTION, app_domain
from backend.http import COOKIE, allow, current_user, error, ok, read_json, same_origin, with_session

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,189}\.[^@\s]{2,}$")
MAX_BODY = 2_000_000  # copia de la cuenta de práctica
STATE_COOKIE = "pp_oauth"

PROVIDERS = {
    "google": {"name": "Google", "issuer": lambda: "https://accounts.google.com", "extra": {"prompt": "select_account"}},
    "okta": {"name": "Okta", "issuer": lambda: settings.get("oauth_okta_issuer").rstrip("/"), "extra": {}},
}
_DISCOVERY: Dict[str, tuple] = {}


def provider_config(pid: str) -> Optional[Dict]:
    """Configuración efectiva de un proveedor, o None si no está activado y completo."""
    p = PROVIDERS.get(pid)
    if not p or not settings.get(f"oauth_{pid}_enabled"):
        return None
    cfg = {"id": pid, "name": p["name"], "issuer": p["issuer"](), "extra": p["extra"],
           "client_id": settings.get(f"oauth_{pid}_client_id"), "client_secret": settings.get(f"oauth_{pid}_client_secret")}
    return cfg if cfg["issuer"] and cfg["client_id"] and cfg["client_secret"] else None


def discovery(issuer: str) -> Dict:
    """Documento .well-known/openid-configuration (caché de 1 hora)."""
    hit = _DISCOVERY.get(issuer)
    if hit and time.time() - hit[0] < 3600:
        return hit[1]
    r = requests.get(f"{issuer}/.well-known/openid-configuration", timeout=6)
    r.raise_for_status()
    doc = r.json()
    if doc.get("issuer", "").rstrip("/") != issuer.rstrip("/"):
        raise ValueError("El issuer del documento de descubrimiento no coincide.")
    _DISCOVERY[issuer] = (time.time(), doc)
    return doc


def redirect_uri(request, pid: str) -> str:
    base = app_domain() or str(request.base_url).rstrip("/")
    return f"{base}/api/auth/oauth/{pid}/callback"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def decode_jwt_payload(token: str) -> Dict:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def validate_id_token(claims: Dict, cfg: Dict, issuer: str, nonce: str) -> Optional[str]:
    aud = claims.get("aud")
    audiences = aud if isinstance(aud, list) else [aud]
    if claims.get("iss", "").rstrip("/") != issuer.rstrip("/"):
        return "issuer"
    if cfg["client_id"] not in audiences:
        return "audience"
    if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < time.time() - 60:
        return "expired"
    if not hmac.compare_digest(str(claims.get("nonce", "")), nonce):
        return "nonce"
    return None


def exchange_code(cfg: Dict, doc: Dict, code: str, verifier: str, redirect: str) -> Dict:
    r = requests.post(doc["token_endpoint"], data={
        "grant_type": "authorization_code", "code": code, "redirect_uri": redirect, "code_verifier": verifier,
    }, auth=(cfg["client_id"], cfg["client_secret"]), headers={"Accept": "application/json"}, timeout=8)
    if r.status_code != 200:
        raise ValueError(f"token endpoint {r.status_code}: {r.text[:200]}")
    return r.json()


def build_routes(client_ip: Callable) -> List[Route]:
    """`client_ip` es la función del servidor que respeta proxies de confianza."""

    async def guarded(request, per_minute: int, limit: int = 8192):
        if not same_origin(request):
            return None, error("Origen no permitido.", 403)
        if not allow(f"{request.url.path}:{client_ip(request)}", per_minute):
            return None, error("Demasiados intentos. Espera un minuto.", 429)
        return await read_json(request, limit)

    # ------------------------------------------------------------ email + contraseña
    async def providers(request):
        return ok({
            "password": settings.get("auth_password_enabled"),
            "registration": settings.get("auth_registration_enabled"),
            "providers": [{"id": pid, "name": p["name"]} for pid, p in PROVIDERS.items() if provider_config(pid)],
        })

    async def register(request):
        body, err = await guarded(request, 5)
        if err:
            return err
        if not (settings.get("auth_password_enabled") and settings.get("auth_registration_enabled")):
            return error("El registro con email está desactivado.", 403)
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        name = str(body.get("name", "")).strip()[:40] or email.split("@")[0][:40]
        if len(email) > 254 or not EMAIL_RE.match(email):
            return error("Introduce un email válido.", 400)
        if not 8 <= len(password) <= 128:
            return error("La contraseña debe tener entre 8 y 128 caracteres.", 400)
        if body.get("acceptTerms") is not True or body.get("ageConfirmed") is not True:
            return error("Debes aceptar los términos y la política de privacidad y confirmar que tienes al menos 14 años.", 400)
        user = await run_in_threadpool(db.create_user, email, password, name, True)
        if not user:
            return error("Ya existe una cuenta con ese email.", 409)
        token = await run_in_threadpool(db.create_session, user["id"])
        return with_session(JSONResponse({"user": user}, status_code=201), token)

    async def login(request):
        body, err = await guarded(request, 10)
        if err:
            return err
        if not settings.get("auth_password_enabled"):
            return error("El acceso con contraseña está desactivado. Usa Google u Okta.", 403)
        email = str(body.get("email", "")).strip().lower()[:254]
        if not allow(f"login-email:{email}", 10):
            return error("Demasiados intentos para esta cuenta. Espera un minuto.", 429)
        user = await run_in_threadpool(db.authenticate, email, str(body.get("password", ""))[:128])
        if not user:
            return error("Email o contraseña incorrectos.", 401)
        token = await run_in_threadpool(db.create_session, user["id"])
        return with_session(JSONResponse({"user": user}), token)

    async def logout(request):
        if not same_origin(request):
            return error("Origen no permitido.", 403)
        await run_in_threadpool(db.delete_session, request.cookies.get(COOKIE))
        return with_session(JSONResponse({"ok": True}), None)

    async def me(request):
        user = await current_user(request)
        if request.method == "GET":
            return ok({"user": user})
        # DELETE: borrar la cuenta (contraseña si la tiene; si entró con Google/Okta, confirmación escrita)
        body, err = await guarded(request, 5)
        if err:
            return err
        if not user:
            return error("Inicia sesión.", 401)
        if user["hasPassword"]:
            if not await run_in_threadpool(db.authenticate, user["email"], str(body.get("password", ""))[:128]):
                return error("Contraseña incorrecta.", 401)
        elif str(body.get("confirm", "")).strip().upper() != "ELIMINAR":
            return error("Escribe ELIMINAR para confirmar.", 400)
        await run_in_threadpool(db.delete_user, user["id"])
        return with_session(JSONResponse({"ok": True}), None)

    async def data(request):
        user = await current_user(request)
        if not user:
            return error("Inicia sesión.", 401)
        if request.method == "GET":
            return ok(await run_in_threadpool(db.get_data, user["id"]) or {"data": None})
        body, err = await guarded(request, 60, MAX_BODY)
        if err:
            return err
        payload = body.get("data")
        if not isinstance(payload, dict) or payload.get("app") not in ("PaperPulse", "PaperPulse Terminal"):
            return error("Copia de datos no válida.", 400)
        meta = await run_in_threadpool(db.put_data, user["id"], json.dumps(payload, separators=(",", ":")))
        return ok(meta)

    # ------------------------------------------------------------ Google / Okta
    def back_to_app(code: Optional[str] = None):
        """Vuelve a la app; los errores viajan como código (el frontend los traduce)."""
        resp = RedirectResponse("/" + (f"?auth_error={code}" if code else "") + "#/dashboard", status_code=302)
        resp.delete_cookie(STATE_COOKIE, path="/api/auth/oauth", secure=IS_PRODUCTION, httponly=True, samesite="lax")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    async def oauth_start(request):
        pid = request.path_params["provider"]
        cfg = provider_config(pid)
        if not cfg:
            return back_to_app("provider_disabled")
        if not allow(f"oauth-start:{client_ip(request)}", 20):
            return back_to_app("rate_limited")
        try:
            doc = await run_in_threadpool(discovery, cfg["issuer"])
        except Exception as e:
            print(f"[OAuth] Descubrimiento {pid} fallido: {e}", file=sys.stderr)
            return back_to_app("provider_unavailable")
        state, verifier, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(48), secrets.token_urlsafe(16)
        await run_in_threadpool(db.save_oauth_state, state, pid, verifier, nonce)
        params = {
            "client_id": cfg["client_id"], "response_type": "code", "scope": "openid email profile",
            "redirect_uri": redirect_uri(request, pid), "state": state, "nonce": nonce,
            "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256",
            **cfg["extra"],
        }
        resp = RedirectResponse(f"{doc['authorization_endpoint']}?{urlencode(params)}", status_code=302)
        # Lax: la cookie debe viajar en la navegación de vuelta desde el proveedor
        resp.set_cookie(STATE_COOKIE, state, max_age=db.OAUTH_STATE_TTL, path="/api/auth/oauth",
                        secure=IS_PRODUCTION, httponly=True, samesite="lax")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    async def oauth_callback(request):
        pid = request.path_params["provider"]
        q = request.query_params
        if q.get("error"):
            return back_to_app("cancelled" if q["error"] == "access_denied" else "provider_error")
        state, code = q.get("state", ""), q.get("code", "")
        cookie_state = request.cookies.get(STATE_COOKIE, "")
        if not state or not code or not cookie_state or not hmac.compare_digest(state, cookie_state):
            return back_to_app("invalid_state")
        pending = await run_in_threadpool(db.pop_oauth_state, state)
        cfg = provider_config(pid)
        if not pending or pending["provider"] != pid:
            return back_to_app("invalid_state")
        if not cfg:
            return back_to_app("provider_disabled")
        try:
            doc = await run_in_threadpool(discovery, cfg["issuer"])
            tokens = await run_in_threadpool(exchange_code, cfg, doc, code, pending["verifier"], redirect_uri(request, pid))
            claims = decode_jwt_payload(tokens["id_token"])
        except Exception as e:
            print(f"[OAuth] Intercambio de código {pid} fallido: {e}", file=sys.stderr)
            return back_to_app("provider_error")
        problem = validate_id_token(claims, cfg, doc["issuer"], pending["nonce"])
        if problem:
            print(f"[OAuth] id_token de {pid} rechazado: {problem}", file=sys.stderr)
            return back_to_app("invalid_token")
        email = str(claims.get("email", "")).strip().lower()
        if not EMAIL_RE.match(email) or claims.get("email_verified") not in (True, "true"):
            return back_to_app("email_unverified")
        result = await run_in_threadpool(
            db.oauth_user, pid, str(claims["sub"]), email, str(claims.get("name") or claims.get("given_name") or ""),
            settings.get("auth_registration_enabled"), claims.get("email_verified") in (True, "true"),
        )
        if "error" in result:
            return back_to_app(result["error"])
        token = await run_in_threadpool(db.create_session, result["user"]["id"])
        return with_session(back_to_app(), token)

    return [
        Route("/api/auth/providers", providers, methods=["GET"]),
        Route("/api/auth/register", register, methods=["POST"]),
        Route("/api/auth/login", login, methods=["POST"]),
        Route("/api/auth/logout", logout, methods=["POST"]),
        Route("/api/auth/me", me, methods=["GET", "DELETE"]),
        Route("/api/auth/oauth/{provider}/start", oauth_start, methods=["GET"]),
        Route("/api/auth/oauth/{provider}/callback", oauth_callback, methods=["GET"]),
        Route("/api/data", data, methods=["GET", "PUT"]),
    ]
