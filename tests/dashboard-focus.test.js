// Resumen según el estado: elegir saldo primero, órdenes pendientes arriba e invitación a la primera compra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dashboardFocus, orderLabel } from '../frontend/js/lib/dashboard-focus.js';

test('con sesión y sin cuenta del servidor: elegir saldo primero y casi lo único', () => {
  assert.deepEqual(dashboardFocus({ signedIn: true, practice: false }), { setupFirst: true, minimal: true, orders: false, firstBuy: false });
});

test('sin sesión y sin cuenta: nada de esto (la portada pública tiene su propio orden)', () => {
  assert.deepEqual(dashboardFocus({ signedIn: false, practice: false }), { setupFirst: false, minimal: false, orders: false, firstBuy: false });
});

test('con cuenta: órdenes pendientes arriba si las hay e invitación a la primera compra si no hay posiciones', () => {
  assert.deepEqual(dashboardFocus({ signedIn: true, practice: true, positions: 0, orders: 2 }), { setupFirst: false, minimal: false, orders: true, firstBuy: true });
  assert.deepEqual(dashboardFocus({ signedIn: false, practice: true, positions: 3, orders: 0 }), { setupFirst: false, minimal: false, orders: false, firstBuy: false });
});

test('etiquetas de las órdenes de Demo y de la cuenta del servidor', () => {
  assert.equal(orderLabel({ type: 'limit' }), 'Límite');
  assert.equal(orderLabel({ type: 'stop-limit' }), 'Stop-límite');
  assert.equal(orderLabel({ side: 'sell', type: 'stop' }), 'Venta stop');
  assert.equal(orderLabel({ side: 'buy', type: 'limit' }), 'Compra límite');
});

test('la invitación no nombra ningún activo (no es una recomendación)', () => {
  const src = readFileSync(new URL('../frontend/js/views/dashboard.js', import.meta.url), 'utf8');
  const card = src.slice(src.indexOf('d-first-title'), src.indexOf('d-first-title') + 900);
  assert.doesNotMatch(card, /Bitcoin|BTC|ETH|NVIDIA|Santander/);
});
