"""Cumplimiento legal: aceptación de términos y edad, descarga de datos y borrado con anonimización."""
import os
import sys
import time
import unittest
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import account, auth, db, http  # noqa: E402
from backend.community import api as community_api, forum, moderation, profiles  # noqa: E402
from backend.community.common import Forbidden  # noqa: E402
from backend.retention import api as retention_api, notifications  # noqa: E402
from backend.trading import api as trading_api, ledger  # noqa: E402
from test_community import Base as CommunityBase  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


class Base(CommunityBase):
    def client(self, uid=None):
        app = Starlette(routes=auth.build_routes(lambda r: "9.9.9.9") + community_api.routes + trading_api.routes + retention_api.routes + account.routes)
        c = TestClient(app, base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def row(self, sql, *args):
        with closing(db.connect()) as conn:
            r = conn.execute(sql, args).fetchone()
            return dict(r) if r else None

    def google_user(self, email="nuevo@gmail.com"):
        """Cuenta creada al entrar con Google: email verificado y términos SIN aceptar."""
        return db.oauth_user("google", f"sub-{email}", email, "Nuevo", True, True)["user"]


class TermsTest(Base):
    REG = {"email": "ana@example.com", "password": "secreto123", "name": "Ana"}

    def test_el_registro_exige_terminos_y_mayoria_de_edad_minima(self):
        c = self.client()
        for extra in ({}, {"acceptTerms": True}, {"acceptTerms": "yes", "ageConfirmed": True}):
            r = c.post("/api/auth/register", json={**self.REG, **extra})
            self.assertEqual(r.status_code, 400, extra)
            self.assertIn("14 años", r.json()["error"])
        self.assertEqual(db.list_users()["total"], 0)  # no se crea nada sin aceptar
        before = int(time.time())
        r = c.post("/api/auth/register", json={**self.REG, "acceptTerms": True, "ageConfirmed": True})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(r.json()["user"]["termsVersion"], account.LEGAL_VERSION)
        row = self.row("SELECT terms_version, terms_accepted_at, age_confirmed_at FROM users WHERE email = 'ana@example.com'")
        self.assertEqual(row["terms_version"], account.LEGAL_VERSION)
        self.assertGreaterEqual(row["terms_accepted_at"], before)
        self.assertGreaterEqual(row["age_confirmed_at"], before)

    def test_cuenta_nueva_de_google_no_participa_ni_opera_hasta_aceptar(self):
        user = self.google_user()
        self.assertIsNone(user["termsVersion"])
        with db.transaction() as conn:
            conn.execute("INSERT INTO profiles (user_id, alias, created_at, updated_at) VALUES (?, 'Nuevo', 1, 1)", (user["id"],))
        with self.assertRaisesRegex(Forbidden, "Acepta los términos"):
            forum.create_thread(user["id"], "novatos", "Mi primera duda", "¿Cómo empiezo?")
        c = self.client(user["id"])
        order = {"clientOrderId": "google-0001", "symbol": "BTC", "side": "buy", "type": "market", "quantity": "0.1"}
        self.assertEqual(c.post("/api/orders", json=order).status_code, 403)
        self.assertEqual(c.post("/api/account/terms", json={"acceptTerms": True}).status_code, 400)  # falta la edad
        r = c.post("/api/account/terms", json={"acceptTerms": True, "ageConfirmed": True})
        self.assertEqual((r.status_code, r.json()["user"]["termsVersion"]), (200, account.LEGAL_VERSION))
        self.assertEqual(c.post("/api/orders", json=order).status_code, 409)  # aún falta elegir el saldo de la cuenta de práctica
        self.assertEqual(c.post("/api/portfolio/start", json={"amount": 1000, "currency": "EUR"}).status_code, 201)
        self.assertEqual(c.post("/api/orders", json=order).status_code, 201)
        forum.create_thread(user["id"], "novatos", "Mi primera duda", "¿Cómo empiezo?")

    def test_cuentas_anteriores_quedan_como_legacy_y_no_se_bloquean(self):
        uid = self.user("Vieja")
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET terms_version = 'legacy', terms_accepted_at = NULL WHERE id = ?", (uid,))
        self.thread(uid)  # puede seguir participando
        self.assertEqual(self.client(uid).post("/api/account/terms", json={"acceptTerms": True, "ageConfirmed": True}).json()["user"]["termsVersion"], account.LEGAL_VERSION)

    def test_la_version_del_servidor_coincide_con_la_del_frontend(self):
        js = open(os.path.join(os.path.dirname(__file__), "..", "frontend", "js", "lib", "legal-content.js"), encoding="utf-8").read()
        self.assertIn(f"LEGAL_VERSION = '{account.LEGAL_VERSION}'", js)


class ExportTest(Base):
    def test_descarga_todo_lo_propio_y_nada_ajeno(self):
        ana, luis = self.user("Ana"), self.user("Luis")
        self.buy(ana, "ana-0001")
        tid = self.thread(ana, title="Mi hilo de prueba")
        forum.reply(luis, tid, "Respuesta de Luis, ajena a Ana")
        profiles.follow(ana, "Luis", True)
        profiles.follow(luis, "Ana", True)
        with db.transaction() as conn:
            notifications.notify(conn, ana, "reply", "Aviso", "texto")
        r = self.client(ana).get("/api/account/export")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r.headers["content-disposition"])
        data = r.json()
        self.assertEqual(data["account"]["email"], "ana@example.com")
        self.assertEqual((data["profile"]["alias"], len(data["serverAccount"]["fills"]), len(data["serverAccount"]["positions"])), ("Ana", 1, 1))
        self.assertEqual([t["title"] for t in data["forum"]["threads"]], ["Mi hilo de prueba"])
        self.assertEqual(data["following"], ["Luis"])
        self.assertEqual(data["followersCount"], 1)
        text = r.text
        self.assertNotIn("luis@example.com", text)  # emails ajenos
        self.assertNotIn("Respuesta de Luis", text)  # mensajes ajenos
        self.assertNotIn("scrypt$", text)  # hashes de contraseña
        self.assertNotIn("password_hash", text)
        self.assertEqual(self.client().get("/api/account/export").status_code, 401)

    def test_limite_de_descargas(self):
        c = self.client(self.user("Ana"))
        codes = [c.get("/api/account/export").status_code for _ in range(5)]
        self.assertEqual(codes[:3], [200, 200, 200])
        self.assertEqual(codes[3], 429)


