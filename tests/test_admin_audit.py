"""Paquete A del panel: registro de auditoría, eliminación con confirmación y estadísticas del Resumen."""
import os
import sys
import time
import unittest
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import admin, admin_log, ai_usage, db, http  # noqa: E402
from backend.community import moderation  # noqa: E402
from test_community import Base as CommunityBase  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


class Base(CommunityBase):
    def client(self, uid=None):
        c = TestClient(Starlette(routes=admin.routes), base_url="http://testserver")
        if uid:
            c.cookies.set(http.COOKIE, db.create_session(uid))
        self.addCleanup(c.close)
        return c

    def rows(self):
        with closing(db.connect()) as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM admin_log ORDER BY id").fetchall()]

    def setUp(self):
        super().setUp()
        self.boss = self.user("Jefe", admin=True)
        self.second = self.user("Otro", admin=True)
        self.ana = self.user("Ana")
        self.api = self.client(self.boss)


class AuditTest(Base):
    def test_cambiar_el_rol_se_registra_con_quien_sobre_quien_y_el_cambio(self):
        with closing(db.connect()) as conn:
            conn.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (self.ana,))
        self.assertEqual(self.api.patch(f"/api/admin/users/{self.ana}", json={"role": "admin"}).status_code, 200)
        (row,) = self.rows()
        self.assertEqual((row["actor_id"], row["action"], row["target_user_id"], row["detail"]), (self.boss, "user_role", self.ana, "user → admin"))

    def test_una_peticion_que_no_cambia_nada_no_deja_registro(self):
        self.api.patch(f"/api/admin/users/{self.ana}", json={"role": "user", "disabled": False})
        self.assertEqual(self.rows(), [])

    def test_desactivar_y_activar_se_registran(self):
        self.api.patch(f"/api/admin/users/{self.ana}", json={"disabled": True})
        self.api.patch(f"/api/admin/users/{self.ana}", json={"disabled": False})
        self.assertEqual([r["action"] for r in self.rows()], ["user_disable", "user_enable"])

    def test_una_accion_rechazada_no_se_registra(self):
        r = self.api.patch(f"/api/admin/users/{self.boss}", json={"disabled": True})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.rows(), [])

    def test_los_ajustes_registran_las_claves_y_nunca_los_valores(self):
        r = self.api.put("/api/admin/settings", json={"values": {"anthropic_api_key": "sk-ant-SECRETO-1234", "trading_fee_bps": "20", "finnhub_api_key": None}})
        self.assertEqual(r.status_code, 200, r.text)
        (row,) = self.rows()
        self.assertEqual(row["action"], "settings_update")
        self.assertEqual(row["detail"], "anthropic_api_key, finnhub_api_key (restablecido), trading_fee_bps")
        self.assertNotIn("SECRETO", row["detail"])
        self.assertNotIn("20", row["detail"].replace("trading_fee_bps", ""))

    def test_el_registro_nunca_guarda_emails(self):
        self.api.patch(f"/api/admin/users/{self.ana}", json={"disabled": True})
        self.api.request("DELETE", f"/api/admin/users/{self.ana}", json={"confirmEmail": "ana@example.com"})
        self.assertNotIn("@", repr(self.rows()))


class DeleteConfirmationTest(Base):
    def test_sin_el_email_correcto_no_se_elimina(self):
        for body in ({}, {"confirmEmail": ""}, {"confirmEmail": "otra@example.com"}):
            r = self.api.request("DELETE", f"/api/admin/users/{self.ana}", json=body)
            self.assertEqual(r.status_code, 400, body)
        self.assertEqual(db.get_user(self.ana)["email"], "ana@example.com")
        self.assertEqual(self.rows(), [])

    def test_con_el_email_se_elimina_sin_distinguir_mayusculas_y_se_registra(self):
        r = self.api.request("DELETE", f"/api/admin/users/{self.ana}", json={"confirmEmail": " ANA@Example.com "})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(db.get_user(self.ana)["email"].startswith("eliminado-"))  # anonimizada
        (row,) = self.rows()
        self.assertEqual((row["actor_id"], row["action"], row["target_user_id"]), (self.boss, "user_delete", self.ana))

    def test_no_se_puede_eliminar_la_propia_cuenta_ni_sin_ser_admin(self):
        self.assertEqual(self.api.request("DELETE", f"/api/admin/users/{self.boss}", json={"confirmEmail": "jefe@example.com"}).status_code, 400)
        r = self.client(self.ana).request("DELETE", f"/api/admin/users/{self.second}", json={"confirmEmail": "otro@example.com"})
        self.assertEqual(r.status_code, 403)


