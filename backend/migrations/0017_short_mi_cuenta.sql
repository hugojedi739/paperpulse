-- 0017: posiciones cortas (Short) en «Mi cuenta» y Stop Loss / Take Profit en la cuenta del servidor. SOLO aditiva:
-- no borra, renombra ni reescribe nada, y no toca ninguna fila existente. El código anterior sigue funcionando con ella
-- (no lee las tablas nuevas y las columnas nuevas llevan valor por defecto), lo que permite volver atrás.
-- Las posiciones largas siguen en `positions`, sin cambios (el código anterior las inserta por posición de columna).

-- Posiciones cortas abiertas, una por usuario y activo (como `positions`). Un usuario no puede tener a la vez una larga y una corta
-- del mismo activo (lo comprueba el libro contable). Sin apalancamiento: al abrir se aparta el 100 % del importe como garantía
-- (margin_cents) más la comisión (cost_cents = garantía + comisión de apertura). La pérdida máxima es la garantía.
CREATE TABLE IF NOT EXISTS short_positions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    qty_e8 INTEGER NOT NULL CHECK (qty_e8 > 0),
    margin_cents INTEGER NOT NULL CHECK (margin_cents >= 0),
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
    avg_price_e8 INTEGER NOT NULL CHECK (avg_price_e8 > 0),
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

-- Stop Loss y Take Profit de una posición (larga o corta) y hasta dónde se han revisado las velas para cerrarla sola.
-- Cada corto tiene siempre una fila (la revisión también vigila la liquidación); una larga solo si lleva SL o TP.
-- Se borra al cerrar la posición entera.
CREATE TABLE IF NOT EXISTS position_exits (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    stop_e8 INTEGER CHECK (stop_e8 IS NULL OR stop_e8 > 0),
    take_e8 INTEGER CHECK (take_e8 IS NULL OR take_e8 > 0),
    checked_until INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

-- Dirección de cada orden y ejecución: 'long' (por defecto, como hasta ahora) o 'short'. Con direction = 'short',
-- side 'sell' abre el corto (vender para abrir) y side 'buy' lo cierra (comprar para cubrir).
ALTER TABLE orders ADD COLUMN direction TEXT NOT NULL DEFAULT 'long';
ALTER TABLE fills ADD COLUMN direction TEXT NOT NULL DEFAULT 'long';

-- Stop Loss y Take Profit que lleva una orden de apertura a mercado; al ejecutarse pasan a position_exits.
ALTER TABLE orders ADD COLUMN stop_e8 INTEGER;
ALTER TABLE orders ADD COLUMN take_e8 INTEGER
