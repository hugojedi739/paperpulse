"""La función de Vercel no lleva lo que no usa (excludeFiles), pero nunca deja fuera lo que necesita para arrancar y servir."""
import fnmatch
import json
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def patterns():
    cfg = json.load(open(os.path.join(ROOT, "vercel.json")))["functions"]["server.py"]
    m = re.fullmatch(r"\{(.*)\}", cfg["excludeFiles"])
    return m.group(1).split(",") if m else [cfg["excludeFiles"]]


def excluded(path):
    return any(fnmatch.fnmatch(path, p) or (p.startswith("**/") and fnmatch.fnmatch(path, p[3:])) for p in patterns())


class Bundle(unittest.TestCase):
    def test_no_excluye_nada_que_use_la_funcion(self):
        needed = ["server.py", "requirements.txt", "backend/app.py", "backend/templates/index.html",
                  "frontend/index.html", "frontend/js/main.js", "frontend/vendor/lightweight-charts.mjs", "frontend/manifest.json"]
        needed += [f"backend/migrations/{f}" for f in os.listdir(os.path.join(ROOT, "backend/migrations"))]
        for path in needed:
            self.assertFalse(excluded(path), f"{path} es necesario en la función")

    def test_excluye_lo_que_sirve_el_cdn_o_no_se_usa_en_ejecucion(self):
        for path in ["public/js/main.a034e152.js", "docs/referencia.md", "frontend/img/icon-192.png", "LICENSE",
                     "site-packages/pandas/tests/test_x.py", "tests/test_trading.py"]:
            self.assertTrue(excluded(path), path)

    def test_las_imagenes_excluidas_siguen_en_el_cdn(self):
        imgs = sorted(os.listdir(os.path.join(ROOT, "frontend/img")))
        self.assertEqual(imgs, sorted(os.listdir(os.path.join(ROOT, "public/img"))))


if __name__ == "__main__":
    unittest.main()
