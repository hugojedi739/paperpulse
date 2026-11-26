// Motor de operativa simulada: compras a mercado, órdenes límite/stop, cierres, alertas y valoración.
// Sin sesión todo se ejecuta aquí, en el navegador (modo local). Con sesión, las operaciones se envían al servidor
// (lib/account.js), que decide precio, comisión y saldo; las funciones de este módulo son asíncronas en ambos casos.
import * as store from './store.a368de54.js';
import * as account from './account.47747814.js';
import { priceOf, tick } from './feed.9f8aa8be.js';
import { toUsd, price as fmtPrice, units } from './format.df8faa5e.js';
import { findAsset } from './catalog.847c7742.js';

export const MIN_ORDER_USD = 5;

/** P&L de una posición larga sin comisiones. */
export function calcPnl(amount, entryPrice, exitPrice) {
  const investedUsd = store.roundUsd(amount * entryPrice);
  const currentValueUsd = store.roundUsd(amount * exitPrice);
  const pnlUsd = store.roundUsd(currentValueUsd - investedUsd);
  const pnlPct = entryPrice > 0 ? Math.round(((exitPrice - entryPrice) / entryPrice) * 10000) / 100 : 0;
  return { investedUsd, currentValueUsd, pnlUsd, pnlPct };
}

/**
 * Resultado en la divisa de cotización según la dirección.
 * Long: (actual − entrada) × cantidad · Short: (entrada − actual) × cantidad.
 */
export const directionalPnl = (side, amount, entryPrice, exitPrice) =>
  (side === 'short' ? entryPrice - exitPrice : exitPrice - entryPrice) * amount;

/**
 * Valor de una posición (USD) a un precio. Long: cantidad × precio. Short sin apalancamiento: garantía + resultado,
 * nunca por debajo de 0 (la pérdida máxima es la garantía: se liquida al llegar a 2× la entrada).
 */
export function positionValueAt(p, px) {
  if (p.side !== 'short') return toUsd(p.amount * px, p.quote);
  return Math.max(0, p.investedUsd + toUsd(directionalPnl('short', p.amount, p.entryPrice, px), p.quote));
}

/** Precio al que un corto pierde toda su garantía y se cierra solo. */
export const liquidationPrice = (p) => (p.side === 'short' ? p.entryPrice * 2 : null);

export function valuePosition(p) {
  const live = priceOf(p.symbol);
  const px = live ?? p.entryPrice;
  const valueUsd = positionValueAt(p, px);
  const pnlUsd = valueUsd - p.investedUsd;
  // Un precio sembrado de la caché local (feed.js) se pinta, pero no cuenta como en vivo: así no entra en el historial de patrimonio
  return { price: px, live: live != null && !tick(p.symbol)?.seeded, valueUsd, pnlUsd, pnlPct: p.investedUsd > 0 ? (pnlUsd / p.investedUsd) * 100 : 0 };
}

export function portfolio() {
  const rows = store.positions().map((p) => ({ ...p, ...valuePosition(p) }));
  const holdingsUsd = rows.reduce((s, r) => s + r.valueUsd, 0);
  const reservedUsd = store.orders().reduce((s, o) => s + o.reservedUsd, 0);
  const cashUsd = store.cash();
  const equityUsd = cashUsd + reservedUsd + holdingsUsd;
  const unrealizedUsd = rows.reduce((s, r) => s + r.pnlUsd, 0);
  const investedUsd = rows.reduce((s, r) => s + r.investedUsd, 0);
  const change24hUsd = rows.reduce((s, r) => {
    const c = tick(r.symbol)?.change24h;
    if (!Number.isFinite(c)) return s;
    const moveUsd = toUsd(r.amount * r.price, r.quote) * (1 - 1 / (1 + c / 100)); // lo que se movió el nocional en 24 h
    return s + (r.side === 'short' ? -moveUsd : moveUsd);
  }, 0);
  return {
    rows, holdingsUsd, reservedUsd, cashUsd, equityUsd, unrealizedUsd, investedUsd, change24hUsd,
    returnPct: store.initialCapital() > 0 ? ((equityUsd - store.initialCapital()) / store.initialCapital()) * 100 : 0,
  };
}

