-- 0008: cumplimiento legal. Aceptación de términos y privacidad (versión y fecha), edad mínima y borrado/anonimización.
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
ALTER TABLE users ADD COLUMN age_confirmed_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
-- Cuentas anteriores a esta versión: se marcan «legacy». No se bloquean ni se les borra nada; la app les pide
-- aceptar los términos (aviso que se puede cerrar). Las cuentas nuevas sin aceptación (p. ej. alta con Google) se
-- bloquean hasta aceptar.
UPDATE users SET terms_version = 'legacy' WHERE owner_id IS NULL;
