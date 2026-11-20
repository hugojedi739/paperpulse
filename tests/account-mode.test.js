// Selector «Demo / Mi cuenta»: dos cuentas que no se mezclan, cada una con su motor de órdenes.
// Demo = motor local (lib/trading.js); Mi cuenta = el servidor (POST /api/orders). Comprobamos que ninguna orden
// de Demo llega al servidor y que ninguna de Mi cuenta se ejecuta en el navegador.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  key: (i) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
};
Object.defineProperty(globalThis.localStorage, Symbol.iterator, { value: () => storage.keys() });
globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener() {}, querySelector: () => null };

// Servidor falso: registra cada petición y responde como el backend
const calls = [];
const SERVER_PORTFOLIO = {
  account: { cashCents: 900_000, reservedCents: 0, availableCents: 900_000, initialCents: 1_000_000, createdAt: 1793500000, fills: 1, initialInputCents: null, initialCurrency: null },
  positions: [{ symbol: 'ETH', name: 'Ethereum', assetType: 'crypto', quote: 'USDT', quantity: 2, avgPrice: 2500, costCents: 500_000, openedAt: 1793500000 }],
  orders: [{ id: 7, symbol: 'BTC', side: 'buy', type: 'limit', quantity: 0.01, triggerPrice: 1, reservedCents: 10_000, createdAt: 1793500000 }],
  trades: [], config: { feeBps: 10, slippageBps: 5, minOrderCents: 500 },
};
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
  const body = String(url).endsWith('/api/orders') && opts.method === 'POST'
    ? { order: { id: 8, quantity: 0.001, fill: { price: 50_000, notionalCents: 5_000, feeCents: 5 } } }
    : String(url).endsWith('/api/portfolio') ? SERVER_PORTFOLIO : {};
  return { ok: true, status: 200, json: async () => body };
};

const store = await import('../frontend/js/lib/store.js');
const mode = await import('../frontend/js/lib/account-mode.js');
const account = await import('../frontend/js/lib/account.js');
const trading = await import('../frontend/js/lib/trading.js');
const feed = await import('../frontend/js/lib/feed.js');
const { findAsset } = await import('../frontend/js/lib/catalog.js');
const fmt = await import('../frontend/js/lib/format.js');
fmt.setRates({ EUR: 0.9, GBP: 0.8 });

const BTC = findAsset('BTC');
feed.setFallbackPrice('BTC', 50_000);
const read = (k) => JSON.parse(storage.get(`paperpulse_${k}`) ?? 'null');
const orderCalls = () => calls.filter((c) => c.url.includes('/api/orders'));

beforeEach(async () => {
  await account.setUser(null);
  storage.clear();
  store.load();
  calls.length = 0;
});

async function demoWithCash(usd = 10_000) {
  store.activate(usd);
  return store.cash();
}

test('modo efectivo: «Mi cuenta» solo con sesión; por defecto, quien entra sigue en su cuenta', () => {
  assert.equal(mode.preferred(), mode.SERVER);
  assert.equal(mode.effective(false), mode.DEMO);
  assert.equal(mode.effective(true), mode.SERVER);
  mode.setPreferred(mode.DEMO);
  assert.equal(mode.effective(true), mode.DEMO);
  assert.throws(() => mode.setPreferred('real'), /desconocido/);
});

test('etiquetas: siempre «dinero virtual» y sin lenguaje de dinero real, brókeres ni depósitos', () => {
  assert.equal(mode.LABELS.demo.tag, 'Demo · dinero virtual');
  assert.equal(mode.LABELS.server.tag, 'Mi cuenta · dinero virtual');
  const all = JSON.stringify(mode.LABELS).toLowerCase() + readFileSync(new URL('../frontend/js/ui/account-switch.js', import.meta.url), 'utf8').toLowerCase();
  for (const w of ['dinero real', 'bróker', 'broker', 'depósito', 'deposita', 'retirar', 'ingresar']) assert.ok(!all.includes(w), w);
});

test('Demo con sesión: las órdenes se ejecutan en el navegador y NINGUNA llega al servidor', async () => {
  mode.setPreferred(mode.DEMO);
  await account.setUser({ id: 1 });
  assert.equal(store.activeAccount(), 'demo');
  assert.equal(account.isActive(), false);
  await demoWithCash(10_000);
  await trading.buyMarket(BTC, 0.01);
  await trading.placeOrder(BTC, { type: 'limit', amount: 0.01, limitPrice: 40_000 });
  assert.equal(orderCalls().length, 0, 'sin POST /api/orders');
  assert.equal(store.positions().length, 1);
  assert.equal(store.orders().length, 1);
  assert.ok(store.cash() < 10_000);
});

test('Mi cuenta: las órdenes van al servidor y NADA se ejecuta ni se guarda en el navegador', async () => {
  mode.setPreferred(mode.SERVER);
  await account.setUser({ id: 1 });
  assert.equal(store.activeAccount(), 'server');
  assert.equal(account.isActive(), true);
  const before = JSON.stringify([store.cash(), store.positions(), store.orders()]);
  await trading.buyMarket(BTC, 0.001);
  assert.equal(orderCalls().filter((c) => c.method === 'POST').length, 1);
  assert.deepEqual(orderCalls()[0].body.symbol, 'BTC');
  assert.equal(JSON.stringify([store.cash(), store.positions(), store.orders()]), before, 'el saldo y las posiciones los decide el servidor');
  // El motor local no puede tocar Mi cuenta aunque alguien lo llame directamente
  assert.throws(() => store.setCash(1), /Mi cuenta/);
  assert.throws(() => store.addPosition({ symbol: 'BTC', amount: 1, entryPrice: 1 }), /Mi cuenta/);
  assert.throws(() => store.addOrder({ symbol: 'BTC', amount: 1 }), /Mi cuenta/);
  // Y los disparadores locales no ejecutan sus órdenes límite (las resuelve el servidor con velas)
  feed.setFallbackPrice('BTC', 0.5);
  trading.checkTriggers(new Set(['BTC']), () => {});
  assert.equal(store.orders().length, 1);
  feed.setFallbackPrice('BTC', 50_000);
});

