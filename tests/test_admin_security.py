"""Seguridad del rol de administrador y del email verificado (preparación de producción)."""
import os
import sys
import tempfile
import unittest
from contextlib import closing
from unittest import mock

import _local_db  # noqa: F401,E402  (antes que backend)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import db  # noqa: E402

ME = "admin@example.com"


class AdminSecurityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        db.USE_TURSO = False
        db.DB_PATH = os.path.join(self.tmp.name, "test.db")
        db.init_db()
        self.admins = mock.patch.object(db, "ADMIN_EMAILS", {ME})
        self.admins.start()

    def tearDown(self):
        self.admins.stop()
        self.tmp.cleanup()

    def google(self, email=ME, sub="g-1", verified=True, allow=True):
        return db.oauth_user("google", sub, email, "Hugo", allow, verified)

    def test_registrarse_con_el_correo_del_admin_no_da_rol_ni_antes_ni_despues(self):
        attacker = db.create_user(ME, "contraseña-del-atacante", "Intruso")
        self.assertEqual((attacker["role"], attacker["emailVerified"]), ("user", False))
        self.assertEqual(db.authenticate(ME, "contraseña-del-atacante")["role"], "user")  # ni al entrar de nuevo

    def test_el_dueno_entra_con_google_y_el_atacante_pierde_el_acceso(self):
        attacker = db.create_user(ME, "contraseña-del-atacante", "Intruso")
        token = db.create_session(attacker["id"])
        owner = self.google()["user"]
        self.assertEqual(owner["id"], attacker["id"])  # misma fila (email único)
        self.assertEqual((owner["role"], owner["emailVerified"], owner["hasPassword"]), ("admin", True, False))
        self.assertIsNone(db.authenticate(ME, "contraseña-del-atacante"))  # la contraseña ya no vale
        self.assertIsNone(db.session_user(token))  # ni la sesión que el atacante tenía abierta

    def test_google_nuevo_con_email_verificado_en_admin_emails_es_admin_otro_no(self):
        self.assertEqual(self.google()["user"]["role"], "admin")
        self.assertEqual(self.google("otra@gmail.com", "g-2")["user"]["role"], "user")

    def test_email_no_verificado_del_proveedor_no_crea_ni_vincula(self):
        self.assertEqual(self.google(verified=False), {"error": "email_unverified"})
        self.assertEqual(db.list_users()["total"], 0)
        existing = db.create_user("ana@example.com", "secreto123", "Ana")
        self.assertEqual(db.oauth_user("google", "g-3", "ana@example.com", "Ana", True, False), {"error": "email_unverified"})
        self.assertTrue(db.authenticate("ana@example.com", "secreto123"))  # sigue como estaba
        self.assertFalse(db.get_user(existing["id"])["emailVerified"])

    def test_promover_por_cli_exige_cuenta_existente_y_verificada(self):
        ok, msg = db.promote_admin(ME)
        self.assertFalse(ok)
        self.assertIn("No existe", msg)
        db.create_user("pass@example.com", "secreto123", "P")
        ok, msg = db.promote_admin("pass@example.com")
        self.assertFalse(ok)
        self.assertIn("verificado", msg)
        self.assertEqual(db.list_admins(), [])
        self.assertTrue(db.promote_admin("pass@example.com", force=True)[0])  # solo desarrollo
        owner = db.oauth_user("google", "g-9", "otro@gmail.com", "Otro", True, True)["user"]
        self.assertTrue(db.promote_admin("otro@gmail.com")[0])
        self.assertEqual([a["email"] for a in db.list_admins()], ["pass@example.com", "otro@gmail.com"])
        self.assertEqual(db.count_admins(), 2)
        self.assertEqual(db.get_user(owner["id"])["role"], "admin")

    def test_demo_se_niega_en_produccion(self):
        for patch in (mock.patch.object(db, "TURSO_URL", "libsql://x.turso.io"), mock.patch.dict(os.environ, {"ENV": "production"}),
                      mock.patch.object(db, "IS_VERCEL", True)):
            with patch, self.assertRaises(SystemExit) as cm:
                db.refuse_demo_in_production()
            self.assertIn("solo es para desarrollo", str(cm.exception))
        self.assertEqual(db.list_users()["total"], 0)

    def test_migracion_marca_verificadas_solo_las_cuentas_con_proveedor(self):
        """Cuentas anteriores a la 0006: las de Google quedan verificadas y ninguna se borra ni se bloquea."""
        db.DB_PATH = os.path.join(self.tmp.name, "old.db")
        with closing(db.connect()) as conn:
            for sql in db.load_migrations()[:5]:
                for stmt in db.split_statements(sql):
                    conn.execute(stmt)
            conn.execute("PRAGMA user_version = 5")
            conn.execute("INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (1, 'g@gmail.com', 'G', '', 1, 'user')")
            conn.execute("INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (2, 'p@example.com', 'P', 'x', 1, 'user')")
            conn.execute("INSERT INTO identities VALUES ('google', 's1', 1, 'g@gmail.com', 1)")
        db.init_db()
        with closing(db.connect()) as conn:
            rows = {r["email"]: (r["email_verified"], r["disabled"]) for r in conn.execute("SELECT * FROM users")}
        self.assertEqual(rows, {"g@gmail.com": (1, 0), "p@example.com": (0, 0)})


if __name__ == "__main__":
    unittest.main()
