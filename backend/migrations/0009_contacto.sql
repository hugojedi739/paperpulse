-- 0009: formulario de contacto. Mensajes de texto para la administración; sin correo ni otros datos de contacto.
-- user_id solo se rellena si quien escribe tenía sesión; si esa cuenta se elimina, el mensaje se borra (ver account.py).
CREATE TABLE contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at INTEGER
);
CREATE INDEX contact_messages_created ON contact_messages(created_at);
