// Comparador del Resumen: «¿Te ha compensado operar?». Tu rentabilidad frente a no invertir (0 %) y frente al
// S&P 500 desde el día en que se abrió la cuenta del servidor. El dato del S&P 500 lo da nuestro backend
// (/api/benchmark/sp500), que lo saca del proveedor de bolsa: el navegador nunca llama a terceros.
import { api } from './api.js';

const TTL_MS = 10 * 60 * 1000; // el backend cachea una hora; aquí basta con no pedirlo en cada repintado

let cached = { since: null, at: 0, data: null };

/** Rentabilidad del S&P 500 desde `since` (epoch en segundos) o null si no hay dato. Nunca lanza. */
export async function sp500Since(since, { fetcher = api, now = Date.now() } = {}) {
  if (!Number.isFinite(since) || since <= 0) return null;
  if (cached.since === since && now - cached.at < TTL_MS) return cached.data;
  let data = null;
  try {
    const res = await fetcher(`/api/benchmark/sp500?since=${Math.floor(since)}`);
    data = res?.available && Number.isFinite(res.returnPct) ? res : null;
  } catch {
    data = null; // sin servidor o sin proveedor: la tarjeta no se pinta
  }
  cached = { since, at: now, data };
  return data;
}

/** Solo para los tests. */
export function resetCache() { cached = { since: null, at: 0, data: null }; }

// Diferencias menores que esto (en puntos porcentuales) se cuentan como «igual»: el redondeo no debe decidir.
const SAME = 0.05;

/**
 * Filas y frase del comparador. `mine` y `sp500` en %, o null si falta el S&P 500 (entonces no hay tarjeta).
 * Texto neutral: describe la diferencia, sin animar ni desanimar a operar.
 */
export function comparison(mine, sp500) {
  if (!Number.isFinite(mine) || !Number.isFinite(sp500)) return null;
  const rows = [
    { key: 'mine', label: 'Tu cuenta', detail: 'con comisiones y deslizamiento', pct: mine },
    { key: 'cash', label: 'No invertir', detail: 'dejar el dinero quieto', pct: 0 },
    { key: 'sp500', label: 'S&P 500', detail: 'comprar y mantener', pct: sp500 },
  ];
  // `same`: «igual que el S&P 500»; `of`: «por encima del S&P 500» (con la contracción del español)
  const vs = (a, b, same, of) => {
    const d = a - b;
    if (Math.abs(d) < SAME) return `igual que ${same}`;
    return `${formatPoints(Math.abs(d))} ${d > 0 ? 'por encima' : 'por debajo'} ${of}`;
  };
  const summary = `Hasta ahora, tu cuenta va ${vs(mine, sp500, 'el S&P 500', 'del S&P 500')} y ${vs(mine, 0, 'no invertir', 'de no invertir')}.`;
  return { rows, summary };
}

const pointsFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** «1,3 puntos» / «1 punto»: diferencia entre dos rentabilidades, no un porcentaje de nada. */
export function formatPoints(p) {
  const s = pointsFmt.format(p);
  return `${s} ${s === '1,0' ? 'punto' : 'puntos'}`;
}

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** «3 de noviembre de 2026» a partir de la fecha de apertura (epoch en segundos). */
export const sinceLabel = (since) => dateFmt.format(new Date(since * 1000));