test('las dos cuentas no se mezclan: cambiar de modo cambia saldo, posiciones y diario', async () => {
  mode.setPreferred(mode.DEMO);
  await account.setUser({ id: 1 });
  await demoWithCash(1_000);
  await trading.buyMarket(BTC, 0.001);
  const demo = { cash: store.cash(), positions: store.positions().map((p) => p.symbol) };
  account.choose(mode.SERVER);
  await account.refresh();
  assert.equal(store.cash(), 9_000);
  assert.deepEqual(store.positions().map((p) => p.symbol), ['ETH']);
  account.choose(mode.DEMO);
  assert.equal(store.cash(), demo.cash);
  assert.deepEqual(store.positions().map((p) => p.symbol), demo.positions);
});

test('la copia del servidor nunca se escribe en las claves de Demo (ni en /api/data)', async () => {
  await demoWithCash(1_000);
  mode.setPreferred(mode.SERVER);
  await account.setUser({ id: 1 });
  assert.equal(store.cash(), 9_000);
  assert.equal(read('balance'), 1_000, 'la Demo guardada sigue igual');
  assert.equal(read('positions').length, 0);
  const backup = store.exportData();
  assert.equal(backup.account.balanceUsd, 1_000);
  assert.equal(backup.positions.length, 0);
  // Al recargar (sin la copia en memoria), lo que se lee de las claves es Demo, y Demo queda activa
  store.load();
  assert.equal(store.activeAccount(), 'demo');
  assert.equal(store.cash(), 1_000);
});

test('importar una copia va a Demo aunque esté activa Mi cuenta, y descarta operaciones del servidor', async () => {
  mode.setPreferred(mode.SERVER);
  await account.setUser({ id: 1 });
  store.importData({ app: 'PaperPulse', account: { hasPracticeAccount: true, initialCapitalUsd: 500, balanceUsd: 400 },
    trades: [{ id: 'f12', symbol: 'BTC', amount: 1, entryPrice: 1, exitPrice: 2, pnl: 1 }, { id: 'abc-1', symbol: 'ETH', amount: 1, entryPrice: 1, exitPrice: 2, pnl: 1 }] });
  assert.equal(store.cash(), 9_000, 'Mi cuenta no cambia');
  account.choose(mode.DEMO);
  assert.equal(store.cash(), 400);
  assert.deepEqual(store.trades().map((t) => t.symbol), ['ETH']);
});

test('sin sesión, elegir «Mi cuenta» pide iniciar sesión y se queda en Demo', async () => {
  assert.equal(account.choose(mode.SERVER), 'login');
  assert.equal(store.activeAccount(), 'demo');
  assert.equal(mode.preferred(), mode.SERVER); // al iniciar sesión, entra en su cuenta
  await account.setUser({ id: 1 });
  assert.equal(store.activeAccount(), 'server');
  await account.setUser(null);
  assert.equal(store.activeAccount(), 'demo', 'al cerrar sesión vuelve a Demo');
});

test('actualización: con sesión, las claves locales eran la copia del servidor y Demo empieza de cero', () => {
  storage.clear();
  storage.set('paperpulse_practice_active', 'true');
  storage.set('paperpulse_balance', '9000');
  storage.set('paperpulse_initial_capital', '10000');
  store.load();
  assert.equal(store.cash(), 9_000);
  assert.equal(store.settleUpgrade(true), true);
  assert.equal(store.hasPractice(), false);
  assert.equal(read('practice_active'), false);
  assert.equal(store.settleUpgrade(true), false, 'solo una vez');
});

test('actualización: sin sesión, lo guardado es la Demo de verdad y se conserva', () => {
  storage.clear();
  storage.set('paperpulse_practice_active', 'true');
  storage.set('paperpulse_balance', '700');
  storage.set('paperpulse_initial_capital', '1000');
  store.load();
  assert.equal(store.settleUpgrade(false), false);
  assert.equal(store.cash(), 700);
  store.load();
  assert.equal(store.settleUpgrade(true), false, 'ya marcada: no se vacía después');
});

test('selector accesible: grupo de radio, teclado, texto para lector en móvil y nodos de texto', () => {
  const ui = readFileSync(new URL('../frontend/js/ui/account-switch.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/css/app.css', import.meta.url), 'utf8');
  assert.match(html, /id="acct-switch" role="radiogroup" aria-label="[^"]+"/);
  assert.match(html, /id="acct-tag" role="status"/);
  for (const s of ["role: 'radio'", "'aria-checked'", 'tabindex', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.ok(ui.includes(s), s);
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(ui));
  assert.match(css, /\.acct-opt-text \{ position: absolute; width: 1px;/, 'en móvil el texto se oculta visualmente, no para el lector');
});
