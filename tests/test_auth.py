"""Tests de usuarios, sesiones, inicio de sesión con Google/Okta y API de administración."""
import json
import os
import sys
import tempfile
import time
import unittest
from contextlib import closing
from unittest import mock
from urllib.parse import parse_qs, urlsplit

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import admin, auth, db, http, settings  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

BACKUP = {"app": "PaperPulse", "schemaVersion": 3, "account": {"hasPracticeAccount": True, "initialCapitalUsd": 1000, "balanceUsd": 900}}
GOOGLE_DOC = {
    "issuer": "https://accounts.google.com",
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
}


def fake_id_token(claims):
    enc = lambda d: auth._b64url(json.dumps(d).encode())
    return f"{enc({'alg': 'RS256'})}.{enc(claims)}.firma"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False  # nunca contra una base remota, aunque .env defina Turso
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        http._LIMITS.clear()
        settings._cache["time"] = 0
        db.init_db()
        app = Starlette(routes=auth.build_routes(lambda r: "1.2.3.4") + admin.routes)
        self.client = TestClient(app, base_url="http://testserver")

    def tearDown(self):
        self.client.close()
        self.tmp.cleanup()

    def register(self, email="ana@example.com", password="secreto123", client=None, terms=True):
        return (client or self.client).post("/api/auth/register", json={
            "email": email, "password": password, "name": "Ana", "acceptTerms": terms, "ageConfirmed": terms})

    def make_admin(self, email="ana@example.com"):
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET role = 'admin' WHERE email = ?", (email,))


class SessionTest(Base):
    def test_password_hash_roundtrip(self):
        h = db.hash_password("clave-segura")
        self.assertTrue(h.startswith("scrypt$"))
        self.assertTrue(db.verify_password("clave-segura", h))
        self.assertFalse(db.verify_password("otra", h))
        self.assertFalse(db.verify_password("x", "basura"))

    def test_register_login_logout(self):
        r = self.register()
        self.assertEqual(r.status_code, 201)
        self.assertIn("httponly", r.headers["set-cookie"].lower())
        self.assertIn("samesite=strict", r.headers["set-cookie"].lower())
        me = self.client.get("/api/auth/me").json()["user"]
        self.assertEqual((me["email"], me["role"], me["hasPassword"]), ("ana@example.com", "user", True))
        self.assertEqual(self.register().status_code, 409)  # email duplicado
        self.client.post("/api/auth/logout")
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "ANA@example.com", "password": "mala-clave"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "ANA@example.com", "password": "secreto123"}).status_code, 200)

    def test_validation_and_csrf(self):
        self.assertEqual(self.register(email="no-es-email").status_code, 400)
        self.assertEqual(self.register(password="corta").status_code, 400)
        self.assertEqual(self.client.post("/api/auth/login", content="email=a", headers={"Content-Type": "application/x-www-form-urlencoded"}).status_code, 415)
        evil = self.client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"}, headers={"Origin": "https://evil.example"})
        self.assertEqual(evil.status_code, 403)

    def test_rate_limit(self):
        codes = [self.client.post("/api/auth/login", json={"email": "x@y.co", "password": "nope"}).status_code for _ in range(12)]
        self.assertIn(429, codes)

    def test_practice_data_sync(self):
        self.assertEqual(self.client.get("/api/data").status_code, 401)
        self.register()
        self.assertIsNone(self.client.get("/api/data").json()["data"])
        self.assertEqual(self.client.put("/api/data", json={"data": {"app": "Otra"}}).status_code, 400)
        self.assertEqual(self.client.put("/api/data", json={"data": BACKUP}).json()["revision"], 1)
        self.assertEqual(self.client.put("/api/data", json={"data": BACKUP}).json()["revision"], 2)
        self.assertEqual(self.client.get("/api/data").json()["data"]["account"]["balanceUsd"], 900)

    def test_delete_account_cascades(self):
        self.register()
        self.client.put("/api/data", json={"data": BACKUP})
        self.assertEqual(self.client.request("DELETE", "/api/auth/me", json={"password": "mala"}).status_code, 401)
        self.assertEqual(self.client.request("DELETE", "/api/auth/me", json={"password": "secreto123"}).status_code, 200)
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM practice_data").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 0)

    def test_settings_can_close_registration_and_password_login(self):
        settings.save({"auth_registration_enabled": False}, None)
        self.assertEqual(self.register().status_code, 403)
        settings.save({"auth_registration_enabled": True}, None)
        self.assertEqual(self.register().status_code, 201)
        settings.save({"auth_password_enabled": False}, None)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "ana@example.com", "password": "secreto123"}).status_code, 403)
        self.assertFalse(self.client.get("/api/auth/providers").json()["password"])

    def test_disabled_user_loses_session(self):
        self.register()
        uid = self.client.get("/api/auth/me").json()["user"]["id"]
        db.update_user(uid, disabled=True)
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "ana@example.com", "password": "secreto123"}).status_code, 401)

    def test_admin_emails_no_promueve_al_registrarse_con_contrasena(self):
        with mock.patch.object(db, "ADMIN_EMAILS", {"jefa@example.com"}):
            self.register(email="jefa@example.com")
        me = self.client.get("/api/auth/me").json()["user"]
        self.assertEqual((me["role"], me["emailVerified"]), ("user", False))


