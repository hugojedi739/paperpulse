// Próximos dividendos de las acciones del catálogo (informativo). El dato lo da nuestro backend
// (/api/dividends, con el proveedor de bolsa): el navegador nunca llama a terceros. Sin dato, no se pinta nada.
// La simulación NO abona dividendos: esto solo informa de las fechas.
import { api } from './api.c22010e9.js';

const TTL_MS = 30 * 60 * 1000; // el backend cachea 6 h; aquí basta con no pedirlo en cada vista

let cached = { at: 0, data: null, pending: null };

/** {SÍMBOLO: {exDate, amount, lastAmount, currency}}; objeto vacío si no hay datos o falla. Nunca lanza. */
export async function upcomingDividends({ fetcher = api, now = Date.now() } = {}) {
  if (cached.data && now - cached.at < TTL_MS) return cached.data;
  if (cached.pending) return cached.pending; // varias vistas a la vez: una sola petición
  cached.pending = (async () => {
    let data = {};
    try {
      const res = await fetcher('/api/dividends');
      data = res?.data && typeof res.data === 'object' ? res.data : {};
    } catch {
      data = {};
    }
    cached = { at: now, data, pending: null };
    return data;
  })();
  return cached.pending;
}

/** Solo para los tests. */
export function resetCache() { cached = { at: 0, data: null, pending: null }; }

const dateFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** «19 de noviembre de 2026» a partir de «2026-11-19». */
export const exDateLabel = (iso) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

/** Importe por acción en su moneda, con los decimales que traiga (0,275 €). */
export function amountLabel(value, currency) {
  if (!Number.isFinite(value)) return '';
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 4 };
  try {
    return new Intl.NumberFormat('es-ES', currency ? { ...opts, style: 'currency', currency } : opts).format(value).replace(/\s/g, ' ');
  } catch {
    return new Intl.NumberFormat('es-ES', opts).format(value);
  }
}

/** Importe anunciado o, si aún no lo está, «por confirmar» con el último pagado. */
export function amountText(d) {
  if (Number.isFinite(d.amount)) return `${amountLabel(d.amount, d.currency)} por acción`;
  if (Number.isFinite(d.lastAmount)) return `importe por confirmar (el último fue ${amountLabel(d.lastAmount, d.currency)})`;
  return 'importe por confirmar';
}

/** Línea de la ficha de una acción, o '' si no hay dividendo próximo conocido. */
export function dividendLine(d) {
  if (!d?.exDate) return '';
  return `Próximo dividendo: ex-dividendo el ${exDateLabel(d.exDate)} · ${amountText(d)}`;
}

/** Días naturales que faltan hasta la fecha ex-dividendo (0 = hoy). */
export function daysUntil(iso, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Posiciones abiertas con un dividendo próximo, de la fecha más cercana a la más lejana. */
export function forPositions(positions, data) {
  const seen = new Set();
  return (positions || [])
    .filter((p) => p && data?.[p.symbol]?.exDate && !seen.has(p.symbol) && seen.add(p.symbol))
    .map((p) => ({ symbol: p.symbol, name: p.name || p.symbol, ...data[p.symbol] }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate) || a.symbol.localeCompare(b.symbol));
}

/** Notas neutrales: qué es la fecha ex-dividendo y qué hace (y qué no hace) la simulación. */
export const EX_DATE_NOTE = 'La fecha que cuenta es la ex-dividendo: para cobrarlo hay que tener la acción antes de ese día; quien compra ese mismo día ya no tiene derecho.';
export const SIMULATION_NOTE = 'La simulación no abona dividendos: el saldo no cambia. Es información, no una recomendación.';
