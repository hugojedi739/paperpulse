"""Base local: dos hilos que escriben a la vez esperan su turno; no se congelan ni acaban en «database is locked»."""
import os
import sys
import threading
import time
import unittest
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402


class LocalLock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()

    def test_una_transaccion_espera_a_otra_en_curso_y_entra_al_soltarse(self):
        dentro, resultado = threading.Event(), {}

        def lenta():
            with db.transaction() as conn:
                conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lock_test', 'a', 0)")
                dentro.set()
                time.sleep(0.6)  # la transacción sigue abierta mientras la otra intenta entrar

        hilo = threading.Thread(target=lenta)
        hilo.start()
        self.assertTrue(dentro.wait(5))
        inicio = time.time()
        with db.transaction() as conn:  # antes: 5 s de bloqueo y ValueError("database is locked")
            conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lock_test', 'b', 0)")
        resultado["espera"] = time.time() - inicio
        hilo.join()
        self.assertLess(resultado["espera"], 3)
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT value FROM settings WHERE key = 'lock_test'").fetchone()["value"], "b")

    def test_una_escritura_suelta_tambien_espera_a_la_transaccion(self):
        dentro = threading.Event()

        def lenta():
            with db.transaction() as conn:
                conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lock_test2', 'a', 0)")
                dentro.set()
                time.sleep(0.5)

        hilo = threading.Thread(target=lenta)
        hilo.start()
        self.assertTrue(dentro.wait(5))
        inicio = time.time()
        with closing(db.connect()) as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lock_test3', 'c', 0)")
        hilo.join()
        self.assertLess(time.time() - inicio, 3)

    def test_muchos_hilos_a_la_vez_sin_errores(self):
        errores = []

        def escribir(i):
            try:
                with db.transaction() as conn:
                    conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 0)", (f"lock_many_{i}", str(i)))
                    time.sleep(0.01)
            except Exception as exc:  # noqa: BLE001
                errores.append(exc)

        hilos = [threading.Thread(target=escribir, args=(i,)) for i in range(20)]
        for h in hilos:
            h.start()
        for h in hilos:
            h.join()
        self.assertEqual(errores, [])
        with closing(db.connect()) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM settings WHERE key LIKE 'lock_many_%'").fetchone()[0], 20)

    def test_el_candado_es_reentrante(self):
        with db.transaction() as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('lock_re', '1', 0)")
            self.assertEqual(conn.execute("SELECT value FROM settings WHERE key = 'lock_re'").fetchone()["value"], "1")


if __name__ == "__main__":
    unittest.main()