class OAuthTest(Base):
    def configure_google(self):
        settings.save({"oauth_google_enabled": True, "oauth_google_client_id": "cid.apps.googleusercontent.com",
                       "oauth_google_client_secret": "secreto-de-google"}, None)
        auth._DISCOVERY.clear()

    def login_with_google(self, claims_override=None, tamper_state=False):
        with mock.patch.object(auth, "discovery", return_value=GOOGLE_DOC):
            start = self.client.get("/api/auth/oauth/google/start", follow_redirects=False)
            self.assertEqual(start.status_code, 302)
            url = urlsplit(start.headers["location"])
            params = {k: v[0] for k, v in parse_qs(url.query).items()}
            self.assertEqual(f"{url.scheme}://{url.netloc}{url.path}", GOOGLE_DOC["authorization_endpoint"])
            self.assertEqual(params["code_challenge_method"], "S256")
            self.assertEqual(params["redirect_uri"], "http://testserver/api/auth/oauth/google/callback")
            claims = {"iss": GOOGLE_DOC["issuer"], "aud": "cid.apps.googleusercontent.com", "exp": time.time() + 300,
                      "nonce": params["nonce"], "sub": "google-123", "email": "luis@gmail.com", "email_verified": True, "name": "Luis"}
            claims.update(claims_override or {})
            with mock.patch.object(auth, "exchange_code", return_value={"id_token": fake_id_token(claims)}) as ex:
                state = params["state"] + ("x" if tamper_state else "")
                cb = self.client.get(f"/api/auth/oauth/google/callback?code=abc&state={state}", follow_redirects=False)
                if not tamper_state:
                    self.assertEqual(ex.call_args.args[3] and len(ex.call_args.args[3]) > 40, True)  # code_verifier PKCE
            return cb

    def test_providers_hidden_until_configured(self):
        self.assertEqual(self.client.get("/api/auth/providers").json()["providers"], [])
        self.configure_google()
        self.assertEqual(self.client.get("/api/auth/providers").json()["providers"], [{"id": "google", "name": "Google"}])
        r = self.client.get("/api/auth/oauth/okta/start", follow_redirects=False)
        self.assertIn("auth_error=provider_disabled", r.headers["location"])

    def test_google_login_creates_and_reuses_user(self):
        self.configure_google()
        cb = self.login_with_google()
        self.assertEqual(cb.status_code, 302)
        self.assertEqual(cb.headers["location"], "/#/dashboard")
        me = self.client.get("/api/auth/me").json()["user"]
        self.assertEqual((me["email"], me["hasPassword"]), ("luis@gmail.com", False))
        self.client.post("/api/auth/logout")
        self.login_with_google()
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["id"], me["id"])
        # Sin contraseña: borrar la cuenta exige la confirmación escrita
        self.assertEqual(self.client.request("DELETE", "/api/auth/me", json={}).status_code, 400)
        self.assertEqual(self.client.request("DELETE", "/api/auth/me", json={"confirm": "eliminar"}).status_code, 200)

    def test_google_links_existing_password_account(self):
        self.register(email="luis@gmail.com")
        self.client.post("/api/auth/logout")
        self.configure_google()
        self.login_with_google()
        users = db.list_users()["users"]
        self.assertEqual(len(users), 1)
        # Pre-registro: la cuenta de email y contraseña sin verificar pierde la contraseña al vincular Google
        self.assertEqual(users[0]["providers"], ["google"])
        self.assertTrue(db.get_user(users[0]["id"])["emailVerified"])
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "luis@gmail.com", "password": "secreto123"}).status_code, 401)

    def test_rejects_bad_state_nonce_and_unverified_email(self):
        self.configure_google()
        self.assertIn("invalid_state", self.login_with_google(tamper_state=True).headers["location"])
        self.assertIn("invalid_token", self.login_with_google({"nonce": "otro"}).headers["location"])
        self.assertIn("invalid_token", self.login_with_google({"aud": "otra-app"}).headers["location"])
        self.assertIn("email_unverified", self.login_with_google({"email_verified": False}).headers["location"])
        self.assertIsNone(self.client.get("/api/auth/me").json()["user"])

    def test_state_is_single_use(self):
        self.configure_google()
        db.save_oauth_state("estado", "google", "verificador", "nonce")
        self.assertIsNotNone(db.pop_oauth_state("estado"))
        self.assertIsNone(db.pop_oauth_state("estado"))

    def test_registration_closed_blocks_new_oauth_users(self):
        self.configure_google()
        settings.save({"auth_registration_enabled": False}, None)
        self.assertIn("registration_closed", self.login_with_google().headers["location"])


