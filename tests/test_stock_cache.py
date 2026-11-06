"""Caché compartida de cotizaciones de bolsa (tabla quote_cache): sin red, el proveedor se simula."""
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402
from backend.market import stocks  # noqa: E402


def quote(price):
    return {"symbol": "AAPL", "price": price, "change24h": 1.0, "live": True, "marketOpen": True}


class FakeProvider:
    def __init__(self, *prices, fail=False):
        self.prices, self.fail, self.calls = list(prices), fail, 0

    def fetch_quotes(self, symbols):
        self.calls += 1
        if self.fail:
            raise RuntimeError("proveedor caído")
        return {"AAPL": quote(self.prices.pop(0))}


class SharedCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        self.new_instance()

    def new_instance(self):
        """Simula otra instancia serverless: la memoria vacía, la base compartida."""
        stocks.STOCKS_CACHE, stocks.STOCKS_CACHE_TIME = {}, 0

    def fetch(self, provider, **kw):
        with mock.patch.object(stocks, "provider", return_value=provider):
            return stocks.fetch_live_stock_quotes(**kw)

    def test_second_instance_reuses_shared_row_without_provider(self):
        first = FakeProvider(100)
        self.assertEqual(self.fetch(first)["AAPL"]["price"], 100)
        self.new_instance()
        second = FakeProvider(999)
        self.assertEqual(self.fetch(second)["AAPL"]["price"], 100)
        self.assertEqual(second.calls, 0)

    def test_shared_row_does_not_leak_internal_field(self):
        self.fetch(FakeProvider(100))
        self.new_instance()
        self.assertNotIn("_cachedAt", self.fetch(FakeProvider(1))["AAPL"])

    def test_trading_max_age_refuses_older_shared_data(self):
        self.fetch(FakeProvider(100))
        self.new_instance()
        with mock.patch.object(time, "time", return_value=time.time() + 30):
            fresh = FakeProvider(105)
            self.assertEqual(self.fetch(fresh, max_age=stocks.TRADING_MAX_AGE)["AAPL"]["price"], 105)
            self.assertEqual(fresh.calls, 1)

    def test_public_ttl_accepts_30s_old_shared_data(self):
        self.fetch(FakeProvider(100))
        self.new_instance()
        with mock.patch.object(time, "time", return_value=time.time() + 30):
            p = FakeProvider(105)
            self.assertEqual(self.fetch(p, max_age=stocks.SHARED_TTL)["AAPL"]["price"], 100)
            self.assertEqual(p.calls, 0)

    def test_expired_shared_row_is_refreshed_and_replaced(self):
        self.fetch(FakeProvider(100))
        self.new_instance()
        with mock.patch.object(time, "time", return_value=time.time() + 120):
            self.assertEqual(self.fetch(FakeProvider(110), max_age=stocks.SHARED_TTL)["AAPL"]["price"], 110)
        self.new_instance()
        rows = db.connect().execute("SELECT COUNT(*) AS n FROM quote_cache").fetchone()
        self.assertEqual(rows["n"], 1)  # una fila por símbolo

    def test_provider_failure_falls_back_to_shared_data_marked_not_live(self):
        self.fetch(FakeProvider(100))
        self.new_instance()
        with mock.patch.object(time, "time", return_value=time.time() + 600):
            out = self.fetch(FakeProvider(fail=True), max_age=stocks.SHARED_TTL)
        self.assertEqual(out["AAPL"]["price"], 100)
        self.assertFalse(out["AAPL"]["live"])


class HealthRealtimeTest(unittest.TestCase):
    def test_health_tells_client_whether_websocket_is_available(self):
        from starlette.applications import Starlette
        from starlette.routing import Route
        from starlette.testclient import TestClient
        from backend import app as backend_app

        client = TestClient(Starlette(routes=[Route("/api/health", backend_app.api_health)]))
        with mock.patch.object(backend_app, "IS_VERCEL", True):
            self.assertIs(client.get("/api/health").json()["realtime"], False)
        with mock.patch.object(backend_app, "IS_VERCEL", False):
            self.assertIs(client.get("/api/health").json()["realtime"], True)


if __name__ == "__main__":
    unittest.main()
