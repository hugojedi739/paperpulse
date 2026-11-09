-- 0002: roles, cuentas desactivadas, inicio de sesión con Google/Okta y ajustes del panel de administración

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
-- Identidades externas (Google/Okta) vinculadas a un usuario: (provider, subject) es único.
CREATE TABLE identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);
-- Ajustes editables en el panel de administración (prevalecen sobre .env). Los secretos se guardan en claro.
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
);
-- Estado de un inicio de sesión OIDC en curso (state, PKCE y nonce). Un solo uso y caduca a los 10 minutos.
CREATE TABLE oauth_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
