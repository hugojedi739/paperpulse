"""Comparador del Resumen: /api/benchmark/sp500 (S&P 500 desde una fecha) y metadatos con APP_DOMAIN."""
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import _local_db  # noqa: F401,E402  (antes que backend)

from backend.market import benchmark, stocks  # noqa: E402
from backend.security import IP_STOCK_CALLS  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

DAY = 86400
H = 3600
# Lunes 2 de noviembre de 2026, 00:00 en Nueva York (05:00 UTC): así empiezan las velas diarias de Yahoo.
MON = 1793595600


def bar(t, close):
    return {"time": t, "open": close, "high": close, "low": close, "close": close, "volume": 0}


# Lunes a viernes de una semana y el lunes siguiente (sin sábado ni domingo, como da el proveedor)
WEEK = [bar(MON + i * DAY, 100 + i) for i in range(5)] + [bar(MON + 7 * DAY, 110)]


def reset_cache():
    benchmark._CACHE.update(start=None, fetched=0.0, source=None, bars=[], failed=0.0)


class ComputeTest(unittest.TestCase):
    def test_base_es_el_ultimo_cierre_antes_de_abrir(self):
        # Cuenta abierta el miércoles a las 12:00 de Nueva York: aún no ha cerrado la sesión del miércoles (102)
        r = benchmark.compute(WEEK, MON + 2 * DAY + 12 * H)
        self.assertEqual(r["startClose"], 101)  # cierre del martes
        self.assertEqual(r["lastClose"], 110)
        self.assertAlmostEqual(r["returnPct"], (110 / 101 - 1) * 100, places=3)

    def test_despues_del_cierre_cuenta_esa_sesion(self):
        r = benchmark.compute(WEEK, MON + 2 * DAY + 17 * H)  # miércoles a las 17:00
        self.assertEqual(r["startClose"], 102)

    def test_fin_de_semana_usa_el_viernes(self):
        r = benchmark.compute(WEEK, MON + 5 * DAY + 10 * H)  # sábado
        self.assertEqual(r["startClose"], 104)
        self.assertEqual(r["startDate"], "2026-11-06")

    def test_sin_cierre_anterior_no_hay_dato(self):
        self.assertIsNone(benchmark.compute(WEEK, MON + 10 * H))
        self.assertIsNone(benchmark.compute([], MON + 3 * DAY))


