// Datos al iniciar sesión: qué se junta, qué gana y cuándo hay que preguntar (lib/cloud-merge.js y lib/auth.js).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
};
Object.defineProperty(globalThis.localStorage, Symbol.iterator, { value: () => storage.keys() });
const session = new Map();
globalThis.sessionStorage = { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) };
globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener() {}, querySelector: () => null };

// Servidor falso: /api/data guarda lo último que se sube; /api/auth/* responde con un usuario
const server = { data: null, updatedAt: 0, puts: [] };
globalThis.fetch = async (url, opts = {}) => {
  const path = new URL(String(url), 'http://x').pathname;
  let body = {};
  if (path === '/api/data' && opts.method === 'PUT') {
    const sent = JSON.parse(opts.body).data;
    server.puts.push(sent);
    server.data = sent;
    server.updatedAt = Math.floor(Date.now() / 1000) + 1;
    body = { ok: true };
  } else if (path === '/api/data') body = { data: server.data, updatedAt: server.updatedAt };
  else if (path.startsWith('/api/auth/')) body = { user: { id: 1, name: 'Ana', email: 'ana@example.com', hasPassword: true } };
  return { ok: true, status: 200, json: async () => body };
};

const merge = await import('../frontend/js/lib/cloud-merge.js');
const store = await import('../frontend/js/lib/store.js');
const auth = await import('../frontend/js/lib/auth.js');

const trade = (id) => ({ id, symbol: 'BTC', name: 'Bitcoin', type: 'crypto', quote: 'USDT', amount: 1, entryPrice: 100, exitPrice: 110, investedUsd: 100, pnl: 10, pnlPct: 10, date: '2026-11-10T10:00:00.000Z' });
const copy = ({ trades = [], watchlist = ['BTC'], alerts = [], settings = {}, balance = 1000 } = {}) => ({
  app: 'PaperPulse', version: '3', schemaVersion: 3, exportedAt: '2026-11-20T00:00:00.000Z',
  account: { hasPracticeAccount: true, initialCapitalUsd: 1000, balanceUsd: balance }, positions: [], pendingOrders: [], trades, equityHistory: [],
  watchlist, alerts, settings,
});
const alert = (id, symbol, target) => ({ id, symbol, condition: 'above', target, triggered: false, createdAt: 1 });

/* ---------- Combinación (puro) ---------- */
test('favoritos: unión sin repetir, los de este navegador primero y como mucho 50', () => {
  assert.deepEqual(merge.mergeWatchlist(['BTC', 'ETH'], ['ETH', 'SAN']), ['BTC', 'ETH', 'SAN']);
  const many = Array.from({ length: 40 }, (_, i) => `L${i}`);
  const more = Array.from({ length: 40 }, (_, i) => `R${i}`);
  assert.equal(merge.mergeWatchlist(many, more).length, 50);
});

test('alertas: unión; la misma alerta (mismo id, o mismo activo, sentido y precio) no se duplica', () => {
  const out = merge.mergeAlerts([alert('a', 'BTC', 100), alert('b', 'ETH', 5)], [alert('a', 'BTC', 100), alert('z', 'eth', 5), alert('c', 'SAN', 12)]);
  assert.deepEqual(out.map((a) => a.id), ['a', 'b', 'c']);
});

test('ajustes: gana la copia más reciente; la visita guiada vista en cualquiera de las dos queda vista', () => {
  const local = copy({ settings: { theme: 'light', tourDone: true } });
  const remote = copy({ settings: { theme: 'dark', currency: 'USD' } });
  assert.deepEqual(merge.mergeAtLogin(local, remote, { localNewer: false }).data.settings, { theme: 'dark', currency: 'USD', tourDone: true });
  assert.equal(merge.mergeAtLogin(local, remote, { localNewer: true }).data.settings.theme, 'light');
});

test('Demo: se queda la que tiene operaciones; si ninguna o las dos iguales, la más reciente; conflicto solo si las dos tienen y difieren', () => {
  const empty = copy({ balance: 1000 });
  const withOps = copy({ trades: [trade('t1')], balance: 1010 });
  let r = merge.mergeAtLogin(empty, withOps, { localNewer: true });
  assert.equal(r.conflict, false);
  assert.equal(r.data.trades.length, 1, 'la guardada tenía operaciones');
  r = merge.mergeAtLogin(withOps, empty, { localNewer: false });
  assert.equal(r.conflict, false);
  assert.equal(r.data.trades.length, 1, 'la de este navegador tenía operaciones');
  r = merge.mergeAtLogin(withOps, copy({ trades: [trade('t1')], balance: 1010 }), { localNewer: false });
  assert.equal(r.conflict, false, 'la misma Demo en los dos sitios no es un conflicto');
  r = merge.mergeAtLogin(withOps, copy({ trades: [trade('t9')], balance: 990 }), { localNewer: false });
  assert.equal(r.conflict, true);
  assert.deepEqual(r.data.trades.map((t) => t.id), ['t1'], 'hasta decidir, la de este navegador');
});

