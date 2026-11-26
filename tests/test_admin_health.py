"""/api/admin/health: solo para administradores; los sondeos no devuelven trazas ni lanzan."""
import os
import sys
import unittest
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import admin  # noqa: E402
from test_admin_audit import Base  # noqa: E402


class HealthTest(Base):
    def test_sin_sesion_y_con_usuario_normal_se_rechaza(self):
        self.assertIn(self.client().get("/api/admin/health").status_code, (401, 403))
        self.assertEqual(self.client(self.ana).get("/api/admin/health").status_code, 403)

    def test_admin_recibe_un_resultado_por_servicio_sin_trazas(self):
        def boom():
            raise RuntimeError("secreto https://x?key=abc")
        ok = admin._probe("A", lambda: "bien")
        bad = admin._probe("B", boom)
        self.assertTrue(ok["ok"])
        self.assertFalse(bad["ok"])
        self.assertEqual(bad["detail"], "RuntimeError")  # solo el tipo: nunca el mensaje
        with mock.patch.object(admin, "api_health", return_value=[ok, bad]):
            r = self.client(self.boss).get("/api/admin/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual([c["name"] for c in r.json()["checks"]], ["A", "B"])


if __name__ == "__main__":
    unittest.main()
