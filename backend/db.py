"""
Persistencia de PaperPulse sobre libSQL: usuarios, sesiones, identidades OAuth, ajustes y cuenta de práctica.

Con TURSO_DATABASE_URL y TURSO_AUTH_TOKEN usa Turso (persistente, p. ej. en Vercel); si no, un fichero
libSQL local (compatible con SQLite) en data/. Contraseñas con scrypt, sesiones en cookie HttpOnly
(se guarda el hash del token, nunca el token).

CLI:
  python -m backend.db migrate              aplica las migraciones pendientes (alias: init)
  python -m backend.db status               muestra la versión del esquema y las migraciones pendientes
  python -m backend.db demo                 crea demo@paperpulse.local (usuario) y admin@paperpulse.local (admin)
  python -m backend.db users                lista los usuarios
  python -m backend.db admin <email>        da el rol de administrador a una cuenta existente con email verificado
  python -m backend.db admins               lista los administradores
"""
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
from contextlib import closing, contextmanager
from typing import Dict, List, Optional

import libsql

from backend.config import ADMIN_EMAILS, IS_VERCEL, ROOT_DIR

TURSO_URL = os.getenv("TURSO_DATABASE_URL", "").strip()
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "").strip()
USE_TURSO = bool(TURSO_URL and TURSO_TOKEN)

# ---------------------------------------------------------------- dónde vive el fichero local
# SQLite no funciona de forma fiable en carpetas compartidas con el anfitrión, de red o de VM. En un dev container
# sobre Windows, /workspaces es virtiofs y el número de inodo de un fichero cambia tras el primer fsync: SQLite cree
# que la base «se ha movido» (modo DELETE: «attempt to write a readonly database») o pierde la cuenta de qué
# conexiones comparten bloqueos y memoria compartida (modo WAL: SIGBUS y «database disk image is malformed»).
UNSAFE_FS = {"virtiofs", "9p", "nfs", "nfs4", "cifs", "smb3", "smbfs", "vboxsf", "drvfs", "fakeowner",
             "fuse.grpcfuse", "fuse.osxfs", "fuse.sshfs"}


class UnsafeFilesystemError(RuntimeError):
    """La base local está en un sistema de ficheros donde SQLite se corrompe."""


def filesystem_type(path: str, mounts_file: str = "/proc/mounts") -> Optional[str]:
    """Tipo del sistema de ficheros que contiene `path` (el punto de montaje más largo que lo contiene). None si no se sabe."""
    target = os.path.realpath(os.path.dirname(os.path.abspath(path)))
    try:
        with open(mounts_file, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return None  # no es Linux (macOS/Windows nativos): se asume disco local
    best, kind = "", None
    for line in lines:
        parts = line.split()
        if len(parts) < 3:
            continue
        mount = parts[1].replace("\\040", " ")
        if (target == mount or target.startswith(mount.rstrip("/") + "/")) and len(mount) > len(best):
            best, kind = mount, parts[2]
    return kind


def unsafe_filesystem(path: str) -> Optional[str]:
    """Nombre del sistema de ficheros si SQLite no es fiable en él; None si es un disco local normal."""
    fs = filesystem_type(path)
    return fs if fs in UNSAFE_FS else None


def unsafe_message(path: str, fs: str) -> str:
    return (f"La base de datos {path} está en un sistema de ficheros «{fs}» (carpeta compartida con el anfitrión, "
            "de red o de máquina virtual) y SQLite la corrompería. Usa una ruta en el disco del contenedor "
            "(p. ej. DATABASE_PATH=~/paperpulse/prueba.db), quita DATABASE_PATH para usar la ruta por defecto o configura Turso.")


def _default_db_path() -> str:
    if IS_VERCEL:
        return "/tmp/paperpulse.db"  # sin Turso, en Vercel solo /tmp es escribible (y efímero)
    in_repo = os.path.join(ROOT_DIR, "data", "paperpulse.db")
    if unsafe_filesystem(in_repo):  # p. ej. dev container sobre Windows: se usa el disco del contenedor
        return os.path.join(os.path.expanduser("~"), ".local", "share", "paperpulse", "paperpulse.db")
    return in_repo


DB_PATH = os.path.expanduser(os.getenv("DATABASE_PATH", "").strip()) or _default_db_path()
DB_LABEL = TURSO_URL if USE_TURSO else DB_PATH  # la URL no contiene secretos; el token nunca se muestra
SESSION_TTL = 30 * 86400
OAUTH_STATE_TTL = 600
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}
ROLES = ("user", "admin")

