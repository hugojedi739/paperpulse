// Próximos dividendos: petición a nuestro backend, textos de la ficha y de la tarjeta del Resumen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { upcomingDividends, resetCache, dividendLine, amountText, amountLabel, exDateLabel, daysUntil, forPositions, EX_DATE_NOTE, SIMULATION_NOTE } from '../frontend/js/lib/dividends.js';

const DATA = {
  MSFT: { exDate: '2026-11-19', amount: null, lastAmount: 0.91, currency: 'USD' },
  IBE: { exDate: '2027-01-12', amount: 0.275, lastAmount: 0.275, currency: 'EUR' },
  REP: { exDate: '2027-01-12', amount: 0.56, lastAmount: 0.56, currency: 'EUR' },
};

test('pide /api/dividends una sola vez aunque lo pidan varias vistas a la vez', async () => {
  resetCache();
  const calls = [];
  const fetcher = async (path) => { calls.push(path); return { data: DATA }; };
  const [a, b] = await Promise.all([upcomingDividends({ fetcher, now: 0 }), upcomingDividends({ fetcher, now: 0 })]);
  assert.deepEqual(calls, ['/api/dividends']);
  assert.equal(a, b);
  await upcomingDividends({ fetcher, now: 29 * 60_000 });
  assert.equal(calls.length, 1);
  await upcomingDividends({ fetcher, now: 31 * 60_000 });
  assert.equal(calls.length, 2);
});

test('sin servidor o sin datos devuelve un objeto vacío (no se pinta nada)', async () => {
  resetCache();
  assert.deepEqual(await upcomingDividends({ fetcher: async () => { throw new Error('sin red'); } }), {});
  resetCache();
  assert.deepEqual(await upcomingDividends({ fetcher: async () => ({}) }), {});
});

test('línea de la ficha: fecha ex-dividendo e importe anunciado o por confirmar', () => {
  assert.equal(exDateLabel('2027-01-12'), '12 de enero de 2027');
  assert.equal(dividendLine(DATA.IBE), 'Próximo dividendo: ex-dividendo el 12 de enero de 2027 · 0,275 € por acción');
  assert.equal(dividendLine(DATA.MSFT), 'Próximo dividendo: ex-dividendo el 19 de noviembre de 2026 · importe por confirmar (el último fue 0,91 US$)');
  assert.equal(amountText({ exDate: '2027-01-01' }), 'importe por confirmar');
  assert.equal(dividendLine(null), '');
  assert.equal(amountLabel(0.5, 'XXXX'), '0,50'); // moneda no válida: sin símbolo, sin romper
});

test('tarjeta del Resumen: solo mis posiciones con dividendo, de la fecha más cercana a la más lejana', () => {
  const positions = [{ symbol: 'REP', name: 'Repsol' }, { symbol: 'BTC', name: 'Bitcoin' }, { symbol: 'MSFT', name: 'Microsoft' }, { symbol: 'IBE', name: 'Iberdrola' }, { symbol: 'REP', name: 'Repsol' }];
  assert.deepEqual(forPositions(positions, DATA).map((d) => d.symbol), ['MSFT', 'IBE', 'REP']);
  assert.deepEqual(forPositions([], DATA), []);
  assert.deepEqual(forPositions(positions, {}), []);
});

test('días hasta la fecha ex-dividendo', () => {
  const now = Date.parse('2026-11-15T22:00:00Z');
  assert.equal(daysUntil('2026-11-15', now), 0);
  assert.equal(daysUntil('2026-11-19', now), 4);
});

test('notas neutrales: la fecha ex-dividendo es la que cuenta y la simulación no los abona', () => {
  assert.match(EX_DATE_NOTE, /ex-dividendo/);
  assert.match(EX_DATE_NOTE, /antes de ese día/);
  assert.match(SIMULATION_NOTE, /no abona dividendos/);
  assert.match(SIMULATION_NOTE, /no una recomendación/);
});

test('la ficha y el Resumen usan lib/el.js, y la tarjeta solo existe con la cuenta del servidor', () => {
  const trade = readFileSync(new URL('../frontend/js/views/trade.js', import.meta.url), 'utf8');
  const fn = trade.slice(trade.indexOf('async function renderDividend'), trade.indexOf('function renderStats'));
  assert.ok(fn.includes("shown.type !== 'stock'") && fn.includes('put(') && !/\.innerHTML\s*=|insertAdjacentHTML/.test(fn));
  const dash = readFileSync(new URL('../frontend/js/views/dashboard.js', import.meta.url), 'utf8');
  const card = dash.slice(dash.indexOf('async function renderDividends'), dash.indexOf('/* ---------- Con sesión'));
  assert.ok(card.includes('store.isServerMode()') && card.includes('account.openedAt()') && card.includes('put(') && !/\.innerHTML\s*=|insertAdjacentHTML/.test(card));
  assert.match(dash, /<div id="d-compare"><\/div>/);
  assert.match(dash, /<div id="d-divs"><\/div>/);
});
