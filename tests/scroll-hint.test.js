// Pruebas de la lógica de la pista de scroll horizontal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollState } from '../frontend/js/lib/scroll-hint.js';

test('si todo cabe no hay pista', () => {
  assert.equal(scrollState(0, 358, 358), 'none');
  assert.equal(scrollState(0, 358, 359), 'none'); // 1 px de redondeo no cuenta
  assert.equal(scrollState(0, 358, 360), 'none'); // dentro de la tolerancia
});

test('al principio hay más a la derecha, al final a la izquierda, y en medio a los dos lados', () => {
  assert.equal(scrollState(0, 358, 520), 'start');
  assert.equal(scrollState(1, 358, 520), 'start');
  assert.equal(scrollState(80, 358, 520), 'middle');
  assert.equal(scrollState(162, 358, 520), 'end');
  assert.equal(scrollState(161.4, 358, 520), 'end'); // subpíxeles al llegar al final
});

test('valores raros no rompen nada', () => {
  assert.equal(scrollState(0, 0, 0), 'none');
  assert.equal(scrollState(-5, 358, 520), 'start'); // rebote de iOS
  assert.equal(scrollState(400, 358, 520), 'end');
});
