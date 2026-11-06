// Respaldo REST del feed (sin WebSocket, como en Vercel): ritmo, pausa en segundo plano, solapamiento y reconexión.
// Se simula todo el entorno del navegador; el tiempo es simulado (mock.timers). Ejecutar: npm test
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 };
const doc = { hidden: false, listeners: {}, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, querySelector: () => null };
globalThis.document = doc;
globalThis.addEventListener = () => {};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.location = { protocol: 'https:', host: 'app.test' };

let sockets = 0;
globalThis.WebSocket = class { // el servidor no admite WebSocket: se cierra sin entregar nada
  static OPEN = 1;
  constructor() { sockets++; this.readyState = 0; setTimeout(() => { this.readyState = 3; this.onclose?.(); }, 0); }
  send() {}
};

const calls = [];
let realtime = false;
let slow = false;
globalThis.fetch = (url) => {
  calls.push(String(url));
  const body = String(url).includes('/api/health') ? { realtime } : { data: [] };
  const respond = () => ({ ok: true, json: async () => body });
  return slow ? new Promise((resolve) => setTimeout(() => resolve(respond()), 40_000)) : Promise.resolve(respond());
};

mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
const flush = () => new Promise((r) => setImmediate(r));
async function advance(ms) {
  for (let t = 0; t < ms; t += 250) { mock.timers.tick(250); await flush(); }
}
const count = (frag) => calls.filter((u) => u.includes(frag)).length;

const feed = await import('../frontend/js/lib/feed.js');
feed.setPollRate(false);
feed.start();

test('sin WebSocket: una sola petición de bolsa al arrancar y un solo intento confirmado', async () => {
  await advance(1000);
  assert.equal(count('/api/stocks/quotes'), 1, 'arranque y primera ronda comparten la petición');
  assert.equal(count('/api/health'), 1);
  assert.equal(sockets, 1);
});

test('si el servidor confirma que no hay tiempo real, no se vuelve a abrir el WebSocket', async () => {
  await advance(120_000);
  assert.equal(sockets, 1);
});

test('fuera de Operar el sondeo es de 10 s; en Operar, de 5 s', async () => {
  calls.length = 0;
  await advance(60_000);
  const slowRounds = count('/api/crypto/tickers');
  feed.setPollRate(true);
  calls.length = 0;
  await advance(60_000);
  const fastRounds = count('/api/crypto/tickers');
  assert.ok(slowRounds >= 5 && slowRounds <= 6, `rondas a 10 s: ${slowRounds}`);
  assert.ok(fastRounds >= 11 && fastRounds <= 12, `rondas a 5 s: ${fastRounds}`);
  feed.setPollRate(false);
});

test('con la pestaña oculta no hay ninguna petición periódica y al volver se refresca', async () => {
  doc.hidden = true;
  calls.length = 0;
  await advance(60_000);
  assert.equal(calls.length, 0);
  doc.hidden = false;
  doc.listeners.visibilitychange.forEach((f) => f());
  await advance(250);
  assert.ok(count('/api/crypto/tickers') >= 1);
});

test('no se lanza una ronda nueva mientras la anterior sigue en curso', async () => {
  await advance(15_000); // deja terminar lo pendiente
  slow = true;
  calls.length = 0;
  await advance(30_000); // rondas que tardan 40 s: durante ese tiempo no debe empezar otra
  assert.equal(count('/api/crypto/tickers'), 1);
  slow = false;
  await advance(60_000);
});
