// Formato compacto único de cifras grandes, en escala española (B = billón = 10¹²). Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const fmt = await import('../frontend/js/lib/format.js');
fmt.setCurrencyPreference('EUR');
fmt.setRates({ EUR: 1, GBP: 0.8 }); // 1 USD = 1 EUR: las cifras salen tal cual

const NB = ' '; // la cifra y su unidad van unidas con espacio duro
const plain = (s) => s.replaceAll(NB, ' ');

test('escala española: 999 · 1,5 K · 1,5 M · 1,5 mil M · 1,1 B', () => {
  assert.equal(plain(fmt.compact(999)), '999');
  assert.equal(plain(fmt.compact(1_500)), '1,5 K');
  assert.equal(plain(fmt.compact(1_500_000)), '1,5 M');
  assert.equal(plain(fmt.compact(1.5e9)), '1,5 mil M');
  assert.equal(plain(fmt.compact(1.1e12)), '1,1 B');
});

test('la unidad va siempre junto al número y nunca se usa la «B» inglesa para 10⁹', () => {
  assert.equal(plain(fmt.compact(1.5e9, 'USDT')), '1,5 mil M USDT');
  assert.equal(plain(fmt.compact(12_300_000, 'acciones')), '12,3 M acciones');
  assert.ok(fmt.compact(1.5e9).includes(NB), 'espacio duro entre cifra y escala');
  assert.doesNotMatch(fmt.compact(1.5e9), /\bB\b/);
});

test('volumen y capitalización usan el mismo formateador', () => {
  assert.equal(plain(fmt.volume(1.5e9)), '1,5 mil M');
  assert.equal(plain(fmt.money(31_610_000_000, { compact: true })), '31,6 mil M €');
  assert.equal(fmt.volume(0), '—');
  assert.equal(plain(fmt.compact(-2_000_000)), '−2 M');
});
