"""Selector «Demo / Mi cuenta»: lo que hace Demo en el navegador nunca se convierte en órdenes del servidor.

Con sesión, la copia de Demo (alertas, favoritos, ajustes y la cuenta local) se guarda en /api/data como un JSON:
el servidor la almacena tal cual y no crea cuenta, órdenes ni ejecuciones. La cuenta del servidor solo cambia
por POST /api/portfolio/start y POST /api/orders, que exigen sesión."""
import os
import sys
import tempfile
import unittest
from contextlib import closing

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import _local_db  # noqa: F401,E402  (antes que backend)

from backend import app as app_module, db  # noqa: E402
from backend.security import IP_TRADING_CALLS, USER_TRADING_CALLS  # noqa: E402

from starlette.testclient import TestClient  # noqa: E402

# Copia de Demo como la sube lib/auth.js (store.exportData): con posiciones, órdenes pendientes y operaciones
DEMO_BACKUP = {
    "app": "PaperPulse", "version": "3.0.0", "schemaVersion": 3,
    "account": {"hasPracticeAccount": True, "initialCapitalUsd": 1000, "balanceUsd": 400},
    "positions": [{"id": "a-1", "symbol": "BTC", "amount": 0.01, "entryPrice": 60000, "investedUsd": 600}],
    "pendingOrders": [{"id": "o-1", "symbol": "ETH", "type": "limit", "amount": 1, "limitPrice": 1, "reservedUsd": 1}],
    "trades": [{"id": "t-1", "symbol": "SOL", "amount": 1, "entryPrice": 100, "exitPrice": 120, "pnl": 20}],
    "watchlist": ["BTC"], "alerts": [], "settings": {},
}


class DemoIsolationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        IP_TRADING_CALLS.clear()
        USER_TRADING_CALLS.clear()
        self.client = TestClient(app_module.app, base_url="http://localhost:8000", headers={"Origin": "http://localhost:8000"})

    def count(self, table):
        with closing(db.connect()) as conn:
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def test_sin_sesion_no_se_puede_operar_en_el_servidor(self):
        order = {"clientOrderId": "c-1", "symbol": "BTC", "side": "buy", "type": "market", "quantity": "0.001"}
        self.assertEqual(self.client.post("/api/orders", json=order).status_code, 401)
        self.assertEqual(self.client.get("/api/portfolio").status_code, 401)
        self.assertEqual(self.count("orders"), 0)

    def test_la_copia_de_demo_en_api_data_no_crea_cuenta_ni_ordenes(self):
        r = self.client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": "clave-larga-1",
                                                          "acceptTerms": True, "ageConfirmed": True})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertEqual(self.client.put("/api/data", json={"data": DEMO_BACKUP}).status_code, 200)
        for table in ("accounts", "orders", "fills", "positions"):
            self.assertEqual(self.count(table), 0, table)
        # Mi cuenta sigue sin crear: el saldo se elige aparte (POST /api/portfolio/start)
        self.assertTrue(self.client.get("/api/portfolio").json().get("needsSetup"))
        self.assertEqual(self.client.get("/api/data").json()["data"]["positions"][0]["symbol"], "BTC")


if __name__ == "__main__":
    unittest.main()