class AdminTest(Base):
    def test_requires_admin(self):
        self.assertEqual(self.client.get("/api/admin/overview").status_code, 401)
        self.register()
        self.assertEqual(self.client.get("/api/admin/overview").status_code, 403)
        self.make_admin()
        r = self.client.get("/api/admin/overview")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["users"]["users"], 1)

    def test_settings_never_leak_secrets(self):
        self.register()
        self.make_admin()
        r = self.client.put("/api/admin/settings", json={"values": {"anthropic_api_key": "sk-ant-muy-secreta-1234", "anthropic_model": "claude-haiku-5-5"}})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("sk-ant-muy-secreta", r.text)
        view = r.json()["settings"]["anthropic_api_key"]
        self.assertEqual((view["configured"], view["hint"], view["source"]), (True, "••••1234", "panel"))
        self.assertEqual(settings.get("anthropic_api_key"), "sk-ant-muy-secreta-1234")
        self.assertIn("/api/auth/oauth/okta/callback", r.json()["redirectUris"]["okta"])
        # Validación
        self.assertEqual(self.client.put("/api/admin/settings", json={"values": {"nada": 1}}).status_code, 400)
        self.assertEqual(self.client.put("/api/admin/settings", json={"values": {"oauth_okta_issuer": "http://inseguro"}}).status_code, 400)
        self.assertEqual(self.client.put("/api/admin/settings", json={"values": {"stock_data_provider": "otro"}}).status_code, 400)
        # null vuelve al valor de .env
        self.client.put("/api/admin/settings", json={"values": {"anthropic_api_key": None}})
        self.assertNotEqual(settings.source("anthropic_api_key"), "panel")

    def test_settings_require_same_origin(self):
        self.register()
        self.make_admin()
        r = self.client.put("/api/admin/settings", json={"values": {}}, headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 403)

    def test_manage_users(self):
        self.register()
        self.make_admin()
        other = TestClient(self.client.app, base_url="http://testserver")
        self.register(email="bea@example.com", client=other)
        bea = next(u for u in self.client.get("/api/admin/users?q=bea").json()["users"])
        me = self.client.get("/api/auth/me").json()["user"]
        # No puede degradarse a sí mismo ni quedar sin administradores
        self.assertEqual(self.client.patch(f"/api/admin/users/{me['id']}", json={"role": "user"}).status_code, 400)
        self.assertEqual(self.client.request("DELETE", f"/api/admin/users/{me['id']}").status_code, 400)
        # Desactivar cierra sus sesiones
        self.assertTrue(self.client.patch(f"/api/admin/users/{bea['id']}", json={"disabled": True}).json()["user"]["disabled"])
        self.assertIsNone(other.get("/api/auth/me").json()["user"])
        # Sin email verificado no se puede dar el rol de administrador (ni desde el panel)
        self.assertEqual(self.client.patch(f"/api/admin/users/{bea['id']}", json={"role": "admin", "disabled": False}).status_code, 400)
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (bea["id"],))
        self.assertEqual(self.client.patch(f"/api/admin/users/{bea['id']}", json={"role": "admin", "disabled": False}).json()["user"]["role"], "admin")
        self.assertEqual(self.client.request("DELETE", f"/api/admin/users/{bea['id']}", json={}).status_code, 400)  # sin confirmar el email
        self.assertEqual(self.client.request("DELETE", f"/api/admin/users/{bea['id']}", json={"confirmEmail": bea["email"]}).status_code, 200)
        self.assertEqual(self.client.get("/api/admin/users").json()["total"], 1)
        other.close()


if __name__ == "__main__":
    unittest.main()
