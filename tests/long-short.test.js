// Posiciones Long (alcistas) y Short (bajistas) del motor local (Demo): PnL, saldo, SL/TP y liquidación.
// Ejecutar: npm test
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
globalThis.document = { visibilityState: 'visible', hidden: false, addEventListener() {}, querySelector: () => null };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const store = await import('../frontend/js/lib/store.js');
const account = await import('../frontend/js/lib/account.js');
const trading = await import('../frontend/js/lib/trading.js');
const feed = await import('../frontend/js/lib/feed.js');
const { findAsset } = await import('../frontend/js/lib/catalog.js');

const BTC = findAsset('BTC'); // cotiza en USDT: 1 USDT = 1 USD, así las cuentas son exactas
const setPrice = (px) => feed.setFallbackPrice('BTC', px);
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(async () => {
  await account.setUser(null);
  storage.clear();
  store.load();
  store.activate(10_000);
  setPrice(50_000);
});

/** Abre 0,1 BTC a 50.000 (5.000 USD), mueve el precio y cierra: devuelve PnL, saldo y la operación del diario. */
async function roundTrip(side, exitPx) {
  await (side === 'short' ? trading.shortMarket(BTC, 0.1) : trading.buyMarket(BTC, 0.1));
  assert.equal(store.cash(), 5_000, 'se aparta el importe (compra o garantía del corto)');
  setPrice(exitPx);
  const pos = store.positions()[0];
  const open = trading.valuePosition(pos);
  const t = await trading.closePosition(pos.id);
  return { unrealized: open.pnlUsd, pct: open.pnlPct, pnl: t.pnl, cash: store.cash(), trade: t };
}

test('Long ganador: 50.000 → 55.000 con 0,1 BTC = +500 USD y saldo 10.500', async () => {
  const r = await roundTrip('long', 55_000);
  assert.equal(r.unrealized, 500);
  assert.equal(r.pct, 10);
  assert.equal(r.pnl, 500);
  assert.equal(r.cash, 10_500);
  assert.equal(r.trade.side, 'long');
});

test('Long perdedor: 50.000 → 45.000 = −500 USD y saldo 9.500', async () => {
  const r = await roundTrip('long', 45_000);
  assert.equal(r.pnl, -500);
  assert.equal(r.pct, -10);
  assert.equal(r.cash, 9_500);
});

test('Short ganador: 50.000 → 45.000 = +500 USD y saldo 10.500', async () => {
  const r = await roundTrip('short', 45_000);
  assert.equal(r.unrealized, 500);
  assert.equal(r.pct, 10);
  assert.equal(r.pnl, 500);
  assert.equal(r.cash, 10_500);
  assert.equal(r.trade.side, 'short');
});

test('Short perdedor: 50.000 → 55.000 = −500 USD y saldo 9.500', async () => {
  const r = await roundTrip('short', 55_000);
  assert.equal(r.pnl, -500);
  assert.equal(r.pct, -10);
  assert.equal(r.cash, 9_500);
});

test('fórmulas: Long (actual − entrada) × cantidad y Short (entrada − actual) × cantidad', () => {
  assert.equal(trading.directionalPnl('long', 2, 100, 130), 60);
  assert.equal(trading.directionalPnl('short', 2, 100, 130), -60);
  assert.equal(trading.directionalPnl('short', 2, 100, 70), 60);
});

test('Short: la pérdida máxima es la garantía y se liquida solo a 2× la entrada; el saldo nunca es negativo', async () => {
  await trading.shortMarket(BTC, 0.1);
  setPrice(120_000); // un corto «perdería» 7.000 con 5.000 de garantía
  assert.equal(trading.valuePosition(store.positions()[0]).valueUsd, 0);
  const events = [];
  trading.checkTriggers(new Set(['BTC']), (type, msg) => events.push([type, msg]));
  await flush();
  assert.equal(store.positions().length, 0);
  assert.equal(store.cash(), 5_000); // pierde los 5.000 de garantía, no más
  assert.equal(store.trades()[0].pnl, -5_000);
  assert.match(events[0][1], /Liquidación/);
});

test('Take Profit de un Long y Stop Loss de un Short se cierran solos al tocarse', async () => {
  await trading.buyMarket(BTC, 0.1, { takeProfit: 52_000 });
  setPrice(51_000);
  trading.checkTriggers(new Set(['BTC']));
  await flush();
  assert.equal(store.positions().length, 1, 'aún no llega al TP');
  setPrice(52_000);
  trading.checkTriggers(new Set(['BTC']));
  await flush();
  assert.equal(store.positions().length, 0);
  assert.equal(store.trades()[0].pnl, 200);
  assert.equal(store.cash(), 10_200);

  await trading.shortMarket(BTC, 0.1, { stopLoss: 54_000 }); // entrada a 52.000
  setPrice(54_000);
  trading.checkTriggers(new Set(['BTC']));
  await flush();
  assert.equal(store.positions().length, 0);
  assert.equal(store.trades()[0].pnl, -200);
  assert.equal(store.cash(), 10_000);
});

test('valida SL/TP según la dirección, los fondos y no mezcla direcciones en un activo', async () => {
  await assert.rejects(trading.buyMarket(BTC, 0.1, { stopLoss: 51_000 }), /Stop Loss va por debajo/);
  await assert.rejects(trading.shortMarket(BTC, 0.1, { takeProfit: 51_000 }), /Take Profit va por debajo/);
  await assert.rejects(trading.shortMarket(BTC, 0.1, { stopLoss: 100_000 }), /2× la entrada/);
  await assert.rejects(trading.shortMarket(BTC, 1), /Saldo de práctica insuficiente/); // 50.000 > 10.000
  await trading.buyMarket(BTC, 0.01);
  await assert.rejects(trading.shortMarket(BTC, 0.01), /posición larga/);
});

test('las posiciones guardadas antes (sin dirección) son Long y siguen valorándose igual', () => {
  storage.set('paperpulse_positions', JSON.stringify([{ id: 'a-b-c', symbol: 'BTC', amount: 0.1, entryPrice: 40_000, investedUsd: 4_000, quote: 'USDT' }]));
  store.load();
  const [p] = store.positions();
  assert.equal(p.side, 'long');
  assert.equal(p.stopLoss, null);
  assert.equal(trading.valuePosition(p).pnlUsd, 1_000);
});
