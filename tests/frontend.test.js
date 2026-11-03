// Pruebas de la lógica del frontend (formato, estado y operativa). Ejecutar: npm test
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

const fmt = await import('../frontend/js/lib/format.js');
const store = await import('../frontend/js/lib/store.js');
const { calcPnl } = await import('../frontend/js/lib/trading.js');
const { findAsset, toAsset } = await import('../frontend/js/lib/catalog.js');
const { html, raw, escape } = await import('../frontend/js/lib/dom.js');

fmt.setCurrencyPreference('EUR');
fmt.setRates({ EUR: 0.9, GBP: 0.8 });

beforeEach(() => { storage.clear(); store.load(); });

test('formatea porcentajes y volúmenes en español', () => {
  assert.equal(fmt.pct(2.31), '+2,31 %');
  assert.equal(fmt.pct(-1.45), '−1,45 %');
  assert.equal(fmt.volume(35_800_000), '35,8 M');
  assert.equal(fmt.volume(520_000), '520,0 K');
});

test('convierte divisas sin distorsión', () => {
  assert.equal(fmt.convert(100, 'EUR', 'EUR'), 100);
  assert.equal(fmt.convert(100, 'USDT', 'USD'), 100);
  assert.ok(Math.abs(fmt.convert(fmt.convert(100, 'USD', 'EUR'), 'EUR', 'USD') - 100) < 1e-9);
  assert.equal(fmt.convert(90, 'EUR', 'USD'), 100);
});

test('muestra símbolo si la divisa coincide con la cuenta y código si no', () => {
  assert.match(fmt.price(12.5, 'EUR'), /12,50\s€/);
  assert.match(fmt.price(250, 'USD'), /250,00\sUSD/);
  assert.equal(fmt.price(82064, 'USDT'), '82.064,00 USDT');
});

test('calcula P&L sin comisiones', () => {
  assert.deepEqual(calcPnl(10, 100, 115), { investedUsd: 1000, currentValueUsd: 1150, pnlUsd: 150, pnlPct: 15 });
  assert.equal(calcPnl(10, 100, 90).pnlUsd, -100);
  assert.equal(calcPnl(10, 100, 100).pnlPct, 0);
});

test('resuelve activos del catálogo y alias', () => {
  assert.equal(findAsset('bitcoin').symbol, 'BTC');
  assert.equal(findAsset('SAN.MC').quote, 'EUR');
  assert.equal(findAsset('matic').symbol, 'POL');
  assert.equal(toAsset({ symbol: 'PEPE', type: 'crypto' }).pair, 'PEPEUSDT');
});

test('migra datos v2: watchlist por id y posiciones sin divisa', () => {
  storage.set('paperpulse_practice_active', 'true');
  storage.set('paperpulse_balance', '500');
  storage.set('paperpulse_watchlist', JSON.stringify(['bitcoin', 'santander', 'ETH']));
  storage.set('paperpulse_positions', JSON.stringify([{ id: 'bitcoin', symbol: 'BTC', amount: 0.01, entryPrice: 50000, investedUsd: 500 }]));
  store.load();
  assert.deepEqual(store.watchlist(), ['BTC', 'SAN', 'ETH']);
  assert.equal(store.positions()[0].quote, 'USDT');
  assert.equal(store.cash(), 500);
  assert.equal(JSON.parse(storage.get('paperpulse_schema_version')), 3);
});

test('exporta e importa copias validando el contenido', () => {
  store.activate(2000);
  store.addTrade({ symbol: 'BTC', amount: 0.1, entryPrice: 100, exitPrice: 110, pnl: 1, investedUsd: 10 });
  const backup = store.exportData();
  store.clearAll();
  assert.equal(store.hasPractice(), false);
  assert.deepEqual(store.importData(JSON.stringify(backup)), { trades: 1, positions: 0 });
  assert.equal(store.initialCapital(), 2000);
  assert.throws(() => store.importData('texto corrupto'), /JSON válido/);
  assert.throws(() => store.importData({ app: 'Otra' }), /no pertenece/);
  assert.throws(() => store.importData({ app: 'PaperPulse', account: { initialCapitalUsd: -5 } }), /capital/);
});

test('las plantillas escapan HTML salvo contenido marcado como seguro', () => {
  const evil = '<img src=x onerror=alert(1)>';
  assert.equal(String(html`<p>${evil}</p>`), `<p>${escape(evil)}</p>`);
  assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
  assert.equal(String(html`<ul>${['a', '<b>'].map((x) => html`<li>${x}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
});

const { normalizeInterval, mergeCandles, INTERVALS, RANGES, QUICK_INTERVALS } = await import('../frontend/js/lib/marketdata.js');

test('migra temporalidades guardadas por versiones anteriores', () => {
  assert.equal(normalizeInterval('60'), '1h');
  assert.equal(normalizeInterval('D'), '1d');
  assert.equal(normalizeInterval('4h'), '4h');
  assert.equal(normalizeInterval('raro'), '1h');
  for (const k of QUICK_INTERVALS) assert.ok(INTERVALS[k]);
  for (const r of Object.values(RANGES)) assert.ok(INTERVALS[r.interval], r.label);
});

test('une páginas de histórico sin duplicados y en orden', () => {
  const older = [{ time: 1, close: 1 }, { time: 2, close: 2 }, { time: 3, close: 3 }];
  const current = [{ time: 3, close: 30 }, { time: 4, close: 4 }];
  assert.deepEqual(mergeCandles(older, current).map((c) => c.time), [1, 2, 3, 4]);
});
