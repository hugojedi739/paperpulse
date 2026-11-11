// Saldo inicial de la cuenta de práctica: límites, importes rápidos, lectura del importe escrito y textos.
// Lógica sin DOM (se prueba con node --test). Los límites deben coincidir con backend/trading/rules.py (START_MIN_EUR/START_MAX_EUR).

export const START_MIN = 50;
export const START_MAX = 1_000_000;
export const PRESETS = [100, 500, 1000, 5000, 10000, 25000]; // menos de 100 € (hasta START_MIN) solo con «Otra cantidad»
export const DEFAULT_AMOUNT = 1000;
export const SMALL_BELOW = 100; // por debajo de esto se avisa de que caben pocas posiciones

const fmt = (digits) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always', minimumFractionDigits: digits, maximumFractionDigits: digits });
const eurWhole = fmt(0);
const eurCents = fmt(2);
/** «1.000 €», «50 €», «123,45 €», «123,50 €» (el agrupado de miles se pone siempre, también en 1.000). */
export const formatEuro = (n) => (Number.isInteger(n) ? eurWhole : eurCents).format(n).replace(/\s/g, ' ');

/**
 * Lee el importe que escribe la persona: «1000», «1.000», «1 000», «1.000,50», «1000.5». Devuelve { ok: true, value } o { ok: false, error }.
 * Admite hasta dos decimales y exige estar entre START_MIN y START_MAX.
 */
export function parseAmount(input) {
  const range = `Elige un importe entre ${formatEuro(START_MIN)} y ${formatEuro(START_MAX)}.`;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: range };
    input = String(input);
  }
  let t = String(input ?? '').replace(/[\s €]/g, '');
  if (!t) return { ok: false, error: range };
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // coma decimal; los puntos son de miles
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // «1.000», «1.000.000»
  if (!/^\d+(\.\d+)?$/.test(t)) return { ok: false, error: range };
  if ((t.split('.')[1] ?? '').length > 2) return { ok: false, error: 'El importe admite como mucho dos decimales.' };
  const value = Number(t);
  if (!(value >= START_MIN && value <= START_MAX)) return { ok: false, error: range };
  return { ok: true, value };
}

/** Aviso cuando el saldo es pequeño (con la orden mínima de 5 USD solo caben pocas posiciones a la vez). */
export const smallBalanceNote = (value) => (value >= START_MIN && value < SMALL_BELOW ? 'Con este saldo solo cabrán pocas posiciones a la vez.' : '');

export const summaryLine = (value) => `Empezarás con ${formatEuro(value)}. Tu saldo es privado. Tu rentabilidad puede aparecer en la clasificación si tu perfil es público.`;

/** «Empezaste con 1.000 €» a partir de lo guardado ({ amount, currency }); cadena vacía si no hay dato. */
export const startedWith = (input) => (startedAmount(input) ? `Empezaste con ${startedAmount(input)}` : '');

/** Solo el importe elegido («1.000 €»), o cadena vacía si no hay dato (cuentas anteriores o de los retos). */
export const startedAmount = (input) => (input?.amount > 0 && input.currency === 'EUR' ? formatEuro(input.amount) : '');

/**
 * «Si hubieras invertido tus X € de verdad…»: lo elegido al empezar llevado a hoy con la rentabilidad de la cuenta de práctica.
 * Devuelve { start, now, diff } en euros (céntimos redondeados) o null si no hay importe elegido (cuentas anteriores, retos).
 * No hay tipo de cambio de por medio: es el mismo porcentaje que se ve como «Rentabilidad», aplicado a los euros elegidos.
 */
export function whatIf(input, returnPct) {
  const start = input?.amount > 0 && input.currency === 'EUR' ? input.amount : 0;
  if (!start || !Number.isFinite(returnPct)) return null;
  const now = Math.max(0, Math.round(start * (1 + returnPct / 100) * 100) / 100);
  return { start, now, diff: Math.round((now - start) * 100) / 100 };
}

/** «+43,20 €», «−12 €», «0 €» (mismo signo menos tipográfico que el resto de importes). */
export const formatEuroSigned = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatEuro(Math.abs(n))}`;

/**
 * Textos del resumen, por partes para que la vista marque los importes como ocultables. `traded`: ya hay alguna operación.
 * Sin operaciones todavía no hay nada que contar: se explica qué aparecerá.
 */
export function whatIfParts(input, returnPct, traded) {
  const w = whatIf(input, returnPct);
  if (!w) return null;
  if (!traded) return { intro: `Cuando hagas tu primera operación verás aquí cuánto tendrías hoy si hubieras invertido tus ${formatEuro(w.start)} de verdad.` };
  return { lead: 'Si hubieras invertido tus', start: formatEuro(w.start), mid: 'de verdad con estas mismas operaciones, hoy tendrías', now: formatEuro(w.now), diff: formatEuroSigned(w.diff), trend: Math.sign(w.diff) };
}
