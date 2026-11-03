"""Tests de las migraciones .sql numeradas de backend/migrations/."""
import os
import sys
import tempfile
import unittest
from contextlib import closing
from unittest import mock

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


MOUNTS = """overlay / overlay rw,relatime 0 0
host /workspaces/app virtiofs rw,relatime 0 0
/dev/vdb /workspaces/app/data ext4 rw,relatime 0 0
host /mnt/mi\\040carpeta 9p rw 0 0
"""


class FilesystemTest(unittest.TestCase):
    """Regresión: registrarse devolvía HTTP 500 con DATABASE_PATH en /workspaces (virtiofs sobre Windows).

    Allí el inodo del fichero cambia tras el primer fsync y SQLite corrompe la base (WAL) o la trata como movida
    (DELETE). Ahora la base nunca se crea en esos sistemas de ficheros.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.mounts = os.path.join(self.tmp.name, "mounts")
        with open(self.mounts, "w", encoding="utf-8") as fh:
            fh.write(MOUNTS)
        db.USE_TURSO = False

    def tearDown(self):
        self.tmp.cleanup()

    def test_detecta_el_punto_de_montaje_mas_largo(self):
        fs = lambda p: db.filesystem_type(p, self.mounts)
        self.assertEqual(fs("/workspaces/app/prueba.db"), "virtiofs")
        self.assertEqual(fs("/workspaces/app/backend/x.db"), "virtiofs")
        self.assertEqual(fs("/workspaces/app/data/prueba.db"), "ext4")  # p. ej. un volumen de Docker montado en data/
        self.assertEqual(fs("/workspaces/application/x.db"), "overlay")  # prefijo de texto, no de ruta
        self.assertEqual(fs("/mnt/mi carpeta/x.db"), "9p")  # espacios escapados como \\040 en /proc/mounts
        self.assertIsNone(db.filesystem_type("/x.db", os.path.join(self.tmp.name, "no-existe")))

    def test_no_arranca_sobre_un_sistema_de_ficheros_inseguro(self):
        path = os.path.join(self.tmp.name, "prueba.db")
        with mock.patch.object(db, "DB_PATH", path), mock.patch.object(db, "unsafe_filesystem", return_value="virtiofs"):
            with self.assertRaisesRegex(db.UnsafeFilesystemError, "virtiofs"):
                db.init_db()
        self.assertFalse(os.path.exists(path))  # no se llega a crear (ni a corromper) la base

    def test_ruta_por_defecto_fuera_de_la_carpeta_compartida(self):
        with mock.patch.object(db, "unsafe_filesystem", return_value="virtiofs"), mock.patch.object(db, "IS_VERCEL", False):
            self.assertTrue(db._default_db_path().endswith(os.path.join(".local", "share", "paperpulse", "paperpulse.db")))
        with mock.patch.object(db, "unsafe_filesystem", return_value=None), mock.patch.object(db, "IS_VERCEL", False):
            self.assertEqual(db._default_db_path(), os.path.join(db.ROOT_DIR, "data", "paperpulse.db"))

    def test_varias_escrituras_seguidas_en_disco_local(self):
        """Lo que fallaba: la primera escritura iba bien y la siguiente daba error (registro -> 500)."""
        with mock.patch.object(db, "DB_PATH", os.path.join(self.tmp.name, "local.db")):
            db.init_db()
            for i in range(3):
                self.assertIsNotNone(db.create_user(f"u{i}@example.com", "secreto123", "U"))
                self.assertIsNotNone(db.authenticate(f"u{i}@example.com", "secreto123"))
            self.assertEqual(db.integrity(), "ok")

    @unittest.skipUnless(db.unsafe_filesystem(os.path.join(db.ROOT_DIR, "data", "x.db")),
                         "solo en un dev container con el repositorio en una carpeta compartida (virtiofs, 9p...)")
    def test_entorno_real_la_carpeta_data_del_repositorio(self):
        with mock.patch.object(db, "DB_PATH", os.path.join(db.ROOT_DIR, "data", "no-debe-crearse.db")):
            with self.assertRaises(db.UnsafeFilesystemError):
                db.init_db()
            self.assertFalse(os.path.exists(db.DB_PATH))


if __name__ == "__main__":
    unittest.main()
