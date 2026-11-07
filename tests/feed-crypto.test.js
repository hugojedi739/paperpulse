// Cripto al arrancar: petición REST inmediata en paralelo con el WebSocket y siembra desde la caché local.
// Cada caso importa una instancia nueva de feed.js (el parámetro de la URL evita la caché de módulos) con su propio localStorage.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const NOW = 1_700_000_000_000;
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 };
globalThis.document = { hidden: false, addEventListener() {}, querySelector: () => null };
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { protocol: 'https:', host: 'app.test' };

const sockets = [];
globalThis.WebSocket = class { // se queda «conectando»: el test decide cuándo abre y qué entrega
  static OPEN = 1;
  constructor() { this.readyState = 0; sockets.push(this); }
  send() {}
  open() { this.readyState = 1; this.onopen?.(); }
  deliver(stream, data) { this.onmessage?.({ data: JSON.stringify({ stream, data }) }); }
};

const calls = [];
let tickersResponse = null;
globalThis.fetch = (url) => {
  calls.push(String(url));
  if (String(url).includes('/api/crypto/tickers')) return new Promise((resolve) => { tickersResponse = (data) => resolve({ ok: true, json: async () => ({ data }) }); });
  return Promise.resolve({ ok: true, json: async () => ({ data: {}, realtime: true }) });
};

mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: NOW });
const flush = () => new Promise((r) => setImmediate(r));
const cache = (ageMs, data) => JSON.stringify({ at: NOW - ageMs, data });
const row = (price) => ({ price, change24h: 1.5, high24h: price + 10, low24h: price - 10, volume24h: 5e8, open24h: price - 1 });
const t = (s, c) => ({ s, c: String(c), P: '0.5', h: String(c + 5), l: String(c - 5), q: '1000000', o: String(c - 1) });

let n = 0;
async function boot(saved) {
  storage.clear();
  if (saved !== undefined) storage.set('paperpulse_crypto_cache', saved);
  calls.length = 0; sockets.length = 0; tickersResponse = null;
  const feed = await import(`../frontend/js/lib/feed.js?caso=${++n}`);
  feed.start();
  await flush();
  return feed;
}
const tickerCalls = () => calls.filter((u) => u.includes('/api/crypto/tickers')).length;

test('al arrancar se pide /api/crypto/tickers una sola vez, a la vez que se abre el WebSocket', async () => {
  await boot();
  assert.equal(sockets.length, 1);
  assert.equal(tickerCalls(), 1);
  assert.equal(calls.filter((u) => u.includes('/api/stocks/quotes')).length, 1);
});

test('la respuesta REST pone el precio sin esperar al WebSocket y lo guarda en la caché', async () => {
  const feed = await boot();
  assert.equal(feed.priceOf('BTC'), null);
  tickersResponse([t('BTCUSDT', 76000), t('ETHUSDT', 2245)]);
  await flush(); await flush();
  assert.equal(feed.priceOf('BTC'), 76000);
  assert.equal(feed.tick('BTC').seeded, false);
  assert.equal(feed.tick('BTC').live, true);
  const saved = JSON.parse(storage.get('paperpulse_crypto_cache'));
  assert.equal(saved.at, NOW);
  assert.equal(saved.data.BTC.price, 76000);
  assert.equal(saved.data.ETH.price, 2245);
});

test('la respuesta REST no cuenta como «en vivo» (eso es solo del WebSocket)', async () => {
  const feed = await boot();
  sockets[0].open();
  tickersResponse([t('BTCUSDT', 76000)]);
  await flush(); await flush();
  mock.timers.tick(2500); // updateStatus corre cada 2 s
  assert.notEqual(feed.getStatus(), 'live');
  sockets[0].deliver('btcusdt@ticker', t('BTCUSDT', 76010));
  mock.timers.tick(2500);
  assert.equal(feed.getStatus(), 'live');
});

test('con caché reciente los precios están desde el primer instante, marcados como sembrados y no en vivo', async () => {
  const feed = await boot(cache(60_000, { BTC: row(75000), ETH: row(2200) }));
  assert.equal(feed.priceOf('BTC'), 75000);
  const tick = feed.tick('BTC');
  assert.deepEqual([tick.live, tick.seeded, tick.change24h, tick.high24h], [false, true, 1.5, 75010]);
  assert.equal(tickerCalls(), 1, 'aun así se pide el dato real');
});

