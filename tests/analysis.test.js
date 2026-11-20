// Análisis avanzado: MACD, volumen medio y soportes/resistencias (solo cálculo, sin gráfico).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macd, volumeAverage, supportResistance } from '../frontend/js/lib/analysis.js';

const candles = (closes, volume = 10) => closes.map((c, i) => ({ time: 1000 + i * 60, open: c, high: c + 1, low: c - 1, close: c, volume }));

test('MACD: con precio constante todo vale 0 y las series empiezan cuando hay datos suficientes', () => {
  const r = macd(candles(Array(60).fill(100)));
  assert.equal(r.macd.length, 60 - 26 + 1);
  assert.equal(r.signal.length, r.macd.length - 8);
  assert.equal(r.hist.length, r.signal.length);
  assert.ok([...r.macd, ...r.signal, ...r.hist].every((p) => Math.abs(p.value) < 1e-9));
});

test('MACD: en una subida sostenida la línea es positiva y las fechas coinciden con las velas', () => {
  const data = candles(Array.from({ length: 80 }, (_, i) => 100 + i));
  const r = macd(data);
  assert.ok(r.macd.at(-1).value > 0);
  assert.equal(r.macd.at(-1).time, data.at(-1).time);
  assert.equal(r.hist.at(-1).time, data.at(-1).time);
  assert.ok(Math.abs(r.hist.at(-1).value - (r.macd.at(-1).value - r.signal.at(-1).value)) < 1e-9);
});

test('MACD: con pocas velas no devuelve nada (ni lanza)', () => {
  assert.deepEqual(macd(candles([1, 2, 3])), { macd: [], signal: [], hist: [] });
  assert.deepEqual(macd([]), { macd: [], signal: [], hist: [] });
});

test('volumen medio: media móvil simple de 20', () => {
  const data = candles(Array(30).fill(1)).map((d, i) => ({ ...d, volume: i < 10 ? 10 : 30 }));
  const v = volumeAverage(data);
  assert.equal(v.length, 11);
  assert.equal(v[0].value, 20); // diez de 10 y diez de 30
  assert.equal(v.at(-1).value, 30);
  assert.deepEqual(volumeAverage(candles([1, 2, 3])), []);
});

test('soportes y resistencias: encuentra los niveles tocados varias veces, por debajo y por encima del precio', () => {
  // zigzag entre 90 y 110, acabando en medio
  const closes = [];
  for (let c = 0; c < 6; c++) for (let i = 0; i < 12; i++) closes.push(i < 6 ? 90 + (i * 20) / 5 : 110 - ((i - 6) * 20) / 5);
  closes.push(100);
  const r = supportResistance(candles(closes));
  assert.ok(r.resistances.length >= 1 && r.supports.length >= 1);
  assert.ok(r.resistances[0].price > 100 && r.resistances[0].price < 115);
  assert.ok(r.supports[0].price < 100 && r.supports[0].price > 85);
  assert.ok(r.resistances.every((l) => l.touches >= 2));
  assert.ok(r.resistances.length <= 3 && r.supports.length <= 3);
});

test('soportes y resistencias: sin pivotes repetidos o con pocas velas, ninguno', () => {
  assert.deepEqual(supportResistance(candles([1, 2, 3])), { supports: [], resistances: [] });
  const line = supportResistance(candles(Array.from({ length: 50 }, (_, i) => 100 + i)));
  assert.deepEqual(line, { supports: [], resistances: [] });
});

test('el gráfico mantiene las reglas de rendimiento: sin sombras, filtros ni lienzos nuevos para el análisis', () => {
  const src = readFileSync(new URL('../frontend/js/lib/charts.js', import.meta.url), 'utf8');
  const part = src.slice(src.indexOf('function syncIndicators'), src.indexOf('/* Leyenda superpuesta'));
  assert.doesNotMatch(part, /shadowBlur|\.filter\s*=|createElement\('canvas'\)|requestAnimationFrame|setInterval/);
});