class DeleteAccountTest(Base):
    def setUp(self):
        super().setUp()
        self.ana, self.luis, self.admin = self.user("Ana"), self.user("Luis"), self.user("Jefa", admin=True)
        self.buy(self.ana, "ana-0001", qty="2")
        self.fill = self.sell(self.ana, "ana-0002")
        self.tid = self.thread(self.ana, title="Hilo con datos personales")
        self.reply = forum.reply(self.luis, self.tid, "Mi respuesta, que debe seguir existiendo")["postId"]
        self.own_post = forum.reply(self.ana, self.tid, "Mi segundo mensaje con mi nombre real")["postId"]
        self.trade_thread = forum.share_fill(self.ana, self.fill, "Salí con beneficio")["threadId"]
        forum.reply(self.luis, self.trade_thread, "Enhorabuena")
        first = self.scalar("SELECT first_post_id FROM threads WHERE id = ?", self.tid)
        forum.vote(self.ana, self.reply, 1)  # voto de Ana al mensaje de Luis
        forum.vote(self.luis, first, 1)
        profiles.follow(self.ana, "Luis", True)
        forum.report(self.luis, self.own_post, "spam", "")
        self.client(self.ana).post("/api/challenge/join")
        db.put_data(self.ana, '{"app":"PaperPulse"}')
        with db.transaction() as conn:
            notifications.notify(conn, self.ana, "reply", "Aviso privado", "texto")

    def test_borrar_anonimiza_y_deja_el_foro_integro(self):
        c = self.client(self.ana)
        self.assertEqual(c.request("DELETE", "/api/auth/me", json={"password": "mala"}).status_code, 401)
        self.assertEqual(c.request("DELETE", "/api/auth/me", json={"password": "secreto123"}).status_code, 200)
        row = self.row("SELECT * FROM users WHERE id = ?", self.ana)
        self.assertEqual((row["email"], row["name"], row["password_hash"], row["disabled"], row["role"]),
                         (f"eliminado-{self.ana}@eliminado.invalid", "Usuario eliminado", "", 1, "user"))
        self.assertIsNotNone(row["deleted_at"])
        self.assertIsNone(row["terms_version"])
        # Datos personales y de trading fuera
        for table in ("profiles", "practice_data", "notifications", "achievements", "trading_days", "accounts", "positions", "orders", "fills",
                      "challenge_entries", "sessions", "identities", "equity_snapshots", "onboarding"):
            self.assertEqual(self.scalar(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", self.ana), 0, table)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM users WHERE owner_id = ?", self.ana), 0)  # cuenta del reto
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM follows WHERE follower_id = ? OR followee_id = ?", self.ana, self.ana), 0)
        # Integridad del foro: lo de otras personas sigue ahí
        page = forum.get_thread(self.tid, "recent", 1, self.luis, False)
        self.assertEqual(page["thread"]["status"], "deleted")
        self.assertEqual(page["thread"]["title"], "Hilo eliminado")
        bodies = {p["id"]: p["body"] for p in page["replies"]}
        self.assertEqual(bodies[self.reply], "Mi respuesta, que debe seguir existiendo")
        self.assertIsNone(bodies[self.own_post])  # el suyo, vaciado
        self.assertEqual(self.scalar("SELECT body FROM posts WHERE id = ?", self.own_post), "")
        self.assertIsNone(page["firstPost"]["author"])  # sin alias: «Usuario eliminado»
        trade = forum.get_thread(self.trade_thread, "recent", 1, self.luis, False)  # el hilo de la operación compartida y la respuesta de Luis siguen
        self.assertEqual([p["body"] for p in trade["replies"]], ["Enhorabuena"])
        self.assertIsNone(self.scalar("SELECT fill_id FROM threads WHERE id = ?", self.trade_thread))
        # Su voto a un mensaje de otra persona ya no cuenta; el voto de Luis a su hilo desapareció con el hilo del que cuelga
        self.assertEqual(self.scalar("SELECT score FROM posts WHERE id = ?", self.reply), 0)
        # La denuncia que Luis hizo conserva el rastro sin el texto de Ana
        self.assertIsNone(self.scalar("SELECT post_body FROM reports WHERE post_id = ?", self.own_post))

    def test_no_puede_volver_a_entrar_y_el_email_y_el_alias_quedan_libres(self):
        db.delete_user(self.ana)
        self.assertIsNone(db.authenticate("ana@example.com", "secreto123"))
        self.assertIsNone(self.client(self.ana).get("/api/auth/me").json()["user"])  # sesiones fuera
        again = db.create_user("ana@example.com", "otra-clave-1", "Ana de nuevo")
        self.assertIsNotNone(again)
        self.assertNotEqual(again["id"], self.ana)
        profiles.save_mine(again["id"], {"alias": "Ana"})  # el alias se puede reutilizar
        self.assertEqual(db.list_users("ana")["total"], 1)  # el tombstone no sale en el panel
        self.assertNotIn(self.ana, [u["id"] for u in db.list_users()["users"]])

    def test_borrar_desde_el_panel_tambien_conserva_el_foro(self):
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (self.admin,))
        self.assertEqual(self.client(self.admin).request("DELETE", f"/api/admin/users/{self.luis}").status_code, 404)  # sin ese router aquí: ver test_auth
        db.delete_user(self.luis)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM threads WHERE id = ?", self.tid), 1)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM posts WHERE thread_id = ?", self.tid), 3)  # mensajes de Ana intactos; el de Luis, vaciado
        self.assertEqual(self.scalar("SELECT body FROM posts WHERE id = ?", self.reply), "")

    def test_la_cuenta_del_reto_no_se_puede_borrar_por_error(self):
        shadow = self.scalar("SELECT id FROM users WHERE owner_id = ?", self.ana)
        db.delete_user(shadow)  # una cuenta sombra no es una cuenta de usuario: no se anonimiza
        self.assertEqual(self.scalar("SELECT deleted_at IS NULL FROM users WHERE id = ?", shadow), 1)


if __name__ == "__main__":
    unittest.main()
