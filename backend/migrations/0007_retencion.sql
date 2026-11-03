-- 0007: retención. Notificaciones, logros, racha de días, onboarding y retos mensuales.

-- Un reto mensual necesita una cuenta de práctica APARTE sin duplicar la lógica de trading (que trabaja por user_id).
-- Cada participante recibe un «usuario sombra» (owner_id = su usuario real) que es el titular de la cuenta del reto.
-- Los usuarios sombra están desactivados (no inician sesión) y se excluyen de listados y estadísticas; se borran
-- en cascada con su propietario.
ALTER TABLE users ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX users_owner ON users(owner_id);

-- Notificaciones dentro de la app. Se crean en el servidor dentro de la transacción del evento y se borran a los 60 días.
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    read_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX notifications_user ON notifications(user_id, id);
CREATE INDEX notifications_unread ON notifications(user_id, read_at);
CREATE INDEX notifications_age ON notifications(created_at);

-- Logros (el catálogo está en el código; aquí solo qué ha conseguido cada usuario). La concesión es idempotente.
CREATE TABLE achievements (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    earned_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, code)
);

-- Días en que se operó (fecha en hora de Madrid): base de la racha.
CREATE TABLE trading_days (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE onboarding (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    forum_visited_at INTEGER,
    skipped_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
);

-- Retos mensuales (mes natural en hora de Madrid). initial_cents es igual para todos los participantes.
CREATE TABLE challenges (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    starts_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    initial_cents INTEGER NOT NULL CHECK (initial_cents > 0),
    finalized INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE challenge_entries (
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ledger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX challenge_entries_ledger ON challenge_entries(ledger_id);
CREATE TABLE challenge_scores (
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    return_bps INTEGER NOT NULL,
    equity_cents INTEGER NOT NULL,
    trades INTEGER NOT NULL,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX challenge_scores_rank ON challenge_scores(challenge_id, return_bps);
