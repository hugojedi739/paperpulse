// Datos de mercado en vivo a través del backend: un único WebSocket (/ws/market) con el protocolo de Binance
// (tickers, profundidad, velas y el stream "stocks" de bolsa). Si el WebSocket no está disponible (p. ej. en
// despliegues serverless) se consultan los mismos datos por REST cada pocos segundos.
import { CRYPTO, findAsset } from './catalog.847c7742.js';
import { emit } from './store.2bfd45ff.js';
import { getJson, wsUrl } from './api.c22010e9.js';

const POLL_FAST_MS = 5000; // Operar: el gráfico y el libro necesitan datos frescos
const POLL_SLOW_MS = 10000; // resto de vistas
let pollMs = POLL_SLOW_MS;
const ticks = new Map();
const changed = new Set();
const handlers = new Map();
const tickerStreams = new Set(CRYPTO.map((a) => `${a.pair.toLowerCase()}@ticker`));

let ws = null;
let delay = 1000;
let timer = null;
let pollTimer = null;
let reqId = 1;
let lastCryptoTick = 0;
let lastPoll = 0;
let status = 'connecting';
let polling = false; // una ronda a la vez: si la anterior sigue en curso no se lanza otra
let noRealtime = false; // el servidor dice que no hay tiempo real (/api/health): se queda en REST sin reconectar
let lastStocksFrame = 0; // última trama de bolsa recibida por WebSocket (si dejan de llegar, se piden por REST)
const STOCKS_STALE_MS = 15000; // el relay difunde la bolsa cada 5 s: sin tramas en 15 s es que no la está difundiendo

const backoff = (d) => Math.min(30000, Math.round(d * 2 * (0.85 + Math.random() * 0.3)));
const allStreams = () => [...tickerStreams, ...handlers.keys(), 'stocks'];

/* ---------- WebSocket del backend ---------- */
function connect() {
  clearTimeout(timer);
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  let received = false;
  ws = new WebSocket(wsUrl('/ws/market'));
  ws.onopen = () => send('SUBSCRIBE', allStreams());
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg?.stream || !msg.data) return;
    if (!received) { received = true; delay = 1000; stopPolling(); }
    route(msg.stream, msg.data);
  };
  ws.onclose = () => {
    ws = null;
    startPolling();
    if (!received) confirmNoRealtime();
    if (!noRealtime) {
      timer = setTimeout(connect, delay);
      delay = backoff(delay);
    }
    updateStatus();
  };
  updateStatus();
}

/** Tras un fallo sin haber recibido nada, el servidor dice si admite WebSocket; si no, no se vuelve a intentar. */
let checking = false;
async function confirmNoRealtime() {
  if (checking || noRealtime) return;
  checking = true;
  try {
    const j = await getJson('/api/health');
    if (j.realtime === false) { noRealtime = true; clearTimeout(timer); }
  } catch { /* sin confirmación: sigue el reintento con backoff */ }
  checking = false;
}

function send(method, params) {
  if (ws?.readyState === WebSocket.OPEN && params.length) ws.send(JSON.stringify({ method, params, id: reqId++ }));
}

/** `rest`: el dato viene de una petición REST, no del WebSocket (no cuenta para el estado «en vivo»). */
function route(stream, data, rest = false) {
  if (stream === 'stocks') {
    if (!rest) lastStocksFrame = Date.now();
    return applyStocks(data);
  }
  if (stream.endsWith('@ticker')) {
    const asset = findAsset(data.s);
    const symbol = asset?.symbol ?? data.s.replace(/USDT$/, '');
    setTick(symbol, {
      price: +data.c, change24h: +data.P, high24h: +data.h, low24h: +data.l,
      volume24h: +data.q, open24h: +data.o, live: true, marketOpen: true, seeded: false,
    });
    cryptoSeen.add(symbol);
    if (!rest) lastCryptoTick = Date.now();
    saveCrypto();
  }
  handlers.get(stream)?.forEach((cb) => cb(data));
}

/** Suscribe un stream (p. ej. btcusdt@kline_1h). Devuelve la función para cancelar. */
export function subscribe(stream, cb) {
  let set = handlers.get(stream);
  if (!set) {
    handlers.set(stream, (set = new Set()));
    send('SUBSCRIBE', [stream]);
    if (pollTimer) pollStream(stream);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
    if (!set.size) {
      handlers.delete(stream);
      send('UNSUBSCRIBE', [stream]);
    }
  };
}

/** Asegura que un activo cripto fuera del catálogo reciba ticker en vivo. */
export function track(asset) {
  if (asset?.type !== 'crypto') return;
  const stream = `${(asset.pair || `${asset.symbol}USDT`).toLowerCase()}@ticker`;
  if (tickerStreams.has(stream)) return;
  tickerStreams.add(stream);
  send('SUBSCRIBE', [stream]);
}

