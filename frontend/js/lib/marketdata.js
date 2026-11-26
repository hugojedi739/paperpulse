// Datos de mercado no en vivo (todos vía backend): capitalización y sparklines, histórico de velas,
// noticias, estado de los mercados, divisas y búsqueda.
import { CRYPTO, findAsset } from './catalog.js';
import { getJson } from './api.js';
import { reportSource } from './feed.js';

const cache = new Map();

/* ---------- Copia local para pintar al instante (stale-while-revalidate) ---------- */
// Lo último que llegó del servidor se guarda en este navegador; al volver se pinta enseguida y se refresca por detrás.
const SAVED_KEY = 'paperpulse_md_cache';
const SAVED_MAX_AGE = 24 * 3600_000;
function readSaved(key) {
  try {
    const hit = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}')?.[key];
    return hit && Date.now() - hit.at < SAVED_MAX_AGE ? hit.value : null;
  } catch { return null; }
}
function save(key, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') || {};
    all[key] = { at: Date.now(), value };
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
  } catch { /* sin almacenamiento o cuota llena */ }
}

async function cached(key, ttlMs, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = loader().then((value) => { cache.set(key, { time: Date.now(), value }); return value; })
    .catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { ...hit, pending });
  return pending;
}

/** Capitalización, volumen, variación 7d y sparkline 7d de las cripto del catálogo. */
const marketsMap = (rows) => new Map(rows.map((r) => [findAsset(r.id)?.symbol ?? r.symbol, {
  cap: r.cap, volume: r.volume, change7d: r.change7d, spark: r.spark, rank: r.rank,
}]));
export function cryptoMarkets() {
  const ids = CRYPTO.map((a) => a.id).join(',');
  return cached('cg', 5 * 60_000, async () => {
    const rows = (await getJson(`/api/crypto/markets?ids=${ids}`)).data ?? [];
    if (rows.length) save('cg', rows);
    reportSource('coingecko', rows.length > 0);
    return marketsMap(rows);
  }).catch(() => { reportSource('coingecko', false); return new Map(); });
}
/** Lo último guardado de CoinGecko (o null), para pintar Mercados antes de que llegue lo nuevo. */
export function savedCryptoMarkets() {
  const rows = readSaved('cg');
  return Array.isArray(rows) && rows.length ? marketsMap(rows) : null;
}

