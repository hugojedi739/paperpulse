// Retos suaves de la semana: límites de pérdida, constancia y diario, calculados con las operaciones cerradas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekGoals, lastWeek, STATE_LABEL, LOSS_LIMIT_PCT, TRADE_RISK_PCT, DAYS_TARGET, NOTES_TARGET } from '../frontend/js/lib/goals.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const trade = (pnl, date, extra = {}) => ({ id: `t${date}${pnl}`, symbol: 'BTC', pnl, date, ...extra });
const NOW = new Date(2026, 10, 11, 12).getTime(); // miércoles 11 de noviembre de 2026 (semana del 9 al 15)
const goal = (w, id) => w.goals.find((g) => g.id === id);
const states = (w) => Object.fromEntries(w.goals.map((g) => [g.id, g.state]));

test('semana sin operaciones: todo sin empezar, nada cumplido', () => {
  const w = weekGoals([], 1000, NOW);
  assert.deepEqual(states(w), { loss: 'pending', risk: 'pending', days: 'pending', notes: 'pending' });
  assert.deepEqual([w.done, w.total, w.daysLeft], [0, 4, 4]);
  assert.equal(w.start, new Date(2026, 10, 9).getTime());
  assert.ok(w.goals.every((g) => g.ratio === 0 && g.detail && STATE_LABEL[g.state]));
});

test('los límites son los anunciados', () => {
  assert.deepEqual([LOSS_LIMIT_PCT, TRADE_RISK_PCT, DAYS_TARGET, NOTES_TARGET], [5, 2, 3, 3]);
  assert.match(goal(weekGoals([], 1000, NOW), 'loss').title, /No pierdas más del 5 % esta semana/);
});

test('pérdida semanal dentro del límite: va bien y muestra cuánto margen se ha usado', () => {
  const w = weekGoals([trade(-30, at(2026, 11, 9)), trade(10, at(2026, 11, 10))], 1000, NOW);
  const g = goal(w, 'loss');
  assert.deepEqual([g.state, g.value, g.target], ['ontrack', 2, 5]);
  assert.equal(g.ratio, 0.4);
  assert.match(g.detail, /2 % de pérdida/);
});

test('justo en el límite sigue valiendo; por encima, no', () => {
  assert.equal(goal(weekGoals([trade(-50, at(2026, 11, 9))], 1000, NOW), 'loss').state, 'ontrack');
  const over = goal(weekGoals([trade(-50.5, at(2026, 11, 9))], 1000, NOW), 'loss');
  assert.deepEqual([over.state, over.ratio], ['missed', 1]);
  assert.match(over.detail, /revisar/);
});

test('una semana en positivo no usa margen de pérdida aunque haya operaciones perdedoras', () => {
  const w = weekGoals([trade(-15, at(2026, 11, 9)), trade(40, at(2026, 11, 10))], 1000, NOW);
  assert.deepEqual([goal(w, 'loss').value, goal(w, 'loss').state], [0, 'ontrack']);
  assert.deepEqual([goal(w, 'risk').value, goal(w, 'risk').state], [1.5, 'ontrack']);
});

test('riesgo por operación: cuenta la peor operación, no la suma', () => {
  const ok = weekGoals([trade(-15, at(2026, 11, 9)), trade(-15, at(2026, 11, 10))], 1000, NOW);
  assert.equal(goal(ok, 'risk').state, 'ontrack');
  const bad = weekGoals([trade(-25, at(2026, 11, 9)), trade(100, at(2026, 11, 10))], 1000, NOW);
  assert.deepEqual([goal(bad, 'risk').state, goal(bad, 'risk').value], ['missed', 2.5]);
  assert.equal(goal(bad, 'loss').state, 'ontrack', 'la semana va en positivo');
});

test('constancia: cuenta días distintos, no operaciones', () => {
  const sameDay = weekGoals([trade(1, at(2026, 11, 9, 9)), trade(1, at(2026, 11, 9, 15)), trade(1, at(2026, 11, 9, 20))], 1000, NOW);
  assert.deepEqual([goal(sameDay, 'days').value, goal(sameDay, 'days').state], [1, 'ontrack']);
  const three = weekGoals([trade(1, at(2026, 11, 9)), trade(1, at(2026, 11, 10)), trade(-1, at(2026, 11, 11))], 1000, NOW);
  assert.deepEqual([goal(three, 'days').value, goal(three, 'days').state, goal(three, 'days').ratio], [3, 'done', 1]);
});

test('diario: cuentan las operaciones con estrategia o nota (los espacios no valen)', () => {
  const w = weekGoals([
    trade(1, at(2026, 11, 9), { setup: 'Rebote' }), trade(1, at(2026, 11, 10), { notes: 'Entré tarde' }),
    trade(1, at(2026, 11, 10), { setup: '   ', notes: '' }), trade(1, at(2026, 11, 11)),
  ], 1000, NOW);
  assert.deepEqual([goal(w, 'notes').value, goal(w, 'notes').state], [2, 'ontrack']);
  const done = weekGoals([1, 2, 3].map((i) => trade(1, at(2026, 11, 9, 8 + i), { notes: 'ok' })), 1000, NOW);
  assert.equal(goal(done, 'notes').state, 'done');
});

test('solo cuenta la semana en curso: ni el domingo anterior ni el lunes siguiente', () => {
  const w = weekGoals([trade(-900, at(2026, 11, 8, 23)), trade(-900, at(2026, 11, 16, 1))], 1000, NOW);
  assert.deepEqual(states(w), { loss: 'pending', risk: 'pending', days: 'pending', notes: 'pending' });
});

test('días que quedan: 6 el lunes, 0 el domingo', () => {
  assert.equal(weekGoals([], 1000, new Date(2026, 10, 9, 8).getTime()).daysLeft, 6);
  assert.equal(weekGoals([], 1000, new Date(2026, 10, 15, 22).getTime()).daysLeft, 0);
});

test('semana pasada: los límites respetados pasan a cumplidos y lo no alcanzado queda como «esta vez no»', () => {
  const trades = [trade(-20, at(2026, 11, 3), { notes: 'x' }), trade(30, at(2026, 11, 5))];
  const prev = lastWeek(trades, 1000, NOW);
  assert.deepEqual(states(prev), { loss: 'done', risk: 'done', days: 'missed', notes: 'missed' });
  assert.deepEqual([prev.done, prev.total, prev.daysLeft], [2, 4, 0]);
  assert.equal(prev.start, new Date(2026, 10, 2).getTime());
});

test('semana pasada sin operaciones: no hay resumen (no se regala un «cumplido»)', () => {
  assert.equal(lastWeek([trade(10, at(2026, 11, 10))], 1000, NOW), null);
  assert.equal(lastWeek([], 1000, NOW), null);
});

test('sin saldo inicial conocido no hay divisiones por cero', () => {
  const w = weekGoals([trade(-10, at(2026, 11, 9))], 0, NOW);
  assert.deepEqual([goal(w, 'loss').value, goal(w, 'loss').state], [0, 'ontrack']);
});

test('ningún texto invita a arriesgar más ni habla de ranking', () => {
  const all = [weekGoals([], 1000, NOW), weekGoals([trade(-80, at(2026, 11, 9)), trade(5, at(2026, 11, 10), { notes: 'x' })], 1000, NOW), lastWeek([trade(-80, at(2026, 11, 3))], 1000, NOW)];
  for (const w of all) for (const g of w.goals) assert.doesNotMatch(`${g.title} ${g.detail}`, /ranking|clasificaci|apuesta|gana más|recupera/i);
});
