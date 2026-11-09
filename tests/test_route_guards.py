"""Ninguna ruta de administración responde sin rol de admin, y el WebSocket del mercado rechaza orígenes ajenos."""
import os
import sys
import tempfile
import unittest

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from starlette.routing import Route  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from backend import app as app_module, db  # noqa: E402


class RouteGuardsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        self.client = TestClient(app_module.app)

    def tearDown(self):
        self.tmp.cleanup()

    def test_rutas_admin_exigen_admin(self):
        probadas = 0
        for r in app_module.routes:
            if not isinstance(r, Route) or not r.path.startswith("/api/admin/"):
                continue
            path = r.path.replace("{id}", "1").replace("{provider}", "google")
            path = path.replace("{post_id:int}", "1").replace("{user_id:int}", "1").replace("{action:str}", "hide")
            for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
                res = self.client.request(method, path, json={})
                self.assertIn(res.status_code, (401, 403), f"{method} {r.path} respondió {res.status_code} sin sesión")
                probadas += 1
        self.assertGreater(probadas, 15)

    def test_websocket_rechaza_origen_ajeno(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/ws/market", headers={"origin": "https://malo.example"}):
                pass


if __name__ == "__main__":
    unittest.main()