/* ---------- lib/auth.js de punta a punta, con el servidor falso ---------- */
function reset({ local, remote }) {
  storage.clear(); session.clear();
  server.data = remote; server.updatedAt = remote ? 1_700_000_000 : 0; server.puts = [];
  store.clearAll();
  if (local) store.importData(local);
}

beforeEach(async () => { await auth.logout().catch(() => {}); });

test('iniciar sesión sin conflicto: no pregunta, junta favoritos y alertas y sube el resultado', async () => {
  reset({ local: copy({ watchlist: ['BTC', 'ETH'], alerts: [alert('a', 'BTC', 100)] }), remote: copy({ watchlist: ['SAN'], alerts: [alert('c', 'SAN', 12)], settings: { tourDone: true } }) });
  let asked = 0;
  await auth.login('ana@example.com', 'x', async () => { asked++; return 'cloud'; });
  assert.equal(asked, 0);
  assert.deepEqual(store.watchlist(), ['BTC', 'ETH', 'SAN']);
  assert.deepEqual(store.alerts().map((a) => a.id).sort(), ['a', 'c']);
  assert.equal(store.settings().tourDone, true, 'la visita guiada se sincroniza');
  assert.deepEqual(server.puts.at(-1).watchlist, ['BTC', 'ETH', 'SAN']);
});

test('conflicto de Demos: «usar la guardada» la trae y «quedarme con esta» la sube', async () => {
  reset({ local: copy({ trades: [trade('local')] }), remote: copy({ trades: [trade('nube')], balance: 1200 }) });
  await auth.login('ana@example.com', 'x', async ({ local, remote }) => {
    assert.equal(local.trades[0].id, 'local');
    assert.equal(remote.trades[0].id, 'nube');
    return 'cloud';
  });
  assert.deepEqual(store.trades().map((t) => t.id), ['nube']);
  await auth.logout();
  reset({ local: copy({ trades: [trade('local')] }), remote: copy({ trades: [trade('nube')] }) });
  await auth.login('ana@example.com', 'x', async () => 'local');
  assert.deepEqual(store.trades().map((t) => t.id), ['local']);
  assert.deepEqual(server.puts.at(-1).trades.map((t) => t.id), ['local']);
});

test('conflicto sin decidir: no se pierde ninguna, la guardada no se toca y se vuelve a preguntar al recargar', async () => {
  reset({ local: copy({ trades: [trade('local')], watchlist: ['ETH'] }), remote: copy({ trades: [trade('nube')], watchlist: ['SAN'] }) });
  await auth.login('ana@example.com', 'x', async () => null);
  assert.deepEqual(store.trades().map((t) => t.id), ['local'], 'aquí sigue la de este navegador');
  assert.deepEqual(server.puts.at(-1).trades.map((t) => t.id), ['nube'], 'la guardada en la cuenta no se pisa');
  assert.deepEqual(server.puts.at(-1).watchlist, ['ETH', 'SAN'], 'los favoritos sí se juntan');
  assert.equal(auth.hasUndecidedDemo(), true);
  // Recarga con la sesión abierta: en vez de «gana lo más reciente», se vuelve a preguntar
  let asked = 0;
  await auth.init(async () => { asked++; return 'cloud'; });
  assert.equal(asked, 1);
  assert.deepEqual(store.trades().map((t) => t.id), ['nube']);
  assert.equal(auth.hasUndecidedDemo(), false);
});

test('recargar con la sesión ya abierta (sin conflicto pendiente): gana lo más reciente, sin preguntar ni combinar', async () => {
  reset({ local: copy({ watchlist: ['BTC'] }), remote: copy({ watchlist: ['SAN'] }) });
  storage.set('paperpulse_modified_at', String(1_600_000_000_000)); // lo local es más antiguo que la copia
  let asked = 0;
  await auth.init(async () => { asked++; return 'cloud'; });
  assert.equal(asked, 0);
  assert.deepEqual(store.watchlist(), ['SAN'], 'un favorito borrado en otro navegador no resucita');
});
