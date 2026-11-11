// Estadísticas personales a partir de las operaciones cerradas: aciertos, pérdida máxima y resultado por semanas.
// Lógica sin DOM (se prueba con node --test). Importes en USD, como el resto de la cuenta; la vista los convierte al mostrar.
// Solo cuentan las operaciones cerradas: una posición abierta no gana ni pierde hasta que se vende.

export const WEEKS = 8;

/** Lunes a las 00:00 (hora local) de la semana de `ms`. */
export function weekStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** `start` más `days` días de calendario. Con fechas, no sumando milisegundos: un día con cambio de hora no dura 24 h. */
export function addDays(start, days) {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Aciertos: ganadoras, perdedoras, en tablas y medias. La tasa se calcula sobre todas las operaciones cerradas. */
export function hitRate(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const sum = (list) => list.reduce((a, t) => a + t.pnl, 0);
  return {
    total: trades.length, wins: wins.length, losses: losses.length, flats: trades.length - wins.length - losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgWin: wins.length ? sum(wins) / wins.length : 0,
    avgLoss: losses.length ? sum(losses) / losses.length : 0, // negativo
    net: sum(trades),
  };
}

/** La operación que más perdió (o null si ninguna perdió). */
export function worstTrade(trades) {
  let worst = null;
  for (const t of trades) if (t.pnl < 0 && (!worst || t.pnl < worst.pnl)) worst = t;
  return worst;
}

/**
 * Caída máxima: la mayor bajada desde un máximo de la curva «saldo inicial + resultado acumulado de las operaciones cerradas».
 * Devuelve { amount (≥ 0), pct (sobre el máximo del que se cae), from, to } con las fechas en ms; amount 0 si nunca se bajó de un máximo.
 */
export function maxDrawdown(trades, capital) {
  const ordered = [...trades].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let value = capital > 0 ? capital : 0;
  let peak = value, peakAt = null;
  let best = { amount: 0, pct: 0, from: null, to: null };
  for (const t of ordered) {
    const at = Date.parse(t.date);
    value += t.pnl;
    if (value >= peak) { peak = value; peakAt = at; continue; }
    const amount = peak - value;
    if (amount > best.amount) best = { amount, pct: peak > 0 ? (amount / peak) * 100 : 0, from: peakAt ?? Date.parse(ordered[0].date), to: at };
  }
  return best;
}

/**
 * Resultado de las últimas `count` semanas (lunes a domingo, hora local), de la más antigua a la actual.
 * `pct` es el resultado de la semana sobre el saldo inicial: sirve para comparar semanas entre sí.
 */
export function weekly(trades, capital, now = Date.now(), count = WEEKS) {
  const current = weekStart(now);
  const weeks = Array.from({ length: count }, (_, i) => {
    const start = addDays(current, 7 * (i - (count - 1)));
    return { start, end: addDays(start, 6), pnl: 0, trades: 0, pct: 0 }; // end: el domingo a las 00:00 (solo para la etiqueta)
  });
  const index = new Map(weeks.map((w) => [w.start, w]));
  for (const t of trades) {
    const w = index.get(weekStart(Date.parse(t.date)));
    if (w) { w.pnl += t.pnl; w.trades += 1; }
  }
  for (const w of weeks) w.pct = capital > 0 ? (w.pnl / capital) * 100 : 0;
  return weeks;
}

/** Todo lo que pinta la pantalla de estadísticas. */
export function summary(trades, capital, now = Date.now()) {
  const weeks = weekly(trades, capital, now);
  const active = weeks.filter((w) => w.trades > 0);
  const pick = (better) => active.reduce((a, w) => (a === null || better(w.pnl, a.pnl) ? w : a), null);
  return {
    hit: hitRate(trades),
    worst: worstTrade(trades),
    drawdown: maxDrawdown(trades, capital),
    weeks,
    thisWeek: weeks.at(-1),
    bestWeek: pick((a, b) => a > b),
    worstWeek: pick((a, b) => a < b),
    scale: Math.max(0, ...weeks.map((w) => Math.abs(w.pnl))), // para el ancho de las barras
  };
}

const short = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
/** «3 nov – 9 nov» */
export const weekLabel = (w) => `${short.format(w.start).replace('.', '')} – ${short.format(w.end).replace('.', '')}`;
