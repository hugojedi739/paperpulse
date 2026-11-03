"""Transacciones largas en Turso: reintento si el servidor las cancela y ROLLBACK que no tapa el error original."""
import os
import sys
import tempfile
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402

IDLE = ValueError('Hrana: `stream error: `Error { message: "SQLite error: interactive transaction was rolled back because the stream was idle for too long; retry the transaction", code: "SQLITE_BUSY" }``')


class RetryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO, db.DB_PATH = False, os.path.join(self.tmp.name, "t.db")
        db.init_db()
        self.addCleanup(self.tmp.cleanup)

    def users(self):
        with closing(db.connect()) as conn:
            return conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0]

    def test_reconoce_los_errores_transitorios(self):
        self.assertTrue(db.is_transient(IDLE))
        self.assertTrue(db.is_transient(ValueError("SQLite error: cannot rollback - no transaction is active")))
        self.assertFalse(db.is_transient(ValueError("UNIQUE constraint failed: users.email")))
        self.assertFalse(db.is_transient(KeyError("x")))

    def test_reintenta_la_transaccion_entera_y_solo_queda_un_intento_confirmado(self):
        calls = []

        def fn(conn):
            conn.execute("INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, 'v', 1, NULL)", (f"k{len(calls)}",))
            calls.append(1)
            if len(calls) < 3:
                raise IDLE  # el servidor cancela la transacción a mitad
            return "hecho"

        with mock.patch("backend.db.time.sleep"):
            self.assertEqual(db.retry_transaction(fn), "hecho")
        self.assertEqual((len(calls), self.users()), (3, 1))  # los dos intentos fallidos se revirtieron

    def test_no_reintenta_errores_reales_y_se_rinde_tras_los_intentos(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "UNIQUE"):
            db.retry_transaction(lambda conn: (calls.append(1), (_ for _ in ()).throw(ValueError("UNIQUE constraint failed"))))
        self.assertEqual(len(calls), 1)
        calls.clear()
        with mock.patch("backend.db.time.sleep"), self.assertRaises(ValueError):
            db.retry_transaction(lambda conn: (calls.append(1), (_ for _ in ()).throw(IDLE)), attempts=3)
        self.assertEqual(len(calls), 3)

    def test_un_rollback_fallido_no_tapa_el_error_original(self):
        real = db.Connection.execute

        def execute(self, sql, params=()):
            if sql == "ROLLBACK":
                raise ValueError("cannot rollback - no transaction is active")
            return real(self, sql, params)

        with mock.patch.object(db.Connection, "execute", execute), self.assertRaisesRegex(RuntimeError, "el error de verdad"):
            with db.transaction():
                raise RuntimeError("el error de verdad")


if __name__ == "__main__":
    unittest.main()
