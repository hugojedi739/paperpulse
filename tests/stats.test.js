// Estadísticas personales: aciertos, pérdida máxima (una operación y caída acumulada) y resultado por semanas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitRate, worstTrade, maxDrawdown, weekly, summary, weekStart, weekLabel, WEEKS } from '../frontend/js/lib/stats.js';

// Fechas a mediodía (hora local) para que el día no dependa de la zona horaria de la máquina
const at = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
const trade = (pnl, date, extra = {}) => ({ id: `t${date}${pnl}`, symbol: 'BTC', pnl, date, ...extra });
const NOW = new Date(2026, 10, 11, 12).getTime(); // miércoles 11 de noviembre de 2026

test('aciertos: ganadoras, perdedoras, tablas y medias', () => {
  const h = hitRate([trade(100, at(2026, 11, 2)), trade(50, at(2026, 11, 3)), trade(-30, at(2026, 11, 4)), trade(0, at(2026, 11, 5))]);
  assert.deepEqual([h.total, h.wins, h.losses, h.flats], [4, 2, 1, 1]);
  assert.equal(h.winRate, 50);
  assert.equal(h.avgWin, 75);
  assert.equal(h.avgLoss, -30);
  assert.equal(h.net, 120);
});

test('aciertos sin operaciones o sin pérdidas: sin divisiones por cero', () => {
  assert.deepEqual(hitRate([]), { total: 0, wins: 0, losses: 0, flats: 0, winRate: 0, avgWin: 0, avgLoss: 0, net: 0 });
  const onlyWins = hitRate([trade(10, at(2026, 11, 2))]);
  assert.deepEqual([onlyWins.winRate, onlyWins.avgLoss], [100, 0]);
});

test('la peor operación es la de mayor pérdida; sin pérdidas no hay ninguna', () => {
  const list = [trade(-5, at(2026, 11, 2)), trade(-80, at(2026, 11, 3), { symbol: 'ETH' }), trade(200, at(2026, 11, 4)), trade(-79.99, at(2026, 11, 5))];
  assert.equal(worstTrade(list).symbol, 'ETH');
  assert.equal(worstTrade([trade(10, at(2026, 11, 2)), trade(0, at(2026, 11, 3))]), null);
  assert.equal(worstTrade([]), null);
});

test('caída máxima: la mayor bajada desde un máximo, aunque después se recupere', () => {
  // 1000 → 1100 → 1050 → 900 → 1200 → 1150. La mayor caída es de 1100 a 900: 200 (18,18 %)
  const list = [trade(100, at(2026, 11, 2)), trade(-50, at(2026, 11, 3)), trade(-150, at(2026, 11, 4)), trade(300, at(2026, 11, 5)), trade(-50, at(2026, 11, 6))];
  const dd = maxDrawdown(list, 1000);
  assert.equal(dd.amount, 200);
  assert.ok(Math.abs(dd.pct - 18.1818) < 0.001);
  assert.equal(dd.from, Date.parse(at(2026, 11, 2)));
  assert.equal(dd.to, Date.parse(at(2026, 11, 4)));
});

test('caída máxima: no depende del orden en que llegan las operaciones (el diario las da de la más reciente a la más antigua)', () => {
  const list = [trade(100, at(2026, 11, 2)), trade(-50, at(2026, 11, 3)), trade(-150, at(2026, 11, 4)), trade(300, at(2026, 11, 5))];
  assert.deepEqual(maxDrawdown([...list].reverse(), 1000), maxDrawdown(list, 1000));
});

test('caída máxima: si se pierde desde la primera operación, el máximo es el saldo inicial', () => {
  const dd = maxDrawdown([trade(-100, at(2026, 11, 2)), trade(-100, at(2026, 11, 3))], 1000);
  assert.deepEqual([dd.amount, dd.pct], [200, 20]);
  assert.equal(dd.from, Date.parse(at(2026, 11, 2)));
});

