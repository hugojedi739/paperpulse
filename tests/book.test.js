// Libro de órdenes compacto: presión compradora/vendedora, niveles y muros. Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookPressure, bookLevels, BOOK_WALL } from '../frontend/js/lib/book.js';

test('presión: reparto del volumen (precio × cantidad) y etiqueta', () => {
  const lv = (q) => Array.from({ length: 4 }, () => [100, q]); // 4 niveles iguales: 25 % cada uno, ninguno es muro
  assert.deepEqual(bookPressure(lv(6.2), lv(3.8)), { buyPct: 62, sellPct: 38, label: 'Más presión compradora', walls: 0 });
  assert.equal(bookPressure(lv(3), lv(7)).label, 'Más presión vendedora');
  assert.equal(bookPressure(lv(5.4), lv(4.6)).label, 'Equilibrado'); // 54 %: dentro de 45-55
  assert.equal(bookPressure(lv(4.5), lv(5.5)).label, 'Equilibrado'); // 45 %: límite incluido
  assert.equal(bookPressure([], []).buyPct, 50);
});

test('niveles: parte del lado, profundidad acumulada y muro por encima del 30 %', () => {
  const lv = bookLevels([[10, 1], [9, 1], [8, 4], [7, 2], [6, 2]]);
  assert.deepEqual(lv.map((l) => +l.share.toFixed(2)), [0.1, 0.1, 0.4, 0.2, 0.2]);
  assert.deepEqual(lv.map((l) => +l.depth.toFixed(2)), [0.1, 0.2, 0.6, 0.8, 1]);
  assert.deepEqual(lv.map((l) => l.wall), [false, false, true, false, false]);
  assert.equal(BOOK_WALL, 0.3);
});

test('presión: un muro no decide la barra (se excluye y se avisa)', () => {
  const bids = [[100, 1], [99, 1], [98, 1], [97, 1]];
  const asks = [[101, 1], [102, 1], [103, 1], [104, 30]]; // un muro de venta: 87 % del lado
  const p = bookPressure(bids, asks);
  assert.equal(p.walls, 1);
  assert.equal(p.buyPct, 56); // sin el muro: 394 de compra frente a 306 de venta (con él saldría un 12 % de compra)
  assert.notEqual(p.label, 'Más presión vendedora');
});
