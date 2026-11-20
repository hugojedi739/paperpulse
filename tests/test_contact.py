"""Formulario de contacto: guardado, límites de longitud y de peticiones, honeypot, bandeja de admin y ausencia de correos."""
import os
import re
import sys
import time
import unittest
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import account, admin, contact, db, http, security  # noqa: E402
from test_community import Base as CommunityBase  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
ROOT = os.path.join(os.path.dirname(__file__), "..")
OK = {"reason": "Una duda", "message": "¿Cómo reinicio mi cuenta de práctica?"}


class Base(CommunityBase):
    def setUp(self):
        super().setUp()
        security.IP_CONTACT_CALLS.clear()

    def client(self, uid=None):
        c = TestClient(Starlette(routes=contact.routes + admin.routes), base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def count(self):
        with closing(db.connect()) as conn:
            return conn.execute("SELECT COUNT(*) FROM contact_messages").fetchone()[0]


class SaveTest(Base):
    def test_el_mensaje_se_guarda_con_fecha_y_sin_usuario_si_no_hay_sesion(self):
        before = int(time.time())
        r = self.client().post("/api/contact", json=OK)
        self.assertEqual((r.status_code, r.json()), (201, {"ok": True}))
        with closing(db.connect()) as conn:
            row = dict(conn.execute("SELECT * FROM contact_messages").fetchone())
        self.assertEqual((row["reason"], row["message"], row["user_id"], row["read_at"]), (OK["reason"], OK["message"], None, None))
        self.assertGreaterEqual(row["created_at"], before)

    def test_con_sesion_se_guarda_el_usuario_y_el_admin_solo_ve_su_alias(self):
        uid = self.user("Ana")
        self.assertEqual(self.client(uid).post("/api/contact", json=OK).status_code, 201)
        admin_id = self.user("Jefe", admin=True)
        r = self.client(admin_id).get("/api/admin/messages")
        item = r.json()["items"][0]
        self.assertEqual(item["user"], {"id": uid, "alias": "Ana"})
        self.assertEqual((item["message"], item["read"], r.json()["unread"]), (OK["message"], False, 1))

    def test_el_texto_se_guarda_tal_cual_sin_caracteres_de_control(self):
        self.client().post("/api/contact", json={"reason": "<b>x</b> ‮ hola", "message": "<script>alert(1)</script>\x00 hola mundo"})
        with closing(db.connect()) as conn:
            row = conn.execute("SELECT reason, message FROM contact_messages").fetchone()
        self.assertEqual((row["reason"], row["message"]), ("<b>x</b> hola", "<script>alert(1)</script> hola mundo"))

    def test_origen_ajeno_y_contenido_no_json_se_rechazan(self):
        c = self.client()
        self.assertEqual(c.post("/api/contact", json=OK, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(c.post("/api/contact", content="reason=a", headers={"Content-Type": "text/plain"}).status_code, 415)
        self.assertEqual(self.count(), 0)


class LimitsTest(Base):
    def test_limites_de_longitud(self):
        c = self.client()
        bad = [
            {"reason": "ab", "message": OK["message"]},                      # motivo corto
            {"reason": "x" * 101, "message": OK["message"]},                 # motivo largo
            {"reason": OK["reason"], "message": "corto"},                    # mensaje corto
            {"reason": OK["reason"], "message": "x" * 2001},                 # mensaje largo
            {"reason": OK["reason"], "message": 12345678901},                # no es texto
            {"message": OK["message"]},                                      # sin motivo
        ]
        for body in bad:
            security.IP_CONTACT_CALLS.clear()  # aquí se prueba la longitud, no el límite por IP
            self.assertEqual(c.post("/api/contact", json=body).status_code, 400, str(body)[:80])
        self.assertEqual(self.count(), 0)
        security.IP_CONTACT_CALLS.clear()
        self.assertEqual(c.post("/api/contact", json={"reason": "x" * 100, "message": "y" * 2000}).status_code, 201)  # justo en el límite
        security.IP_CONTACT_CALLS.clear()
        self.assertEqual(c.post("/api/contact", json={"reason": "hola", "message": "z" * 20000}).status_code, 413)  # cuerpo enorme

    def test_limite_de_peticiones_por_ip(self):
        c = self.client()
        codes = [c.post("/api/contact", json={**OK, "message": f"{OK['message']} {i}"}).status_code for i in range(contact.PER_MINUTE + 2)]
        self.assertEqual(codes, [201] * contact.PER_MINUTE + [429, 429])
        self.assertEqual(self.count(), contact.PER_MINUTE)
        security.IP_CONTACT_CALLS.clear()  # pasa el minuto
        self.assertEqual(c.post("/api/contact", json=OK).status_code, 201)

    def test_tope_global_por_hora_en_la_base_de_datos(self):
        now = int(time.time())
        with db.transaction() as conn:
            conn.executemany("INSERT INTO contact_messages (reason, message, created_at) VALUES ('antes', 'mensaje de prueba', ?)", [(now,)] * contact.PER_HOUR_GLOBAL)
        self.assertEqual(self.client().post("/api/contact", json=OK).status_code, 429)


class HoneypotTest(Base):
    def test_el_campo_trampa_descarta_el_mensaje_sin_avisar_al_bot(self):
        r = self.client().post("/api/contact", json={**OK, contact.HONEYPOT: "https://spam.example"})
        self.assertEqual((r.status_code, r.json()), (201, {"ok": True}))
        self.assertEqual(self.count(), 0)

    def test_el_campo_trampa_vacio_no_molesta(self):
        self.assertEqual(self.client().post("/api/contact", json={**OK, contact.HONEYPOT: ""}).status_code, 201)
        self.assertEqual(self.count(), 1)


class AdminTest(Base):
    def setUp(self):
        super().setUp()
        self.admin = self.client(self.user("Jefe", admin=True))
        self.client().post("/api/contact", json=OK)
        self.mid = self.admin.get("/api/admin/messages").json()["items"][0]["id"]

    def test_solo_los_admins_ven_los_mensajes(self):
        for c, code in ((self.client(), 401), (self.client(self.user("Pepe")), 403)):
            self.assertEqual(c.get("/api/admin/messages").status_code, code)
            self.assertEqual(c.patch(f"/api/admin/messages/{self.mid}", json={"read": True}).status_code, code)
            self.assertEqual(c.delete(f"/api/admin/messages/{self.mid}").status_code, code)
        self.assertEqual(self.count(), 1)

    def test_marcar_como_leido_y_filtrar(self):
        self.assertEqual(self.admin.patch(f"/api/admin/messages/{self.mid}", json={"read": True}).status_code, 200)
        self.assertEqual(self.admin.get("/api/admin/messages?status=unread").json()["items"], [])
        data = self.admin.get("/api/admin/messages?status=read").json()
        self.assertEqual((len(data["items"]), data["items"][0]["read"], data["unread"]), (1, True, 0))
        self.assertEqual(self.admin.patch(f"/api/admin/messages/{self.mid}", json={"read": False}).json()["read"], False)
        self.assertEqual(self.admin.get("/api/admin/messages?status=unread").json()["total"], 1)
        self.assertEqual(self.admin.patch(f"/api/admin/messages/{self.mid}", json={"read": "si"}).status_code, 400)
        self.assertEqual(self.admin.patch("/api/admin/messages/9999", json={"read": True}).status_code, 404)

    def test_borrar(self):
        self.assertEqual(self.admin.delete(f"/api/admin/messages/{self.mid}").status_code, 200)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.admin.delete(f"/api/admin/messages/{self.mid}").status_code, 404)

    def test_el_resumen_cuenta_los_no_leidos(self):
        self.assertEqual(self.admin.get("/api/admin/overview").json()["unreadMessages"], 1)

    def test_eliminar_la_cuenta_borra_sus_mensajes_y_la_descarga_los_incluye(self):
        uid = self.user("Luis")
        self.client(uid).post("/api/contact", json={**OK, "message": "Mensaje de Luis con sesión iniciada"})
        self.assertEqual(self.count(), 2)
        exported = account.export_data(uid)
        self.assertEqual([m["message"] for m in exported["contactMessages"]], ["Mensaje de Luis con sesión iniciada"])
        account.delete_account(uid)
        self.assertEqual(self.count(), 1)  # queda el anónimo


class NoEmailsTest(Base):
    def test_ninguna_respuesta_contiene_un_correo(self):
        uid = self.user("Marta")  # su cuenta tiene un email: no debe salir en ninguna respuesta
        admin_c = self.client(self.user("Jefe", admin=True))
        user_c, anon = self.client(uid), self.client()
        responses = [
            anon.post("/api/contact", json=OK), user_c.post("/api/contact", json={**OK, "message": "Mensaje de Marta con sesión"}),
            anon.post("/api/contact", json={"reason": "a", "message": "b"}), anon.post("/api/contact", json={**OK, contact.HONEYPOT: "x"}),
            admin_c.get("/api/admin/messages"), admin_c.get("/api/admin/messages?status=unread"),
        ]
        responses.append(admin_c.patch(f"/api/admin/messages/{responses[4].json()['items'][0]['id']}", json={"read": True}))
        for r in responses:
            self.assertIsNone(EMAIL_RE.search(r.text), r.text)
        self.assertGreater(len(responses[4].json()["items"]), 0)

    def test_la_web_y_los_textos_legales_no_publican_ningun_correo(self):
        """Frontend servido (sin vendor ni sprite) y textos legales: ninguna dirección de correo."""
        found = []
        for base, _, files in os.walk(os.path.join(ROOT, "frontend")):
            if os.sep + "vendor" in base:
                continue
            for name in files:
                if name.endswith((".js", ".html", ".css", ".json", ".webmanifest")):
                    with open(os.path.join(base, name), encoding="utf-8") as fh:
                        found += [(name, m.group(0)) for m in EMAIL_RE.finditer(fh.read())]
        self.assertEqual(found, [])
        with open(os.path.join(ROOT, "frontend/js/lib/legal-content.js"), encoding="utf-8") as fh:
            self.assertNotIn("mailto:", fh.read())


if __name__ == "__main__":
    unittest.main()


class RetentionTest(Base):
    def test_el_cron_borra_mensajes_y_registros_de_mas_de_un_ano_o_dos(self):
        from backend import admin_log
        old = int(time.time()) - (contact.RETENTION_DAYS + 1) * 86400
        old_log = int(time.time()) - (admin_log.RETENTION_DAYS + 1) * 86400
        with closing(db.connect()) as conn:
            conn.execute("INSERT INTO contact_messages (user_id, reason, message, created_at) VALUES (NULL, 'viejo', 'mensaje antiguo', ?)", (old,))
            conn.execute("INSERT INTO contact_messages (user_id, reason, message, created_at) VALUES (NULL, 'nuevo', 'mensaje reciente', ?)", (int(time.time()),))
            conn.execute("INSERT INTO admin_log (action, created_at) VALUES ('viejo', ?)", (old_log,))
            conn.execute("INSERT INTO admin_log (action, created_at) VALUES ('nuevo', ?)", (int(time.time()),))
            conn.execute("INSERT INTO moderation_log (action, target_type, target_id, created_at) VALUES ('viejo', 'post', 1, ?)", (old_log,))
        out = {**contact.cleanup(), **admin_log.cleanup()}
        self.assertEqual((out["contactMessagesDeleted"], out["adminLogDeleted"], out["moderationLogDeleted"]), (1, 1, 1))
        self.assertEqual(self.count(), 1)
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM admin_log WHERE action = 'nuevo'").fetchone()[0], 1)
