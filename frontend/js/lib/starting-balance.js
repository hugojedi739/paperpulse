// Saldo inicial de la cuenta de práctica: límites, importes rápidos, lectura del importe escrito y textos.
// Lógica sin DOM (se prueba con node --test). Los límites deben coincidir con backend/trading/rules.py (START_MIN_EUR/START_MAX_EUR).

export const START_MIN = 50;
export const START_MAX = 1_000_000;
export const PRESETS = [50, 100, 500, 1000, 5000, 10000];
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
