// Pruebas de la elección del saldo inicial: límites, lectura del importe y textos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { START_MIN, START_MAX, PRESETS, DEFAULT_AMOUNT, formatEuro, parseAmount, smallBalanceNote, summaryLine, startedWith, startedAmount, whatIf, whatIfParts, formatEuroSigned } from '../frontend/js/lib/starting-balance.js';

test('límites, importes rápidos y valor por defecto', () => {
  assert.deepEqual([START_MIN, START_MAX], [50, 1_000_000]);
  assert.deepEqual(PRESETS, [100, 500, 1000, 5000, 10000, 25000]);
  assert.ok(Math.min(...PRESETS) >= 100, 'las opciones rápidas empiezan en 100 €');
  assert.equal(DEFAULT_AMOUNT, 1000);
  assert.ok(PRESETS.includes(DEFAULT_AMOUNT));
  assert.ok(PRESETS.every((v) => parseAmount(v).ok), 'todos los importes rápidos son válidos');
});

test('formato en euros con agrupado de miles también en 1.000', () => {
  assert.equal(formatEuro(1000), '1.000 €');
  assert.equal(formatEuro(50), '50 €');
  assert.equal(formatEuro(10000), '10.000 €');
  assert.equal(formatEuro(1_000_000), '1.000.000 €');
  assert.equal(formatEuro(123.45), '123,45 €');
  assert.equal(formatEuro(123.5), '123,50 €');
});

test('lee importes escritos de varias formas', () => {
  for (const [text, value] of [['1000', 1000], ['1.000', 1000], ['1 000', 1000], ['1.000,50', 1000.5], ['1000.5', 1000.5], ['1000,5', 1000.5], ['  250 € ', 250], ['1.000.000', 1_000_000], ['50', 50], ['99,99', 99.99], [250, 250], ['0050', 50]]) {
    assert.deepEqual(parseAmount(text), { ok: true, value }, String(text));
  }
});

test('límites inclusivos: 50 y 1.000.000 valen; 49,99 y 1.000.001 no', () => {
  assert.equal(parseAmount('50').ok, true);
  assert.equal(parseAmount('1000000').ok, true);
  assert.equal(parseAmount('49,99').ok, false);
  assert.equal(parseAmount('49.99').ok, false);
  assert.equal(parseAmount('1000001').ok, false);
  assert.match(parseAmount('10').error, /entre 50 € y 1\.000\.000 €/);
});

test('entradas no válidas', () => {
  for (const bad of ['', '   ', 'abc', '1e3', '-100', '1,2,3', '12..5', 'NaN', 'Infinity', null, undefined, NaN, Infinity, 0, '0', '1.00.0', '5 0 0 x']) {
    assert.equal(parseAmount(bad).ok, false, String(bad));
  }
});

test('más de dos decimales se rechaza con su propio mensaje', () => {
  assert.match(parseAmount('100,123').error, /dos decimales/);
  assert.equal(parseAmount('100.123').value, 100123); // con un solo punto y tres cifras es un millar, no tres decimales
  assert.equal(parseAmount('100,12').ok, true);
});

test('aviso de saldo pequeño solo entre 50 y 100 €', () => {
  assert.match(smallBalanceNote(50), /pocas posiciones a la vez/);
  assert.match(smallBalanceNote(99.99), /pocas posiciones/);
  assert.equal(smallBalanceNote(100), '');
  assert.equal(smallBalanceNote(1000), '');
  assert.equal(smallBalanceNote(10), ''); // inválido: se avisa del rango, no de esto
  assert.equal(smallBalanceNote(NaN), '');
});

test('textos: línea dinámica y «Empezaste con»', () => {
  assert.equal(summaryLine(1000), 'Empezarás con 1.000 €. Tu saldo es privado. Tu rentabilidad puede aparecer en la clasificación si tu perfil es público.');
  assert.equal(startedWith({ amount: 1000, currency: 'EUR' }), 'Empezaste con 1.000 €');
  assert.equal(startedWith({ amount: 123.45, currency: 'EUR' }), 'Empezaste con 123,45 €');
  assert.equal(startedAmount({ amount: 1000, currency: 'EUR' }), '1.000 €');
  assert.equal(startedAmount(null), '');
  for (const none of [null, undefined, {}, { amount: 0, currency: 'EUR' }, { amount: 100, currency: 'USD' }]) assert.equal(startedWith(none), '');
});

test('el texto de la interfaz no lleva exclamaciones', () => {
  for (const text of [summaryLine(500), smallBalanceNote(60), parseAmount('1').error, startedWith({ amount: 5, currency: 'EUR' })]) assert.ok(!/[!¡]/.test(text), text);
});

test('«si hubieras invertido tus X €»: lo elegido llevado a hoy con la rentabilidad de la cuenta', () => {
  const eur = (amount) => ({ amount, currency: 'EUR' });
  assert.deepEqual(whatIf(eur(1000), 4.32), { start: 1000, now: 1043.2, diff: 43.2 });
  assert.deepEqual(whatIf(eur(1000), -5), { start: 1000, now: 950, diff: -50 });
  assert.deepEqual(whatIf(eur(250), 0), { start: 250, now: 250, diff: 0 });
  assert.deepEqual(whatIf(eur(123.45), 10), { start: 123.45, now: 135.8, diff: 12.35 }, 'redondea a céntimos');
  assert.deepEqual(whatIf(eur(100), -150), { start: 100, now: 0, diff: -100 }, 'nunca menos de cero');
});

test('sin importe elegido no hay resumen (cuentas anteriores y datos raros)', () => {
  for (const input of [null, undefined, {}, { amount: 0, currency: 'EUR' }, { amount: -5, currency: 'EUR' }, { amount: 1000, currency: 'USD' }]) {
    assert.equal(whatIf(input, 5), null);
    assert.equal(whatIfParts(input, 5, true), null);
  }
  assert.equal(whatIf({ amount: 1000, currency: 'EUR' }, NaN), null);
});

test('textos del resumen: antes de operar se explica; después, importes con signo', () => {
  const input = { amount: 1000, currency: 'EUR' };
  assert.match(whatIfParts(input, 0, false).intro, /primera operación.*1\.000 €/);
  const up = whatIfParts(input, 4.32, true);
  assert.deepEqual([up.start, up.now, up.diff, up.trend], ['1.000 €', '1.043,20 €', '+43,20 €', 1]);
  const down = whatIfParts(input, -5, true);
  assert.deepEqual([down.now, down.diff, down.trend], ['950 €', '−50 €', -1]);
  assert.equal(whatIfParts(input, 0, true).diff, '0 €');
  assert.deepEqual([formatEuroSigned(12.5), formatEuroSigned(-0.01), formatEuroSigned(0)], ['+12,50 €', '−0,01 €', '0 €']);
});
