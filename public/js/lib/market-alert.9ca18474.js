// Luz roja de mercado: reglas objetivas sobre las cotizaciones en vivo que ya recibe el navegador.
// Sin IA ni predicciones: solo «ha caído más de X %». Los umbrales son ajustes del panel y llegan con
// /api/markets (backend/market/alert.py). Con el mercado normal no hay nada que mostrar.

let rules = [];
const listeners = new Set();

/** Reglas recibidas de /api/markets: [{symbol, name, window: '24h'|'session', dropPct}]. Ignora lo que no encaje. */
export function setRules(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((r) => r && typeof r.symbol === 'string' && Number.isFinite(r.dropPct) && r.dropPct > 0 && ['24h', 'session'].includes(r.window))
    .map((r) => ({ symbol: r.symbol, name: String(r.name || r.symbol), window: r.window, dropPct: r.dropPct }));
  const changed = JSON.stringify(clean) !== JSON.stringify(rules);
  rules = clean;
  if (changed) listeners.forEach((fn) => fn());
}

export const getRules = () => rules;
export function onRules(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/**
 * Reglas que se cumplen ahora. `tickOf(symbol)` devuelve la cotización del feed.
 * Solo cuentan datos en vivo: nunca los sembrados desde la caché local (`seeded`), que pueden tener horas.
 * Las reglas de sesión (bolsa) solo cuentan con el mercado abierto: fuera de horario la variación se queda fija.
 */
export function evaluate(list, tickOf) {
  const out = [];
  for (const r of list) {
    const t = tickOf(r.symbol);
    if (!t || t.seeded || !Number.isFinite(t.change24h) || !(t.price > 0)) continue;
    if (r.window === 'session' && t.marketOpen === false) continue;
    if (t.change24h <= -r.dropPct) out.push({ ...r, changePct: t.change24h });
  }
  return out;
}

const pctFmt = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = (n) => `${pctFmt.format(Math.abs(n))} %`;
// El umbral se enseña tal cual se configuró en el panel (10 %, 7,5 %, 1,25 %): redondearlo podría mostrar otro
const thresholdFmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const fmtThreshold = (n) => `${thresholdFmt.format(n)} %`;

/** «Bitcoin cae un 11,2 % en las últimas 24 horas (el aviso se enciende a partir del 10 %).» */
export function describe(a) {
  const when = a.window === '24h' ? 'en las últimas 24 horas' : 'en la sesión de hoy, frente al cierre anterior';
  return `${a.name} cae un ${fmt(a.changePct)} ${when} (el aviso se enciende a partir del ${fmtThreshold(a.dropPct)}).`;
}

/** Texto corto del botón de la cabecera. */
export const label = (active) => (active.length === 1 ? `${active[0].name} ${pctSigned(active[0].changePct)}` : `${active.length} caídas fuertes`);
const pctSigned = (n) => `${n < 0 ? '−' : '+'}${fmt(n)}`;

/** Explicación neutral: qué ha pasado y qué significa el aviso. Nunca qué hacer. */
export const EXPLAIN = [
  'Este aviso se enciende solo, con reglas fijas: cuando un activo de referencia cae más que un umbral en su periodo. No usa inteligencia artificial ni intenta adivinar qué pasará después.',
  'En días así los precios suelen moverse más y más deprisa de lo habitual (más volatilidad), y la diferencia entre el precio que ves y el de ejecución puede ser mayor.',
  'Es información, no una recomendación de comprar ni de vender.',
];
