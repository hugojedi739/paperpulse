"""Paquete B del panel: contadores de las pestañas y ficha del autor en las denuncias."""
import os
import sys
import time
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import admin, db, http  # noqa: E402
from backend.community import forum, moderation  # noqa: E402
from test_community import Base  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


class ModerationPanelTest(Base):
    def setUp(self):
        super().setUp()
        self.admin, self.autor = self.user("Jefa", admin=True), self.user("Autor", days_old=40)
        self.otro, self.tercero = self.user("Otro"), self.user("Tercero")
        self.tid = self.thread(self.autor)
        self.pid = forum.reply(self.autor, self.tid, "Compra ya esta moneda, es seguro x100")["postId"]

    def client(self, uid=None):
        c = TestClient(Starlette(routes=admin.routes), base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    # ---- contadores
    def test_contadores_solo_para_admins(self):
        self.assertEqual(self.client().get("/api/admin/badges").status_code, 401)
        self.assertEqual(self.client(self.otro).get("/api/admin/badges").status_code, 403)
        self.assertEqual(self.client(self.admin).get("/api/admin/badges").json(), {"openReports": 0, "unreadMessages": 0})

    def test_contadores_cuentan_mensajes_denunciados_no_denuncias_y_los_sin_leer(self):
        forum.report(self.otro, self.pid, "spam", "")
        forum.report(self.tercero, self.pid, "estafa", "")  # dos denuncias, un mensaje
        other = forum.reply(self.autor, self.tid, "Otro mensaje")["postId"]
        forum.report(self.otro, other, "abuso", "")
        with closing(db.connect()) as conn:
            for i in range(3):
                conn.execute("INSERT INTO contact_messages (reason, message, created_at) VALUES ('Duda', 'texto de prueba', ?)", (int(time.time()),))
            conn.execute("UPDATE contact_messages SET read_at = ? WHERE id = (SELECT MIN(id) FROM contact_messages)", (int(time.time()),))
        self.assertEqual(self.client(self.admin).get("/api/admin/badges").json(), {"openReports": 2, "unreadMessages": 2})

    def test_al_resolver_baja_el_contador(self):
        forum.report(self.otro, self.pid, "spam", "")
        moderation.dismiss_reports(self.admin, self.pid, "No incumple")
        self.assertEqual(self.client(self.admin).get("/api/admin/badges").json()["openReports"], 0)

    # ---- ficha del autor
    def test_la_ficha_del_autor_cuenta_mensajes_ocultados_y_suspensiones(self):
        forum.report(self.otro, self.pid, "spam", "")
        item = moderation.list_reports("open", 25, 0)["items"][0]["author"]
        self.assertEqual((item["posts"], item["hiddenPosts"], item["suspensions"]), (2, 0, 0))  # mensaje inicial + respuesta
        self.assertLess(item["accountCreatedAt"], int(time.time()) - 39 * 86400)

        old = forum.reply(self.autor, self.tid, "Otro aviso de spam")["postId"]
        moderation.hide_post(self.admin, old, "Spam o promoción")
        moderation.suspend(self.admin, self.autor, 1, "Spam reiterado")
        moderation.unsuspend(self.admin, self.autor, "Cumplida")
        moderation.suspend(self.admin, self.autor, 7, "Otra vez")
        item = moderation.list_reports("open", 25, 0)["items"][0]["author"]
        self.assertEqual((item["posts"], item["hiddenPosts"], item["suspensions"], item["suspended"]), (3, 1, 2, True))

    def test_los_mensajes_borrados_por_su_autor_no_cuentan_como_publicados(self):
        forum.report(self.otro, self.pid, "spam", "")
        extra = forum.reply(self.autor, self.tid, "Lo borraré")["postId"]
        forum.delete_own(self.autor, extra)
        self.assertEqual(moderation.list_reports("open", 25, 0)["items"][0]["author"]["posts"], 2)

    def test_cada_autor_con_su_ficha_en_la_misma_pagina(self):
        mio = forum.reply(self.otro, self.tid, "Mensaje de Otro")["postId"]
        forum.report(self.tercero, self.pid, "spam", "")
        forum.report(self.tercero, mio, "abuso", "")
        moderation.hide_post(self.admin, mio, "Insultos")
        items = {i["author"]["alias"]: i["author"] for i in moderation.list_reports("open", 25, 0)["items"]}
        items.update({i["author"]["alias"]: i["author"] for i in moderation.list_reports("resolved", 25, 0)["items"]})
        self.assertEqual(items["Otro"]["hiddenPosts"], 1)
        self.assertEqual(items["Autor"]["hiddenPosts"], 0)

    def test_la_ficha_no_incluye_emails(self):
        forum.report(self.otro, self.pid, "spam", "")
        self.assertNotIn("@", repr(moderation.list_reports("open", 25, 0)))


if __name__ == "__main__":
    import unittest
    unittest.main()
