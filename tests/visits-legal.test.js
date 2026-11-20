// Contador de visitas: los textos legales lo explican (sin cookies ni IP) y el panel lo muestra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEGAL_VERSION, pageById } from '../frontend/js/lib/legal-content.js';

const text = (id) => JSON.stringify(pageById(id).sections);

test('privacidad: explica el contador, su base jurídica y cuánto se conserva', () => {
  const p = text('privacidad');
  assert.match(p, /Contador de visitas/);
  assert.match(p, /ni la IP ni el user-agent se guardan/);
  assert.match(p, /interés legítimo en conocer el uso del servicio/);
  assert.match(p, /se borra al día siguiente.*90 días/);
});

test('cookies: ya no dice que no haya analítica y explica que el contador no usa cookies', () => {
  const c = text('cookies');
  assert.doesNotMatch(c, /No usamos analítica/);
  assert.match(c, /No usamos cookies de analítica, publicidad ni seguimiento/);
  assert.match(c, /3\. Contador de visitas \(sin cookies\)/);
  assert.deepEqual(pageById('cookies').sections.map((s) => s.h.split('.')[0]), ['1', '2', '3', '4', '5', '6']);
});

test('LEGAL_VERSION no se ha cambiado en esta rama', () => {
  assert.equal(LEGAL_VERSION, '2026-11-borrador-2');
});

test('el Resumen del panel pinta visitantes de hoy, 14 días, bots y registros', () => {
  const src = readFileSync(new URL('../frontend/js/views/admin.js', import.meta.url), 'utf8');
  for (const s of ['Visitantes hoy', 'Visitantes: últimos 14 días', 'Bots hoy', 'Registros hoy', "toggle('visits_enabled'"]) assert.ok(src.includes(s), s);
});
