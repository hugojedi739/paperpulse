// Luz roja de mercado: reglas objetivas, solo con datos en vivo, y textos neutrales («qué ha pasado», no «qué hacer»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setRules, getRules, onRules, evaluate, describe, label, EXPLAIN } from '../frontend/js/lib/market-alert.js';

const RULES = [
  { symbol: 'BTC', name: 'Bitcoin', window: '24h', dropPct: 10 },
  { symbol: 'IBEX', name: 'IBEX 35', window: 'session', dropPct: 4 },
];
const live = (change24h, extra = {}) => ({ price: 100, change24h, seeded: false, live: true, marketOpen: true, ...extra });

test('con el mercado normal no se enciende nada', () => {
  const ticks = { BTC: live(-3), IBEX: live(-1.5) };
  assert.deepEqual(evaluate(RULES, (s) => ticks[s]), []);
});

test('se enciende al pasar el umbral (incluido el propio umbral) y dice cuánto', () => {
  const ticks = { BTC: live(-10), IBEX: live(-4.6) };
  const on = evaluate(RULES, (s) => ticks[s]);
  assert.deepEqual(on.map((a) => [a.symbol, a.changePct]), [['BTC', -10], ['IBEX', -4.6]]);
  assert.equal(label(on), '2 caídas fuertes');
  assert.equal(label(on.slice(1)), 'IBEX 35 −4,6 %');
});

test('una subida fuerte no es luz roja', () => {
  assert.deepEqual(evaluate(RULES, () => live(+15)), []);
});

test('solo con datos en vivo: nunca con precios sembrados de la caché ni sin dato', () => {
  assert.deepEqual(evaluate(RULES, () => live(-20, { seeded: true })), []);
  assert.deepEqual(evaluate(RULES, () => live(Number.NaN)), []);
  assert.deepEqual(evaluate(RULES, () => undefined), []);
  assert.deepEqual(evaluate(RULES, () => live(-20, { price: 0 })), []);
});

test('la regla del índice solo cuenta con la bolsa abierta', () => {
  const ticks = { BTC: live(-1), IBEX: live(-6, { marketOpen: false }) };
  assert.deepEqual(evaluate(RULES, (s) => ticks[s]), []);
});

test('reglas del servidor: se filtran las inválidas y se avisa solo si cambian', () => {
  let calls = 0;
  const off = onRules(() => { calls++; });
  setRules([...RULES, { symbol: 'ETH', window: 'semana', dropPct: 5 }, { symbol: 'SOL', window: '24h', dropPct: 0 }, null]);
  assert.deepEqual(getRules().map((r) => r.symbol), ['BTC', 'IBEX']);
  setRules(RULES);
  assert.equal(calls, 1);
  setRules('basura');
  assert.deepEqual(getRules(), []);
  off();
});

test('textos neutrales: qué ha pasado, sin recomendar ni predecir', () => {
  const [btc] = evaluate(RULES, () => live(-11.24));
  assert.equal(describe(btc), 'Bitcoin cae un 11,2 % en las últimas 24 horas (el aviso se enciende a partir del 10 %).');
  assert.match(describe({ ...btc, dropPct: 1.25 }), /a partir del 1,25 %\)/);
  assert.match(describe({ ...btc, dropPct: 0.01 }), /a partir del 0,01 %\)/);
  assert.match(describe({ symbol: 'IBEX', name: 'IBEX 35', window: 'session', dropPct: 4, changePct: -4.6 }), /^IBEX 35 cae un 4,6 % en la sesión de hoy, frente al cierre anterior/);
  const all = [describe(btc), ...EXPLAIN].join(' ').toLowerCase();
  for (const w of ['compra ', 'comprar ahora', 'vende ', 'vender ya', 'oportunidad', 'rebote', 'seguirá', 'deberías', 'te recomendamos']) {
    assert.ok(!all.includes(w), `«${w}» en el texto`);
  }
  assert.ok(all.includes('no una recomendación'));
  assert.ok(all.includes('no usa inteligencia artificial'));
});

test('la cabecera usa nodos de texto (lib/el.js), enlaza a Aprender y empieza oculta', () => {
  const ui = readFileSync(new URL('../frontend/js/ui/market-alert.js', import.meta.url), 'utf8');
  assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML/.test(ui), 'sin innerHTML');
  assert.match(ui, /from '\.\.\/lib\/el\.js'/);
  assert.match(ui, /href: '#\/learn'/);
  const index = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
  assert.match(index, /<button type="button" class="market-alert" id="market-alert" popovertarget="market-alert-pop" hidden>/);
  assert.match(index, /<div popover id="market-alert-pop"/);
});