# Migraciones: ficheros backend/migrations/NNNN_descripcion.sql, aplicados en orden y una sola vez.
# Para cambiar el esquema crea el siguiente número; nunca edites una migración ya aplicada en producción.
MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")


def load_migrations(directory: str = MIGRATIONS_DIR) -> List[str]:
    """Devuelve el SQL de cada migración ordenado por número (posición 0 = migración 0001).

    Exige numeración consecutiva desde 0001 para que un hueco o un número repetido no pase desapercibido.
    """
    files = sorted(f for f in os.listdir(directory) if f.endswith(".sql"))
    migrations = []
    for expected, name in enumerate(files, start=1):
        number = name.split("_", 1)[0]
        if not number.isdigit() or int(number) != expected:
            raise RuntimeError(f"Migración mal numerada: {name} (se esperaba {expected:04d}_...sql)")
        with open(os.path.join(directory, name), encoding="utf-8") as fh:
            migrations.append(fh.read())
    return migrations


def split_statements(sql: str) -> List[str]:
    """Separa un fichero .sql en sentencias. Quita las líneas de comentario (--) y corta por «;».

    Es deliberadamente simple: no admite «;» dentro de cadenas ni triggers (no los usamos).
    """
    code = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    return [s.strip() for s in code.split(";") if s.strip()]


# ---------------------------------------------------------------- conexión y esquema
class Row(tuple):
    """Fila que se lee por índice (row[0]), por nombre (row["email"]) y con dict(row)."""

    def __new__(cls, values, columns):
        row = super().__new__(cls, values)
        row._columns = columns
        return row

    def __getitem__(self, key):
        if isinstance(key, str):
            try:
                return super().__getitem__(self._columns.index(key))
            except ValueError:
                raise IndexError(f"No hay columna «{key}»") from None
        return super().__getitem__(key)

    def keys(self):
        return list(self._columns)


class Cursor:
    """Envuelve el cursor de libsql (que no es iterable y devuelve tuplas) para devolver Row."""

    def __init__(self, cur):
        self._cur = cur
        self.lastrowid = cur.lastrowid
        self.rowcount = cur.rowcount

    def _wrap(self, values):
        cols = tuple(d[0] for d in self._cur.description or ())
        return Row(values, cols)

    def fetchone(self):
        values = self._cur.fetchone()
        return None if values is None else self._wrap(values)

    def fetchall(self):
        return [self._wrap(v) for v in self._cur.fetchall()]

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql: str, params=()) -> Cursor:
        return Cursor(self._conn.execute(sql, tuple(params)))

    def executemany(self, sql: str, seq) -> None:
        for params in seq:
            self._conn.execute(sql, tuple(params))

    def close(self) -> None:
        self._conn.close()


def is_integrity_error(exc: Exception) -> bool:
    """libsql lanza ValueError/Error genéricos: se reconoce la violación de restricción por el mensaje."""
    return isinstance(exc, (ValueError, libsql.Error)) and "constraint failed" in str(exc).lower()


def connect() -> Connection:
    if USE_TURSO:
        conn = libsql.connect(TURSO_URL, auth_token=TURSO_TOKEN, isolation_level=None)  # autocommit (sin esto no se confirman las escrituras); Turso aplica las claves foráneas por defecto
        return Connection(conn)
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn = libsql.connect(DB_PATH, isolation_level=None)  # autocommit; transacciones explícitas
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return Connection(conn)


