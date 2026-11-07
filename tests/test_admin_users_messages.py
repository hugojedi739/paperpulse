"""Paquete C del panel: filtros y orden de usuarios, y búsqueda y «marcar todo» en los mensajes de contacto."""
import os
import sys
import time
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import admin, contact, db, http  # noqa: E402
from test_community import Base  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

NOW = int(time.time())


class Panel(Base):
    def setUp(self):
        super().setUp()
        self.boss = self.user("Jefe", admin=True)
        self.api = self.client(self.boss)

    def client(self, uid=None):
        c = TestClient(Starlette(routes=admin.routes + contact.routes), base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def sql(self, query, *args):
        with closing(db.connect()) as conn:
            conn.execute(query, args)


class UserFiltersTest(Panel):
    def setUp(self):
        super().setUp()
        self.ana, self.bea, self.cris, self.dani = (self.user(n) for n in ("Ana", "Bea", "Cris", "Dani"))
        self.sql("UPDATE users SET email_verified = 1 WHERE id IN (?, ?, ?)", self.boss, self.ana, self.bea)
        self.sql("UPDATE users SET disabled = 1 WHERE id = ?", self.bea)
        self.sql("UPDATE users SET suspended_until = ? WHERE id = ?", NOW + 86400, self.cris)
        self.sql("UPDATE users SET suspended_until = ? WHERE id = ?", NOW - 86400, self.dani)  # suspensión ya vencida: no cuenta
        # altas: Ana la más antigua; accesos: Dani el más reciente, Bea nunca
        for uid, created, login in ((self.boss, 500, NOW - 50), (self.ana, 100, NOW - 300), (self.bea, 200, None), (self.cris, 300, NOW - 100), (self.dani, 400, NOW - 10)):
            self.sql("UPDATE users SET created_at = ?, last_login_at = ? WHERE id = ?", created, login, uid)

    def names(self, **params):
        r = self.api.get("/api/admin/users", params={"limit": 100, **params})
        self.assertEqual(r.status_code, 200, r.text)
        return [u["name"] for u in r.json()["users"]], r.json()["total"]

    def test_filtro_por_rol(self):
        self.assertEqual(self.names(role="admin"), (["Jefe"], 1))
        self.assertEqual(self.names(role="user")[1], 4)

    def test_filtro_por_estado_la_suspension_vencida_cuenta_como_activo(self):
        self.assertEqual(self.names(status="disabled"), (["Bea"], 1))
        self.assertEqual(self.names(status="suspended"), (["Cris"], 1))
        self.assertEqual(sorted(self.names(status="active")[0]), ["Ana", "Dani", "Jefe"])

    def test_filtro_por_email_verificado(self):
        self.assertEqual(sorted(self.names(verified="yes")[0]), ["Ana", "Bea", "Jefe"])
        self.assertEqual(sorted(self.names(verified="no")[0]), ["Cris", "Dani"])

    def test_los_filtros_se_combinan_con_la_busqueda_y_el_total_los_respeta(self):
        self.assertEqual(self.names(verified="yes", status="active")[1], 2)
        self.assertEqual(sorted(self.names(verified="yes", status="active")[0]), ["Ana", "Jefe"])
        self.assertEqual(self.names(verified="yes", status="active", q="ana"), (["Ana"], 1))
        self.assertEqual(self.names(role="admin", q="ana"), ([], 0))

    def test_orden_por_alta_y_por_ultimo_acceso_ambos_sentidos(self):
        self.assertEqual(self.names()[0], ["Jefe", "Dani", "Cris", "Bea", "Ana"])  # alta, más reciente primero (por defecto)
        self.assertEqual(self.names(sort="created", dir="asc")[0], ["Ana", "Bea", "Cris", "Dani", "Jefe"])
        self.assertEqual(self.names(sort="login")[0], ["Dani", "Jefe", "Cris", "Ana", "Bea"])  # quien nunca entró, al final
        self.assertEqual(self.names(sort="login", dir="asc")[0], ["Bea", "Ana", "Cris", "Jefe", "Dani"])

    def test_la_paginacion_mantiene_filtros_y_orden(self):
        first = self.names(sort="login", limit=2)[0]
        page2 = self.api.get("/api/admin/users", params={"sort": "login", "limit": 2, "offset": 2}).json()["users"]
        self.assertEqual(first + [u["name"] for u in page2], ["Dani", "Jefe", "Cris", "Ana"])

    def test_valores_no_validos_dan_400_y_vacio_equivale_a_sin_filtro(self):
        for params in ({"role": "root"}, {"status": "raro"}, {"verified": "tal vez"}, {"sort": "email"}, {"dir": "sideways"}):
            self.assertEqual(self.api.get("/api/admin/users", params=params).status_code, 400, params)
        self.assertEqual(self.names(role="", status="", verified="")[1], 5)

    def test_la_respuesta_trae_verificado_y_alias_sin_filtrar_a_no_admins(self):
        users = {u["name"]: u for u in self.api.get("/api/admin/users").json()["users"]}
        self.assertTrue(users["Ana"]["emailVerified"] and not users["Cris"]["emailVerified"])
        self.assertEqual(users["Ana"]["alias"], "Ana")
        self.assertEqual(self.client(self.ana).get("/api/admin/users").status_code, 403)


class MessagesTest(Panel):
    def add(self, reason, message, read=False, minutes_ago=0):
        with closing(db.connect()) as conn:
            conn.execute("INSERT INTO contact_messages (reason, message, created_at, read_at) VALUES (?, ?, ?, ?)",
                         (reason, message, NOW - minutes_ago * 60, NOW if read else None))

    def ids(self, **params):
        r = self.api.get("/api/admin/messages", params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return [m["reason"] for m in r.json()["items"]], r.json()["total"]

    def setUp(self):
        super().setUp()
        self.add("Duda de saldo", "¿Cómo reinicio mi cuenta?", minutes_ago=3)
        self.add("Error en gráfico", "Se ve un 100% raro en el eje", minutes_ago=2, read=True)
        self.add("Sugerencia", "Más indicadores_técnicos por favor", minutes_ago=1)

    def test_busqueda_en_motivo_y_mensaje_sin_distinguir_mayusculas(self):
        self.assertEqual(self.ids(q="SALDO"), (["Duda de saldo"], 1))
        self.assertEqual(self.ids(q="reinicio"), (["Duda de saldo"], 1))
        self.assertEqual(self.ids(q="nada de esto")[1], 0)

    def test_porcentaje_y_guion_bajo_se_buscan_literalmente(self):
        self.assertEqual(self.ids(q="100%"), (["Error en gráfico"], 1))
        self.assertEqual(self.ids(q="%")[1], 1)       # solo el mensaje que contiene un «%»
        self.assertEqual(self.ids(q="_")[1], 1)       # solo el que contiene «_»
        self.assertEqual(self.ids(q="d_c")[1], 0)     # «_» no es un comodín: como comodín casaría con «dic» de «indicadores»
        self.assertEqual(self.ids(q="\\")[1], 0)

    def test_la_busqueda_se_combina_con_el_filtro_de_leidos_y_el_total(self):
        self.assertEqual(self.ids(q="e", status="unread")[1], 2)
        self.assertEqual(self.ids(q="gráfico", status="unread"), ([], 0))
        self.assertEqual(self.ids(q="gráfico", status="read"), (["Error en gráfico"], 1))
        self.assertEqual(self.api.get("/api/admin/messages", params={"q": "gráfico"}).json()["unread"], 2)  # el contador es global

    def test_marcar_todo_como_leido_cuenta_cuantos_y_actualiza_los_contadores(self):
        r = self.api.post("/api/admin/messages/read-all")
        self.assertEqual((r.status_code, r.json()), (200, {"ok": True, "marked": 2}))
        self.assertEqual(self.api.get("/api/admin/badges").json()["unreadMessages"], 0)
        self.assertEqual(self.api.post("/api/admin/messages/read-all").json()["marked"], 0)  # idempotente

    def test_marcar_todo_conserva_la_fecha_de_lectura_de_los_ya_leidos(self):
        self.sql("UPDATE contact_messages SET read_at = 12345 WHERE reason = 'Error en gráfico'")
        self.api.post("/api/admin/messages/read-all")
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT read_at FROM contact_messages WHERE reason = 'Error en gráfico'").fetchone()[0], 12345)

    def test_marcar_todo_solo_para_admins(self):
        self.assertEqual(self.client().post("/api/admin/messages/read-all").status_code, 401)
        self.assertEqual(self.client(self.user("Ana")).post("/api/admin/messages/read-all").status_code, 403)
        self.assertEqual(self.api.get("/api/admin/badges").json()["unreadMessages"], 2)

    def test_el_resto_de_la_bandeja_sigue_funcionando(self):
        mid = self.api.get("/api/admin/messages").json()["items"][0]["id"]
        self.assertEqual(self.api.patch(f"/api/admin/messages/{mid}", json={"read": True}).status_code, 200)
        self.assertEqual(self.api.delete(f"/api/admin/messages/{mid}").status_code, 200)
        self.assertEqual(self.ids()[1], 2)


if __name__ == "__main__":
    import unittest
    unittest.main()
