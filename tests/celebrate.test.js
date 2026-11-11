// Celebración (primera compra, reto de la semana cumplido) y cifras animadas: cuándo saltan y cuándo no.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k),
  key: (i) => [...storage.keys()][i] ?? null, get length() { return storage.size; },
};
const toasts = [];
// DOM mínimo: lo justo para que toast() deje constancia del mensaje
const node = () => ({ className: '', classList: { add() {} }, setAttribute() {}, append() {}, remove() {}, addEventListener() {}, querySelector: () => node(), querySelectorAll: () => [], set innerHTML(v) {}, set textContent(v) { if (v) toasts.push(v); } });
globalThis.document = { addEventListener() {}, getElementById: (id) => (id === 'toasts' ? node() : null), querySelector: () => null, createElement: node, body: node() };

const store = await import('../frontend/js/lib/store.js');
const { afterBuy, checkGoals } = await import('../frontend/js/ui/celebrate.js');
const { easeValue, reducedMotion } = await import('../frontend/js/lib/motion.js');

const NOW = new Date(2026, 10, 11, 12).getTime();
const trade = (pnl, msAgo, extra = {}) => ({ id: `t${msAgo}${pnl}`, symbol: 'BTC', name: 'Bitcoin', type: 'crypto', quote: 'USDT', amount: 1, entryPrice: 1, exitPrice: 1, investedUsd: 100, pnl, pnlPct: pnl, date: new Date(NOW - msAgo).toISOString(), ...extra });
const DAY = 86_400_000;
const position = { id: 'p1', assetId: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', type: 'crypto', quote: 'USDT', amount: 0.01, entryPrice: 70000, investedUsd: 700, openedAt: NOW };
function account({ trades = [], positions = [] } = {}) {
  storage.clear(); toasts.length = 0;
  const set = (k, v) => storage.set(`paperpulse_${k}`, JSON.stringify(v));
  set('schema_version', 3); set('practice_active', true); set('initial_capital', 1000); set('balance', 300); set('trades', trades); set('positions', positions);
  store.load();
}
beforeEach(() => account());

test('primera compra: se celebra una vez y solo una', () => {
  account({ positions: [position] });
  assert.equal(afterBuy(), true);
  assert.match(toasts.at(-1), /Primera compra/);
  assert.equal(afterBuy(), false, 'la segunda compra ya no');
  assert.equal(toasts.length, 1);
});

test('con historial previo (otro dispositivo, cuenta antigua) una compra no es «la primera»', () => {
  account({ positions: [position], trades: [trade(5, 30 * DAY)] });
  assert.equal(afterBuy(), false);
  account({ positions: [position, { ...position, id: 'p2', symbol: 'ETH' }] });
  assert.equal(afterBuy(), false);
  assert.equal(toasts.length, 0);
});

test('reto cumplido justo después de cerrar una operación: se celebra, y no se repite', () => {
  // tres días distintos de la semana (lunes 9, martes 10 y hoy miércoles 11), la última hace un minuto
  account({ trades: [trade(1, 60_000), trade(1, DAY), trade(1, 2 * DAY)] });
  assert.deepEqual(checkGoals(NOW), ['days']);
  assert.match(toasts.at(-1), /Reto cumplido: opera 3 días distintos/);
  assert.deepEqual(checkGoals(NOW), [], 'ya celebrado');
  assert.equal(toasts.length, 1);
});

test('al abrir la app con retos ya cumplidos (sin operación reciente) no hay aviso a destiempo, ni después', () => {
  account({ trades: [trade(1, 3_600_000), trade(1, DAY), trade(1, 2 * DAY)] });
  assert.deepEqual(checkGoals(NOW), []);
  assert.equal(toasts.length, 0);
  assert.deepEqual(checkGoals(NOW + 1000), [], 'quedó anotado como visto');
});

test('varios retos a la vez se anuncian en un solo aviso', () => {
  account({ trades: [trade(1, 60_000, { notes: 'a' }), trade(1, DAY, { notes: 'b' }), trade(1, 2 * DAY, { setup: 'c' })] });
  assert.deepEqual(checkGoals(NOW).sort(), ['days', 'notes']);
  assert.match(toasts.at(-1), /2 retos de la semana cumplidos/);
  assert.equal(toasts.length, 1);
});

test('los límites de pérdida no se celebran a mitad de semana (solo se cumplen al terminarla)', () => {
  account({ trades: [trade(-5, 60_000)] });
  assert.deepEqual(checkGoals(NOW), []);
});

test('sin cuenta de práctica no se comprueba nada', () => {
  storage.clear(); store.load();
  assert.deepEqual(checkGoals(NOW), []);
});

test('ningún mensaje de celebración suena a premio o apuesta', () => {
  account({ positions: [position] }); afterBuy();
  account({ trades: [trade(1, 60_000), trade(1, DAY), trade(1, 2 * DAY)] }); checkGoals(NOW);
  for (const m of toasts) assert.doesNotMatch(m, /premio|ganas|bote|suerte|apuesta|jackpot|racha/i);
});

test('cifras animadas: empiezan en el valor anterior, acaban exactas y frenan al final', () => {
  assert.equal(easeValue(100, 200, 0), 100);
  assert.equal(easeValue(100, 200, 1), 200);
  assert.equal(easeValue(100, 200, 5), 200, 'no se pasa del destino');
  assert.equal(easeValue(100, 200, -1), 100);
  assert.ok(easeValue(100, 200, 0.5) > 150, 'a mitad de tiempo ya ha recorrido más de la mitad');
  assert.equal(easeValue(200, 100, 1), 100, 'también hacia abajo');
});

test('sin matchMedia (o con «reducir movimiento») no se anima', () => {
  assert.equal(reducedMotion(), true);
  globalThis.matchMedia = () => ({ matches: false });
  assert.equal(reducedMotion(), false);
  globalThis.matchMedia = () => ({ matches: true });
  assert.equal(reducedMotion(), true);
  delete globalThis.matchMedia;
});