@contextmanager
def transaction():
    """BEGIN IMMEDIATE toma el bloqueo de escritura al empezar: dos peticiones simultáneas del mismo usuario
    se ejecutan una detrás de otra y la segunda ve el saldo ya actualizado por la primera."""
    with closing(connect()) as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def _get_version(conn) -> int:
    if not USE_TURSO:
        return conn.execute("PRAGMA user_version").fetchone()[0]
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")  # Turso no admite PRAGMA user_version
    row = conn.execute("SELECT MAX(version) FROM schema_version").fetchone()
    return row[0] or 0


def _set_version(conn, version: int) -> None:
    if USE_TURSO:
        conn.execute("DELETE FROM schema_version")
        conn.execute("INSERT INTO schema_version VALUES (?)", (version,))
    else:
        conn.execute(f"PRAGMA user_version = {version}")


def init_db() -> None:
    """Aplica las migraciones pendientes (PRAGMA user_version; tabla schema_version en Turso), cada una en su transacción."""
    if not USE_TURSO and (fs := unsafe_filesystem(DB_PATH)):
        raise UnsafeFilesystemError(unsafe_message(DB_PATH, fs))  # mejor no arrancar que corromper la base
    with closing(connect()) as conn:
        if not USE_TURSO:
            conn.execute("PRAGMA journal_mode = WAL")
        version = _get_version(conn)
        for i, sql in enumerate(load_migrations()[version:], start=version + 1):
            conn.execute("BEGIN")
            try:
                for statement in split_statements(sql):
                    conn.execute(statement)
                _set_version(conn, i)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
    if not USE_TURSO:
        try:
            os.chmod(DB_PATH, 0o600)
        except OSError:
            pass


# ---------------------------------------------------------------- contraseñas y tokens
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(digest) // 2)
        return hmac.compare_digest(calc.hex(), digest)
    except (ValueError, TypeError):
        return False


DUMMY_HASH = hash_password(secrets.token_hex(8))  # iguala el tiempo de respuesta si el email no existe
token_hash = lambda token: hashlib.sha256(token.encode()).hexdigest()


# ---------------------------------------------------------------- usuarios (síncrono, se llama en hilo)
def public_user(row) -> Dict:
    return {
        "id": row["id"], "email": row["email"], "name": row["name"], "createdAt": row["created_at"],
        "role": row["role"], "hasPassword": bool(row["password_hash"]), "emailVerified": bool(row["email_verified"]),
        "termsVersion": row["terms_version"],
    }


def _initial_role(email: str, verified: bool) -> str:
    """ADMIN_EMAILS solo concede el rol a emails VERIFICADOS (Google/Okta). Registrarse con email y contraseña
    nunca da el rol de administrador, aunque se use un email de la lista: así nadie puede adelantarse a su dueño."""
    return "admin" if verified and email.lower() in ADMIN_EMAILS else "user"


def create_user(email: str, password: Optional[str], name: str, accepted: bool = True) -> Optional[Dict]:
    """Crea un usuario. Sin contraseña (cuentas de Google/Okta) el hash queda vacío y no se puede entrar con email.

    `accepted`: ya aceptó términos y privacidad y confirmó la edad mínima. El registro HTTP exige las casillas y pasa True;
    por defecto True para los usos internos (pruebas, `demo`)."""
    with closing(connect()) as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (email, name, password_hash, created_at, role, email_verified, terms_version, terms_accepted_at, age_confirmed_at) "
                "VALUES (?, ?, ?, ?, 'user', 0, ?, ?, ?)",
                (email, name, hash_password(password) if password else "", int(time.time()), *(_legal_stamp() if accepted else (None, None, None))),
            )
        except (ValueError, libsql.Error) as exc:
            if not is_integrity_error(exc):
                raise
            return None
        return public_user(conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone())


def _legal_stamp():
    from backend.account import LEGAL_VERSION  # importación tardía: account depende de db
    now = int(time.time())
    return LEGAL_VERSION, now, now


