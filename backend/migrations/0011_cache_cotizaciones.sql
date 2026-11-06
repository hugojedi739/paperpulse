-- 0011: caché compartida de cotizaciones de bolsa. La caché en memoria se perdía en cada instancia serverless (Vercel)
-- y cada arranque en frío repetía la consulta lenta al proveedor (3-4 s). Una fila por símbolo, sustituida en cada refresco.
CREATE TABLE quote_cache (
    symbol TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
)
