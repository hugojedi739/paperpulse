"""Tests del histórico de velas y del relay WebSocket (sin red: los proveedores se simulan)."""
import asyncio
import os
import sys
import time
import unittest
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend.market import candles, crypto, stream  # noqa: E402

from starlette.applications import Starlette  # noqa: E402
from starlette.routing import Route  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402


def bar(t, o=10, h=12, l=9, c=11, v=1):
    return {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": v}


class CandlesTest(unittest.TestCase):
    def setUp(self):
        crypto._CACHE.clear()
        self.client = TestClient(Starlette(routes=[Route("/api/candles", candles.api_candles)]))

    def test_aggregate_groups_within_each_session(self):
        day = 20000 * 86400
        start = day + 13 * 3600 + 1800  # 13:30 UTC
        hourly = [bar(start + i * 3600, o=i, h=i + 1, l=i - 1, c=i + 0.5, v=10) for i in range(7)]
        hourly += [bar(day + 86400 + 13 * 3600 + 1800, o=100)]  # día siguiente
        four = candles.aggregate(hourly, 4 * 3600)
        self.assertEqual([c["time"] for c in four], [start, start + 4 * 3600, day + 86400 + 13 * 3600 + 1800])
        self.assertEqual((four[0]["open"], four[0]["close"], four[0]["high"], four[0]["low"], four[0]["volume"]), (0, 3.5, 4, -1, 40))
        self.assertEqual(four[1]["volume"], 30)

    def test_stock_window_respects_yahoo_limits(self):
        now = int(time.time())
        start, end, more = candles.stock_window("1m", 60, 500, now, now)
        self.assertLessEqual(end - start, 7 * 86400)
        self.assertTrue(more)
        # Más allá de los 30 días de 1m de Yahoo no hay más páginas
        start, _, more = candles.stock_window("1m", 60, 500, now - 28 * 86400, now)
        self.assertEqual(start, now - candles.YAHOO_LOOKBACK["1m"])
        self.assertFalse(more)
        # Diario: sin límite de antigüedad, ~500 sesiones
        start, end, more = candles.stock_window("1d", 86400, 500, now, now)
        self.assertGreater(end - start, 700 * 86400)
        self.assertTrue(more)

    def test_crypto_pagination_passes_end_time(self):
        page = [bar(1000 + i * 60) for i in range(10)]
        with mock.patch.object(crypto, "binance_get", return_value=[[c["time"] * 1000, "1", "2", "0.5", "1.5", "3"] for c in page]) as get:
            r = self.client.get("/api/candles?symbol=BTCUSDT&type=crypto&interval=1m&limit=10&end=5000").json()
        self.assertEqual(get.call_args.args[1]["endTime"], 5000 * 1000 - 1)
        self.assertEqual(len(r["candles"]), 10)
        self.assertTrue(r["hasMore"])
        self.assertEqual(r["candles"][0]["close"], 1.5)

    def test_stock_history_uses_provider_and_aggregates(self):
        provider = mock.Mock()
        provider.fetch_history.return_value = [bar(86400 * 20000 + i * 3600) for i in range(4)]
        with mock.patch.object(candles.stocks, "provider", return_value=provider):
            r = self.client.get("/api/candles?symbol=SAN&type=stock&interval=2h&limit=50").json()
        self.assertEqual(provider.fetch_history.call_args.args[:2], ("SAN.MC", "60m"))
        self.assertEqual(len(r["candles"]), 2)

    def test_validation(self):
        self.assertEqual(self.client.get("/api/candles?symbol=BTCUSDT&interval=7m").status_code, 400)
        self.assertEqual(self.client.get("/api/candles?symbol=<script>&interval=1h").status_code, 400)
        self.assertEqual(self.client.get("/api/candles?symbol=BTCUSDT&interval=1h&end=ayer").status_code, 400)


class RelayTest(unittest.TestCase):
    def test_stream_validation_and_refcount(self):
        async def scenario():
            hub = stream.Hub()
            hub.ensure_upstream = lambda: None  # sin red
            a, b = stream.Client(None, "1.1.1.1"), stream.Client(None, "2.2.2.2")
            hub.subscribe(a, ["btcusdt@ticker", "btcusdt@kline_4h", "BTCUSDT@ticker", "btcusdt@trade", "x@depth20@100ms"])
            hub.subscribe(b, ["btcusdt@ticker"])
            self.assertEqual(hub.wanted(), {"btcusdt@ticker", "btcusdt@kline_4h"})
            hub.publish("btcusdt@ticker", "{}")
            self.assertEqual((a.queue.qsize(), b.queue.qsize()), (1, 1))
            hub.remove(a)
            self.assertEqual(hub.wanted(), {"btcusdt@ticker"})
            hub.unsubscribe(b, ["btcusdt@ticker"])
            self.assertEqual(hub.wanted(), set())
        asyncio.run(scenario())

    def test_stream_name_parsing(self):
        self.assertEqual(stream.stream_of('{"stream":"ethusdt@ticker","data":{}}'), "ethusdt@ticker")
        self.assertEqual(stream.stream_of('{ "stream": "ethusdt@ticker", "data": {} }'), "ethusdt@ticker")
        self.assertIsNone(stream.stream_of('{"result":null,"id":1}'))


class LazyImportsTest(unittest.TestCase):
    def test_app_import_does_not_load_anthropic_or_yfinance(self):
        import subprocess
        code = "import sys; import backend.app; sys.exit(int('anthropic' in sys.modules or 'yfinance' in sys.modules))"
        root = os.path.join(os.path.dirname(__file__), "..")
        env = {**os.environ, "TURSO_DATABASE_URL": "", "TURSO_AUTH_TOKEN": ""}
        self.assertEqual(subprocess.run([sys.executable, "-c", code], cwd=root, env=env).returncode, 0)


if __name__ == "__main__":
    unittest.main()
