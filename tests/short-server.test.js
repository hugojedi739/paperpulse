// Short en «Mi cuenta» (frontend): lo que se envía al servidor, cómo se pinta la posición y que Demo no cambia.
// La lógica de dinero (garantía, comisiones, liquidación, SL/TP) vive y se prueba en el servidor (tests/test_short.py).
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

const calls = [];
let portfolio;
const SHORT_POS = { symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', quote: 'USDT', quantity: 0.1, avgPrice: 50_000, costCents: 500_500,
  openedAt: 1793500000, direction: 'short', marginCents: 500_000, stopLoss: 55_000, takeProfit: 45_000, liquidationPrice: 100_000 };
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
  const body = String(url).endsWith('/api/orders') && opts.method === 'POST'
    ? { order: { id: 8, quantity: 0.1, symbol: 'BTC', fill: { price: 50_000, notionalCents: 500_000, feeCents: 500, pnlCents: 1_000 } } }
    : String(url).endsWith('/api/portfolio') ? portfolio : {};
  return { ok: true, status: 200, json: async () => body };
};

const store = await import('../frontend/js/lib/store.js');
const mode = await import('../frontend/js/lib/account-mode.js');
const account = await import('../frontend/js/lib/account.js');
const trading = await import('../frontend/js/lib/trading.js');
const feed = await import('../frontend/js/lib/feed.js');
const { findAsset } = await import('../frontend/js/lib/catalog.js');

const BTC = findAsset('BTC');
const setPrice = (px) => feed.setFallbackPrice('BTC', px);
const posts = () => calls.filter((c) => c.url.endsWith('/api/orders') && c.method === 'POST');

beforeEach(async () => {
  await account.setUser(null);
  storage.clear();
  store.load();
  calls.length = 0;
  portfolio = {
    account: { cashCents: 499_500, reservedCents: 0, availableCents: 499_500, initialCents: 1_000_000, createdAt: 1793500000, fills: 1, initialInputCents: null, initialCurrency: null },
    positions: [SHORT_POS], orders: [], trades: [], config: { feeBps: 10, slippageBps: 0, minOrderCents: 500 },
  };
  setPrice(50_000);
});

async function conSesion() {
  mode.setPreferred(mode.SERVER);
  await account.setUser({ id: 1 });
  assert.equal(account.isActive(), true);
  calls.length = 0;
}

test('Mi cuenta: abrir un Short envía direction short, lado «sell» y los niveles; el navegador no ejecuta nada', async () => {
  await conSesion();
  const r = await trading.shortMarket(BTC, 0.1, { stopLoss: 55_000, takeProfit: 45_000 });
  assert.equal(posts().length, 1);
  assert.deepEqual(posts()[0].body, { ...posts()[0].body, symbol: 'BTC', side: 'sell', type: 'market', quantity: '0.1', direction: 'short', stopLoss: '55000', takeProfit: '45000' });
  assert.equal(r.side, 'short');
  assert.equal(r.costUsd, 5_005, 'garantía + comisión de apertura');
  assert.ok(r.feeUsd > 0, 'en Mi cuenta hay comisión');
  assert.equal(store.cash(), 4_995, 'el saldo es el que dice el servidor: el navegador no descuenta nada por su cuenta');
});

test('Mi cuenta: los niveles al revés se rechazan antes de llegar al servidor (el servidor los vuelve a validar)', async () => {
  await conSesion();
  await assert.rejects(trading.shortMarket(BTC, 0.1, { stopLoss: 45_000 }), /Stop Loss va por encima/);
  await assert.rejects(trading.shortMarket(BTC, 0.1, { takeProfit: 55_000 }), /Take Profit va por debajo/);
  await assert.rejects(trading.shortMarket(BTC, 0.1, { stopLoss: 120_000 }), /2× la entrada/);
  await assert.rejects(trading.buyMarket(BTC, 0.1, { stopLoss: 60_000 }), /Stop Loss va por debajo/);
  assert.equal(posts().length, 0);
});

