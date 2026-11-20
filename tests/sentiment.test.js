// Opinión de la comunidad por activo: petición a nuestro backend y cálculos del reparto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadSentiment, castVote, nextVote, shares, votesLabel, SENTIMENT_NOTE } from '../frontend/js/lib/sentiment.js';

test('pide al backend del propio sitio y codifica el símbolo', async () => {
  const calls = [];
  const fetcher = async (path, opts) => { calls.push([path, opts?.method ?? 'GET', opts?.body]); return { symbol: 'BTC', total: 0, bullish: 0, bearish: 0, myVote: 0 }; };
  await loadSentiment('BTC', { fetcher });
  await castVote('A/B', -1, { fetcher });
  assert.deepEqual(calls, [['/api/assets/BTC/sentiment', 'GET', undefined], ['/api/assets/A%2FB/sentiment', 'PUT', { value: -1 }]]);
});

test('si el servidor falla, no se pinta nada (null) y no lanza', async () => {
  assert.equal(await loadSentiment('BTC', { fetcher: async () => { throw new Error('x'); } }), null);
  assert.equal(await loadSentiment('BTC', { fetcher: async () => ({}) }), null);
});

test('votar lo mismo retira el voto; lo contrario lo cambia', () => {
  assert.equal(nextVote(0, 1), 1);
  assert.equal(nextVote(1, 1), 0);
  assert.equal(nextVote(1, -1), -1);
  assert.equal(nextVote(-1, -1), 0);
});

test('porcentajes enteros que suman 100; sin votos, null', () => {
  assert.equal(shares({ total: 0, bullish: 0, bearish: 0 }), null);
  assert.deepEqual(shares({ total: 3, bullish: 1, bearish: 2 }), { bull: 33, bear: 67 });
  assert.deepEqual(shares({ total: 2, bullish: 2, bearish: 0 }), { bull: 100, bear: 0 });
  assert.equal(votesLabel(1), '1 voto');
  assert.equal(votesLabel(5), '5 votos');
});

test('el aviso deja claro que es opinión y no recomendación', () => {
  assert.match(SENTIMENT_NOTE, /no es una recomendación/);
});

test('la vista no usa innerHTML ni estilos inline para el reparto', () => {
  const src = readFileSync(new URL('../frontend/js/views/trade.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('function renderOpinion'), src.indexOf('async function vote'));
  assert.doesNotMatch(block, /innerHTML|style=|\.style\./);
  assert.match(block, /data-action': 'login'/);
});
