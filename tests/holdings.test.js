// Cartera del Resumen: filas, totales y distribución por activo, tipo y divisa (solo presentación).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdingRows, holdingTotals, allocation } from '../frontend/js/lib/holdings.js';

const ROWS = [
  { symbol: 'ETH', amount: 1, investedUsd: 2000, valueUsd: 1800, pnlUsd: -200, pnlPct: -10, quote: 'USDT', type: 'crypto' },
  { symbol: 'BTC', amount: 0.1, investedUsd: 6000, valueUsd: 7000, pnlUsd: 1000, pnlPct: 16.67, quote: 'USDT', type: 'crypto' },
  { symbol: 'SAN', amount: 100, investedUsd: 1000, valueUsd: 1100, pnlUsd: 100, pnlPct: 10, quote: 'EUR', type: 'stock' },
];
const find = (s) => ({ BTC: { name: 'Bitcoin' }, ETH: { name: 'Ethereum' }, SAN: { name: 'Banco Santander' } })[s];

test('filas ordenadas por valor, con nombre del catálogo y coste = lo invertido', () => {
  const list = holdingRows(ROWS, find);
  assert.deepEqual(list.map((r) => r.symbol), ['BTC', 'ETH', 'SAN']);
  assert.equal(list[0].name, 'Bitcoin');
  assert.equal(list[1].costUsd, 2000);
  assert.equal(list[1].pnlUsd, -200);
});

test('totales: coste, valor y resultado con su porcentaje sobre el coste', () => {
  const t = holdingTotals(holdingRows(ROWS, find));
  assert.deepEqual(t, { costUsd: 9000, valueUsd: 9900, pnlUsd: 900, pnlPct: 10 });
  assert.deepEqual(holdingTotals([]), { costUsd: 0, valueUsd: 0, pnlUsd: 0, pnlPct: 0 });
});

test('distribución por activo, tipo y divisa; el efectivo siempre aparte y al final; suman 100 %', () => {
  const list = holdingRows(ROWS, find);
  const byAsset = allocation(list, 100, 'asset');
  assert.deepEqual(byAsset.map((p) => p.label), ['BTC', 'ETH', 'SAN', 'Efectivo']);
  assert.equal(byAsset.at(-1).cls, 'c-6');
  const byType = allocation(list, 100, 'type');
  assert.deepEqual(byType.map((p) => [p.label, p.usd]), [['Cripto', 8800], ['Acciones', 1100], ['Efectivo', 100]]);
  const byCur = allocation(list, 0, 'currency');
  assert.deepEqual(byCur.map((p) => p.label), ['Dólar (USD)', 'Euro (EUR)']);
  for (const parts of [byAsset, byType, byCur]) assert.ok(Math.abs(parts.reduce((s, p) => s + p.share, 0) - 100) < 1e-9);
});

test('más de cinco activos: los pequeños se agrupan en «Otros»', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ symbol: `A${i}`, investedUsd: 10, valueUsd: 100 - i, pnlUsd: 0, pnlPct: 0 }));
  const parts = allocation(holdingRows(many), 0, 'asset');
  assert.deepEqual(parts.map((p) => p.label), ['A0', 'A1', 'A2', 'A3', 'A4', 'Otros']);
  assert.equal(parts.at(-1).usd, 94 + 95);
});
