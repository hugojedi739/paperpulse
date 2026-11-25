// Divisas y formato numérico con Intl. Base contable: USD (USDT se trata como USD).

const rates = { USD: 1, EUR: 0.92, GBP: 0.79 };
let preference = 'auto';
const SUPPORTED = ['EUR', 'USD', 'GBP'];

// Últimos tipos conocidos: al recargar se pinta con ellos desde el primer momento (sin esto el patrimonio en euros
// aparecía un instante con los tipos de arriba y saltaba al llegar los reales). Los del servidor los sustituyen enseguida.
const RATES_KEY = 'paperpulse_fx_rates';
const apply = (next) => { for (const c of SUPPORTED) if (Number(next?.[c]) > 0) rates[c] = Number(next[c]); };
try { apply(JSON.parse(globalThis.localStorage?.getItem(RATES_KEY) ?? 'null')); } catch { /* sin almacenamiento o dato roto: tipos por defecto */ }

/** Aplica y guarda los tipos nuevos. Devuelve true si alguno cambió (para repintar lo que ya estaba en pantalla). */
export function setRates(next) {
  const before = `${rates.EUR}|${rates.GBP}`;
  apply(next);
  try { globalThis.localStorage?.setItem(RATES_KEY, JSON.stringify({ EUR: rates.EUR, GBP: rates.GBP })); } catch { /* modo privado o cuota llena */ }
  return before !== `${rates.EUR}|${rates.GBP}`;
}

export function setCurrencyPreference(pref) { preference = pref || 'auto'; }

export function currency() {
  if (SUPPORTED.includes(preference)) return preference;
  const lang = (globalThis.navigator?.language || 'es-ES').toLowerCase();
  if (/-(gb|uk)$/.test(lang)) return 'GBP';
  if (/-us$/.test(lang)) return 'USD';
  return 'EUR';
}
/** La interfaz está en español: los números siempre usan formato es-ES (1.234,56). */
export const locale = () => 'es-ES';

const norm = (c) => (c || 'USD').toUpperCase().replace('USDT', 'USD');

/** Convierte entre USD, EUR, GBP y USDT. */
export function convert(amount, from = 'USD', to = 'USD') {
  const a = Number(amount);
  if (!Number.isFinite(a)) return 0;
  const f = norm(from), t = norm(to);
  return f === t ? a : (a / (rates[f] ?? 1)) * (rates[t] ?? 1);
}
export const toUsd = (amount, from) => convert(amount, from, 'USD');

const nf = new Map();
function numberFormat(opts) {
  const key = locale() + JSON.stringify(opts);
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat(locale(), { useGrouping: 'always', ...opts }));
  return nf.get(key);
}
const digits = (v) => {
  const a = Math.abs(v);
  return a >= 1 || a === 0 ? [2, 2] : a >= 0.01 ? [4, 4] : [6, 8];
};

/** Importe compacto con el símbolo de la divisa de la cuenta detrás: «31,6 mil M €». */
function compactCurrency(v) {
  const symbol = numberFormat({ style: 'currency', currency: currency(), currencyDisplay: 'narrowSymbol' })
    .formatToParts(0).find((x) => x.type === 'currency')?.value ?? currency();
  return compactFn(v, symbol);
}

/** Importe en la divisa de la cuenta (convierte desde `from`, USD por defecto). */
export function money(amount, { from = 'USD', signed = false, compact = false } = {}) {
  const v = convert(amount, from, currency());
  const [min, max] = digits(v);
  const s = compact
    ? compactCurrency(Math.abs(v)) // misma escala que el resto de la app: «31,6 mil M €»
    : numberFormat({ style: 'currency', currency: currency(), currencyDisplay: 'narrowSymbol', minimumFractionDigits: min, maximumFractionDigits: max }).format(Math.abs(v));
  if (!signed) return v < 0 ? `−${s}` : s;
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** Precio en la divisa nativa del activo (USDT, USD, EUR…). */
export function price(value, quote = 'USD') {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const [min, max] = digits(v);
  const q = (quote || 'USD').toUpperCase();
  if (q === 'USDT') return `${numberFormat({ minimumFractionDigits: min, maximumFractionDigits: max }).format(v)} USDT`;
  const display = q === currency() ? 'narrowSymbol' : 'code';
  return numberFormat({ style: 'currency', currency: q, currencyDisplay: display, minimumFractionDigits: min, maximumFractionDigits: max }).format(v);
}

/** Número sin divisa (para ejes y cantidades). */
export function num(value, maxFrac) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const [min, max] = digits(Number(value));
  return numberFormat({ minimumFractionDigits: maxFrac ?? min, maximumFractionDigits: maxFrac ?? max }).format(value);
}

/** Cantidad de unidades de un activo: 0,0123 BTC */
export function units(amount, symbol = '') {
  const v = Number(amount) || 0;
  const s = numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 }).format(v);
  return symbol ? `${s} ${symbol}` : s;
}

/** Porcentaje con signo tipográfico: +2,31 % / −1,45 % */
export function pct(value, { signed = true, decimals = 2 } = {}) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const s = numberFormat({ minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(v));
  const sign = v > 0 ? (signed ? '+' : '') : v < 0 ? '−' : '';
  return `${sign}${s} %`;
}

/**
 * Cifra grande en escala española, el único formato compacto de la app: 999 · 1,5 K · 1,5 M · 1,5 mil M · 1,1 B
 * (B = billón = 10¹²). Con `unit` la añade detrás: «1,5 mil M USDT».
 */
export function compact(value, unit = '') { return compactFn(value, unit); }
function compactFn(value, unit = '') {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const v = Math.abs(n);
  const NB = '\u00a0'; // espacio duro: la cifra y su unidad nunca se separan en dos líneas
  const f = (x, suffix) => `${numberFormat({ maximumFractionDigits: 1 }).format(x)}${NB}${suffix}`;
  const s = v >= 1e12 ? f(v / 1e12, 'B') : v >= 1e9 ? f(v / 1e9, `mil${NB}M`) : v >= 1e6 ? f(v / 1e6, 'M') : v >= 1e3 ? f(v / 1e3, 'K')
    : numberFormat({ maximumFractionDigits: v >= 1 ? 2 : 6 }).format(v);
  return `${n < 0 ? '−' : ''}${s}${unit ? `${NB}${unit}` : ''}`;
}

/** Volumen compacto (sin unidad: quien lo pinta añade la suya). */
export function volume(value) {
  const v = Math.abs(Number(value));
  if (!Number.isFinite(v) || v <= 0) return '—';
  return compact(v);
}

/** Equivalencia aproximada en la divisa de la cuenta, vacía si coincide. */
export function approx(value, quote) {
  if (!Number.isFinite(Number(value)) || norm(quote) === currency()) return '';
  return `≈ ${money(value, { from: quote })}`;
}

export const trendClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' });
export function timeAgo(date) {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 60) return 'ahora';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 604800) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function duration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