test('Mi cuenta: un Long con Stop Loss y Take Profit también los envía', async () => {
  await conSesion();
  await trading.buyMarket(BTC, 0.1, { stopLoss: 45_000, takeProfit: 60_000 });
  const b = posts()[0].body;
  assert.deepEqual([b.side, b.direction, b.stopLoss, b.takeProfit], ['buy', undefined, '45000', '60000']);
});

test('Mi cuenta: cerrar un Short compra para cubrir (side buy + direction short); cerrar un Long vende', async () => {
  await conSesion();
  await account.refresh();
  assert.equal(store.positions()[0].side, 'short');
  calls.length = 0;
  const t = await trading.closePosition('BTC', {});
  assert.deepEqual([posts()[0].body.side, posts()[0].body.direction], ['buy', 'short']);
  assert.equal(t.pnl, 10);
  portfolio.positions = [{ ...SHORT_POS, direction: 'long', marginCents: null, stopLoss: null, takeProfit: null }];
  await account.refresh();
  calls.length = 0;
  await trading.closePosition('BTC', {});
  assert.deepEqual([posts()[0].body.side, posts()[0].body.direction], ['sell', undefined]);
});

test('la posición del servidor llega como Short con garantía, SL/TP y el P&L con signo contrario al Long', async () => {
  await conSesion();
  await account.refresh();
  const p = store.positions()[0];
  assert.deepEqual([p.side, p.marginUsd, p.investedUsd, p.stopLoss, p.takeProfit], ['short', 5_000, 5_005, 55_000, 45_000]);
  assert.equal(trading.liquidationPrice(p), 100_000);
  setPrice(45_000); // baja un 10 %: gana
  let v = trading.valuePosition(p);
  assert.equal(v.valueUsd, 5_500); // garantía 5.000 + 0,1 × 5.000 de ganancia
  assert.equal(v.pnlUsd, 495); // menos los 5 USD de comisión de apertura
  setPrice(55_000); // sube un 10 %: pierde
  v = trading.valuePosition(p);
  assert.equal(v.valueUsd, 4_500);
  assert.equal(v.pnlUsd, -505);
  setPrice(150_000); // muy por encima de la liquidación: nunca por debajo de 0
  assert.equal(trading.valuePosition(p).valueUsd, 0);
  // El patrimonio cuenta el Short con el signo correcto
  setPrice(45_000);
  const eq = trading.portfolio();
  assert.equal(Math.round(eq.equityUsd), 4_995 + 5_500);
});

test('Mi cuenta: el historial marca los cierres automáticos y los Short', async () => {
  portfolio.positions = [];
  portfolio.trades = [{ id: 3, orderId: 9, symbol: 'BTC', name: 'Bitcoin', assetType: 'crypto', quote: 'USDT', quantity: 0.1, entryPrice: 50_000, exitPrice: 100_000,
    costBasisCents: 500_500, feeCents: 0, pnlCents: -500_500, openedAt: 1793500000, executedAt: 1793600000, source: 'liquidación', direction: 'short' }];
  await conSesion();
  await account.refresh();
  const t = store.trades()[0];
  assert.deepEqual([t.side, t.closeReason, t.pnl], ['short', 'Cierre forzoso (liquidación)', -5_005]);
});

test('Demo no cambia: sigue sin comisión, sin tocar el servidor, y el Short local valora con investedUsd', async () => {
  mode.setPreferred(mode.DEMO);
  await account.setUser({ id: 1 });
  store.activate(10_000);
  calls.length = 0;
  await trading.shortMarket(BTC, 0.1, { stopLoss: 54_000 });
  assert.equal(posts().length, 0, 'ninguna orden de Demo llega al servidor');
  assert.equal(store.cash(), 5_000, 'sin comisión: se aparta el 100 %');
  const p = store.positions()[0];
  assert.equal(p.marginUsd, undefined);
  setPrice(45_000);
  assert.equal(trading.valuePosition(p).valueUsd, 5_500);
  assert.equal(trading.valuePosition(p).pnlUsd, 500);
});

