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
from backend.security import IP_VISIT_CALLS  # noqa: E402

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
            visits.record("203.0.113.1", BROWSER, False)
        visits.record("203.0.113.2", BROWSER, False)
        self.assertEqual(self.days(), {"anon": (2, 4)})

    def test_bots_sesion_y_anonimos_por_separado(self):
        self.assertEqual(visits.record("203.0.113.1", "Googlebot/2.1 (+http://www.google.com/bot.html)", False), "bot")
        self.assertEqual(visits.record("203.0.113.1", "", True), "bot")  # un robot no pasa por persona aunque lo diga
        self.assertEqual(visits.record("203.0.113.1", "curl/8.5.0", False), "bot")
        self.assertEqual(visits.record("203.0.113.3", BROWSER, True), "user")
        self.assertEqual(visits.record("203.0.113.4", BROWSER, False), "anon")
        self.assertEqual(self.days(), {"bot": (3, 3), "user": (1, 1), "anon": (1, 1)})

    def test_una_sentencia_por_tabla_sin_transaccion(self):
        seen = []
        real = db.connect

        def spy():
            conn = real()
            original = conn.execute
            conn.execute = lambda sql, params=(): (seen.append(sql.split()[0].upper()), original(sql, params))[1]
            return conn
        with mock.patch.object(db, "connect", spy), mock.patch.object(db, "transaction", side_effect=AssertionError("sin transacción")):
            visits.secret()  # el secreto se lee una vez por instancia (fuera de la cuenta)
            seen.clear()
            visits.record("203.0.113.9", BROWSER, False)
        self.assertEqual(seen, ["INSERT", "INSERT"])  # visit_seen y visit_days; ni BEGIN ni COMMIT

    def test_no_guarda_ip_ni_user_agent(self):
        ip, ua = "203.0.113.77", "Mozilla/5.0 PruebaUnicaNavegador/9.9.9"
        visits.record(ip, ua, False)
        visits.record(ip, ua, True)
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
        visits.record("203.0.113.1", "Mozilla/5.0 " + "x" * 10_000, False)
        self.assertEqual(self.days(), {"anon": (1, 1)})


class SlowConnection:
    """Conexión de verdad cuyas sentencias tardan LATENCY s, como un viaje de ida y vuelta a una base lejana.
    Reproduce el problema real (la base, no un hilo dormido): quien espere a la base, paga ese tiempo."""
    LATENCY = 0.4

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        time.sleep(self.LATENCY)
        return self._conn.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._conn, name)


class EndpointTest(Base):
    def setUp(self):
        super().setUp()
        settings.save({"visits_enabled": True}, None)  # desactivado por defecto: aquí se prueba encendido
        visits.secret()  # en la base rápida, antes de simular la lenta
        IP_VISIT_CALLS.clear()
        self.client = TestClient(app_module.app, base_url="http://localhost:8000",
                                 headers={"user-agent": BROWSER, "origin": "http://localhost:8000"})

    def visit(self, **body):
        return self.client.post("/api/visit", json=body)

    def test_la_portada_no_toca_la_base_aunque_la_base_vaya_lenta(self):
        real = db.connect
        with mock.patch.object(db, "connect", lambda: SlowConnection(real())):
            t0 = time.monotonic()
            for _ in range(3):
                self.assertEqual(self.client.get("/").status_code, 200)
            elapsed = time.monotonic() - t0
        self.assertLess(elapsed, SlowConnection.LATENCY, "tres cargas de la portada sin una sola espera a la base")
        self.assertEqual(self.days(), {})

    def test_la_peticion_aparte_paga_la_latencia_sin_transaccion(self):
        real = db.connect
        with mock.patch.object(db, "connect", lambda: SlowConnection(real())):
            t0 = time.monotonic()
            self.assertEqual(self.visit(signedIn=False).status_code, 204)
            elapsed = time.monotonic() - t0
        # settings (lectura) + dos sentencias de escritura; con BEGIN/COMMIT serían dos viajes más
        self.assertLess(elapsed, 4 * SlowConnection.LATENCY + 0.3)
        self.assertEqual(self.days(), {"anon": (1, 1)})

    def test_cuenta_con_y_sin_sesion_y_bots(self):
        self.visit(signedIn=False)
        self.client.post("/api/visit", json={"signedIn": True}, headers={"user-agent": BROWSER + " otro"})
        self.client.post("/api/visit", json={"signedIn": True}, headers={"user-agent": "bingbot/2.0"})
        self.assertEqual(self.days(), {"anon": (1, 1), "user": (1, 1), "bot": (1, 1)})

    def test_signed_in_raro_cuenta_como_sin_sesion(self):
        for value in ("true", 1, None, [], {"x": 1}):
            self.client.post("/api/visit", json={"signedIn": value}, headers={"user-agent": f"{BROWSER} {value!r}"})
        self.assertEqual(self.days(), {"anon": (5, 5)})

    def test_no_pone_ni_necesita_cookies(self):
        res = self.visit()
        self.assertEqual(res.status_code, 204)
        self.assertNotIn("set-cookie", res.headers)
        self.assertNotIn("set-cookie", self.client.get("/").headers)

    def test_origen_ajeno_json_y_limite_por_ip(self):
        self.assertEqual(self.client.post("/api/visit", json={}, headers={"origin": "https://malo.example"}).status_code, 403)
        self.assertEqual(self.client.post("/api/visit", content=b"x", headers={"content-type": "text/plain"}).status_code, 415)
        codes = [self.visit().status_code for _ in range(visits.VISITS_PER_MINUTE + 3)]
        self.assertEqual(codes[0], 204)
        self.assertIn(429, codes)

    def test_si_la_base_falla_responde_204_igual(self):
        with mock.patch.object(visits, "record", side_effect=RuntimeError("base caída")):
            self.assertEqual(self.visit().status_code, 204)
        with db.transaction() as conn:
            conn.execute("DROP TABLE visit_seen")  # migración pendiente o tabla perdida
        self.assertEqual(self.visit().status_code, 204)

    def test_desactivado_no_cuenta(self):
        settings.save({"visits_enabled": False}, None)
        self.assertEqual(self.visit().status_code, 204)
        self.assertEqual(self.days(), {})


