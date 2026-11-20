// Cuenta de práctica del servidor (usuarios con sesión).
// El navegador solo envía activo, lado, cantidad, tipo y, en límite/stop, el nivel de activación:
// el precio de ejecución, la comisión y el saldo los decide siempre el servidor.
import * as store from './store.e5cc93e9.js';
import { api } from './api.d1db7328.js';
import { findAsset } from './catalog.f1b2b586.js';
import * as notifications from './notifications.49bec9ff.js';

let active = false;
let needs = false; // con sesión pero sin cuenta de práctica: hay que elegir el saldo inicial (ui/welcome.js)
let opened = null; // fecha de apertura de la cuenta del servidor (epoch en segundos), para el comparador del Resumen
let timer = null;
let cfg = { feeBps: 0, slippageBps: 0, minOrderCents: 500 };
const POLL_MS = 20_000; // con órdenes pendientes, el servidor las resuelve en cada consulta

export const isActive = () => active;
export const needsSetup = () => active && needs;
export const config = () => cfg;
/** Cuándo se abrió la cuenta del servidor (segundos), o null sin sesión o sin cuenta todavía. */
export const openedAt = () => (active && !needs ? opened : null);

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
    initialInput: p.account.initialInputCents ? { amount: cents(p.account.initialInputCents), currency: p.account.initialCurrency } : null,
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
        sharedThreadId: t.sharedThreadId ?? null,
        date: iso(t.executedAt), openedAt: t.openedAt ? t.openedAt * 1000 : null,
        setup: t.journal?.setup ?? '', emotion: t.journal?.emotion ?? '', notes: t.journal?.notes ?? '',
      };
    }),
  };
}

/** Los avisos de órdenes ejecutadas, rechazadas o caducadas los crea el servidor (notificaciones): aquí solo se refresca la campana. */
function announce(events) {
  if (events?.length) notifications.refresh().catch(() => {});
}

/** Descarga la cuenta (el servidor resuelve antes las órdenes pendientes) y la vuelca en el store. */
export async function refresh() {
  if (!active) return null;
  const data = await api('/api/portfolio');
  if (!active) return null; // la sesión se cerró mientras tanto
  cfg = { ...cfg, ...data.config };
  needs = Boolean(data.needsSetup);
  opened = needs ? null : Number(data.account?.createdAt) || null;
  if (needs) store.noServerAccount();
  else store.applyServer(toStore(data));
  announce(data.events);
  return data;
}

/** Crea la cuenta de práctica con el saldo elegido (en euros). El servidor lo valida, lo convierte a USD y no deja cambiarlo después. */
export async function startAccount(amountEur) {
  const data = await api('/api/portfolio/start', { method: 'POST', body: { amount: amountEur, currency: 'EUR' } });
  cfg = { ...cfg, ...data.config };
  needs = false;
  opened = Number(data.account?.createdAt) || null;
  store.applyServer(toStore(data));
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
  needs = false;
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
      if (err.status === 409 && !needs) await refresh().catch(() => {}); // sin cuenta todavía: el estado pasa a «hay que elegir saldo»
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