test('interfaz: el selector Long/Short ya no tiene «Pronto» ni el aviso de Mi cuenta, y el ticket avisa de los riesgos del short', () => {
  const src = readFileSync(new URL('../frontend/js/views/trade.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Pronto|próximamente/i);
  assert.doesNotMatch(src, /En Mi cuenta se compra \(Long\)/);
  assert.match(src, /En la vida real el short tiene más riesgos y costes que este simulador no refleja del todo\./);
  assert.match(src, /data-value="short" aria-pressed="\$\{direction === 'short'\}"/);
  assert.doesNotMatch(src, /direction = 'long'; \/\/ la cuenta del servidor no admite cortos/);
});

test('ticket: en Mi cuenta avisa de que el Stop Loss y el Take Profit se revisan al abrir la cartera (en Demo no, ahí son al instante)', () => {
  const src = readFileSync(new URL('../frontend/js/views/trade.js', import.meta.url), 'utf8');
  assert.match(src, /Stop Loss y Take Profit se revisan al abrir la cartera\./);
  assert.match(src, /\$\{serverMode\(\) \? html`<p class="hint exit-note">/);
});

test('divisas: con la cuenta en euros, el saldo en EUR cambia exactamente lo que dice el historial convertido, no en USD', async () => {
  const fmt = await import('../frontend/js/lib/format.js');
  fmt.setRates({ EUR: 1 / 1.1, GBP: 0.8 }); // 1 USD = 0,909… € (1 € = 1,10 USD)
  fmt.setCurrencyPreference('EUR');
  // Short de AAPL (cotiza en USD) con la cuenta abierta en euros: el servidor guarda céntimos de USD; al cerrar con +39,24 USD el saldo pasa de 1.100 a 1.139,24 USD
  const snap = (cashCents, trades = []) => ({
    account: { cashCents, reservedCents: 0, availableCents: cashCents, initialCents: 110_000, createdAt: 1793500000, fills: 2, initialInputCents: 100_000, initialCurrency: 'EUR' },
    positions: [], orders: [], config: { feeBps: 10, slippageBps: 0, minOrderCents: 500 },
    trades,
  });
  const trade = { id: 2, orderId: 2, symbol: 'AAPL', name: 'Apple', assetType: 'stock', quote: 'USD', quantity: 2, entryPrice: 200, exitPrice: 180,
    costBasisCents: 40_040, feeCents: 36, pnlCents: 3_924, openedAt: 1793500000, executedAt: 1793600000, source: 'cotización', direction: 'short' };
  const after = account.toStore(snap(113_924, [trade]));
  const eur = (usd) => fmt.convert(usd, 'USD', 'EUR');
  const t = after.trades[0];
  assert.equal(t.side, 'short');
  assert.equal(t.pnl, 39.24, 'el historial guarda el resultado en USD, la divisa del libro contable');
  // Saldo final menos saldo inicial (la cuenta empezó con 1.100 USD = 1.000 €) = resultado del historial, en USD y también en euros
  assert.equal((after.cash - after.capital).toFixed(2), t.pnl.toFixed(2));
  assert.equal((eur(after.cash) - eur(after.capital)).toFixed(6), eur(t.pnl).toFixed(6));
  assert.equal(eur(after.capital).toFixed(2), '1000.00', 'lo que eligió la persona: 1.000 €');
  assert.equal(eur(after.cash).toFixed(2), (1000 + 35.67).toFixed(2), 'el saldo en euros sube 35,67 €, no 39,24');
  // Lo que se pinta: el saldo y el resultado del historial, en euros y coherentes entre sí
  const plain = (x) => x.replace(/\s/g, ' '); // Intl separa la divisa con un espacio de no ruptura
  assert.equal(plain(fmt.money(t.pnl, { signed: true })), '+35,67 €');
  assert.equal(fmt.money(after.cash - after.capital, { signed: true }), fmt.money(t.pnl, { signed: true }));
  // Los precios del historial van en la divisa del activo (AAPL cotiza en USD), no convertidos
  assert.equal(fmt.price(t.entryPrice, t.quote), fmt.price(200, 'USD'));
  fmt.setCurrencyPreference('auto');
});
