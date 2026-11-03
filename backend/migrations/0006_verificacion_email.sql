-- 0006: email verificado. Solo se considera verificado el email que devuelve Google (u Okta) con email_verified=true.
-- Las cuentas de email y contraseña quedan como NO verificadas (no se bloquean ni se borran: solo tienen los
-- límites de comunidad de las cuentas nuevas y no pueden recibir el rol de administrador por registro).
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
-- Cuentas existentes que ya entraron con un proveedor externo: su email ya se comprobó entonces
UPDATE users SET email_verified = 1 WHERE id IN (SELECT user_id FROM identities);