class TradeError extends Error {}
export { TradeError };

function requireAccount() {
  if (!store.hasPractice()) throw new TradeError('Activa tu cuenta de práctica para operar.');
}

const server = () => account.isActive();

/**
 * Comprueba Stop Loss y Take Profit opcionales. Long: SL por debajo y TP por encima del precio. Short: al revés,
 * y el SL por debajo de la liquidación (2× la entrada). Devuelve { stopLoss, takeProfit } o lanza TradeError.
 */
export function validateExits(side, px, { stopLoss = null, takeProfit = null } = {}) {
  const sl = stopLoss > 0 ? stopLoss : null;
  const tp = takeProfit > 0 ? takeProfit : null;
  if (side === 'short') {
    if (sl && sl <= px) throw new TradeError('En un corto el Stop Loss va por encima del precio actual.');
    if (sl && sl >= px * 2) throw new TradeError('El Stop Loss de un corto debe quedar por debajo de 2× la entrada (ahí se liquida).');
    if (tp && tp >= px) throw new TradeError('En un corto el Take Profit va por debajo del precio actual.');
  } else {
    if (sl && sl >= px) throw new TradeError('En una compra el Stop Loss va por debajo del precio actual.');
    if (tp && tp <= px) throw new TradeError('En una compra el Take Profit va por encima del precio actual.');
  }
  return { stopLoss: sl, takeProfit: tp };
}

/** Compra a mercado (Long). `amount` en unidades del activo; `exits` = { stopLoss, takeProfit } opcionales (solo Demo). */
export async function buyMarket(asset, amount, exits = {}) {
  if (server()) {
    const o = await account.placeOrder({ symbol: asset.symbol, side: 'buy', type: 'market', quantity: amount });
    return { amount: o.quantity, price: o.fill.price, costUsd: (o.fill.notionalCents + o.fill.feeCents) / 100, feeUsd: o.fill.feeCents / 100 };
  }
  requireAccount();
  const px = priceOf(asset.symbol);
  if (!(px > 0)) throw new TradeError(`Sin cotización disponible para ${asset.symbol}.`);
  return fill(asset, amount, px, 0, 'long', validateExits('long', px, exits));
}

/**
 * Abre o amplía un corto a mercado (solo Demo, sin apalancamiento): se aparta como garantía el 100 % del importe.
 * La pérdida máxima es esa garantía, así que el saldo nunca queda negativo.
 */
export async function shortMarket(asset, amount, exits = {}) {
  if (server()) throw new TradeError('Las posiciones cortas solo están disponibles en la cuenta Demo.');
  requireAccount();
  const px = priceOf(asset.symbol);
  if (!(px > 0)) throw new TradeError(`Sin cotización disponible para ${asset.symbol}.`);
  return fill(asset, amount, px, 0, 'short', validateExits('short', px, exits));
}

function fill(asset, amount, px, prepaidUsd = 0, side = 'long', exits = {}) {
  const costUsd = store.roundUsd(toUsd(amount * px, asset.quote));
  if (!(amount > 0) || costUsd < MIN_ORDER_USD) throw new TradeError(`El importe mínimo por orden es ${MIN_ORDER_USD} USD.`);
  if (costUsd > store.cash() + prepaidUsd + 0.005) throw new TradeError('Saldo de práctica insuficiente.');

  const same = store.positions().filter((p) => p.symbol === asset.symbol);
  if (same.some((p) => p.side !== side)) {
    throw new TradeError(`Ya tienes una posición ${side === 'short' ? 'larga' : 'corta'} en ${asset.symbol}: ciérrala antes de abrir en la dirección contraria.`);
  }
  const existing = same[0];
  const levels = Object.fromEntries(Object.entries(exits).filter(([, v]) => v > 0)); // un SL/TP nuevo sustituye al anterior
  if (existing) {
    const total = existing.amount + amount;
    store.updatePosition(existing.id, {
      amount: total,
      entryPrice: (existing.amount * existing.entryPrice + amount * px) / total,
      investedUsd: existing.investedUsd + costUsd,
      ...levels,
    });
  } else {
    store.addPosition({
      assetId: asset.id, symbol: asset.symbol, name: asset.name, type: asset.type, ticker: asset.ticker,
      quote: asset.quote, amount, entryPrice: px, investedUsd: costUsd, openedAt: Date.now(), side, ...levels,
    });
  }
  store.setCash(store.cash() + prepaidUsd - costUsd);
  return { amount, price: px, costUsd, side };
}