class DefaultOffTest(Base):
    def test_por_defecto_no_cuenta_ni_escribe(self):
        os.environ.pop("VISITS_ENABLED", None)
        settings._cache.update(time=0.0, values={})
        self.assertFalse(settings.get("visits_enabled"))
        IP_VISIT_CALLS.clear()
        client = TestClient(app_module.app, base_url="http://localhost:8000", headers={"user-agent": BROWSER})
        with mock.patch.object(visits, "record", side_effect=AssertionError("no debe contar")) as rec:
            self.assertEqual(client.get("/").status_code, 200)
            self.assertEqual(client.post("/api/visit", json={}).status_code, 204)
        rec.assert_not_called()
        self.assertEqual(self.days(), {})
        self.assertFalse(visits.summary()["enabled"])

    def test_un_valor_guardado_en_el_panel_tiene_prioridad(self):
        settings.save({"visits_enabled": True}, None)
        self.assertTrue(settings.get("visits_enabled"))
        settings.save({"visits_enabled": None}, None)  # None = volver a .env / defecto
        self.assertFalse(settings.get("visits_enabled"))


class SummaryCleanupTest(Base):
    def put_day(self, day, kind, visitors, views):
        with db.transaction() as conn:
            conn.execute("INSERT INTO visit_days (day, kind, visitors, views) VALUES (?, ?, ?, ?)", (day, kind, visitors, views))
            conn.execute("INSERT INTO visit_seen (day, visitor, kind) VALUES (?, ?, ?)", (day, f"h{day}{kind}", kind))

    def test_resumen_de_hoy_14_dias_y_registros(self):
        today = datetime.date.fromisoformat(visits.today())
        self.put_day((today - datetime.timedelta(days=3)).isoformat(), "anon", 5, 9)
        self.put_day((today - datetime.timedelta(days=30)).isoformat(), "anon", 50, 90)  # fuera de los 14 días
        visits.record("203.0.113.1", BROWSER, False)
        visits.record("203.0.113.1", "bingbot/2.0", False)
        db.create_user("nuevo@example.com", "clave-larga-1", "Nuevo")
        s = visits.summary(14)
        self.assertEqual(s["today"], {"anon": 1, "user": 0, "bot": 1, "views": 1, "signups": 1})
        self.assertEqual(len(s["history"]), 14)
        self.assertEqual(s["history"][-4]["anon"], 5)
        self.assertEqual(sum(d["anon"] for d in s["history"]), 6)
        self.assertFalse(s["enabled"])  # desactivado por defecto (fix/contador-apagado)

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
        self.assertEqual(settings.SCHEMA["visits_enabled"][:3], ("VISITS_ENABLED", False, bool))
        with open(os.path.join(os.path.dirname(__file__), "..", ".env.example"), encoding="utf-8") as f:
            self.assertIn("VISITS_ENABLED=false\n", f.read())


if __name__ == "__main__":
    unittest.main()