test('el primer dato real sustituye al sembrado y quita la marca', async () => {
  const feed = await boot(cache(60_000, { BTC: row(75000) }));
  tickersResponse([t('BTCUSDT', 76100)]);
  await flush(); await flush();
  assert.equal(feed.priceOf('BTC'), 76100);
  assert.deepEqual([feed.tick('BTC').seeded, feed.tick('BTC').live], [false, true]);
});

test('una caché caducada, ilegible o del futuro se ignora', async () => {
  for (const bad of [cache(11 * 60_000, { BTC: row(75000) }), '{no es json', cache(-3_600_000, { BTC: row(75000) }), JSON.stringify({ at: NOW, data: { BTC: { price: -1 }, ETH: { price: 'x' } } }), JSON.stringify(null)]) {
    const feed = await boot(bad);
    assert.equal(feed.priceOf('BTC'), null, String(bad).slice(0, 40));
  }
});

test('un dato del WebSocket más reciente no lo pisa la respuesta REST que llega después', async () => {
  const feed = await boot();
  sockets[0].open();
  sockets[0].deliver('btcusdt@ticker', t('BTCUSDT', 76050));
  tickersResponse([t('BTCUSDT', 76000), t('ETHUSDT', 2245)]); // salió antes: ya es más vieja que lo del socket
  await flush(); await flush();
  assert.equal(feed.priceOf('BTC'), 76050);
  assert.equal(feed.priceOf('ETH'), 2245, 'lo que el socket no ha dado todavía sí se aprovecha');
});

test('los datos sembrados no se guardan de nuevo como si fueran reales', async () => {
  const feed = await boot(cache(60_000, { BTC: row(75000), ETH: row(2200) }));
  tickersResponse([t('ETHUSDT', 2300)]); // solo llega ETH
  await flush(); await flush();
  const saved = JSON.parse(storage.get('paperpulse_crypto_cache'));
  assert.deepEqual(Object.keys(saved.data), ['ETH']);
  assert.equal(feed.tick('BTC').seeded, true); // BTC sigue siendo el sembrado
});

test('el precio de respaldo de las velas quita la marca de sembrado', async () => {
  const feed = await boot(cache(60_000, { BTC: row(75000) }));
  feed.setFallbackPrice('BTC', 75500);
  assert.deepEqual([feed.priceOf('BTC'), feed.tick('BTC').seeded], [75500, false]);
});

test('si la petición falla no pasa nada y el WebSocket sigue siendo la vía', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url) => (String(url).includes('/api/crypto/tickers') ? Promise.reject(new Error('sin red')) : realFetch(url));
  const feed = await boot();
  await flush(); await flush();
  assert.equal(feed.priceOf('BTC'), null);
  sockets[0].open();
  sockets[0].deliver('btcusdt@ticker', t('BTCUSDT', 76200));
  assert.equal(feed.priceOf('BTC'), 76200);
  globalThis.fetch = realFetch;
});

test('valoración: un precio sembrado se muestra pero no cuenta como en vivo (no entra en el historial de patrimonio)', async () => {
  storage.clear();
  storage.set('paperpulse_crypto_cache', cache(60_000, { BTC: row(75000) }));
  calls.length = 0; sockets.length = 0;
  const feed = await import('../frontend/js/lib/feed.js'); // la misma instancia que usa trading.js
  const { valuePosition } = await import('../frontend/js/lib/trading.js');
  feed.start();
  await flush();
  const position = { symbol: 'BTC', amount: 1, entryPrice: 70000, quote: 'USDT', investedUsd: 70000 };
  const seeded = valuePosition(position);
  assert.equal(seeded.price, 75000);
  assert.equal(seeded.live, false);
  tickersResponse([t('BTCUSDT', 76000)]);
  await flush(); await flush();
  const real = valuePosition(position);
  assert.equal(real.price, 76000);
  assert.equal(real.live, true);
});
