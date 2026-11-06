// Datos de mercado en vivo a través del backend: un único WebSocket (/ws/market) con el protocolo de Binance
// (tickers, profundidad, velas y el stream "stocks" de bolsa). Si el WebSocket no está disponible (p. ej. en
// despliegues serverless) se consultan los mismos datos por REST cada pocos segundos.
import { CRYPTO, findAsset } from './catalog.js';
import { emit } from './store.js';
import { getJson, wsUrl } from './api.js';

const POLL_MS = 5000;
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
    timer = setTimeout(connect, delay);
    delay = backoff(delay);
    updateStatus();
  };
  updateStatus();
}

function send(method, params) {
  if (ws?.readyState === WebSocket.OPEN && params.length) ws.send(JSON.stringify({ method, params, id: reqId++ }));
}

function route(stream, data) {
  if (stream === 'stocks') return applyStocks(data);
  if (stream.endsWith('@ticker')) {
    const asset = findAsset(data.s);
    const symbol = asset?.symbol ?? data.s.replace(/USDT$/, '');
    setTick(symbol, {
      price: +data.c, change24h: +data.P, high24h: +data.h, low24h: +data.l,
      volume24h: +data.q, open24h: +data.o, live: true, marketOpen: true,
    });
    lastCryptoTick = Date.now();
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
  const pairs = [...tickerStreams].map((s) => s.split('@')[0].toUpperCase());
  const jobs = [
    getJson(`/api/crypto/tickers?symbols=${pairs.join(',')}`).then((j) => j.data?.forEach((t) => route(`${t.s.toLowerCase()}@ticker`, t))),
    pollStocks(),
    ...[...handlers.keys()].map(pollStream),
  ];
  await Promise.allSettled(jobs);
  lastPoll = Date.now();
  updateStatus();
}

async function pollStocks() {
  try { applyStocks((await getJson('/api/stocks/quotes')).data); } catch { /* servidor no disponible */ }
}

function startPolling() {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(poll, POLL_MS);
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
        volume24h: q.volume, live: false, marketOpen: q.marketOpen !== false, marketStatus: q.marketStatus, symbol: sym, time: saved.at,
      });
    }
  } catch { /* sin almacenamiento o dato corrupto */ }
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
      volume24h: q.volume, live: Boolean(q.live), marketOpen: q.marketOpen !== false, marketStatus: q.marketStatus,
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
  if (price > 0 && !ticks.get(symbol)?.live) setTick(symbol, { price, live: false });
}

export const tick = (symbol) => ticks.get(findAsset(symbol)?.symbol ?? String(symbol).toUpperCase()) ?? null;
export const priceOf = (symbol) => tick(symbol)?.price ?? null;
export const allTicks = () => ticks;
export const getStatus = () => status;

function updateStatus() {
  const next = !navigator.onLine ? 'offline'
    : ws?.readyState === WebSocket.OPEN && Date.now() - lastCryptoTick < 10000 ? 'live'
      : pollTimer && Date.now() - lastPoll < POLL_MS * 3 ? 'polling'
        : 'connecting';
  if (next !== status) { status = next; emit('feed', status); }
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  seedStocks();
  connect();
  pollStocks();
  setInterval(() => {
    if (changed.size) {
      const symbols = new Set(changed);
      changed.clear();
      emit('prices', symbols);
    }
  }, 400);
  setInterval(updateStatus, 2000);
  const revive = () => {
    delay = 1000;
    if (!ws) connect();
    updateStatus();
  };
  addEventListener('online', revive);
  addEventListener('offline', updateStatus);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revive(); });
}
