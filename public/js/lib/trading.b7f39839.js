// Motor de operativa simulada: compras a mercado, órdenes límite/stop, cierres, alertas y valoración.
// Sin sesión todo se ejecuta aquí, en el navegador (modo local). Con sesión, las operaciones se envían al servidor
// (lib/account.js), que decide precio, comisión y saldo; las funciones de este módulo son asíncronas en ambos casos.
import * as store from './store.0fb0dfbb.js';
import * as account from './account.76c3b674.js';
import { priceOf, tick } from './feed.6d0c0c04.js';
import { toUsd, convert, price as fmtPrice, units } from './format.bcd91d41.js';
import { findAsset } from './catalog.760e22b2.js';

export const MIN_ORDER_USD = 5;

/** P&L de una posición larga sin comisiones. */
export function calcPnl(amount, entryPrice, exitPrice) {
  const investedUsd = store.roundUsd(amount * entryPrice);
  const currentValueUsd = store.roundUsd(amount * exitPrice);
  const pnlUsd = store.roundUsd(currentValueUsd - investedUsd);
  const pnlPct = entryPrice > 0 ? Math.round(((exitPrice - entryPrice) / entryPrice) * 10000) / 100 : 0;
  return { investedUsd, currentValueUsd, pnlUsd, pnlPct };
}

export function valuePosition(p) {
  const live = priceOf(p.symbol);
  const px = live ?? p.entryPrice;
  const valueUsd = toUsd(p.amount * px, p.quote);
  const pnlUsd = valueUsd - p.investedUsd;
  return { price: px, live: live != null, valueUsd, pnlUsd, pnlPct: p.investedUsd > 0 ? (pnlUsd / p.investedUsd) * 100 : 0 };
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
    return Number.isFinite(c) ? s + r.valueUsd - r.valueUsd / (1 + c / 100) : s;
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

/** Compra a mercado. `amount` en unidades del activo. */
export async function buyMarket(asset, amount) {
  if (server()) {
    const o = await account.placeOrder({ symbol: asset.symbol, side: 'buy', type: 'market', quantity: amount });
    return { amount: o.quantity, price: o.fill.price, costUsd: (o.fill.notionalCents + o.fill.feeCents) / 100, feeUsd: o.fill.feeCents / 100 };
  }
  requireAccount();
  const px = priceOf(asset.symbol);
  if (!(px > 0)) throw new TradeError(`Sin cotización disponible para ${asset.symbol}.`);
  return fill(asset, amount, px);
}

function fill(asset, amount, px, prepaidUsd = 0) {
  const costUsd = store.roundUsd(toUsd(amount * px, asset.quote));
  if (!(amount > 0) || costUsd < MIN_ORDER_USD) throw new TradeError(`El importe mínimo por orden es ${MIN_ORDER_USD} USD.`);
  if (costUsd > store.cash() + prepaidUsd + 0.005) throw new TradeError('Saldo de práctica insuficiente.');

  const existing = store.positions().find((p) => p.symbol === asset.symbol);
  if (existing) {
    const total = existing.amount + amount;
    store.updatePosition(existing.id, {
      amount: total,
      entryPrice: (existing.amount * existing.entryPrice + amount * px) / total,
      investedUsd: existing.investedUsd + costUsd,
    });
  } else {
    store.addPosition({
      assetId: asset.id, symbol: asset.symbol, name: asset.name, type: asset.type, ticker: asset.ticker,
      quote: asset.quote, amount, entryPrice: px, investedUsd: costUsd, openedAt: Date.now(),
    });
  }
  store.setCash(store.cash() + prepaidUsd - costUsd);
  return { amount, price: px, costUsd };
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
  const proceedsUsd = store.roundUsd(toUsd(qty * px, pos.quote));
  const pnl = store.roundUsd(proceedsUsd - investedUsd);

  if (fraction >= 0.999999) store.removePosition(id);
  else store.updatePosition(id, { amount: pos.amount - qty, investedUsd: pos.investedUsd - investedUsd });
  store.setCash(store.cash() + proceedsUsd);

  return store.addTrade({
    symbol: pos.symbol, name: pos.name, type: pos.type, quote: pos.quote, amount: qty,
    entryPrice: pos.entryPrice, exitPrice: px, investedUsd, pnl,
    pnlPct: investedUsd > 0 ? (pnl / investedUsd) * 100 : 0,
    date: new Date().toISOString(), openedAt: pos.openedAt, setup, emotion, notes,
  });
}

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

/** Unidades que se obtienen con un importe en la divisa de la cuenta. */
export function unitsFor(amountAccount, accountCurrency, asset) {
  const px = priceOf(asset.symbol);
  return px > 0 ? convert(amountAccount, accountCurrency, asset.quote) / px : 0;
}
