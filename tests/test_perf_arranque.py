"""Rendimiento del arranque y del inicio de sesión: nada caro al importar y una sentencia menos por login."""
import os
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")


class Arranque(unittest.TestCase):
    def test_importar_la_app_no_calcula_ningun_scrypt(self):
        code = ("import hashlib; calls = []; real = hashlib.scrypt\n"
                "hashlib.scrypt = lambda *a, **k: calls.append(1) or real(*a, **k)\n"
                "import backend.app; print(len(calls))")
        out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, check=True,
                             env={**os.environ, "TURSO_DATABASE_URL": "", "TURSO_AUTH_TOKEN": ""})
        self.assertEqual(out.stdout.strip().splitlines()[-1], "0")

    def test_hash_de_relleno_se_calcula_una_vez_y_nunca_coincide(self):
        self.assertIs(db.dummy_hash(), db.dummy_hash())
        self.assertFalse(db.verify_password("cualquiera", db.dummy_hash()))


class Sesiones(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        self.uid = db.create_user("ana@example.com", "secreto123", "Ana")["id"]
        with closing(db.connect()) as conn:
            conn.execute("INSERT INTO sessions VALUES (?, ?, 0, ?)", (db.token_hash("tok-caducado"), self.uid, int(time.time()) - 10))

    def tearDown(self):
        self.tmp.cleanup()

    def count(self):
        with closing(db.connect()) as conn:
            return conn.execute("SELECT COUNT(*) FROM sessions WHERE token_hash = ?", (db.token_hash("tok-caducado"),)).fetchone()[0]

    def test_las_caducadas_se_borran_solo_de_vez_en_cuando_al_entrar(self):
        with mock.patch.object(db.secrets, "randbelow", return_value=7):
            db.create_session(self.uid)
        self.assertEqual(self.count(), 1)  # esta vez no (lo hace el cron diario)
        with mock.patch.object(db.secrets, "randbelow", return_value=0):
            token = db.create_session(self.uid)
        self.assertEqual(self.count(), 0)
        self.assertEqual(db.session_user(token)["id"], self.uid)

    def test_una_sesion_caducada_nunca_sirve_aunque_siga_en_la_tabla(self):
        with mock.patch.object(db.secrets, "randbelow", return_value=7):
            db.create_session(self.uid)
        self.assertEqual(self.count(), 1)
        self.assertIsNone(db.session_user("tok-caducado"))


if __name__ == "__main__":
    unittest.main()
