// Opinión de la comunidad por activo (voto alcista/bajista). El dato lo da nuestro backend
// (/api/assets/{símbolo}/sentiment): el navegador nunca llama a terceros. Es una opinión, no una recomendación.
import { api } from './api.c22010e9.js';

export const SENTIMENT_NOTE = 'Opinión de la comunidad con fines educativos: no es una recomendación de inversión ni predice el precio. Cada persona puede votar una vez por activo y cambiar o retirar su voto.';

const url = (symbol) => `/api/assets/${encodeURIComponent(symbol)}/sentiment`;

/** {symbol, bullish, bearish, total, myVote, threadId}, o null si falla. Nunca lanza. */
export async function loadSentiment(symbol, { fetcher = api } = {}) {
  try {
    const s = await fetcher(url(symbol));
    return s && typeof s.total === 'number' ? s : null;
  } catch {
    return null;
  }
}

/** Vota (1 alcista, -1 bajista, 0 retirar). Lanza el error del servidor (sesión, suspensión, límite). */
export const castVote = (symbol, value, { fetcher = api } = {}) => fetcher(url(symbol), { method: 'PUT', body: { value } });

/** Hacer clic en el voto que ya tengo lo retira; en el otro, lo cambia. */
export const nextVote = (current, clicked) => (clicked === current ? 0 : clicked);

/** Porcentajes enteros que suman 100, o null si nadie ha votado. */
export function shares(s) {
  if (!s || !s.total) return null;
  const bull = Math.round((s.bullish / s.total) * 100);
  return { bull, bear: 100 - bull };
}

export const votesLabel = (n) => (n === 1 ? '1 voto' : `${n} votos`);
