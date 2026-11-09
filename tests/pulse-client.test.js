// Cliente del pulso público: una sola petición aunque varias vistas lo pidan a la vez, y caché de 5 minutos.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 };
globalThis.document = { hidden: false, addEventListener() {}, querySelector: () => null };
globalThis.location = { protocol: 'https:', host: 'app.test' };

let calls = 0, fail = false;
globalThis.fetch = async (url) => {
  calls++;
  await new Promise((r) => setImmediate(r));
  if (fail) throw new Error('sin red');
  return { ok: true, json: async () => ({ topWeek: [], latestThreads: [], activeTraders7d: null, empty: true, n: calls, url: String(url) }) };
};
mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });

const community = await import('../frontend/js/lib/community.js');

test('dos peticiones a la vez comparten una sola llamada a /api/community/pulse', async () => {
  const [a, b] = await Promise.all([community.pulse(), community.pulse()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.match(a.url, /\/api\/community\/pulse$/);
});

test('se cachea 5 minutos y después se vuelve a pedir', async () => {
  await community.pulse();
  assert.equal(calls, 1);
  mock.timers.tick(4 * 60_000);
  await community.pulse();
  assert.equal(calls, 1);
  mock.timers.tick(61_000);
  const again = await community.pulse();
  assert.equal(calls, 2);
  assert.equal(again.n, 2);
});

test('un fallo no se queda cacheado ni bloquea la siguiente petición', async () => {
  mock.timers.tick(6 * 60_000);
  fail = true;
  await assert.rejects(community.pulse(), /No se pudo conectar con el servidor/);
  fail = false;
  const ok = await community.pulse();
  assert.equal(ok.empty, true);
});