test('caída máxima: sin pérdidas, sin operaciones o sin saldo conocido', () => {
  assert.equal(maxDrawdown([trade(10, at(2026, 11, 2)), trade(20, at(2026, 11, 3))], 1000).amount, 0);
  assert.deepEqual(maxDrawdown([], 1000), { amount: 0, pct: 0, from: null, to: null });
  const noCapital = maxDrawdown([trade(-10, at(2026, 11, 2))], 0);
  assert.deepEqual([noCapital.amount, noCapital.pct], [10, 0]);
});

test('la semana empieza el lunes a las 00:00, también si hoy es domingo', () => {
  const monday = new Date(2026, 10, 9).getTime();
  assert.equal(weekStart(new Date(2026, 10, 9, 0, 0, 1).getTime()), monday);
  assert.equal(weekStart(NOW), monday);
  assert.equal(weekStart(new Date(2026, 10, 15, 23, 59).getTime()), monday); // domingo
  assert.equal(weekStart(new Date(2026, 10, 16).getTime()), new Date(2026, 10, 16).getTime()); // lunes siguiente
});

test('rendimiento semanal: 8 semanas, la última es la actual, con resultado y porcentaje sobre el saldo inicial', () => {
  const list = [
    trade(50, at(2026, 11, 10)), trade(-20, at(2026, 11, 9)), // esta semana: +30
    trade(-100, at(2026, 11, 8)), // domingo de la semana pasada
    trade(40, at(2026, 9, 22)), // hace 7 semanas (lunes 21 sep – domingo 27 sep)
    trade(999, at(2026, 9, 20)), // hace 8 semanas: fuera
  ];
  const w = weekly(list, 1000, NOW);
  assert.equal(w.length, WEEKS);
  assert.deepEqual([w.at(-1).pnl, w.at(-1).trades, w.at(-1).pct], [30, 2, 3]);
  assert.deepEqual([w.at(-2).pnl, w.at(-2).trades, w.at(-2).pct], [-100, 1, -10]);
  assert.deepEqual([w[0].pnl, w[0].trades], [40, 1]);
  assert.equal(w.reduce((a, x) => a + x.trades, 0), 4, 'la operación de hace 8 semanas no entra');
  assert.equal(w.at(-1).start, new Date(2026, 10, 9).getTime());
  assert.ok(w.every((x, i) => i === 0 || x.start > w[i - 1].start), 'ordenadas de la más antigua a la actual');
});

test('rendimiento semanal: las semanas son consecutivas también al cruzar el cambio de hora', () => {
  const w = weekly([], 1000, NOW);
  for (const x of w) {
    assert.equal(new Date(x.start).getDay(), 1, 'cada semana empieza en lunes');
    assert.equal(new Date(x.start).getHours(), 0);
    assert.equal(new Date(x.end).getDay(), 0, 'y termina en domingo');
  }
});

test('resumen: semana actual, mejor y peor semana solo entre las que tienen operaciones', () => {
  const s = summary([trade(50, at(2026, 11, 10)), trade(-100, at(2026, 11, 4)), trade(10, at(2026, 10, 28))], 1000, NOW);
  assert.equal(s.thisWeek.pnl, 50);
  assert.equal(s.bestWeek.pnl, 50);
  assert.equal(s.worstWeek.pnl, -100);
  assert.equal(s.scale, 100);
  assert.equal(s.hit.total, 3);
  assert.equal(s.worst.pnl, -100);
  const quiet = summary([trade(5, at(2026, 1, 5))], 1000, NOW); // todo es anterior a las 8 semanas
  assert.deepEqual([quiet.bestWeek, quiet.worstWeek, quiet.scale, quiet.thisWeek.trades], [null, null, 0, 0]);
  assert.equal(quiet.hit.total, 1, 'los aciertos sí cuentan todas las operaciones');
});

test('etiqueta de la semana', () => {
  assert.equal(weekLabel(weekly([], 0, NOW).at(-1)), '9 nov – 15 nov');
});