def _touch_login(conn, row) -> Row:
    """Registra el acceso y aplica ADMIN_EMAILS solo a cuentas verificadas (promociona, nunca degrada)."""
    role = "admin" if row["email_verified"] and row["email"].lower() in ADMIN_EMAILS else row["role"]
    conn.execute("UPDATE users SET last_login_at = ?, role = ? WHERE id = ?", (int(time.time()), role, row["id"]))
    return conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()


def authenticate(email: str, password: str) -> Optional[Dict]:
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        stored = row["password_hash"] if row and row["password_hash"] else DUMMY_HASH
        if not verify_password(password, stored) or not row or not row["password_hash"] or row["disabled"]:
            return None
        return public_user(_touch_login(conn, row))


def get_user(user_id: int) -> Optional[Dict]:
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return public_user(row) if row else None


def oauth_user(provider: str, subject: str, email: str, name: str, allow_create: bool, email_verified: bool = False) -> Dict:
    """Resuelve el usuario de un inicio de sesión externo.

    Orden: identidad ya vinculada → usuario con ese email (se vincula) → usuario nuevo (si el registro está abierto).
    `email_verified` es el campo del id_token del proveedor: sin él no se crea ni se vincula nada.
    Si el email ya tenía una cuenta de email y contraseña SIN verificar, se le quitan la contraseña y las sesiones al
    vincularla: quien la registró no tiene por qué ser el dueño del email (ataque de «pre-registro»), y el dueño
    real acaba de demostrarlo con el proveedor. Seguirá entrando con Google.
    Devuelve {"user": ...} o {"error": código}.
    """
    if not email_verified:
        return {"error": "email_unverified"}
    now = int(time.time())
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?",
            (provider, subject),
        ).fetchone()
        if not row:
            row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if not row:
                if not allow_create:
                    return {"error": "registration_closed"}
                cur = conn.execute(
                    "INSERT INTO users (email, name, password_hash, created_at, role, email_verified) VALUES (?, ?, '', ?, ?, 1)",
                    (email, name[:40] or email.split("@")[0][:40], now, _initial_role(email, True)),
                )
                row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
            conn.execute(
                "INSERT OR IGNORE INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)",
                (provider, subject, row["id"], email, now),
            )
        if row["disabled"]:
            return {"error": "disabled"}
        if not row["email_verified"]:
            conn.execute("UPDATE users SET email_verified = 1, password_hash = '' WHERE id = ?", (row["id"],))
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
            row = conn.execute("SELECT * FROM users WHERE id = ?", (row["id"],)).fetchone()
        return {"user": public_user(_touch_login(conn, row))}


def delete_user(user_id: int) -> None:
    """Borra la cuenta anonimizándola (conserva la integridad del foro). Ver backend/account.py."""
    from backend.account import delete_account
    delete_account(user_id)


# ---------------------------------------------------------------- sesiones
def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with closing(connect()) as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)", (token_hash(token), user_id, now, now + SESSION_TTL))
    return token


def session_user(token: Optional[str]) -> Optional[Dict]:
    if not token or len(token) > 100:
        return None
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0",
            (token_hash(token), int(time.time())),
        ).fetchone()
        return public_user(row) if row else None


def delete_session(token: Optional[str]) -> None:
    if token:
        with closing(connect()) as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


# ---------------------------------------------------------------- estados OAuth (un solo uso, 10 min)
def save_oauth_state(state: str, provider: str, verifier: str, nonce: str) -> None:
    now = int(time.time())
    with closing(connect()) as conn:
        conn.execute("DELETE FROM oauth_states WHERE expires_at < ?", (now,))
        conn.execute("INSERT INTO oauth_states VALUES (?, ?, ?, ?, ?)", (token_hash(state), provider, verifier, nonce, now + OAUTH_STATE_TTL))


def pop_oauth_state(state: str) -> Optional[Dict]:
    with closing(connect()) as conn:
        row = conn.execute("SELECT * FROM oauth_states WHERE state_hash = ?", (token_hash(state),)).fetchone()
        if not row:
            return None
        conn.execute("DELETE FROM oauth_states WHERE state_hash = ?", (row["state_hash"],))
        return dict(row) if row["expires_at"] > time.time() else None


