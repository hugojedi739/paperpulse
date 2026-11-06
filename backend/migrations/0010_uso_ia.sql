-- 0010: uso y límites del asistente IA en la base de datos. Los contadores en memoria no valen con varias instancias
-- (Vercel): cada una tenía su propio tope diario, sus límites por IP y su propio secreto del desafío anti-bot.

-- Una fila por respuesta del asistente. No guarda IP, usuario ni texto: solo consumo.
CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ai', 'fixed')),
    model TEXT NOT NULL DEFAULT '',
    effort TEXT NOT NULL DEFAULT '',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    thinking_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ai_usage_day ON ai_usage(day, kind);

-- Contadores para los límites por cliente. client = HMAC-SHA256(secreto, día + IP): no se guarda la IP y el valor
-- cambia cada día, así que no permite seguir a nadie de un día a otro. period = 'd:AAAA-MM-DD' o 'm:<minuto unix>'.
-- El cron diario borra los periodos pasados.
CREATE TABLE ai_limits (
    client TEXT NOT NULL,
    period TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (client, period)
);

-- Desafíos anti-bot ya usados (uso único entre instancias). Se borran al caducar.
CREATE TABLE ai_challenges_used (
    signature TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

-- Secretos internos del servidor, generados aquí para no depender de variables de entorno nuevas.
CREATE TABLE server_secrets (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO server_secrets (name, value) VALUES ('ai', lower(hex(randomblob(32))))