/**
 * Orden pendiente. Local: límite o stop-limit de compra (reserva saldo). Servidor: límite o stop, de compra o de venta
 * (`side`), con un único nivel (`limitPrice`); si el nivel ya se cumple, el servidor la ejecuta al momento.
 */
export async function placeOrder(asset, { type, amount, limitPrice, stopPrice, side = 'buy' }) {
  if (server()) {
    const o = await account.placeOrder({ symbol: asset.symbol, side, type: type === 'stop-limit' ? 'stop' : type, quantity: amount, triggerPrice: limitPrice });
    return { filled: o.status === 'filled', order: o };
  }
  requireAccount();
  if (!(limitPrice > 0)) throw new TradeError('Introduce un precio límite válido.');
  if (type === 'stop-limit' && !(stopPrice > 0)) throw new TradeError('Introduce un precio stop válido.');
  const reservedUsd = store.roundUsd(toUsd(amount * limitPrice, asset.quote));
  if (!(amount > 0) || reservedUsd < MIN_ORDER_USD) throw new TradeError(`El importe mínimo por orden es ${MIN_ORDER_USD} USD.`);
  if (reservedUsd > store.cash()) throw new TradeError('Saldo de práctica insuficiente.');

  const current = priceOf(asset.symbol);
  if (type === 'limit' && current > 0 && current <= limitPrice) return { filled: true, ...(await buyMarket(asset, amount)) };

  store.setCash(store.cash() - reservedUsd);
  const order = store.addOrder({
    assetId: asset.id, symbol: asset.symbol, name: asset.name, type, amount, limitPrice,
    stopPrice: type === 'stop-limit' ? stopPrice : null, quote: asset.quote, reservedUsd,
  });
  return { filled: false, order };
}

export async function cancelOrder(id) {
  if (server()) return account.cancelOrder(id);
  const order = store.removeOrder(id);
  if (order) store.setCash(store.cash() + order.reservedUsd);
  return order;
}

/** Vende `amount` unidades (todo por defecto) y registra la operación en el diario. */
export async function closePosition(id, { amount, setup = '', emotion = '', notes = '' } = {}) {
  if (server()) {
    const pos = store.positions().find((p) => p.id === id);
    if (!pos) throw new TradeError('La posición ya no existe.');
    const qty = Math.min(pos.amount, amount > 0 ? amount : pos.amount);
    const o = await account.placeOrder({ symbol: pos.symbol, side: 'sell', type: 'market', quantity: qty, journal: { setup, emotion, notes } });
    return { symbol: o.symbol, pnl: o.fill.pnlCents / 100, feeUsd: o.fill.feeCents / 100 };
  }
  requireAccount();
  const pos = store.positions().find((p) => p.id === id);
  if (!pos) throw new TradeError('La posición ya no existe.');
  const px = priceOf(pos.symbol);
  if (!(px > 0)) throw new TradeError(`Sin cotización para ${pos.symbol}: no se puede cerrar ahora.`);

  const qty = Math.min(pos.amount, amount > 0 ? amount : pos.amount);
  const fraction = qty / pos.amount;
  const investedUsd = store.roundUsd(pos.investedUsd * fraction);
  // Long: se cobra la venta. Short: se devuelve la garantía ± el resultado (nunca menos de 0)
  const proceedsUsd = store.roundUsd(positionValueAt({ ...pos, amount: qty, investedUsd }, px));
  const pnl = store.roundUsd(proceedsUsd - investedUsd);

  if (fraction >= 0.999999) store.removePosition(id);
  else store.updatePosition(id, { amount: pos.amount - qty, investedUsd: pos.investedUsd - investedUsd });
  store.setCash(store.cash() + proceedsUsd);

  return store.addTrade({
    symbol: pos.symbol, name: pos.name, type: pos.type, quote: pos.quote, amount: qty,
    entryPrice: pos.entryPrice, exitPrice: px, investedUsd, pnl,
    pnlPct: investedUsd > 0 ? (pnl / investedUsd) * 100 : 0,
    date: new Date().toISOString(), openedAt: pos.openedAt, setup, emotion, notes, side: pos.side,
  });
}

