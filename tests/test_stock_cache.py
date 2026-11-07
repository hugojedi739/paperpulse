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
    """`realtime` de /api/health refleja el estado real del relay, no la plataforma: el navegador lo usa para decidir si
    sigue intentando el WebSocket o se queda en REST."""

    def health(self, **patches):
        from starlette.applications import Starlette
        from starlette.routing import Route
        from starlette.testclient import TestClient
        from backend import app as backend_app
        from backend.market import stream

        client = TestClient(Starlette(routes=[Route("/api/health", backend_app.api_health)]))
        with mock.patch.object(stream, "REALTIME_ENABLED", patches.get("enabled", True)), \
                mock.patch.object(stream.hub, "failures", patches.get("failures", 0)), \
                mock.patch.object(backend_app, "IS_VERCEL", patches.get("vercel", False)):
            return client.get("/api/health").json()

    def test_activo_por_defecto_tambien_en_vercel(self):
        self.assertIs(self.health(vercel=False)["realtime"], True)
        self.assertIs(self.health(vercel=True)["realtime"], True)  # el WebSocket funciona en Vercel (medido en producción)

    def test_se_puede_desactivar_por_configuracion(self):
        self.assertIs(self.health(enabled=False)["realtime"], False)
        self.assertIs(self.health(enabled=False, vercel=True)["realtime"], False)

    def test_un_relay_que_no_conecta_con_binance_se_considera_no_disponible(self):
        self.assertIs(self.health(failures=2)["realtime"], True)   # un tropiezo no basta
        self.assertIs(self.health(failures=3)["realtime"], False)  # varios seguidos sí
        self.assertIs(self.health(failures=50, vercel=True)["realtime"], False)

    def test_sin_conexion_todavia_no_cuenta_como_fallo(self):
        from backend.market import stream
        fresh = stream.Hub()  # relay recién creado: sin conexión con Binance, pero sin fallos
        self.assertIsNone(fresh.upstream)
        self.assertEqual(fresh.failures, 0)
        self.assertIs(self.health(failures=fresh.failures)["realtime"], True)

    def test_el_estado_del_relay_expone_los_fallos_seguidos(self):
        from backend.market import stream
        with mock.patch.object(stream.hub, "failures", 2):
            self.assertEqual(stream.status()["upstreamFailures"], 2)

    def test_los_fallos_seguidos_suben_y_se_reinician_al_conectar(self):
        import asyncio
        from backend.market import stream

        class Fake:  # conexión de Binance simulada: no envía nada y se cierra
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            def __aiter__(self): return self
            async def __anext__(self): raise StopAsyncIteration

        hub = stream.Hub()
        hub.refs = {"btcusdt@ticker": {object()}}  # alguien quiere ese stream
        attempts = []

        def connect(*a, **k):
            attempts.append(1)
            if len(attempts) <= 2:
                raise OSError("sin red")
            hub.refs = {}  # a la tercera se conecta y ya no hace falta: el bucle termina
            return Fake()

        async def run():
            real_sleep = asyncio.sleep
            async def fast(_): await real_sleep(0)
            with mock.patch.object(stream.websockets, "connect", connect), mock.patch.object(stream.asyncio, "sleep", fast):
                await hub.run_upstream()
        asyncio.run(run())
        self.assertEqual(len(attempts), 3)
        self.assertEqual(hub.failures, 0)  # conectó: contador a cero


if __name__ == "__main__":
    unittest.main()
