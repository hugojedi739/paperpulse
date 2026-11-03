-- 0003: cuenta de práctica ejecutada en el servidor.
-- Convenciones de unidades (todo enteros, sin coma flotante):
--   *_cents  importes en céntimos de USD (la divisa de la cuenta)
--   *_e8     cantidades y precios en unidades de 1e-8 (0,5 BTC = 50000000; 101,25 USD = 10125000000)
--   fechas   segundos desde epoch (UTC)

-- Saldo de cada usuario. Se crea al primer acceso con el saldo inicial configurado en el panel.
CREATE TABLE accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cash_cents INTEGER NOT NULL CHECK (cash_cents >= 0),
    initial_cents INTEGER NOT NULL CHECK (initial_cents > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Órdenes. client_order_id es la clave de idempotencia: un reintento con la misma clave no se ejecuta dos veces.
CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_order_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    type TEXT NOT NULL CHECK (type IN ('market', 'limit', 'stop')),
    qty_e8 INTEGER NOT NULL CHECK (qty_e8 > 0),
    trigger_e8 INTEGER CHECK (trigger_e8 IS NULL OR trigger_e8 > 0),
    reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled', 'rejected', 'expired')),
    reason TEXT,
    journal TEXT,
    checked_until INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_id, client_order_id)
);
CREATE INDEX orders_user_status ON orders(user_id, status, created_at);

-- Posiciones abiertas (solo largos: no hay ventas en corto).
CREATE TABLE positions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    qty_e8 INTEGER NOT NULL CHECK (qty_e8 > 0),
    cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
    avg_price_e8 INTEGER NOT NULL CHECK (avg_price_e8 > 0),
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, symbol)
);

-- Ejecuciones. Cada orden se ejecuta como mucho una vez (order_id UNIQUE) y entera (sin ejecuciones parciales).
CREATE TABLE fills (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    qty_e8 INTEGER NOT NULL CHECK (qty_e8 > 0),
    price_e8 INTEGER NOT NULL CHECK (price_e8 > 0),
    fx_e8 INTEGER NOT NULL CHECK (fx_e8 > 0),
    notional_cents INTEGER NOT NULL,
    fee_cents INTEGER NOT NULL,
    cost_basis_cents INTEGER,
    entry_price_e8 INTEGER,
    pnl_cents INTEGER,
    opened_at INTEGER,
    source TEXT NOT NULL,
    executed_at INTEGER NOT NULL
);
CREATE INDEX fills_user_time ON fills(user_id, executed_at);