class EndpointTest(unittest.TestCase):
    def setUp(self):
        reset_cache()
        IP_STOCK_CALLS.clear()
        self.provider = mock.Mock(spec=stocks.YFinanceStockProvider)
        self.provider.fetch_history.return_value = WEEK
        patcher = mock.patch.object(stocks, "provider", return_value=self.provider)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(reset_cache)
        self.client = TestClient(Starlette(routes=benchmark.routes))

    def get(self, since):
        return self.client.get(f"/api/benchmark/sp500?since={since}")

    def test_devuelve_la_rentabilidad_desde_la_apertura(self):
        res = self.get(MON + 2 * DAY + 12 * H)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["available"])
        self.assertEqual(data["source"], "^GSPC")
        self.assertAlmostEqual(data["returnPct"], (110 / 101 - 1) * 100, places=3)
        self.assertEqual(self.provider.fetch_history.call_args.args[:2], ("^GSPC", "1d"))
        self.assertIn("s-maxage", res.headers["cache-control"])

    def test_finnhub_usa_el_etf_spy(self):
        finnhub = mock.Mock(spec=stocks.FinnhubStockProvider)
        finnhub.fetch_history.return_value = WEEK
        with mock.patch.object(stocks, "provider", return_value=finnhub):
            self.assertEqual(self.get(MON + 3 * DAY).json()["source"], "SPY")

    def test_caché_acotada_una_descarga_para_fechas_distintas(self):
        for since in (MON + 2 * DAY + 12 * H, MON + 3 * DAY + 17 * H, MON + 5 * DAY):
            self.assertTrue(self.get(since).json()["available"])
        self.assertEqual(self.provider.fetch_history.call_count, 1)

    def test_fecha_anterior_al_inicio_amplia_la_serie(self):
        self.get(MON + 5 * DAY)
        start = benchmark._CACHE["start"]
        self.get(MON + 1 * DAY + 17 * H - 30 * DAY)  # un mes antes: la serie no lo cubre
        self.assertEqual(self.provider.fetch_history.call_count, 2)
        self.assertLess(benchmark._CACHE["start"], start)

    def test_caduca_a_la_hora(self):
        self.get(MON + 3 * DAY)
        benchmark._CACHE["fetched"] -= benchmark.CACHE_TTL + 1
        self.get(MON + 3 * DAY)
        self.assertEqual(self.provider.fetch_history.call_count, 2)

    def test_sin_datos_no_se_pinta_y_no_se_martillea_al_proveedor(self):
        self.provider.fetch_history.return_value = []
        for _ in range(3):
            res = self.get(MON + 3 * DAY)
            self.assertEqual(res.json(), {"available": False})
            self.assertEqual(res.headers["cache-control"], "no-store")
        self.assertEqual(self.provider.fetch_history.call_count, 1)

    def test_error_del_proveedor_no_rompe_la_respuesta(self):
        self.provider.fetch_history.side_effect = RuntimeError("caído")
        res = self.get(MON + 3 * DAY)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"available": False})

    def test_caché_caducada_sin_poder_renovarla_no_da_cifras_viejas(self):
        self.get(MON + 3 * DAY)
        benchmark._CACHE["fetched"] -= benchmark.CACHE_TTL + 1
        self.provider.fetch_history.return_value = []
        self.assertEqual(self.get(MON + 3 * DAY).json(), {"available": False})

    def test_since_no_valido(self):
        for bad in ("", "abc", "1.5e9", str(benchmark.MIN_SINCE - 1), str(int(time.time()) + DAY)):
            self.assertEqual(self.client.get(f"/api/benchmark/sp500?since={bad}").status_code, 400, bad)
        self.assertEqual(self.client.get("/api/benchmark/sp500").status_code, 400)
        self.provider.fetch_history.assert_not_called()

    def test_límite_por_ip(self):
        codes = [self.get(MON + 3 * DAY).status_code for _ in range(62)]
        self.assertIn(429, codes)


class ProductionMetadataTest(unittest.TestCase):
    """canonical, og:url y og:image salen con APP_DOMAIN, también con el index generado que usa Vercel."""

    DOMAIN = "https://mi-dominio.example"

    def render(self, vercel):
        from backend import app as app_module
        with mock.patch.dict(os.environ, {"APP_DOMAIN": self.DOMAIN}), \
                mock.patch.object(app_module, "IS_VERCEL", vercel), mock.patch.object(app_module, "IS_PRODUCTION", True):
            res = TestClient(app_module.app).get("/")
        self.assertEqual(res.status_code, 200)
        return res.text

    def test_salida_de_produccion_sin_dominios_ajenos(self):
        from backend import app as app_module
        self.assertTrue(os.path.exists(app_module.BUILT_INDEX))
        for vercel in (True, False):
            html = self.render(vercel)
            self.assertNotIn("paperpulse.app", html)
            self.assertNotIn(app_module.DOMAIN_PLACEHOLDER, html)
            self.assertIn(f'<link rel="canonical" href="{self.DOMAIN}/">', html)
            self.assertIn(f'<meta property="og:url" content="{self.DOMAIN}/">', html)
            self.assertIn(f'<meta property="og:image" content="{self.DOMAIN}/img/brand/og-preview.png">', html)
        self.assertIn("/js/main.", self.render(True))  # de verdad es el index generado (módulos con hash)

    def test_ningun_fichero_servido_menciona_paperpulse_app(self):
        root = os.path.join(os.path.dirname(__file__), "..")
        hits = []
        for base in ("frontend", "public", os.path.join("backend", "templates")):
            for dirpath, _, files in os.walk(os.path.join(root, base)):
                if "vendor" in dirpath.split(os.sep):
                    continue
                for name in files:
                    if name.endswith((".html", ".js", ".css", ".json", ".webmanifest", ".svg")):
                        path = os.path.join(dirpath, name)
                        with open(path, encoding="utf-8", errors="ignore") as f:
                            if "paperpulse.app" in f.read():
                                hits.append(os.path.relpath(path, root))
        self.assertEqual(hits, [])


if __name__ == "__main__":
    unittest.main()