/* ---------- Respaldo REST (sin WebSocket) ---------- */
async function pollStream(stream) {
  const [pair, kind] = stream.split('@');
  const symbol = pair.toUpperCase();
  try {
    if (kind.startsWith('kline_')) {
      const j = await getJson(`/api/candles?symbol=${symbol}&type=crypto&interval=${kind.slice(6)}&limit=10`);
      const c = j.candles?.at(-1);
      if (c) route(stream, { k: { t: c.time * 1000, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume } });
    } else if (kind.startsWith('depth')) {
      route(stream, await getJson(`/api/crypto/depth?symbol=${symbol}`));
    }
  } catch { /* se reintenta en la siguiente vuelta */ }
}

async function poll() {
  if (polling || document.hidden) return;
  polling = true;
  const jobs = [
    pollCrypto(),
    pollStocks(),
    ...[...handlers.keys()].map(pollStream),
  ];
  try { await Promise.allSettled(jobs); } finally { polling = false; }
  lastPoll = Date.now();
  updateStatus();
}

// Cotizaciones de cripto por REST. Se pide también al arrancar, en paralelo con el WebSocket: el relay del servidor abre su
// conexión con Binance al primer suscriptor y el primer ticker tarda de 2 a 4 s (más con la función en frío), mientras que
// esta petición responde en menos de 1 s. La petición de arranque y la primera ronda del sondeo comparten la misma.
let cryptoRequest = null;
let cryptoAt = -Infinity;
function pollCrypto() {
  if (!cryptoRequest && Date.now() - cryptoAt < 2000) return Promise.resolve();
  const pairs = [...tickerStreams].map((s) => s.split('@')[0].toUpperCase());
  cryptoRequest ??= getJson(`/api/crypto/tickers?symbols=${pairs.join(',')}`)
    .then((j) => j.data?.forEach((t) => {
      const mine = ticks.get(findAsset(t.s)?.symbol ?? t.s.replace(/USDT$/, ''));
      if (mine && !mine.seeded && mine.live && Date.now() - mine.time < 1500) return; // el WebSocket ya entregó uno más reciente
      route(`${t.s.toLowerCase()}@ticker`, t, true);
    }))
    .catch(() => { /* servidor no disponible: llegará por el WebSocket o en la siguiente ronda */ })
    .then(() => { cryptoRequest = null; cryptoAt = Date.now(); });
  return cryptoRequest;
}

/** Ritmo del respaldo REST según la vista (main.js): 5 s en Operar, 10 s en el resto. */
export function setPollRate(fast) {
  const next = fast ? POLL_FAST_MS : POLL_SLOW_MS;
  if (next === pollMs) return;
  pollMs = next;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = setInterval(poll, pollMs); }
}

let stocksRequest = null; // la petición de arranque y la primera ronda del sondeo comparten la misma
let stocksAt = -Infinity;
function pollStocks() {
  if (!stocksRequest && Date.now() - stocksAt < 2000) return Promise.resolve();
  stocksRequest ??= getJson('/api/stocks/quotes')
    .then((j) => applyStocks(j.data))
    .catch(() => { /* servidor no disponible */ })
    .then(() => { stocksRequest = null; stocksAt = Date.now(); });
  return stocksRequest;
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, pollMs);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/* ---------- Bolsa ---------- */
// Stale-while-revalidate: la última respuesta se guarda y se pinta al arrancar, mientras la petición real la renueva.
// Se siembra como «no en vivo» y sin avisar de cambios (no cuenta como actualización reciente).
const STOCKS_KEY = 'paperpulse_stocks_cache';
const STOCKS_MAX_AGE = 6 * 3600 * 1000;

function seedStocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(STOCKS_KEY));
    if (!saved || Date.now() - saved.at > STOCKS_MAX_AGE) return;
    for (const [sym, q] of Object.entries(saved.data || {})) {
      if (!(q?.price > 0) || ticks.has(sym)) continue;
      ticks.set(sym, {
        price: q.price, change24h: q.change24h, high24h: q.high24h, low24h: q.low24h,
        volume24h: q.volume, live: false, seeded: true, marketOpen: q.marketOpen !== false, marketStatus: q.marketStatus, symbol: sym, time: saved.at,
      });
    }
  } catch { /* sin almacenamiento o dato corrupto */ }
}

/* ---------- Cripto: caché local ---------- */
// Igual que la bolsa: el último precio conocido se pinta al arrancar mientras llega el real. Caduca a los 10 minutos (los precios
// de cripto se mueven mucho más que los de bolsa fuera de horario) y los datos sembrados llevan `seeded: true` hasta el primer
// dato real, para que no se usen como precio de operación ni en el historial de patrimonio.
const CRYPTO_KEY = 'paperpulse_crypto_cache';
const CRYPTO_MAX_AGE = 10 * 60 * 1000;
const CRYPTO_SAVE_EVERY = 30 * 1000;
const cryptoSeen = new Set();
let cryptoSavedAt = 0;

