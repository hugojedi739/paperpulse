// Contador de visitas: el navegador envía un aviso aparte, una vez por carga, sin cookies, después de cargar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendVisit, sourceOf, resetVisit } from '../frontend/js/lib/visit.js';

test('envía POST /api/visit una sola vez, sin cookies y con signedIn', async () => {
  resetVisit();
  const calls = [];
  const fetcher = async (path, opts) => { calls.push([path, opts]); return {}; };
  assert.equal(await sendVisit({ signedIn: true, fetcher }), true);
  assert.equal(await sendVisit({ signedIn: true, fetcher }), false, 'solo una vez por carga');
  assert.deepEqual(calls, [['/api/visit', { method: 'POST', body: { signedIn: true, ref: 'direct' }, credentials: 'omit' }]]);
  resetVisit();
  await sendVisit({ signedIn: 'sí', fetcher });
  assert.deepEqual(calls[1][1].body, { signedIn: false, ref: 'direct' }, 'solo true cuenta como con sesión');
});

test('si falla, no lanza: es una estadística', async () => {
  resetVisit();
  assert.equal(await sendVisit({ fetcher: async () => { throw new Error('429'); } }), false);
});

test('api.js deja omitir las cookies y por defecto sigue enviándolas al mismo origen', () => {
  const src = readFileSync(new URL('../frontend/js/lib/api.js', import.meta.url), 'utf8');
  assert.match(src, /credentials = 'same-origin'/);
});

test('main.js lo envía tras el evento load y cuando ya se sabe si hay sesión; la portada no cuenta', () => {
  const main = readFileSync(new URL('../frontend/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /auth\.ready\.then\(\(\) => \{\s*const go = \(\) => setTimeout\(\(\) => sendVisit\(\{ signedIn: Boolean\(auth\.currentUser\(\)\) \}\), 0\);\s*if \(document\.readyState === 'complete'\) go\(\); else addEventListener\('load', go, \{ once: true \}\);/);
  const app = readFileSync(new URL('../backend/app.py', import.meta.url), 'utf8');
  const serve = app.slice(app.indexOf('async def serve_index'), app.indexOf('routes = ['));
  assert.ok(!serve.includes('visits'), 'serve_index no llama al contador');
});

test('sourceOf: ?ref=, página de procedencia y directo', () => {
  assert.equal(sourceOf('?ref=Reddit', ''), 'reddit');
  assert.equal(sourceOf('?ref=tiktok', 'https://www.reddit.com/'), 'tiktok', '?ref= manda sobre la procedencia');
  assert.equal(sourceOf('', 'https://old.reddit.com/r/x'), 'reddit');
  assert.equal(sourceOf('', 'https://t.co/abc'), 'x');
  assert.equal(sourceOf('', 'https://blog.ejemplo.com/post'), 'otro');
  assert.equal(sourceOf('', ''), 'direct');
  assert.equal(sourceOf('?ref=' + 'a'.repeat(50), '').length, 20, 'se recorta: el servidor igualmente solo admite una lista cerrada');
});
