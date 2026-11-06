// Estáticos para el CDN (scripts/build-static.mjs): están al día, los imports con hash existen y el arranque no carga las vistas diferidas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { build } from '../scripts/build-static.mjs';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [join(dir, e.name).slice(base.length + 1)]));

const tmp = mkdtempSync(join(tmpdir(), 'pp-build-'));
const out = join(tmp, 'public');
const indexOut = join(tmp, 'index.html');
build({ root, out, indexOut });

test('public/ y backend/templates/index.html están al día (ejecuta npm run build:static)', () => {
  const fresh = walk(out).sort();
  assert.deepEqual(walk(join(root, 'public')).sort(), fresh, 'lista de ficheros distinta');
  for (const f of fresh) assert.ok(readFileSync(join(out, f)).equals(readFileSync(join(root, 'public', f))), `desactualizado: public/${f}`);
  assert.equal(readFileSync(indexOut, 'utf8'), readFileSync(join(root, 'backend/templates/index.html'), 'utf8'));
});

test('la compilación es determinista', () => {
  const again = join(tmp, 'again');
  build({ root, out: again, indexOut: join(tmp, 'index2.html') });
  assert.deepEqual(walk(again).sort(), walk(out).sort());
});

test('cada import de public/ apunta a un fichero que existe y con hash', () => {
  const jsFiles = walk(out).filter((f) => /^js\/.*\.js$/.test(f));
  assert.ok(jsFiles.length > 30);
  for (const f of jsFiles) {
    const src = readFileSync(join(out, f), 'utf8');
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(['"])((?:\.{1,2}\/|\/vendor\/)[^'"]+\.m?js)\1/g)) {
      const target = m[2].startsWith('/') ? m[2].slice(1) : posix.normalize(posix.join(posix.dirname(f), m[2]));
      assert.match(target, /\.[0-9a-f]{8}\.m?js$/, `${f} importa sin hash: ${m[2]}`);
      assert.ok(existsSync(join(out, target)), `${f} importa un fichero inexistente: ${m[2]}`);
    }
  }
});

test('index.html, service worker y manifest apuntan a ficheros publicados', () => {
  const html = readFileSync(indexOut, 'utf8');
  const refs = [...html.matchAll(/(?:href|src)="(\/(?:js|css)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 20, 'faltan modulepreload');
  for (const r of refs) assert.ok(existsSync(join(out, r)), `index.html referencia ${r}`);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, 'no puede haber scripts inline (CSP)');
  const sw = readFileSync(join(out, 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/'(\/(?:js|css)\/[^']+)'/g)) assert.ok(existsSync(join(out, m[1])), `sw.js cachea ${m[1]}`);
});

test('el arranque no descarga admin, moderación, aprender ni la vista legal', () => {
  const html = readFileSync(indexOut, 'utf8');
  for (const lazy of ['views/admin', 'views/moderation', 'views/messages', 'views/learn', 'views/legal.', 'learn-content']) {
    assert.ok(!html.includes(`/js/${lazy.startsWith('learn-') ? 'lib/' : ''}${lazy}`), `${lazy} se precarga en el arranque`);
  }
});
