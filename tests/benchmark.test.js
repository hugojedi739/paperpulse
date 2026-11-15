// Comparador del Resumen («¿Te ha compensado operar?»): petición al backend, caché y textos neutrales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sp500Since, resetCache, comparison, formatPoints, sinceLabel } from '../frontend/js/lib/benchmark.js';

const SINCE = 1793800800; // miércoles 4 de noviembre de 2026

test('pide el dato a nuestro backend, nunca a un tercero, y lo guarda unos minutos', async () => {
  resetCache();
  const calls = [];
  const fetcher = async (path) => { calls.push(path); return { available: true, returnPct: 1.25 }; };
  assert.equal((await sp500Since(SINCE, { fetcher, now: 0 })).returnPct, 1.25);
  assert.deepEqual(calls, [`/api/benchmark/sp500?since=${SINCE}`]);
  await sp500Since(SINCE, { fetcher, now: 9 * 60 * 1000 });
  assert.equal(calls.length, 1, 'dentro de los 10 minutos no se vuelve a pedir');
  await sp500Since(SINCE, { fetcher, now: 11 * 60 * 1000 });
  assert.equal(calls.length, 2);
  await sp500Since(SINCE + 1, { fetcher, now: 11 * 60 * 1000 });
  assert.equal(calls.length, 3, 'otra fecha de apertura (otra sesión) pide de nuevo');
});

test('sin dato, con error o sin fecha devuelve null (la tarjeta no se pinta)', async () => {
  resetCache();
  assert.equal(await sp500Since(SINCE, { fetcher: async () => ({ available: false }) }), null);
  resetCache();
  assert.equal(await sp500Since(SINCE, { fetcher: async () => { throw new Error('sin red'); } }), null);
  resetCache();
  assert.equal(await sp500Since(SINCE, { fetcher: async () => ({ available: true, returnPct: null }) }), null);
  let called = false;
  assert.equal(await sp500Since(null, { fetcher: async () => { called = true; } }), null);
  assert.equal(await sp500Since(0, { fetcher: async () => { called = true; } }), null);
  assert.equal(called, false);
});

test('compara con no invertir (0 %) y con el S&P 500', () => {
  const c = comparison(3.2, 1.9);
  assert.deepEqual(c.rows.map((r) => [r.key, r.pct]), [['mine', 3.2], ['cash', 0], ['sp500', 1.9]]);
  assert.equal(c.summary, 'Hasta ahora, tu cuenta va 1,3 puntos por encima del S&P 500 y 3,2 puntos por encima de no invertir.');
});

test('frases neutrales por debajo e igual, sin animar a operar', () => {
  assert.equal(comparison(-2, 1).summary, 'Hasta ahora, tu cuenta va 3,0 puntos por debajo del S&P 500 y 2,0 puntos por debajo de no invertir.');
  assert.equal(comparison(0.02, 0).summary, 'Hasta ahora, tu cuenta va igual que el S&P 500 y igual que no invertir.');
  assert.equal(formatPoints(1), '1,0 punto');
  for (const [a, b] of [[5, 1], [-5, 1], [0, 0]]) {
    const s = comparison(a, b).summary.toLowerCase();
    for (const word of ['gana', 'enhorabuena', 'deberías', 'compra', 'vende', 'garantiz']) assert.ok(!s.includes(word), `«${word}» en: ${s}`);
  }
});

test('sin S&P 500 no hay comparación', () => {
  assert.equal(comparison(1, null), null);
  assert.equal(comparison(1, NaN), null);
  assert.equal(comparison(undefined, 1), null);
});

test('fecha de apertura en español', () => {
  assert.equal(sinceLabel(SINCE), '4 de noviembre de 2026');
});

test('la tarjeta solo existe con sesión, avisa del rendimiento pasado y no usa innerHTML', () => {
  const src = readFileSync(new URL('../frontend/js/views/dashboard.js', import.meta.url), 'utf8');
  assert.match(src, /\$\{user \? html`<div id="d-compare"><\/div>` : ''\}/);
  assert.match(src, /¿Te ha compensado operar\?/);
  assert.match(src, /El rendimiento pasado no garantiza resultados futuros\./);
  const fn = src.slice(src.indexOf('async function renderCompare'), src.indexOf('/* ---------- Con sesión'));
  assert.ok(fn.includes('store.isServerMode()') && fn.includes('account.openedAt()'), 'solo con la cuenta del servidor');
  assert.ok(!fn.includes('innerHTML'));
});

test('portada: titular, costes honestos y aviso educativo, sin promesas de ganancias', () => {
  const src = readFileSync(new URL('../frontend/js/views/dashboard.js', import.meta.url), 'utf8');
  const cta = src.slice(src.indexOf('<section class="card cta"'), src.indexOf('</section>', src.indexOf('<section class="card cta"')));
  const text = cta.replace(/<[^>]+>/g, ' ').replace(/\$\{[^}]+\}/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  assert.ok(text.includes('Practica con precios y costes reales. Averigua si de verdad te compensa operar.'), text);
  for (const part of ['Saldo virtual', 'cotizaciones reales', 'comisión y deslizamiento', 'Sin dinero real', 'Simulador educativo', 'No es asesoramiento financiero']) {
    assert.ok(text.includes(part), `falta «${part}»`);
  }
  for (const word of ['gana dinero', 'ganar dinero', 'hazte rico', 'garantizad', 'beneficios seguros']) assert.ok(!text.toLowerCase().includes(word), word);
});
