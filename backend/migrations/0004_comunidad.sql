-- 0004: comunidad. Perfiles públicos, foro, votos, seguidores, denuncias, moderación y clasificación.
-- Todo el texto de usuario se guarda tal cual (sin HTML escapado): el frontend lo pinta siempre con textContent.
-- Al borrar un usuario se borra en cascada todo su contenido (perfil, hilos, mensajes, votos, seguidores...).

-- Suspensión de la comunidad (distinta de users.disabled, que impide entrar):
-- un usuario suspendido puede entrar y operar, pero no publicar, votar, denunciar ni seguir.
ALTER TABLE users ADD COLUMN suspended_until INTEGER;
ALTER TABLE users ADD COLUMN suspension_reason TEXT;

-- Perfil público. Sin perfil (alias) no se participa en la comunidad ni se aparece en la clasificación.
CREATE TABLE profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    alias TEXT NOT NULL UNIQUE COLLATE NOCASE,
    bio TEXT NOT NULL DEFAULT '',
    is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX profiles_public ON profiles(is_private, alias);

CREATE TABLE follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id);

-- Foro. kind = 'general' (los usuarios abren hilos) o 'asset' (un hilo automático por activo del catálogo).
CREATE TABLE forum_categories (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('general', 'asset', 'trades')),
    position INTEGER NOT NULL
);
INSERT INTO forum_categories (slug, name, description, kind, position) VALUES
    ('estrategias', 'Estrategias', 'Planes de trading, gestión del riesgo y sistemas.', 'general', 1),
    ('novatos', 'Novatos', 'Preguntas para empezar. Aquí no hay preguntas tontas.', 'general', 2),
    ('analisis-tecnico', 'Análisis técnico', 'Gráficos, indicadores y patrones.', 'general', 3),
    ('noticias', 'Noticias', 'Actualidad de los mercados y cómo afecta a los activos.', 'general', 4),
    ('operaciones', 'Operaciones compartidas', 'Operaciones reales de la cuenta de práctica, con su resultado.', 'trades', 5),
    ('activos', 'Activos', 'Un hilo por cada activo del simulador.', 'asset', 6);

-- Hilos. El primer mensaje (first_post_id) es el cuerpo del hilo y es el que reciben los votos del hilo.
-- Los hilos de activo no tienen autor ni primer mensaje. fill_id: operación compartida (cada fill, una sola vez).
CREATE TABLE threads (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES forum_categories(id),
    author_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    symbol TEXT UNIQUE,
    fill_id INTEGER UNIQUE REFERENCES fills(id) ON DELETE CASCADE,
    first_post_id INTEGER,
    status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    created_at INTEGER NOT NULL,
    last_post_at INTEGER NOT NULL
);
CREATE INDEX threads_category_recent ON threads(category_id, status, last_post_at);
CREATE INDEX threads_author ON threads(author_id, created_at);

-- Mensajes. score = suma de votos (se actualiza en la misma transacción que el voto).
-- status: visible, hidden (moderación; reversible) o deleted (borrado por su autor). Nunca se borran filas.
CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX posts_thread_recent ON posts(thread_id, status, created_at);
CREATE INDEX posts_thread_score ON posts(thread_id, status, score);
CREATE INDEX posts_author ON posts(author_id, created_at);

-- Un voto por usuario y mensaje (+1 o -1). Cambiar el voto actualiza la fila; quitarlo la borra.
CREATE TABLE votes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX votes_user ON votes(user_id);

-- Denuncias: una por usuario y mensaje.
CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN ('spam', 'abuso', 'estafa', 'otro')),
    details TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (post_id, reporter_id)
);
CREATE INDEX reports_status ON reports(status, created_at);

-- Registro de moderación (también el borrado por el propio autor). No se borra al eliminar al moderador.
CREATE TABLE moderation_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('post', 'user', 'report')),
    target_id INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX moderation_log_time ON moderation_log(created_at);

-- Patrimonio diario (último valor del día, UTC) de cada cuenta con operaciones: base de las rentabilidades a 7 y 30 días.
CREATE TABLE equity_snapshots (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    equity_cents INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, day)
);

-- Clasificación precalculada (se recalcula como mucho cada pocos minutos, al consultarla).
-- return_bps: rentabilidad en puntos básicos (1234 = 12,34 %).
CREATE TABLE leaderboard (
    period TEXT NOT NULL CHECK (period IN ('7d', '30d', 'total')),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    return_bps INTEGER NOT NULL,
    equity_cents INTEGER NOT NULL,
    base_cents INTEGER NOT NULL,
    trades INTEGER NOT NULL,
    approximate INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (period, user_id)
);
CREATE INDEX leaderboard_rank ON leaderboard(period, return_bps);
