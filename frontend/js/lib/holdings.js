// Presentación de la cartera en el Resumen: filas de posiciones ordenadas por valor y distribución por activo, tipo o
// divisa. Solo agrupa lo que ya calcula portfolio() (lib/trading.js): no toca saldos ni órdenes.

const TYPE_LABEL = { crypto: 'Cripto', stock: 'Acciones' };
const CURRENCY_LABEL = { USD: 'Dólar (USD)', EUR: 'Euro (EUR)' };
const currencyOf = (quote) => (quote === 'EUR' ? 'EUR' : 'USD'); // USDT cotiza como el dólar

/** Filas de la tabla Cartera: coste, valor y resultado (importe y %) en USD, de mayor a menor valor. */
export function holdingRows(rows, find = () => null) {
  return rows.map((r) => {
    const a = find(r.symbol) ?? {};
    return {
      symbol: r.symbol, name: r.name ?? a.name ?? r.symbol, type: r.type ?? a.type ?? 'crypto', quote: r.quote ?? a.quote ?? 'USDT',
      amount: r.amount, costUsd: r.investedUsd, valueUsd: r.valueUsd, pnlUsd: r.pnlUsd, pnlPct: r.pnlPct, live: r.live,
    };
  }).sort((a, b) => b.valueUsd - a.valueUsd);
}

/** Totales de la tabla: coste, valor y resultado de todas las posiciones. */
export function holdingTotals(list) {
  const costUsd = list.reduce((s, r) => s + r.costUsd, 0);
  const valueUsd = list.reduce((s, r) => s + r.valueUsd, 0);
  const pnlUsd = valueUsd - costUsd;
  return { costUsd, valueUsd, pnlUsd, pnlPct: costUsd > 0 ? (pnlUsd / costUsd) * 100 : 0 };
}

export const ALLOCATION_TABS = [['asset', 'Activo'], ['type', 'Tipo'], ['currency', 'Divisa']];

/**
 * Tramos de la distribución, con su clase de color (c-1…c-6). `by`: 'asset' (5 mayores + «Otros»), 'type' o 'currency'.
 * El efectivo (incluido el reservado en órdenes) va siempre al final, aparte.
 */
export function allocation(list, cashUsd, by = 'asset') {
  let parts;
  if (by === 'asset') {
    parts = list.slice(0, 5).map((r) => ({ label: r.symbol, usd: r.valueUsd }));
    const rest = list.slice(5).reduce((s, r) => s + r.valueUsd, 0);
    if (rest > 0) parts.push({ label: 'Otros', usd: rest });
  } else {
    const key = by === 'type' ? (r) => TYPE_LABEL[r.type] ?? 'Otros' : (r) => CURRENCY_LABEL[currencyOf(r.quote)];
    const groups = new Map();
    for (const r of list) groups.set(key(r), (groups.get(key(r)) ?? 0) + r.valueUsd);
    parts = [...groups].map(([label, usd]) => ({ label, usd })).sort((a, b) => b.usd - a.usd);
  }
  parts = parts.map((p, i) => ({ ...p, cls: `c-${Math.min(i + 1, 5)}` }));
  if (cashUsd > 0) parts.push({ label: 'Efectivo', usd: cashUsd, cls: 'c-6' });
  const total = parts.reduce((s, p) => s + p.usd, 0);
  return parts.map((p) => ({ ...p, share: total > 0 ? (p.usd / total) * 100 : 0 }));
}