# ---------------------------------------------------------------- copia de la cuenta de práctica
def get_data(user_id: int) -> Optional[Dict]:
    with closing(connect()) as conn:
        row = conn.execute("SELECT payload, revision, updated_at FROM practice_data WHERE user_id = ?", (user_id,)).fetchone()
        return {"data": json.loads(row["payload"]), "revision": row["revision"], "updatedAt": row["updated_at"]} if row else None


def put_data(user_id: int, payload: str) -> Dict:
    now = int(time.time())
    with closing(connect()) as conn:
        conn.execute(
            """INSERT INTO practice_data (user_id, payload, revision, updated_at) VALUES (?, ?, 1, ?)
               ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, revision = revision + 1, updated_at = excluded.updated_at""",
            (user_id, payload, now),
        )
        rev = conn.execute("SELECT revision FROM practice_data WHERE user_id = ?", (user_id,)).fetchone()[0]
    return {"revision": rev, "updatedAt": now}


# ---------------------------------------------------------------- ajustes del panel de administración
def get_settings() -> Dict[str, str]:
    with closing(connect()) as conn:
        return {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}


def put_settings(values: Dict[str, Optional[str]], by: Optional[int]) -> None:
    """Guarda ajustes; None borra la clave (vuelve al valor de .env)."""
    now = int(time.time())
    with closing(connect()) as conn:
        conn.execute("BEGIN")
        for key, value in values.items():
            if value is None:
                conn.execute("DELETE FROM settings WHERE key = ?", (key,))
            else:
                conn.execute(
                    "INSERT INTO settings VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
                    (key, value, now, by),
                )
        conn.execute("COMMIT")


# ---------------------------------------------------------------- administración de usuarios
def list_users(query: str = "", limit: int = 50, offset: int = 0) -> Dict:
    like = f"%{query.strip()}%"
    with closing(connect()) as conn:
        where = "WHERE u.owner_id IS NULL AND u.deleted_at IS NULL AND (u.email LIKE ? OR u.name LIKE ? OR pr.alias LIKE ?)"
        total = conn.execute(f"SELECT COUNT(*) FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id {where}", (like, like, like)).fetchone()[0]
        rows = conn.execute(
            f"""SELECT u.*, GROUP_CONCAT(DISTINCT i.provider) AS providers,
                       (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions,
                       (SELECT updated_at FROM practice_data p WHERE p.user_id = u.id) AS data_at, pr.alias AS alias
                FROM users u LEFT JOIN identities i ON i.user_id = u.id LEFT JOIN profiles pr ON pr.user_id = u.id {where}
                GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?""",
            (int(time.time()), like, like, like, limit, offset),
        ).fetchall()
    users = [{
        **public_user(r), "disabled": bool(r["disabled"]), "lastLoginAt": r["last_login_at"],
        "providers": (["password"] if r["password_hash"] else []) + (r["providers"].split(",") if r["providers"] else []),
        "sessions": r["sessions"], "dataUpdatedAt": r["data_at"], "alias": r["alias"],
        "suspendedUntil": r["suspended_until"] if (r["suspended_until"] or 0) > time.time() else None,
        "suspensionReason": r["suspension_reason"] if (r["suspended_until"] or 0) > time.time() else None,
    } for r in rows]
    return {"total": total, "users": users}


def update_user(user_id: int, role: Optional[str] = None, disabled: Optional[bool] = None) -> Optional[Dict]:
    with closing(connect()) as conn:
        if role is not None:
            conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        if disabled is not None:
            conn.execute("UPDATE users SET disabled = ? WHERE id = ?", (int(disabled), user_id))
            if disabled:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return {**public_user(row), "disabled": bool(row["disabled"])} if row else None


def count_admins() -> int:
    with closing(connect()) as conn:
        return conn.execute("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0").fetchone()[0]


