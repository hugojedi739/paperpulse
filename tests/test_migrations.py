"""Tests de las migraciones .sql numeradas de backend/migrations/."""
import os
import sys
import tempfile
import unittest
from contextlib import closing

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402


class MigrationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "sub", "test.db")  # el directorio aún no existe

    def tearDown(self):
        self.tmp.cleanup()

    def tables(self):
        with closing(db.connect()) as conn:
            return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

    def test_numeracion_consecutiva(self):
        names = sorted(f for f in os.listdir(db.MIGRATIONS_DIR) if f.endswith(".sql"))
        self.assertEqual([int(n[:4]) for n in names], list(range(1, len(names) + 1)))
        self.assertEqual(len(db.load_migrations()), len(names))

    def test_hueco_en_la_numeracion_falla(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ("0001_a.sql", "0003_c.sql"):
                with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
                    fh.write("SELECT 1;")
            with self.assertRaises(RuntimeError):
                db.load_migrations(d)

    def test_base_nueva_queda_al_dia(self):
        self.assertEqual(db.schema_status()["current"], 0)
        db.init_db()
        st = db.schema_status()
        self.assertEqual(st["current"], st["latest"])
        self.assertTrue({"users", "sessions", "practice_data", "identities", "settings", "oauth_states"} <= self.tables())

    def test_es_idempotente(self):
        db.init_db()
        db.init_db()  # una segunda pasada no reaplica nada (si lo hiciera, CREATE TABLE fallaría)
        self.assertEqual(db.schema_status()["current"], len(db.load_migrations()))

    def test_continua_desde_una_version_intermedia(self):
        # Simula una base creada cuando solo existía la 0001
        with closing(db.connect()) as conn:
            for stmt in db.split_statements(db.load_migrations()[0]):
                conn.execute(stmt)
            conn.execute("PRAGMA user_version = 1")
        db.init_db()
        with closing(db.connect()) as conn:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(users)")}
        self.assertIn("role", cols)
        self.assertEqual(db.schema_status()["current"], len(db.load_migrations()))

    def test_split_statements_ignora_comentarios(self):
        sql = "-- comentario; con punto y coma\nCREATE TABLE a (x INTEGER);\n\n-- otro\nCREATE TABLE b (y TEXT);\n-- final\n"
        self.assertEqual(db.split_statements(sql), ["CREATE TABLE a (x INTEGER)", "CREATE TABLE b (y TEXT)"])


if __name__ == "__main__":
    unittest.main()
