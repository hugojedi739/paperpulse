-- 0001: usuarios, sesiones y copia de la cuenta de práctica

-- Cuentas. password_hash va vacío en las que solo entran con Google/Okta. Los campos se amplían en migraciones posteriores.
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
);
-- Sesiones: solo se guarda el SHA-256 del token de la cookie, nunca el token.
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
-- Copia en el servidor de alertas, favoritos y ajustes del modo local (JSON en payload). No afecta a la cuenta de práctica del servidor.
CREATE TABLE practice_data (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
);
