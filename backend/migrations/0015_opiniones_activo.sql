-- 0015: opiniones de la comunidad por activo (voto alcista o bajista). Solo aditiva.

-- Voto de un usuario sobre un activo del catálogo: 1 = alcista, -1 = bajista. Uno por usuario y activo; se puede
-- cambiar (UPDATE) o retirar (DELETE). Es opinión de la comunidad, nunca una recomendación. El reparto que se
-- publica es solo un recuento: ninguna respuesta de la API dice quién votó qué. Se borra con la cuenta
-- (a mano en account.delete_account, porque la fila de users se anonimiza y no se elimina) y entra en «Descargar mis datos».
CREATE TABLE asset_votes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (1, -1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
);
CREATE INDEX asset_votes_symbol ON asset_votes(symbol, value);
