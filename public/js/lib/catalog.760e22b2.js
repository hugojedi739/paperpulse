// Catálogo único de activos: fuente de verdad para símbolo, divisa de cotización y mercado.

const crypto = (id, symbol, name) => ({ id, symbol, name, type: 'crypto', quote: 'USDT', pair: `${symbol}USDT`, market: 'crypto' });
const stock = (id, symbol, name, ticker, market) => ({
  id, symbol, name, type: 'stock', ticker, market, quote: market === 'es' ? 'EUR' : 'USD',
});

export const ASSETS = [
  crypto('bitcoin', 'BTC', 'Bitcoin'),
  crypto('ethereum', 'ETH', 'Ethereum'),
  crypto('solana', 'SOL', 'Solana'),
  crypto('binancecoin', 'BNB', 'BNB'),
  crypto('ripple', 'XRP', 'XRP'),
  crypto('cardano', 'ADA', 'Cardano'),
  crypto('dogecoin', 'DOGE', 'Dogecoin'),
  crypto('polkadot', 'DOT', 'Polkadot'),
  crypto('avalanche-2', 'AVAX', 'Avalanche'),
  crypto('chainlink', 'LINK', 'Chainlink'),
  crypto('tron', 'TRX', 'TRON'),
  crypto('polygon', 'POL', 'Polygon'),
  stock('nvidia', 'NVDA', 'NVIDIA', 'NVDA', 'us'),
  stock('apple', 'AAPL', 'Apple', 'AAPL', 'us'),
  stock('tesla', 'TSLA', 'Tesla', 'TSLA', 'us'),
  stock('microsoft', 'MSFT', 'Microsoft', 'MSFT', 'us'),
  stock('amazon', 'AMZN', 'Amazon', 'AMZN', 'us'),
  stock('google', 'GOOGL', 'Alphabet', 'GOOGL', 'us'),
  stock('meta', 'META', 'Meta Platforms', 'META', 'us'),
  stock('ibex35', 'IBEX', 'IBEX 35', '^IBEX', 'es'),
  stock('santander', 'SAN', 'Banco Santander', 'SAN.MC', 'es'),
  stock('bbva', 'BBVA', 'BBVA', 'BBVA.MC', 'es'),
  stock('inditex', 'ITX', 'Inditex', 'ITX.MC', 'es'),
  stock('iberdrola', 'IBE', 'Iberdrola', 'IBE.MC', 'es'),
  stock('repsol', 'REP', 'Repsol', 'REP.MC', 'es'),
  stock('telefonica', 'TEF', 'Telefónica', 'TEF.MC', 'es'),
];

export const CRYPTO = ASSETS.filter((a) => a.type === 'crypto');
export const STOCKS = ASSETS.filter((a) => a.type === 'stock');
export const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL', 'NVDA', 'AAPL', 'SAN'];

const ALIASES = { MATIC: 'POL', IBEX35: 'IBEX', '^IBEX': 'IBEX', BTCUSDT: 'BTC' };
const index = new Map();
for (const a of ASSETS) {
  for (const k of [a.id, a.symbol, a.ticker, a.pair].filter(Boolean)) index.set(k.toUpperCase(), a);
}

/** Busca un activo por id, símbolo, ticker o par (sin distinguir mayúsculas). */
export function findAsset(key) {
  if (!key) return null;
  const k = String(key).trim().toUpperCase();
  return index.get(ALIASES[k] ?? k) ?? null;
}

/** Registra un activo externo (búsqueda, posiciones) para poder resolverlo por símbolo. */
export function register(asset) {
  if (!asset?.symbol || index.has(asset.symbol.toUpperCase())) return findAsset(asset?.symbol) ?? null;
  for (const k of [asset.symbol, asset.ticker, asset.pair].filter(Boolean)) index.set(k.toUpperCase(), asset);
  return asset;
}

/** Normaliza un resultado de búsqueda externo a la forma del catálogo. */
export function toAsset(item) {
  const known = findAsset(item.symbol) ?? findAsset(item.ticker);
  if (known && (!item.type || item.type === known.type)) return known;
  const symbol = String(item.symbol || '').toUpperCase().replace(/[^A-Z0-9.^-]/g, '').slice(0, 15);
  if (!symbol) return null;
  if (item.type === 'stock') {
    const ticker = item.ticker || symbol;
    const es = ticker.endsWith('.MC') || item.market === 'BME';
    const quote = item.pair?.split('/')[1] || (es ? 'EUR' : 'USD');
    return { id: ticker.toLowerCase(), symbol, name: String(item.name || symbol).slice(0, 60), type: 'stock', ticker, market: es ? 'es' : 'us', quote };
  }
  return { ...crypto(symbol.toLowerCase(), symbol, String(item.name || symbol).slice(0, 60)), dynamic: true };
}

export const isStock = (a) => a?.type === 'stock';
export const displayPair = (a) => `${a.symbol}/${a.quote}`;