class AuditViewTest(Base):
    def test_solo_los_admins_ven_la_auditoria(self):
        self.assertEqual(self.client().get("/api/admin/audit").status_code, 401)
        self.assertEqual(self.client(self.ana).get("/api/admin/audit").status_code, 403)
        self.assertEqual(self.api.get("/api/admin/audit").status_code, 200)

    def test_une_moderacion_y_administracion_de_mas_reciente_a_mas_antigua_con_alias(self):
        moderation.suspend(self.boss, self.ana, 7, "Spam repetido")
        with closing(db.connect()) as conn:  # la moderación, un minuto antes
            conn.execute("UPDATE moderation_log SET created_at = created_at - 60")
        self.api.patch(f"/api/admin/users/{self.ana}", json={"disabled": True})
        items = self.api.get("/api/admin/audit").json()["items"]
        self.assertEqual([(i["source"], i["action"]) for i in items], [("admin", "user_disable"), ("moderation", "suspend_user")])
        self.assertEqual((items[0]["actor"], items[0]["target"]), ("Jefe", "Ana"))
        self.assertIn("Spam repetido", items[1]["detail"])
        self.assertNotIn("@", repr(items))

    def test_paginacion_con_cursor_sin_repetir_ni_perder_filas_con_la_misma_hora(self):
        t = int(time.time())
        with closing(db.connect()) as conn:
            for i in range(3):  # misma marca de tiempo en las dos tablas: el desempate es origen e id
                conn.execute("INSERT INTO admin_log (actor_id, action, target_user_id, detail, created_at) VALUES (?, 'user_enable', ?, ?, ?)", (self.boss, self.ana, f"a{i}", t))
                conn.execute("INSERT INTO moderation_log (actor_id, action, target_type, target_id, reason, created_at) VALUES (?, 'unsuspend_user', 'user', ?, ?, ?)", (self.boss, self.ana, f"m{i}", t))
        seen, cursor = [], None
        for _ in range(10):
            page = admin_log.audit(cursor, limit=2)
            seen += [i["detail"] for i in page["items"]]
            cursor = page["nextCursor"]
            if not cursor:
                break
        self.assertEqual(sorted(seen), ["a0", "a1", "a2", "m0", "m1", "m2"])
        self.assertEqual(len(seen), 6)

    def test_cursor_invalido_da_400(self):
        for bad in ("x", "1.2", "1.z.3", "a.a.a"):
            self.assertEqual(self.api.get(f"/api/admin/audit?before={bad}").status_code, 400, bad)


class OverviewStatsTest(Base):
    def test_historico_de_ia_de_14_dias_con_ceros_y_el_consumo_de_hoy(self):
        ai_usage.record("1.2.3.4", "fixed")
        usage = type("U", (), {"input_tokens": 800, "output_tokens": 200, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0, "output_tokens_details": None})()
        ai_usage.record("1.2.3.4", "ai", "claude-haiku-5-5", "low", usage)
        hist = self.api.get("/api/admin/overview").json()["aiHistory"]
        self.assertEqual(len(hist), 14)
        self.assertEqual(hist[-1], {"day": ai_usage.today(), "aiRequests": 1, "fixedAnswers": 1, "tokens": 1000})
        self.assertTrue(all(h["aiRequests"] == h["fixedAnswers"] == h["tokens"] == 0 for h in hist[:-1]))

    def test_actividad_de_hoy_operaciones_foro_y_denuncias_abiertas(self):
        self.buy(self.ana, "o1-aaaaaaaa")
        act = self.api.get("/api/admin/overview").json()["activity"]
        self.assertEqual((act["trading"]["ordersToday"], act["trading"]["fillsToday"], act["trading"]["tradersToday"]), (1, 1, 1))
        self.assertEqual(act["community"]["openReports"], 0)

    def test_sin_actividad_todo_a_cero(self):
        act = self.api.get("/api/admin/overview").json()["activity"]
        self.assertEqual(list(act["trading"].values()), [0, 0, 0, 0])
        self.assertEqual(act["community"]["postsToday"], 0)


if __name__ == "__main__":
    unittest.main()
