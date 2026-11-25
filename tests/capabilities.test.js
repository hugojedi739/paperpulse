// Capacidades por tipo de usuario (solo interfaz). Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, can, isLocked, COMING_SOON, LOCKED_TEXT } from '../frontend/js/lib/capabilities.js';

test('el invitado conserva todo lo que ya tenía: Long/Short en Demo, indicadores y alertas', () => {
  for (const f of ['demo', 'long', 'short', 'exits', 'indicators', 'alerts', 'favorites']) assert.equal(can(f, false), true, f);
});

test('solo la comparación con el S&P 500 y votar llevan candado para el invitado', () => {
  const locked = Object.keys(CAPABILITIES.user).filter((f) => isLocked(f, false));
  assert.deepEqual(locked.sort(), ['compareSp500', 'serverAccount', 'vote']);
  assert.equal(LOCKED_TEXT, 'Disponible con cuenta gratuita');
});

test('con sesión nunca se tiene menos que sin ella', () => {
  for (const f of Object.keys(CAPABILITIES.guest)) if (can(f, false)) assert.equal(can(f, true), true, f);
});

test('el Short en Mi cuenta es «próximamente», no un candado', () => {
  assert.equal(can('serverShort', true), false);
  assert.equal(isLocked('serverShort', false), false);
  assert.match(COMING_SOON.serverShort, /próximamente/);
  assert.equal(can('desconocida', true), false);
});