function seedCrypto() {
  try {
    const saved = JSON.parse(localStorage.getItem(CRYPTO_KEY));
    if (!saved || !(Date.now() - saved.at <= CRYPTO_MAX_AGE) || saved.at > Date.now() + 60000) return; // caducada, ilegible o «del futuro»
    for (const [sym, q] of Object.entries(saved.data || {})) {
      if (!(q?.price > 0) || ticks.has(sym)) continue;
      ticks.set(sym, {
        price: q.price, change24h: q.change24h, high24h: q.high24h, low24h: q.low24h, volume24h: q.volume24h, open24h: q.open24h,
        live: false, seeded: true, marketOpen: true, symbol: sym, time: saved.at,
      });
    }
  } catch { /* sin almacenamiento o dato corrupto */ }
}

function saveCrypto(force = false) {
  const now = Date.now();
  if (!force && now - cryptoSavedAt < CRYPTO_SAVE_EVERY) return;
  cryptoSavedAt = now;
  const data = {};
  for (const sym of cryptoSeen) {
    const t = ticks.get(sym);
    if (t && !t.seeded && t.price > 0) data[sym] = { price: t.price, change24h: t.change24h, high24h: t.high24h, low24h: t.low24h, volume24h: t.volume24h, open24h: t.open24h };
  }
  if (!Object.keys(data).length) return;
  try { localStorage.setItem(CRYPTO_KEY, JSON.stringify({ at: now, data })); } catch { /* sin almacenamiento */ }
}

function saveStocks(data) {
  try { localStorage.setItem(STOCKS_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* sin almacenamiento */ }
}

function applyStocks(data) {
  if (data && Object.keys(data).length) saveStocks(data);
  for (const [sym, q] of Object.entries(data || {})) {
    if (!(q?.price > 0)) continue;
    setTick(sym, {
      price: q.price, change24h: q.change24h, high24h: q.high24h, low24h: q.low24h,
      volume24h: q.volume, live: Boolean(q.live), seeded: false, marketOpen: q.marketOpen !== false, marketStatus: q.marketStatus,
    });
  }
}

/* ---------- Estado compartido ---------- */
function setTick(symbol, data) {
  const prev = ticks.get(symbol);
  ticks.set(symbol, { ...prev, ...data, symbol, prev: prev?.price, time: Date.now() });
  changed.add(symbol);
}

/** Precio externo (p. ej. último cierre de velas para activos sin feed). No pisa datos en vivo. */
export function setFallbackPrice(symbol, price) {
  if (price > 0 && !ticks.get(symbol)?.live) setTick(symbol, { price, live: false, seeded: false });
}

export const tick = (symbol) => ticks.get(findAsset(symbol)?.symbol ?? String(symbol).toUpperCase()) ?? null;
export const priceOf = (symbol) => tick(symbol)?.price ?? null;
export const getStatus = () => status;

function updateStatus() {
  const next = !navigator.onLine ? 'offline'
    : ws?.readyState === WebSocket.OPEN && Date.now() - lastCryptoTick < 10000 ? 'live'
      : pollTimer && Date.now() - lastPoll < pollMs * 3 ? 'polling'
        : 'connecting';
  if (next !== status) { status = next; emit('feed', status); }
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  seedStocks();
  seedCrypto();
  connect();
  pollStocks();
  pollCrypto().then(() => saveCrypto(true)); // sin esperar al WebSocket (el relay tarda unos segundos en tener el primer ticker)
  // En Vercel no corre el proceso de fondo del relay que difunde la bolsa cada 5 s: el WebSocket entrega solo la instantánea
  // inicial y, como al recibir datos se detiene el sondeo, las cotizaciones de bolsa se quedaban congeladas. Si con el socket
  // abierto dejan de llegar tramas, se piden por REST (con el relay completo no hace falta: siempre llegan).
  setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN && !document.hidden && Date.now() - lastStocksFrame > STOCKS_STALE_MS) pollStocks();
  }, STOCKS_STALE_MS / 2);
  addEventListener('pagehide', () => saveCrypto(true));
  setInterval(() => {
    if (changed.size) {
      const symbols = new Set(changed);
      changed.clear();
      emit('prices', symbols);
    }
  }, 500); // como mucho 2 repintados de precios por segundo
  setInterval(updateStatus, 2000);
  const revive = () => {
    delay = 1000;
    if (!ws && !noRealtime) connect();
    if (pollTimer && !document.hidden) poll(); // al volver a la pestaña se refresca de inmediato
    updateStatus();
  };
  addEventListener('online', revive);
  addEventListener('offline', updateStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
}
