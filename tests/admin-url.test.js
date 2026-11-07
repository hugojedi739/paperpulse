// Pruebas del estado del panel de administración en la URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABS, parseParam, buildPath, nonDefault, pickAllowed } from '../frontend/js/lib/admin-url.js';

// Lo que hace router.js: separar por «/» el hash crudo y decodificar una vez el parámetro
const viaRouter = (path) => decodeURIComponent(path.replace(/^\/admin\//, '').split('/')[0]);

test('una pestaña sola, con o sin estado', () => {
  assert.deepEqual(parseParam('users'), { tab: 'users', state: {} });
  assert.deepEqual(parseParam('moderation:section=resolved'), { tab: 'moderation', state: { section: 'resolved' } });
  assert.equal(buildPath('overview'), '/admin/overview');
  assert.equal(buildPath('moderation', { section: 'dismissed' }), '/admin/moderation:section=dismissed');
});

test('pestaña desconocida, vacía o con basura: sin pestaña', () => {
  for (const bad of ['', 'nada', ':x=1', 'USERS', undefined, null, '__proto__:a=1']) assert.deepEqual(parseParam(bad), { tab: null, state: {} }, String(bad));
  assert.ok(TABS.includes('audit') && TABS.includes('messages'));
});

test('ida y vuelta pasando por el enrutador, con caracteres especiales', () => {
  const state = { q: 'a&b=c%d é/ñ #1 +x', status: 'suspended', role: '' };
  const param = viaRouter(buildPath('users', state));
  assert.ok(!buildPath('users', state).slice('/admin/'.length).includes('/'), 'sin «/» sin codificar: el enrutador partiría ahí');
  assert.deepEqual(parseParam(param), { tab: 'users', state: { q: 'a&b=c%d é/ñ #1 +x', status: 'suspended' } });
});

test('los valores vacíos no se escriben', () => {
  assert.equal(buildPath('users', { q: '', role: '', status: undefined, verified: null }), '/admin/users');
});

test('un estado mal formado no rompe nada', () => {
  assert.deepEqual(parseParam('users:q=%E0%A4%A&x'), { tab: 'users', state: { q: '%E0%A4%A' } }); // % suelto: se deja como está
  assert.deepEqual(parseParam('users:&&=&a'), { tab: 'users', state: {} });
  assert.deepEqual(parseParam('users:q=a=b'), { tab: 'users', state: { q: 'a=b' } });
});

test('nonDefault deja solo lo que cambia y pickAllowed rechaza lo desconocido', () => {
  const defaults = { q: '', role: '', order: 'created_desc' };
  assert.deepEqual(nonDefault({ q: '', role: 'admin', order: 'created_desc' }, defaults), { role: 'admin' });
  assert.equal(pickAllowed('admin', ['admin', 'user'], ''), 'admin');
  assert.equal(pickAllowed('root', ['admin', 'user'], ''), '');
  assert.equal(pickAllowed(undefined, ['a'], 'x'), 'x');
});