def stats() -> Dict:
    now = int(time.time())
    with closing(connect()) as conn:
        one = lambda sql, *a: conn.execute(sql, a).fetchone()[0]
        signups = conn.execute(
            "SELECT date(created_at, 'unixepoch') AS d, COUNT(*) AS n FROM users WHERE owner_id IS NULL AND deleted_at IS NULL AND created_at > ? GROUP BY d ORDER BY d",
            (now - 30 * 86400,),
        ).fetchall()
        return {
            "users": one("SELECT COUNT(*) FROM users WHERE owner_id IS NULL AND deleted_at IS NULL"),
            "admins": one("SELECT COUNT(*) FROM users WHERE role = 'admin' AND owner_id IS NULL AND deleted_at IS NULL"),
            "disabled": one("SELECT COUNT(*) FROM users WHERE disabled = 1 AND owner_id IS NULL AND deleted_at IS NULL"),
            "activeSessions": one("SELECT COUNT(*) FROM sessions WHERE expires_at > ?", now),
            "activeUsers7d": one("SELECT COUNT(*) FROM users WHERE owner_id IS NULL AND deleted_at IS NULL AND last_login_at > ?", now - 7 * 86400),
            "newUsers7d": one("SELECT COUNT(*) FROM users WHERE owner_id IS NULL AND deleted_at IS NULL AND created_at > ?", now - 7 * 86400),
            "withData": one("SELECT COUNT(*) FROM practice_data"),
            "byProvider": {r[0]: r[1] for r in conn.execute("SELECT provider, COUNT(*) FROM identities GROUP BY provider")},
            "signups30d": [{"date": r["d"], "count": r["n"]} for r in signups],
        }


# ---------------------------------------------------------------- CLI
def promote_admin(email: str, force: bool = False):
    """Da el rol de administrador a una cuenta EXISTENTE. Devuelve (ok, mensaje).

    Solo cuentas con email verificado (Google/Okta): una cuenta de email y contraseña pudo registrarla cualquiera.
    `force` (solo desarrollo) lo permite para cuentas sin verificar.
    """
    with closing(connect()) as conn:
        row = conn.execute("SELECT id, email_verified FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        if not row:
            return False, f"No existe ningún usuario con el email {email}. Crea primero la cuenta (en producción, entrando con Google)."
        if not row["email_verified"] and not force:
            return False, (f"La cuenta {email} no tiene el email verificado (se registró con email y contraseña). "
                           "Entra una vez con Google con ese email para verificarla. Solo en desarrollo: --force.")
        conn.execute("UPDATE users SET role = 'admin', disabled = 0 WHERE id = ?", (row["id"],))
    return True, f"{email} ahora es administrador."


def list_admins() -> List[Dict]:
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT u.id, u.email, u.name, u.email_verified, u.disabled, u.last_login_at, GROUP_CONCAT(i.provider) AS providers "
            "FROM users u LEFT JOIN identities i ON i.user_id = u.id WHERE u.role = 'admin' GROUP BY u.id ORDER BY u.id").fetchall()
    return [dict(r) for r in rows]


def refuse_demo_in_production() -> None:
    if TURSO_URL or os.getenv("ENV", "").lower() == "production" or IS_VERCEL:
        sys.exit("Error: `demo` crea usuarios de prueba con contraseñas públicas y solo es para desarrollo. "
                 "Se niega a ejecutarse con TURSO_DATABASE_URL definida, ENV=production o en Vercel.")