/* ---------- Velas ---------- */
const MIN = 60, H = 3600, D = 86400;
/** Temporalidades del gráfico. `group` agrupa el selector; `secs` es la duración de cada vela. */
export const INTERVALS = {
  '1m': { label: '1m', name: '1 minuto', secs: MIN, group: 'Minutos' },
  '3m': { label: '3m', name: '3 minutos', secs: 3 * MIN, group: 'Minutos' },
  '5m': { label: '5m', name: '5 minutos', secs: 5 * MIN, group: 'Minutos' },
  '15m': { label: '15m', name: '15 minutos', secs: 15 * MIN, group: 'Minutos' },
  '30m': { label: '30m', name: '30 minutos', secs: 30 * MIN, group: 'Minutos' },
  '1h': { label: '1h', name: '1 hora', secs: H, group: 'Horas' },
  '2h': { label: '2h', name: '2 horas', secs: 2 * H, group: 'Horas' },
  '4h': { label: '4h', name: '4 horas', secs: 4 * H, group: 'Horas' },
  '1d': { label: '1D', name: '1 día', secs: D, group: 'Días' },
  '1w': { label: '1S', name: '1 semana', secs: 7 * D, group: 'Días' },
  '1M': { label: '1M', name: '1 mes', secs: 30 * D, group: 'Días' },
};
/** Accesos rápidos visibles en la barra del gráfico. */
export const QUICK_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
// Claves guardadas por versiones anteriores
const LEGACY = { 1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', D: '1d', W: '1w' };
export const normalizeInterval = (k) => (INTERVALS[k] ? k : LEGACY[k] ?? '1h');

/** Rangos de fechas (como en las webs de bolsa): eligen temporalidad y cuánto histórico mostrar. */
export const RANGES = {
  '1D': { label: '1D', interval: '5m', from: (now) => now - D },
  '5D': { label: '5D', interval: '15m', from: (now) => now - 5 * D },
  '1M': { label: '1M', interval: '1h', from: (now) => now - 30 * D },
  '3M': { label: '3M', interval: '4h', from: (now) => now - 91 * D },
  '6M': { label: '6M', interval: '1d', from: (now) => now - 182 * D },
  YTD: { label: 'YTD', interval: '1d', from: () => Date.UTC(new Date().getUTCFullYear(), 0, 1) / 1000 },
  '1Y': { label: '1A', interval: '1d', from: (now) => now - 365 * D },
  '5Y': { label: '5A', interval: '1w', from: (now) => now - 5 * 365 * D },
  ALL: { label: 'Todo', interval: '1M', from: () => 0 },
};

const cleanCandles = (list) => {
  const seen = new Set();
  return (list || [])
    .filter((c) => Number.isFinite(c?.time) && Number.isFinite(+c.close) && !seen.has(c.time) && seen.add(c.time))
    .map((c) => ({ time: c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }))
    .sort((a, b) => a.time - b.time);
};

const PAGE = 500;
/**
 * Una página de velas anteriores a `end` (epoch s; sin él, las más recientes).
 * Devuelve { candles, hasMore } para ir cargando histórico hacia atrás.
 */
export async function candles(asset, interval, { end, signal, limit = PAGE } = {}) {
  const stock = asset.type === 'stock';
  const symbol = stock ? (asset.ticker ?? asset.symbol) : (asset.pair ?? `${asset.symbol}USDT`);
  const q = new URLSearchParams({ symbol, type: stock ? 'stock' : 'crypto', interval: normalizeInterval(interval), limit: String(limit) });
  if (end) q.set('end', String(Math.floor(end)));
  const j = await getJson(`/api/candles?${q}`, { signal });
  return { candles: cleanCandles(j.candles), hasMore: Boolean(j.hasMore) };
}

/** Une una página antigua con las velas ya cargadas (sin duplicados, en orden). */
export const mergeCandles = (older, current) => cleanCandles([...older, ...current]);

/** Cierres diarios del último mes de todas las acciones del catálogo (una sola petición). */
function stockSparks() {
  return cached('sparks', 30 * 60_000, async () => {
    const data = (await getJson('/api/stocks/sparks')).data ?? {};
    if (Object.keys(data).length) save('sparks', data);
    return data;
  });
}
/** Cierres de 1 mes guardados (o {}), para las minigráficas de bolsa antes de que lleguen los nuevos. */
export const savedStockSparks = () => readSaved('sparks') ?? {};
export const stockSpark = (asset) => stockSparks().then((d) => d[asset.symbol] ?? null).catch(() => null);

export function news() {
  return cached('news', 5 * 60_000, async () => {
    const list = (await getJson('/api/news')).articles ?? [];
    if (list.length) save('news', list.slice(0, 8));
    return list;
  });
}
/** Los últimos titulares guardados (o []), para la portada mientras llegan los nuevos. */
export const savedNews = () => readSaved('news') ?? [];

/** Estado de las bolsas y reglas de la luz roja de la cabecera (lib/market-alert.js), en una sola petición. */
export function marketsInfo() {
  return getJson('/api/markets').then((j) => ({ markets: j.markets ?? [], alertRules: j.alertRules ?? [] }));
}

export function fxRates() {
  return getJson('/api/rates').then((j) => j.rates);
}

export async function search(q, signal) {
  const j = await getJson(`/api/search?q=${encodeURIComponent(q)}`, { signal });
  return j.results ?? [];
}

/** Solo URLs http(s): evita javascript: y otros esquemas en enlaces e imágenes de terceros. */
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}
