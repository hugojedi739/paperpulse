-- 0012: registro de auditoría de las acciones de administración (roles, desactivación, eliminación de cuentas y ajustes).
-- La moderación de la comunidad sigue en moderation_log. No guarda emails ni valores de ajustes (pueden ser secretos):
-- solo ids y nombres de claves. actor_id queda a NULL si el administrador se elimina; el registro se conserva.
CREATE TABLE admin_log (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_user_id INTEGER,
    detail TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX admin_log_time ON admin_log(created_at);