def _demo() -> None:
    refuse_demo_in_production()
    accounts = [("demo@paperpulse.local", "demo1234", "Demo", "user"), ("admin@paperpulse.local", "admin1234", "Admin", "admin")]
    with closing(connect()) as conn:
        conn.executemany("DELETE FROM users WHERE email = ?", [(a[0],) for a in accounts])
    for email, password, name, role in accounts:
        user = create_user(email, password, name)
        update_user(user["id"], role=role)
    now = time.time()
    trades = [
        {"id": f"demo-t{i}", "symbol": ["BTC", "ETH", "SOL", "NVDA"][i % 4], "amount": 0.5, "entryPrice": 100,
         "exitPrice": 100 + (i % 5 - 2) * 4, "investedUsd": 500, "pnl": (i % 5 - 2) * 20.0,
         "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - i * 2 * 86400)), "setup": "Prueba rápida", "emotion": "Disciplinado"}
        for i in range(12)
    ]
    demo_id = authenticate(accounts[0][0], accounts[0][1])["id"]
    put_data(demo_id, json.dumps({
        "app": "PaperPulse", "schemaVersion": 3,
        "account": {"hasPracticeAccount": True, "initialCapitalUsd": 10000, "balanceUsd": 7650},
        "positions": [{"id": "demo-1", "symbol": "BTC", "amount": 0.03, "entryPrice": 78000, "investedUsd": 2340, "openedAt": int(now * 1000)}],
        "trades": trades, "watchlist": ["BTC", "ETH", "SOL", "NVDA", "AAPL", "SAN"],
    }))
    for email, password, _, role in accounts:
        print(f"Usuario de prueba ({role}): {email} / {password}")


def schema_status() -> Dict:
    """Versión aplicada y número de migraciones disponibles (para la CLI y el panel)."""
    with closing(connect()) as conn:
        current = _get_version(conn)
    return {"current": current, "latest": len(load_migrations())}


def integrity() -> str:
    """'ok' si la base local está sana; si no, el error. PRAGMA user_version se lee de la cabecera y puede decir
    «al día» aunque el resto del fichero esté dañado, así que `status` comprueba también esto."""
    try:
        with closing(connect()) as conn:
            return str(conn.execute("PRAGMA quick_check").fetchone()[0])
    except Exception as exc:  # noqa: BLE001  (libsql lanza ValueError genérico)
        return str(exc)


def _main(argv: List[str]) -> None:
    cmd = argv[1] if len(argv) > 1 else "migrate"
    if cmd == "status":
        st = schema_status()
        pending = st["latest"] - st["current"]
        print(f"Esquema en la versión {st['current']} de {st['latest']}" + (f" ({pending} pendientes)" if pending else " (al día)"))
        if not USE_TURSO:
            check = integrity()
            print(f"Integridad: {check}" if check == "ok" else f"Integridad: DAÑADA ({check}). Borra el fichero (y sus -wal/-shm) o restaura una copia.")
            if (fs := unsafe_filesystem(DB_PATH)):
                print(f"AVISO: {unsafe_message(DB_PATH, fs)}")
        print(f"Base de datos: {DB_LABEL}")
        return
    if cmd == "demo":
        refuse_demo_in_production()  # antes de tocar la base de datos
    before = schema_status()["current"] if cmd in ("migrate", "init") else None
    init_db()
    if before is not None:
        after = schema_status()["current"]
        print(f"Migraciones aplicadas: {after - before} (esquema en la versión {after})")
    if cmd == "demo":
        _demo()
    elif cmd == "users":
        with closing(connect()) as conn:
            for r in conn.execute("SELECT id, email, name, role, disabled, datetime(created_at, 'unixepoch') FROM users"):
                print(*r, sep=" | ")
    elif cmd == "admin" and len(argv) > 2:
        ok, msg = promote_admin(argv[2], force="--force" in argv[3:])
        print(msg)
        if not ok:
            sys.exit(1)
    elif cmd == "admins":
        admins = list_admins()
        for a in admins:
            print(a["id"], a["email"], "verificado" if a["email_verified"] else "SIN VERIFICAR", "DESACTIVADO" if a["disabled"] else "activo",
                  f"({a['providers'] or 'email+contraseña'})", sep=" | ")
        print(f"{len(admins)} administrador(es).")
    print(f"Base de datos: {DB_LABEL}")


if __name__ == "__main__":
    try:
        _main(sys.argv)
    except UnsafeFilesystemError as exc:
        sys.exit(f"Error: {exc}")
