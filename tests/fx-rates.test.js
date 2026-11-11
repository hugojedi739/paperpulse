// Los últimos tipos de cambio se recuerdan: al recargar, los importes en euros salen bien desde el primer momento.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.localStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
const fresh = (tag) => import(`../frontend/js/lib/format.js?${tag}`); // cada etiqueta carga el módulo de nuevo, como una recarga de la página

test('sin nada guardado se usan los tipos por defecto', async () => {
  data.clear();
  const fmt = await fresh('vacio');
  assert.equal(fmt.convert(100, 'USD', 'EUR'), 92);
});

test('setRates guarda los tipos y la siguiente carga arranca con ellos', async () => {
  data.clear();
  const first = await fresh('a');
  first.setRates({ EUR: 0.5, GBP: 0.4, JPY: 150 });
  assert.deepEqual(JSON.parse(data.get('paperpulse_fx_rates')), { EUR: 0.5, GBP: 0.4 });
  const reloaded = await fresh('b');
  assert.equal(reloaded.convert(100, 'USD', 'EUR'), 50);
  assert.equal(reloaded.convert(100, 'USD', 'GBP'), 40);
});

test('un dato guardado roto o absurdo no rompe el arranque ni cambia los tipos', async () => {
  for (const [tag, bad] of [['c', '{no es json'], ['d', '{"EUR":0,"GBP":-1}'], ['e', '"texto"'], ['f', '{"EUR":"abc"}']]) {
    data.set('paperpulse_fx_rates', bad);
    const fmt = await fresh(tag);
    assert.equal(fmt.convert(100, 'USD', 'EUR'), 92, bad);
  }
});

test('si el almacenamiento falla al escribir, setRates sigue aplicando los tipos', async () => {
  data.clear();
  const fmt = await fresh('g');
  const original = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new Error('cuota llena'); };
  try { fmt.setRates({ EUR: 0.8 }); } finally { globalThis.localStorage.setItem = original; }
  assert.equal(fmt.convert(100, 'USD', 'EUR'), 80);
});

test('setRates dice si algo cambió, para repintar solo cuando hace falta', async () => {
  data.clear();
  const fmt = await fresh('h');
  assert.equal(fmt.setRates({ EUR: 0.9 }), true);
  assert.equal(fmt.setRates({ EUR: 0.9 }), false);
  assert.equal(fmt.setRates({ EUR: 'x' }), false, 'un valor no válido se ignora');
  assert.equal(fmt.setRates({ GBP: 0.7 }), true);
});
