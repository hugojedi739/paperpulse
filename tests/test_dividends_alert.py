"""Próximos dividendos (/api/dividends) y umbrales de la luz roja de mercado (en /api/markets)."""
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import _local_db  # noqa: F401,E402  (antes que backend)

from backend import db, settings  # noqa: E402
from backend.market import alert, dividends, hours, stocks  # noqa: E402
from backend.security import IP_STOCK_CALLS  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.routing import Route  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

FUTURE = "2099-01-12"
PAST = "2001-01-01"


def reset_cache():
    dividends._CACHE.update(fetched=0.0, failed=0.0, data={})


class YFinanceDividendsTest(unittest.TestCase):
    """Cómo se lee Ticker.info: fecha ex-dividendo e importe solo si ya está anunciado."""

    def run_with(self, infos):
        fake = mock.Mock()
        def ticker(t):
            m = mock.Mock()
            if isinstance(infos.get(t), Exception):
                m.get_info.side_effect = infos[t]
            else:
                m.get_info.return_value = infos.get(t, {})
            return m
        fake.Ticker.side_effect = ticker
        with mock.patch.object(stocks, "get_yfinance", return_value=fake):
            return stocks.YFinanceStockProvider().fetch_dividends(list(infos))

    def test_importe_anunciado_y_por_confirmar(self):
        ex = 1799712000  # 12/01/2027 00:00 UTC
        out = self.run_with({
            "IBE.MC": {"exDividendDate": ex, "lastDividendDate": ex, "lastDividendValue": 0.275, "currency": "EUR"},
            "MSFT": {"exDividendDate": ex, "lastDividendDate": ex - 90 * 86400, "lastDividendValue": 0.91, "currency": "USD"},
            "TSLA": {"exDividendDate": None},
            "AMZN": RuntimeError("404"),
        })
        self.assertEqual(out["IBE.MC"], {"exDate": "2027-01-12", "amount": 0.275, "lastAmount": 0.275, "currency": "EUR"})
        self.assertEqual(out["MSFT"]["amount"], None)  # aún no anunciado: solo el último pagado
        self.assertEqual(out["MSFT"]["lastAmount"], 0.91)
        self.assertNotIn("TSLA", out)
        self.assertNotIn("AMZN", out)

    def test_finnhub_no_da_dividendos(self):
        self.assertEqual(stocks.FinnhubStockProvider("x").fetch_dividends(["AAPL"]), {})


class DividendsEndpointTest(unittest.TestCase):
    def setUp(self):
        reset_cache()
        IP_STOCK_CALLS.clear()
        self.provider = mock.Mock()
        self.provider.fetch_dividends.return_value = {
            "MSFT": {"exDate": FUTURE, "amount": None, "lastAmount": 0.91, "currency": "USD"},
            "IBE.MC": {"exDate": FUTURE, "amount": 0.275, "lastAmount": 0.275, "currency": "EUR"},
            "SAN.MC": {"exDate": PAST, "amount": 0.127, "lastAmount": 0.127, "currency": "EUR"},
            "XYZ": {"exDate": FUTURE},  # no es del catálogo: se descarta
        }
        p = mock.patch.object(stocks, "provider", return_value=self.provider)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(reset_cache)
        self.client = TestClient(Starlette(routes=dividends.routes))

    def test_solo_proximos_y_del_catalogo_con_simbolo_propio(self):
        res = self.client.get("/api/dividends")
        self.assertEqual(res.status_code, 200)
        data = res.json()["data"]
        self.assertEqual(set(data), {"MSFT", "IBE"})  # SAN ya pasó; XYZ no es del catálogo
        self.assertEqual(data["IBE"]["amount"], 0.275)
        self.assertIn("s-maxage", res.headers["cache-control"])

    def test_no_pide_indices(self):
        self.client.get("/api/dividends")
        pedidos = self.provider.fetch_dividends.call_args.args[0]
        self.assertNotIn("^IBEX", pedidos)
        self.assertIn("SAN.MC", pedidos)
        self.assertEqual(len(pedidos), len(stocks.STOCK_SYMBOLS) - 1)

    def test_cache_de_horas_una_descarga(self):
        for _ in range(5):
            self.client.get("/api/dividends")
        self.assertEqual(self.provider.fetch_dividends.call_count, 1)
        dividends._CACHE["fetched"] -= dividends.CACHE_TTL + 1
        self.client.get("/api/dividends")
        self.assertEqual(self.provider.fetch_dividends.call_count, 2)

    def test_sin_datos_vacio_y_sin_martillear(self):
        self.provider.fetch_dividends.return_value = {}
        for _ in range(3):
            res = self.client.get("/api/dividends")
            self.assertEqual(res.json()["data"], {})
            self.assertEqual(res.headers["cache-control"], "no-store")
        self.assertEqual(self.provider.fetch_dividends.call_count, 1)

    def test_error_del_proveedor(self):
        self.provider.fetch_dividends.side_effect = RuntimeError("caído")
        res = self.client.get("/api/dividends")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["data"], {})

    def test_si_falla_al_renovar_sirve_lo_ultimo_un_maximo_de_24_h(self):
        self.client.get("/api/dividends")
        self.provider.fetch_dividends.return_value = {}
        dividends._CACHE["fetched"] -= dividends.CACHE_TTL + 1
        self.assertEqual(set(self.client.get("/api/dividends").json()["data"]), {"MSFT", "IBE"})
        dividends._CACHE["fetched"] -= dividends.MAX_STALE
        dividends._CACHE["failed"] = 0.0
        self.assertEqual(self.client.get("/api/dividends").json()["data"], {})

    def test_limite_por_ip(self):
        self.assertIn(429, [self.client.get("/api/dividends").status_code for _ in range(62)])


class MarketAlertRulesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        settings._cache.update(time=0.0, values={})
        self.addCleanup(settings._cache.update, time=0.0, values={})
        hours.MARKETS_CACHE.update(timestamp=time.time(), data=[{"id": "us", "open": True}])  # sin red: estado en caché
        self.addCleanup(hours.MARKETS_CACHE.update, timestamp=0, data=[])
        self.client = TestClient(Starlette(routes=[Route("/api/markets", hours.api_markets)]))

    def test_por_defecto_btc_10_e_ibex_4(self):
        rules = self.client.get("/api/markets").json()["alertRules"]
        self.assertEqual(rules, [
            {"symbol": "BTC", "name": "Bitcoin", "window": "24h", "dropPct": 10.0},
            {"symbol": "IBEX", "name": "IBEX 35", "window": "session", "dropPct": 4.0},
        ])

    def test_umbrales_del_panel_y_cero_desactiva(self):
        values = {"market_alert_btc_drop_bps": "750", "market_alert_index_drop_bps": "0"}
        self.assertIsNone(settings.validate(values))
        settings.save(values, None)
        self.assertEqual(alert.alert_rules(), [{"symbol": "BTC", "name": "Bitcoin", "window": "24h", "dropPct": 7.5}])

    def test_rangos_validados(self):
        for key in ("market_alert_btc_drop_bps", "market_alert_index_drop_bps"):
            for bad in (-1, 5001, "abc", True):
                self.assertIsNotNone(settings.validate({key: bad}), (key, bad))
            self.assertIsNone(settings.validate({key: 0}))

    def test_documentados_en_env_example(self):
        with open(os.path.join(os.path.dirname(__file__), "..", ".env.example"), encoding="utf-8") as f:
            env = f.read()
        for key in ("market_alert_btc_drop_bps", "market_alert_index_drop_bps"):
            self.assertIn(f"{settings.SCHEMA[key][0]}=", env)


if __name__ == "__main__":
    unittest.main()
