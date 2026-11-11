// Retos suaves de la semana: metas personales de buenos hábitos (controlar las pérdidas, ser constante, llevar el diario).
// No hay clasificación ni se guardan en ningún sitio: se calculan con las operaciones cerradas de la semana (lunes a domingo, hora
// local), así que valen igual en modo local y con la cuenta del servidor. Lógica sin DOM (se prueba con node --test).
import { weekStart, addDays } from './stats.js';

export const LOSS_LIMIT_PCT = 5; // pérdida máxima de la semana, sobre el saldo inicial
export const TRADE_RISK_PCT = 2; // pérdida máxima de una sola operación, sobre el saldo inicial
export const DAYS_TARGET = 3;
export const NOTES_TARGET = 3;

const pctOf = (amount, capital) => (capital > 0 ? (amount / capital) * 100 : 0);
const round1 = (v) => Math.round(v * 10) / 10;
const es = (v) => String(round1(v)).replace('.', ',');

/** Reto de «no pasar de un límite»: va bien mientras no se supere; se da por cumplido cuando la semana termina sin superarlo. */
function limitGoal(id, title, used, limit, traded, final, texts) {
  const state = !traded ? 'pending' : used > limit ? 'missed' : final ? 'done' : 'ontrack';
  return { id, kind: 'limit', title, value: round1(used), target: limit, ratio: Math.min(1, used / limit), state, detail: texts[state] };
}

/** Reto de «llegar a una cantidad»: cumplido en cuanto se alcanza. */
function countGoal(id, title, value, target, final, texts) {
  const state = value >= target ? 'done' : final ? 'missed' : value > 0 ? 'ontrack' : 'pending';
  return { id, kind: 'count', title, value, target, ratio: Math.min(1, value / target), state, detail: texts[state] };
}

/**
 * Retos de la semana que contiene `now`. `final`: la semana ya terminó (se usa para el resumen de la semana pasada).
 * Devuelve { start, end, daysLeft, goals, done, total }.
 */
export function weekGoals(trades, capital, now = Date.now(), final = false) {
  const start = weekStart(now);
  const next = addDays(start, 7);
  const week = trades.filter((t) => { const at = Date.parse(t.date); return at >= start && at < next; });
  const traded = week.length > 0;
  const pnl = week.reduce((a, t) => a + t.pnl, 0);
  const lossPct = pctOf(Math.max(0, -pnl), capital);
  const worstPct = pctOf(Math.max(0, ...week.map((t) => -t.pnl)), capital);
  const days = new Set(week.map((t) => new Date(t.date).toDateString())).size;
  const noted = week.filter((t) => (t.setup ?? '').trim() || (t.notes ?? '').trim()).length;
  const daysLeft = final ? 0 : 6 - ((new Date(now).getDay() + 6) % 7); // días que quedan después de hoy (domingo: 0)

  const goals = [
    limitGoal('loss', `No pierdas más del ${LOSS_LIMIT_PCT} % esta semana`, lossPct, LOSS_LIMIT_PCT, traded, final, {
      pending: 'Empieza a contar con tu primera operación cerrada de la semana.',
      ontrack: lossPct > 0 ? `Llevas un ${es(lossPct)} % de pérdida: te queda margen hasta el ${LOSS_LIMIT_PCT} %.` : 'Semana sin pérdidas por ahora. Vas bien.',
      done: lossPct > 0 ? `Semana cerrada con un ${es(lossPct)} % de pérdida, dentro del límite.` : 'Semana cerrada sin pérdidas.',
      missed: `La pérdida de la semana llegó al ${es(lossPct)} %. Buen momento para revisar el tamaño de tus posiciones y tus stops.`,
    }),
    limitGoal('risk', `Ninguna operación pierde más del ${TRADE_RISK_PCT} % de tu saldo`, worstPct, TRADE_RISK_PCT, traded, final, {
      pending: 'Empieza a contar con tu primera operación cerrada de la semana.',
      ontrack: worstPct > 0 ? `Tu mayor pérdida en una operación es del ${es(worstPct)} % del saldo.` : 'Ninguna operación en pérdida esta semana.',
      done: worstPct > 0 ? `Tu mayor pérdida en una operación fue del ${es(worstPct)} % del saldo.` : 'Ninguna operación cerró en pérdida.',
      missed: `Una operación perdió el ${es(worstPct)} % del saldo. Una orden stop te ayuda a acotar la pérdida antes de entrar.`,
    }),
    countGoal('days', `Opera ${DAYS_TARGET} días distintos`, days, DAYS_TARGET, final, {
      pending: 'La constancia enseña más que un día de muchas operaciones.',
      ontrack: `Llevas ${days} de ${DAYS_TARGET} días con operaciones cerradas.`,
      done: `Has cerrado operaciones ${days} días distintos.`,
      missed: `Cerraste operaciones ${days} de ${DAYS_TARGET} días.`,
    }),
    countGoal('notes', `Anota ${NOTES_TARGET} operaciones en tu diario`, noted, NOTES_TARGET, final, {
      pending: 'Apunta la estrategia o una nota al cerrar: es la forma más rápida de aprender de tus operaciones.',
      ontrack: `Llevas ${noted} de ${NOTES_TARGET} operaciones con estrategia o nota.`,
      done: `${noted} operaciones anotadas esta semana.`,
      missed: `Anotaste ${noted} de ${NOTES_TARGET} operaciones.`,
    }),
  ];
  return { start, end: addDays(start, 6), daysLeft, goals, done: goals.filter((g) => g.state === 'done').length, total: goals.length };
}

/** Resumen de la semana anterior (ya cerrada), o null si no se cerró ninguna operación en ella. */
export function lastWeek(trades, capital, now = Date.now()) {
  const start = addDays(weekStart(now), -7);
  const end = addDays(start, 7);
  const any = trades.some((t) => { const at = Date.parse(t.date); return at >= start && at < end; });
  return any ? weekGoals(trades, capital, start, true) : null;
}

export const STATE_LABEL = { pending: 'Sin empezar', ontrack: 'Vas bien', done: 'Cumplido', missed: 'Esta vez no' };
