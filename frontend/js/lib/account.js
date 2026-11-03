// Cuenta de práctica del servidor (usuarios con sesión).
// El navegador solo envía activo, lado, cantidad, tipo y, en límite/stop, el nivel de activación:
// el precio de ejecución, la comisión y el saldo los decide siempre el servidor.
import * as store from './store.js';
import { api } from './api.js';
import { findAsset } from './catalog.js';

let active = false;
let timer = null;
let cfg = { feeBps: 0, slippageBps: 0, minOrderCents: 500 };
const POLL_MS = 20_000; // con órdenes pendientes, el servidor las resuelve en cada consulta

export const isActive = () => active;
export const config = () => cfg;

const cents = (c) => (Number(c) || 0) / 100;
const iso = (s) => new Date(s * 1000).toISOString();

/** Convierte la respuesta de /api/portfolio a la forma que usan las vistas (la misma del modo local). */
export function toStore(p) {
  const base = (x) => {
    const a = findAsset(x.symbol);
    return { assetId: a?.id ?? x.symbol.toLowerCase(), symbol: x.symbol, name: x.name, type: x.assetType ?? a?.type, ticker: a?.ticker, quote: x.quote ?? a?.quote };
  };
  return {
    capital: cents(p.account.initialCents),
    cash: cents(p.account.availableCents), // libre; lo reservado va en cada orden
    positions: p.positions.map((x) => ({
      ...base(x), id: x.symbol, amount: x.quantity, entryPrice: x.avgPrice, investedUsd: cents(x.costCents), openedAt: x.openedAt * 1000,
    })),
    orders: p.orders.map((o) => ({
      ...base(o), id: String(o.id), side: o.side, type: o.type, amount: o.quantity, limitPrice: o.triggerPrice, stopPrice: null,
      reservedUsd: cents(o.reservedCents), createdAt: iso(o.createdAt),
    })),
    trades: p.trades.map((t) => {
      const invested = cents(t.costBasisCents);
      const pnl = cents(t.pnlCents);
      return {
        ...base(t), id: `f${t.id}`, orderId: t.orderId, amount: t.quantity, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        investedUsd: invested, pnl, pnlPct: invested > 0 ? (pnl / invested) * 100 : 0, feeUsd: cents(t.feeCents),
        date: iso(t.executedAt), openedAt: t.openedAt ? t.openedAt * 1000 : null,
        setup: t.journal?.setup ?? '', emotion: t.journal?.emotion ?? '', notes: t.journal?.notes ?? '',
      };
    }),
  };
}

const ORDER_WORDS = { limit: 'límite', stop: 'stop', market: 'a mercado' };
function announce(events) {
  for (const e of events ?? []) {
    const o = e.order;
    const what = `${o.side === 'buy' ? 'compra' : 'venta'} ${ORDER_WORDS[o.type]} de ${o.symbol}`;
    if (e.type === 'filled') store.notify('Orden ejecutada', `Tu ${what} se ha ejecutado a ${o.fill.price} ${o.quote}.`, 'success');
    else if (e.type === 'rejected') store.notify('Orden rechazada', `Tu ${what} no se pudo ejecutar: ${e.reason}`, 'error');
    else if (e.type === 'expired') store.notify('Orden caducada', `Tu ${what} caducó a los 30 días sin ejecutarse.`, 'info');
  }
}

/** Descarga la cuenta (el servidor resuelve antes las órdenes pendientes) y la vuelca en el store. */
export async function refresh() {
  if (!active) return null;
  const data = await api('/api/portfolio');
  if (!active) return null; // la sesión se cerró mientras tanto
  cfg = data.config;
  store.applyServer(toStore(data));
  announce(data.events);
  return data;
}

function poll() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (document.visibilityState === 'visible' && store.orders().length) refresh().catch(() => {});
  }, POLL_MS);
}

/** Se llama al iniciar o cerrar sesión (main.js). */
export async function setUser(user) {
  active = Boolean(user);
  if (!active) {
    clearInterval(timer);
    store.leaveServerMode();
    return;
  }
  poll();
  await refresh().catch((err) => console.warn('[account] No se pudo cargar la cuenta del servidor:', err.message));
}

/**
 * Envía una orden. El identificador de idempotencia se genera una vez y se reutiliza en los reintentos:
 * si la conexión se corta después de que el servidor la ejecute, reintentar no la duplica.
 */
export async function placeOrder({ symbol, side, type, quantity, triggerPrice, journal }) {
  const body = { clientOrderId: store.uuid(), symbol, side, type, quantity: String(quantity) };
  if (type !== 'market') body.triggerPrice = String(triggerPrice);
  if (journal) body.journal = journal;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { order } = await api('/api/orders', { method: 'POST', body });
      await refresh().catch(() => {});
      return order;
    } catch (err) {
      lastErr = err;
      if (err.status) throw err; // el servidor respondió (validación, saldo...): no se reintenta
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); // fallo de red: mismo clientOrderId
    }
  }
  throw lastErr;
}

export async function cancelOrder(id) {
  const { order } = await api(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await refresh().catch(() => {});
  return order;
}

export async function saveJournal(orderId, journal) {
  await api(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', body: { journal } });
  await refresh().catch(() => {});
}

/** Comisión estimada en USD para mostrarla antes de confirmar (la real la calcula el servidor). */
export const estimateFeeUsd = (notionalUsd) => (notionalUsd * cfg.feeBps) / 10_000;
