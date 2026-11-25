// Portada (Resumen): lógica sin interfaz. Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextLesson, firstSteps, moversList, tickerFor, heatClass } from '../frontend/js/lib/home.js';
import { ASSETS } from '../frontend/js/lib/catalog.js';
import { LESSONS } from '../frontend/js/lib/learn-content.js';

test('siguiente lección y progreso de Aprender', () => {
  const n0 = nextLesson(LESSONS, new Set());
  assert.equal(n0.lesson.id, LESSONS[0].id);
  assert.equal(n0.done, 0);
  const n1 = nextLesson(LESSONS, new Set([LESSONS[0].id]));
  assert.equal(n1.lesson.id, LESSONS[1].id);
  assert.equal(n1.pct, Math.round(100 / LESSONS.length));
  const all = nextLesson(LESSONS, new Set(LESSONS.map((l) => l.id)));
  assert.equal(all.lesson, null);
  assert.equal(all.pct, 100);
});

test('primeros pasos: saldo, primera operación y una lección; se completan y la tarjeta desaparece', () => {
  const nuevo = firstSteps({ practice: true, nextLessonId: 'stop-loss' });
  assert.deepEqual(nuevo.steps.map((s) => s.done), [true, false, false]);
  assert.equal(nuevo.steps[2].href, '#/learn/stop-loss');
  assert.equal(nuevo.complete, false);
  assert.equal(firstSteps({ practice: true, positions: 1 }).done, 2);
  assert.equal(firstSteps({ practice: true, orders: 1 }).steps[1].done, true); // una orden pendiente también cuenta
  assert.equal(firstSteps({ practice: true, trades: 3, lessonsDone: 1 }).complete, true);
});

test('mayores movimientos: orden, sentido, filtro Cripto/Acciones y como mucho 5', () => {
  const a = (symbol, type) => ({ symbol, type });
  const items = [[a('BTC', 'crypto'), 2], [a('ETH', 'crypto'), -4], [a('SAN', 'stock'), 1], [a('NVDA', 'stock'), -1], [a('SOL', 'crypto'), 6], [a('X', 'crypto'), NaN]]
    .map(([asset, change]) => ({ a: asset, change }));
  assert.deepEqual(moversList(items).map((x) => x.a.symbol), ['SOL', 'BTC', 'SAN', 'NVDA', 'ETH']);
  assert.deepEqual(moversList(items, { dir: 'losers', kind: 'crypto' }).map((x) => x.a.symbol), ['ETH', 'BTC', 'SOL']);
  assert.deepEqual(moversList(items, { kind: 'stock' }).map((x) => x.a.symbol), ['SAN', 'NVDA']);
  assert.equal(moversList(items, { limit: 2 }).length, 2);
});

test('ticker de una noticia: por nombre, y por símbolo solo en cripto', () => {
  assert.equal(tickerFor('Bitcoin cae por debajo de los 58.000 dólares', ASSETS)?.symbol, 'BTC');
  assert.equal(tickerFor('Nvidia presenta resultados récord', ASSETS)?.symbol, 'NVDA');
  assert.equal(tickerFor('Santander eleva su beneficio', ASSETS)?.symbol, 'SAN');
  assert.equal(tickerFor('Ethereum (ETH) cae un 1 %', ASSETS)?.symbol, 'ETH');
  assert.equal(tickerFor('El Ibex 35 cierra en positivo', ASSETS)?.symbol, 'IBEX');
  assert.equal(tickerFor('Los bancos centrales y la inflación', ASSETS), null);
  assert.equal(tickerFor('San Sebastián acoge un congreso', ASSETS), null); // «SAN» de bolsa no se busca como palabra
});

test('mapa de calor: plano, tres intensidades y signo', () => {
  assert.equal(heatClass(0.01), 'heat-flat');
  assert.equal(heatClass(0.5), 'heat-up-1');
  assert.equal(heatClass(-1.5), 'heat-down-2');
  assert.equal(heatClass(4), 'heat-up-3');
  assert.equal(heatClass(NaN), 'heat-flat');
});
