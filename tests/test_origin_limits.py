"""Seguridad transversal: el asistente exige mismo origen y JSON; los datos públicos de mercado tienen límite por IP."""
import os
import sys
import tempfile
import time
import unittest

import _local_db  # noqa: F401  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db, security  # noqa: E402
from backend.market import fx  # noqa: E402

from starlette.testclient import TestClient  # noqa: E402


class OriginAndLimits(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        security.IP_STOCK_CALLS.clear()
        from backend import app as app_module
        self.client = TestClient(app_module.app, base_url="http://testserver")

    def tearDown(self):
        self.client.close()
        security.IP_STOCK_CALLS.clear()
        self.tmp.cleanup()

    def test_chat_rechaza_otro_origen_y_lo_que_no_es_json(self):
        r = self.client.post("/api/chat", json={"message": "hola"}, headers={"Origin": "https://evil.example"})
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/api/chat", content=b'{"message": "hola"}', headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 415)
        # mismo origen y JSON: pasa a la verificación anti-bot (sin desafío, 403 por eso y no por el origen)
        r = self.client.post("/api/chat", json={"message": "hola"}, headers={"Origin": "http://testserver"})
        self.assertEqual(r.status_code, 403)
        self.assertIn("anti-bot", r.json()["error"])

    def test_tipos_de_cambio_y_mercados_tienen_limite_por_ip(self):
        fx.FX_CACHE.update({"timestamp": time.time(), "rates": {"EUR": 0.9}})  # sin red: sirve la caché
        for path in ("/api/rates", "/api/markets"):
            security.IP_STOCK_CALLS.clear()
            codes = [self.client.get(path).status_code for _ in range(245)]
            self.assertEqual(codes[0], 200, path)
            self.assertEqual(codes[-1], 429, path)


if __name__ == "__main__":
    unittest.main()
