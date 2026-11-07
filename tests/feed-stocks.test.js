// Bolsa con el WebSocket abierto: si el relay no difunde (como en Vercel, sin proceso de fondo), se piden las cotizaciones por REST.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 };
const doc = { hidden: false, addEventListener() {}, querySelector: () => null };
globalThis.document = doc;
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { protocol: 'https:', host: 'app.test' };

const sockets = [];
globalThis.WebSocket = class {
  static OPEN = 1;
  constructor() { this.readyState = 0; sockets.push(this); }
  send() {}
  open() { this.readyState = 1; this.onopen?.(); }
  deliver(stream, data) { this.onmessage?.({ data: JSON.stringify({ stream, data }) }); }
};

const calls = [];
globalThis.fetch = (url) => {
  calls.push(String(url));
  const body = String(url).includes('/api/stocks/quotes') ? { data: { NVDA: { price: 190, change24h: 1, live: true } } } : { data: [], realtime: true };
  return Promise.resolve({ ok: true, json: async () => body });
};

mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 1_700_000_000_000 });
const flush = () => new Promise((r) => setImmediate(r));
async function advance(ms) { for (let t = 0; t < ms; t += 250) { mock.timers.tick(250); await flush(); } }
const stockCalls = () => calls.filter((u) => u.includes('/api/stocks/quotes')).length;

const feed = await import('../frontend/js/lib/feed.js');
feed.start();
await flush();
sockets[0].open();
sockets[0].deliver('btcusdt@ticker', { s: 'BTCUSDT', c: '76000', P: '0', h: '1', l: '1', q: '1', o: '1' }); // el WebSocket ya entrega datos: se detiene el sondeo

test('con el relay completo (tramas de bolsa cada 5 s) no se pide la bolsa por REST', async () => {
  calls.length = 0;
  for (let i = 0; i < 8; i++) { // 40 s
    sockets[0].deliver('stocks', { NVDA: { price: 190 + i, change24h: 1, live: true } });
    await advance(5000);
  }
  assert.equal(stockCalls(), 0);
  assert.equal(feed.priceOf('NVDA'), 197);
});

test('si el relay solo entrega la instantánea y calla, la bolsa se pide por REST', async () => {
  calls.length = 0;
  await advance(40_000);
  assert.ok(stockCalls() >= 3, `peticiones de bolsa en 40 s: ${stockCalls()}`);
  assert.ok(stockCalls() <= 6, `sin exceso: ${stockCalls()}`);
  assert.equal(feed.priceOf('NVDA'), 190); // dato nuevo de la REST
});

test('con la pestaña oculta no se pide nada', async () => {
  doc.hidden = true;
  calls.length = 0;
  await advance(40_000);
  assert.equal(stockCalls(), 0);
  doc.hidden = false;
});

test('al volver a llegar tramas de bolsa se vuelve a callar el REST', async () => {
  sockets[0].deliver('stocks', { NVDA: { price: 200, change24h: 1, live: true } });
  calls.length = 0;
  for (let i = 0; i < 4; i++) { sockets[0].deliver('stocks', { NVDA: { price: 200 + i, change24h: 1, live: true } }); await advance(5000); }
  assert.equal(stockCalls(), 0);
});
