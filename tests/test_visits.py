"""Contador de visitas de la portada (backend/visits.py, migración 0014): anónimo, sin cookies y sin frenar la portada."""
import asyncio
import datetime
import glob
import os
import sys
import tempfile
import time
import unittest
from contextlib import closing
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import _local_db  # noqa: F401,E402  (antes que backend)

from backend import app as app_module, db, settings, visits  # noqa: E402
from backend.http import COOKIE  # noqa: E402

from starlette.testclient import TestClient  # noqa: E402

BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        visits._secret_cache.clear()
        settings._cache.update(time=0.0, values={})
        self.addCleanup(settings._cache.update, time=0.0, values={})

    def rows(self, sql, *args):
        with closing(db.connect()) as conn:
            return [tuple(r) for r in conn.execute(sql, args).fetchall()]

    def days(self):
        return {r[0]: (r[1], r[2]) for r in self.rows("SELECT kind, visitors, views FROM visit_days WHERE day = ?", visits.today())}


class MigrationTest(Base):
    def test_tablas_y_secreto_propio(self):
        tables = {r[0] for r in self.rows("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertTrue({"visit_days", "visit_seen"} <= tables)
        secret = self.rows("SELECT value FROM server_secrets WHERE name = 'visits'")[0][0]
        self.assertEqual(len(secret), 64)
        self.assertNotEqual(secret, self.rows("SELECT value FROM server_secrets WHERE name = 'ai'")[0][0])

    def test_cada_tabla_lleva_un_comentario_encima(self):
        path = os.path.join(os.path.dirname(__file__), "..", "backend", "migrations", "0014_visitas.sql")
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        for i, line in enumerate(lines):
            if line.startswith("CREATE TABLE"):
                self.assertTrue(lines[i - 1].startswith("--"), line)


class RecordTest(Base):
    def test_unicos_por_dia_y_cargas(self):
        for _ in range(3):
            visits.record("203.0.113.1", BROWSER, None)
        visits.record("203.0.113.2", BROWSER, None)
        self.assertEqual(self.days(), {"anon": (2, 4)})

    def test_bots_sesion_y_anonimos_por_separado(self):
        user = db.create_user("ana@example.com", "clave-larga-1", "Ana")
        token = db.create_session(user["id"])
        self.assertEqual(visits.record("203.0.113.1", "Googlebot/2.1 (+http://www.google.com/bot.html)", None), "bot")
        self.assertEqual(visits.record("203.0.113.1", "", None), "bot")
        self.assertEqual(visits.record("203.0.113.1", "curl/8.5.0", None), "bot")
        self.assertEqual(visits.record("203.0.113.3", BROWSER, token), "user")
        self.assertEqual(visits.record("203.0.113.4", BROWSER, "token-falso"), "anon")
        self.assertEqual(self.days(), {"bot": (3, 3), "user": (1, 1), "anon": (1, 1)})

    def test_sesion_de_cuenta_desactivada_cuenta_como_anonima(self):
        user = db.create_user("leo@example.com", "clave-larga-1", "Leo")
        token = db.create_session(user["id"])
        with db.transaction() as conn:
            conn.execute("UPDATE users SET disabled = 1 WHERE id = ?", (user["id"],))
        self.assertEqual(visits.record("203.0.113.5", BROWSER, token), "anon")

    def test_no_guarda_ip_ni_user_agent(self):
        ip, ua = "203.0.113.77", "Mozilla/5.0 PruebaUnicaNavegador/9.9.9"
        visits.record(ip, ua, None)
        visits.record(ip, ua, None)
        dump = repr(self.rows("SELECT * FROM visit_days") + self.rows("SELECT * FROM visit_seen"))
        for needle in (ip, ua, "PruebaUnicaNavegador"):
            self.assertNotIn(needle, dump)
        # Ni en ningún otro sitio de la base: se buscan los bytes en el fichero y en su WAL
        with closing(db.connect()) as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        for path in glob.glob(db.DB_PATH + "*"):
            with open(path, "rb") as f:
                raw = f.read()
            for needle in (ip, "PruebaUnicaNavegador"):
                self.assertNotIn(needle.encode(), raw, path)

    def test_el_identificador_cambia_cada_dia(self):
        a = visits.visitor_key("203.0.113.1", BROWSER, "2026-11-15")
        self.assertEqual(a, visits.visitor_key("203.0.113.1", BROWSER, "2026-11-15"))
        self.assertNotEqual(a, visits.visitor_key("203.0.113.1", BROWSER, "2026-11-16"))
        self.assertNotEqual(a, visits.visitor_key("203.0.113.2", BROWSER, "2026-11-15"))
        self.assertEqual(len(a), 32)

    def test_user_agent_enorme_se_recorta(self):
        visits.record("203.0.113.1", "Mozilla/5.0 " + "x" * 10_000, None)
        self.assertEqual(self.days(), {"anon": (1, 1)})


class PortadaTest(Base):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app_module.app, headers={"user-agent": BROWSER})

    def test_solo_cuenta_get_de_la_portada(self):
        self.assertEqual(self.client.get("/").status_code, 200)
        self.client.head("/")
        self.client.get("/index.html")
        self.client.get("/api/health")
        self.client.get("/manifest.json")
        self.client.get("/", headers={"sec-purpose": "prefetch;prerender"})
        self.client.get("/", headers={"purpose": "prefetch"})
        self.assertEqual(self.days(), {"anon": (1, 1)})

    def test_no_pone_cookies(self):
        res = self.client.get("/")
        self.assertNotIn("set-cookie", res.headers)

    def test_si_la_base_falla_la_portada_se_sirve_igual(self):
        with mock.patch.object(visits, "record", side_effect=RuntimeError("base caída")):
            res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("<html", res.text.lower())

    def test_si_la_base_tarda_la_portada_no_espera(self):
        with mock.patch.object(visits, "record", side_effect=lambda *a: time.sleep(2)):
            t0 = time.monotonic()
            res = self.client.get("/")
            elapsed = time.monotonic() - t0
        self.assertEqual(res.status_code, 200)
        self.assertLess(elapsed, 1.5)

    def test_sin_migracion_aplicada_no_rompe(self):
        with db.transaction() as conn:
            conn.execute("DROP TABLE visit_seen")
        self.assertEqual(self.client.get("/").status_code, 200)

    def test_desactivado_no_cuenta(self):
        settings.save({"visits_enabled": False}, None)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertEqual(self.days(), {})

    def test_cookie_de_sesion_cuenta_como_con_sesion(self):
        user = db.create_user("eva@example.com", "clave-larga-1", "Eva")
        self.client.cookies.set(COOKIE, db.create_session(user["id"]))
        self.client.get("/")
        self.assertEqual(self.days(), {"user": (1, 1)})


class SummaryCleanupTest(Base):
    def put_day(self, day, kind, visitors, views):
        with db.transaction() as conn:
            conn.execute("INSERT INTO visit_days (day, kind, visitors, views) VALUES (?, ?, ?, ?)", (day, kind, visitors, views))
            conn.execute("INSERT INTO visit_seen (day, visitor, kind) VALUES (?, ?, ?)", (day, f"h{day}{kind}", kind))

    def test_resumen_de_hoy_14_dias_y_registros(self):
        today = datetime.date.fromisoformat(visits.today())
        self.put_day((today - datetime.timedelta(days=3)).isoformat(), "anon", 5, 9)
        self.put_day((today - datetime.timedelta(days=30)).isoformat(), "anon", 50, 90)  # fuera de los 14 días
        visits.record("203.0.113.1", BROWSER, None)
        visits.record("203.0.113.1", "bingbot/2.0", None)
        db.create_user("nuevo@example.com", "clave-larga-1", "Nuevo")
        s = visits.summary(14)
        self.assertEqual(s["today"], {"anon": 1, "user": 0, "bot": 1, "views": 1, "signups": 1})
        self.assertEqual(len(s["history"]), 14)
        self.assertEqual(s["history"][-4]["anon"], 5)
        self.assertEqual(sum(d["anon"] for d in s["history"]), 6)
        self.assertTrue(s["enabled"])

    def test_cron_borra_hashes_pasados_y_agregados_de_mas_de_90_dias(self):
        today = datetime.date.fromisoformat(visits.today())
        ago = lambda n: (today - datetime.timedelta(days=n)).isoformat()
        for n in (0, 1, 89, 91):
            self.put_day(ago(n), "anon", 1, 1)
        out = visits.cleanup()
        self.assertEqual(out, {"visitHashesDeleted": 3, "visitDaysDeleted": 1})
        self.assertEqual([r[0] for r in self.rows("SELECT day FROM visit_seen")], [ago(0)])
        self.assertEqual(sorted(r[0] for r in self.rows("SELECT day FROM visit_days")), sorted([ago(0), ago(1), ago(89)]))

    def test_el_cron_diario_incluye_la_limpieza(self):
        from backend.retention import api as retention_api
        out = retention_api.daily_job()
        self.assertIn("visitHashesDeleted", out)
        self.assertIn("visitDaysDeleted", out)


class AdminOverviewTest(Base):
    def test_el_resumen_del_panel_exige_admin_y_trae_visitas(self):
        client = TestClient(app_module.app)
        self.assertIn(client.get("/api/admin/overview").status_code, (401, 403))
        admin = db.oauth_user("google", "sub-admin", "admin@example.com", "Admin", True, True)["user"]
        self.assertTrue(db.promote_admin("admin@example.com")[0])
        client.cookies.set(COOKIE, db.create_session(admin["id"]))
        with mock.patch("backend.admin.is_market_open", return_value=(False, "Cerrado")):
            res = client.get("/api/admin/overview")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.json()["visits"]), {"today", "history", "enabled"})


class SettingTest(unittest.TestCase):
    def test_ajuste_documentado(self):
        self.assertEqual(settings.SCHEMA["visits_enabled"][:3], ("VISITS_ENABLED", True, bool))
        with open(os.path.join(os.path.dirname(__file__), "..", ".env.example"), encoding="utf-8") as f:
            self.assertIn("VISITS_ENABLED=", f.read())


if __name__ == "__main__":
    unittest.main()
