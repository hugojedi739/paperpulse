"""Las cabeceras de seguridad del CDN de Vercel (vercel.json) no se desvían de las que pone el backend."""
import json
import os
import sys
import unittest

import _local_db  # noqa: F401,E402  (antes que backend)
ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)
from backend.app import SECURITY_HEADERS  # noqa: E402


class VercelHeaders(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "vercel.json"), encoding="utf-8") as f:
            self.rules = {r["source"]: {h["key"].lower(): h["value"] for h in r["headers"]} for r in json.load(f)["headers"]}
        self.backend = {k.decode(): v.decode() for k, v in SECURITY_HEADERS}

    def test_las_cabeceras_globales_coinciden_con_las_del_backend(self):
        globales = self.rules["/(.*)"]
        for clave in ("x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy"):
            self.assertEqual(globales.get(clave), self.backend[clave], clave)

    def test_la_regla_global_no_lleva_csp(self):
        # La regla global también alcanza a la función y a /sw.js: una segunda CSP se sumaría a la de la app
        self.assertNotIn("content-security-policy", self.rules["/(.*)"])

    def test_codigo_e_imagenes_estaticos_van_protegidos(self):
        self.assertEqual(self.rules["/(js|css|vendor)/(.*)"]["cross-origin-resource-policy"], "same-origin")
        self.assertIn("sandbox", self.rules["/img/(.*)"]["content-security-policy"])


if __name__ == "__main__":
    unittest.main()