/** Qué salida toca a este precio: 'liquidation', 'stopLoss', 'takeProfit' o null. */
export function exitReason(p, px) {
  if (p.side === 'short') {
    if (px >= liquidationPrice(p)) return 'liquidation';
    if (p.stopLoss && px >= p.stopLoss) return 'stopLoss';
    if (p.takeProfit && px <= p.takeProfit) return 'takeProfit';
  } else {
    if (p.stopLoss && px <= p.stopLoss) return 'stopLoss';
    if (p.takeProfit && px >= p.takeProfit) return 'takeProfit';
  }
  return null;
}
const EXIT_LABEL = { liquidation: 'Liquidación (pérdida de toda la garantía)', stopLoss: 'Stop Loss', takeProfit: 'Take Profit' };

/* ---------- Disparadores en cada lote de precios ---------- */
export function checkTriggers(symbols, onEvent) {
  // Con sesión las órdenes las resuelve el servidor (con velas): aquí solo se revisan las alertas
  for (const order of server() ? [] : store.orders()) {
    if (!symbols.has(order.symbol)) continue;
    const px = priceOf(order.symbol);
    if (!(px > 0)) continue;
    const armed = order.type === 'limit' || px >= order.stopPrice;
    if (!armed || px > order.limitPrice) continue;
    store.removeOrder(order.id);
    try {
      const asset = findAsset(order.symbol) ?? { id: order.assetId, symbol: order.symbol, name: order.name, quote: order.quote, type: order.quote === 'USDT' ? 'crypto' : 'stock' };
      fill(asset, order.amount, px, order.reservedUsd);
      onEvent?.('order', `Orden ${order.type} ejecutada: ${units(order.amount, order.symbol)} a ${fmtPrice(px, order.quote)}`);
    } catch (err) {
      store.setCash(store.cash() + order.reservedUsd);
      onEvent?.('error', `No se pudo ejecutar la orden de ${order.symbol}: ${err.message}`);
    }
  }
  // Stop Loss, Take Profit y liquidación de cortos (solo Demo): se cierra al precio en vivo que los toca
  for (const pos of server() ? [] : store.positions()) {
    if (!symbols.has(pos.symbol)) continue;
    const px = priceOf(pos.symbol);
    const reason = px > 0 ? exitReason(pos, px) : null;
    if (!reason) continue;
    closePosition(pos.id, { notes: `Cierre automático: ${EXIT_LABEL[reason]}` })
      .then((t) => onEvent?.(reason === 'takeProfit' ? 'order' : 'error', `${EXIT_LABEL[reason]} de ${pos.symbol} a ${fmtPrice(px, pos.quote)}: ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USD`))
      .catch((err) => onEvent?.('error', `No se pudo cerrar ${pos.symbol}: ${err.message}`));
  }
  for (const alert of store.alerts()) {
    if (alert.triggered || !symbols.has(alert.symbol)) continue;
    const px = priceOf(alert.symbol);
    if (!(px > 0)) continue;
    if (alert.condition === 'above' ? px >= alert.target : px <= alert.target) {
      store.markAlertTriggered(alert.id);
      const quote = findAsset(alert.symbol)?.quote ?? 'USDT';
      onEvent?.('alert', `${alert.symbol} ${alert.condition === 'above' ? 'supera' : 'cae por debajo de'} ${fmtPrice(alert.target, quote)} (ahora ${fmtPrice(px, quote)})`, { symbol: alert.symbol, condition: alert.condition, target: alert.target });
    }
  }
}

