// Estado de la aplicación con persistencia en localStorage (claves paperpulse_*, compatibles con v2).
import { findAsset, DEFAULT_WATCHLIST } from './catalog.js';
import { toUsd } from './format.js';

export const APP = { name: 'PaperPulse', version: '3.0.0', schema: 3 };
const PREFIX = 'paperpulse_';
const MAX_EQUITY_POINTS = 2000;

/* ---------- Persistencia ---------- */
function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* almacenamiento lleno o bloqueado: la app sigue en memoria */ }
}

/* ---------- Utilidades numéricas ---------- */
export const roundUsd = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100 || 0;
export const roundQty = (v) => Math.round((Number(v) + Number.EPSILON) * 1e8) / 1e8 || 0;
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const str = (v, max) => String(v ?? '').slice(0, max);
const finite = (v) => Number.isFinite(Number(v));

/* ---------- Bus de eventos ---------- */
const bus = new EventTarget();
export function on(type, fn) {
  const h = (e) => { try { fn(e.detail); } catch (err) { console.error(`[store:${type}]`, err); } };
  bus.addEventListener(type, h);
  return () => bus.removeEventListener(type, h);
}
export const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

/* ---------- Normalización (también migra datos v2) ---------- */
function normalizePosition(p) {
  const a = findAsset(p.assetId) ?? findAsset(p.symbol);
  const quote = (p.quote || p.quoteCurrency || a?.quote || 'USDT').toUpperCase();
  const amount = roundQty(p.amount);
  const entryPrice = Number(p.entryPrice);
  if (!(amount > 0) || !(entryPrice > 0)) throw new Error(`Posición inválida para ${p.symbol}`);
  return {
    id: str(p.id && String(p.id).includes('-') ? p.id : uuid(), 64),
    assetId: a?.id ?? str(p.assetId || p.symbol, 30).toLowerCase(),
    symbol: str(p.symbol || a?.symbol, 15).toUpperCase(),
    name: str(p.name || a?.name || p.symbol, 60),
    type: a?.type ?? (p.type === 'stock' || p.category === 'stocks' ? 'stock' : 'crypto'),
    ticker: a?.ticker ?? (p.ticker ? str(p.ticker, 20) : undefined),
    quote,
    amount,
    entryPrice,
    investedUsd: roundUsd(finite(p.investedUsd) && p.investedUsd > 0 ? p.investedUsd : toUsd(amount * entryPrice, quote)),
    openedAt: Number(p.openedAt) || Date.parse(p.createdAt) || Date.now(),
  };
}

function normalizeTrade(t) {
  const a = findAsset(t.symbol);
  const amount = roundQty(t.amount);
  const pnl = Number(t.pnl ?? 0);
  if (!(amount > 0) || !finite(pnl) || !finite(t.entryPrice ?? 0) || !finite(t.exitPrice ?? t.price ?? 0)) {
    throw new Error(`Operación inválida para ${t.symbol}`);
  }
  const investedUsd = roundUsd(t.investedUsd || 0);
  return {
    id: str(t.id || uuid(), 64),
    symbol: str(t.symbol, 15).toUpperCase(),
    name: str(t.name || a?.name || t.symbol, 60),
    type: a?.type ?? (t.type === 'stock' || t.category === 'stocks' ? 'stock' : 'crypto'),
    quote: (t.quote || a?.quote || 'USDT').toUpperCase(),
    amount,
    entryPrice: Number(t.entryPrice) || 0,
    exitPrice: Number(t.exitPrice ?? t.price) || 0,
    investedUsd,
    pnl: roundUsd(pnl),
    pnlPct: finite(t.pnlPct) ? Number(t.pnlPct) : investedUsd > 0 ? (pnl / investedUsd) * 100 : 0,
    date: new Date(t.date || t.createdAt || Date.now()).toISOString(),
    openedAt: Number(t.openedAt) || null,
    setup: str(t.setup, 80),
    emotion: str(t.emotion, 40),
    notes: str(t.notes ?? t.reflection, 1000),
  };
}

function normalizeAlert(a) {
  const target = Number(a.target);
  if (!a.symbol || !(target > 0)) throw new Error('Alerta inválida');
  return {
    id: str(a.id || uuid(), 64),
    symbol: str(a.symbol, 15).toUpperCase(),
    condition: a.condition === 'below' ? 'below' : 'above',
    target,
    triggered: a.triggered === true,
    createdAt: a.createdAt || new Date().toISOString(),
  };
}

function normalizeOrder(o) {
  const amount = roundQty(o.amount);
  const limitPrice = Number(o.limitPrice);
  if (!(amount > 0) || !(limitPrice > 0)) throw new Error('Orden inválida');
  return {
    id: str(o.id || uuid(), 64),
    assetId: str(o.assetId || o.idAsset || o.symbol, 30).toLowerCase(),
    symbol: str(o.symbol, 15).toUpperCase(),
    name: str(o.name || o.symbol, 60),
    type: o.type === 'stop-limit' ? 'stop-limit' : 'limit',
    stopPrice: Number(o.stopPrice) > 0 ? Number(o.stopPrice) : null,
    limitPrice,
    amount,
    quote: (o.quote || o.quoteCurrency || findAsset(o.symbol)?.quote || 'USDT').toUpperCase(),
    reservedUsd: roundUsd(o.reservedUsd || 0),
    createdAt: o.createdAt || new Date().toISOString(),
  };
}

const symbolOf = (s) => findAsset(s)?.symbol ?? str(s, 15).toUpperCase();
const safeMap = (list, fn) => (Array.isArray(list) ? list : []).flatMap((x) => { try { return [fn(x)]; } catch { return []; } });

const DEFAULT_SETTINGS = { theme: null, currency: 'auto', privacyMode: false, interval: '1h', chartType: 'candles', indicators: ['volume'], tourDone: false };

/* ---------- Estado ---------- */
const state = {
  practice: false, capital: 1000, cash: 0,
  positions: [], orders: [], trades: [], equity: [],
  alerts: [], watchlist: [...DEFAULT_WATCHLIST], recent: [],
  settings: { ...DEFAULT_SETTINGS }, markets: [], notifications: [],
};

export function load() {
  state.practice = read('practice_active', false) === true;
  state.capital = roundUsd(read('initial_capital', 1000)) || 1000;
  state.cash = state.practice ? roundUsd(read('balance', state.capital)) : 0;
  state.positions = state.practice ? safeMap(read('positions', []), normalizePosition) : [];
  state.orders = state.practice ? safeMap(read('pending_orders', []), normalizeOrder) : [];
  state.equity = state.practice ? safeMap(read('equity_history', []), (e) => ({ time: Number(e.time), value: roundUsd(e.value) })).filter((e) => e.time > 0) : [];
  state.trades = safeMap(read('trades', []), normalizeTrade);
  state.alerts = safeMap(read('alerts', []), normalizeAlert);
  const wl = read('watchlist', null);
  state.watchlist = Array.isArray(wl) ? [...new Set(wl.map(symbolOf).filter(Boolean))] : [...DEFAULT_WATCHLIST];
  state.recent = (read('recent_searches', []) || []).slice(0, 8);
  state.settings = { ...DEFAULT_SETTINGS, ...(read('settings', {}) || {}) };

  if (read('schema_version', 1) < APP.schema) {
    persist('positions', 'pending_orders', 'trades', 'alerts', 'watchlist');
    write('schema_version', APP.schema);
  }
}

const PERSIST = {
  practice_active: () => state.practice,
  initial_capital: () => state.capital,
  balance: () => (state.practice ? state.cash : null),
  positions: () => (state.practice ? state.positions : null),
  pending_orders: () => (state.practice ? state.orders : null),
  equity_history: () => (state.practice ? state.equity : null),
  trades: () => state.trades,
  alerts: () => state.alerts,
  watchlist: () => state.watchlist,
  recent_searches: () => state.recent,
  settings: () => state.settings,
};
function persist(...keys) { for (const k of keys) write(k, PERSIST[k]()); }

/* ---------- Lecturas ---------- */
export const hasPractice = () => state.practice;
export const initialCapital = () => state.capital;
export const cash = () => state.cash;
export const positions = () => state.positions;
export const orders = () => state.orders;
export const trades = () => state.trades;
export const equityHistory = () => state.equity;
export const alerts = () => state.alerts;
export const watchlist = () => state.watchlist;
export const recentSearches = () => state.recent;
export const settings = () => state.settings;
export const markets = () => state.markets;
export const notifications = () => state.notifications;

/* ---------- Cuenta de práctica ---------- */
export function activate(capitalUsd) {
  state.practice = true;
  state.capital = Math.max(10, roundUsd(capitalUsd) || 1000);
  state.cash = state.capital;
  state.positions = [];
  state.orders = [];
  state.equity = [{ time: Math.floor(Date.now() / 1000), value: state.capital }];
  persist('practice_active', 'initial_capital', 'balance', 'positions', 'pending_orders', 'equity_history');
  emit('account');
}

export function closeAccount() {
  state.practice = false;
  state.cash = 0;
  state.positions = [];
  state.orders = [];
  state.equity = [];
  persist('practice_active', 'balance', 'positions', 'pending_orders', 'equity_history');
  emit('account');
}

export function setCash(usd) {
  state.cash = Math.max(0, roundUsd(usd));
  persist('balance');
  emit('account');
}

export function addPosition(p) {
  const pos = normalizePosition(p);
  state.positions = [pos, ...state.positions];
  persist('positions');
  emit('account');
  return pos;
}

export function updatePosition(id, patch) {
  state.positions = state.positions.map((p) => (p.id === id ? normalizePosition({ ...p, ...patch }) : p));
  persist('positions');
  emit('account');
}

export function removePosition(id) {
  const pos = state.positions.find((p) => p.id === id);
  state.positions = state.positions.filter((p) => p.id !== id);
  persist('positions');
  emit('account');
  return pos;
}

export function addOrder(o) {
  const order = normalizeOrder(o);
  state.orders = [...state.orders, order];
  persist('pending_orders');
  emit('account');
  return order;
}

export function removeOrder(id) {
  const order = state.orders.find((o) => o.id === id);
  state.orders = state.orders.filter((o) => o.id !== id);
  persist('pending_orders');
  emit('account');
  return order;
}

/** Guarda un punto de la curva de patrimonio (agrupa puntos con menos de 60 s). */
export function snapshotEquity(valueUsd) {
  if (!state.practice || !(valueUsd >= 0)) return;
  const time = Math.floor(Date.now() / 1000);
  const last = state.equity.at(-1);
  if (last && time - last.time < 60) last.value = roundUsd(valueUsd);
  else state.equity.push({ time, value: roundUsd(valueUsd) });
  if (state.equity.length > MAX_EQUITY_POINTS) state.equity.splice(0, state.equity.length - MAX_EQUITY_POINTS);
  persist('equity_history');
}

/* ---------- Cuenta del servidor (con sesión) ---------- */
// Con sesión, saldo, posiciones, órdenes y operaciones cerradas vienen de /api/portfolio (lib/account.js) y el store
// solo guarda una copia para pintar. Los eventos llevan { server: true } para que auth.js no los suba a /api/data.
let serverMode = false;
export const isServerMode = () => serverMode;

/** Sustituye la cuenta por la del servidor. `snap` ya viene convertido a la forma del store (ver account.js). */
export function applyServer(snap) {
  serverMode = true;
  Object.assign(state, {
    practice: true, capital: snap.capital, cash: snap.cash,
    positions: snap.positions, orders: snap.orders, trades: snap.trades,
  });
  if (!state.equity.length) state.equity = [{ time: Math.floor(Date.now() / 1000), value: snap.capital }];
  persist('practice_active', 'initial_capital', 'balance', 'positions', 'pending_orders', 'trades', 'equity_history');
  emit('account', { server: true });
  emit('trades', { server: true });
}

/** Al cerrar sesión se vuelve al modo local (clearAll borra después la copia). */
export function leaveServerMode() { serverMode = false; }

/* ---------- Diario ---------- */
export function addTrade(t) {
  const trade = normalizeTrade(t);
  state.trades = [trade, ...state.trades];
  persist('trades');
  emit('trades');
  return trade;
}
export function updateTrade(id, patch) {
  state.trades = state.trades.map((t) => (t.id === id ? normalizeTrade({ ...t, ...patch }) : t));
  persist('trades');
  emit('trades');
}
export function clearTrades() {
  state.trades = [];
  persist('trades');
  emit('trades');
}

/* ---------- Alertas, favoritos, búsquedas ---------- */
export function addAlert(a) {
  const alert = normalizeAlert(a);
  state.alerts = [...state.alerts, alert];
  persist('alerts');
  emit('alerts');
  return alert;
}
export function removeAlert(id) {
  state.alerts = state.alerts.filter((a) => a.id !== id);
  persist('alerts');
  emit('alerts');
}
export function markAlertTriggered(id) {
  state.alerts = state.alerts.map((a) => (a.id === id ? { ...a, triggered: true } : a));
  persist('alerts');
  emit('alerts');
}

export const inWatchlist = (sym) => state.watchlist.includes(symbolOf(sym));
export function toggleWatchlist(sym) {
  const s = symbolOf(sym);
  const added = !state.watchlist.includes(s);
  state.watchlist = added ? [...state.watchlist, s] : state.watchlist.filter((x) => x !== s);
  persist('watchlist');
  emit('watchlist');
  return added;
}

export function addRecent(asset) {
  const item = { symbol: asset.symbol, name: asset.name, type: asset.type, ticker: asset.ticker, quote: asset.quote };
  state.recent = [item, ...state.recent.filter((r) => r.symbol !== item.symbol)].slice(0, 8);
  persist('recent_searches');
}

/* ---------- Ajustes ---------- */
export function setSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  persist('settings');
  emit('settings', { key, value });
}

/* ---------- Mercados y notificaciones (solo memoria) ---------- */
export function setMarkets(list) {
  state.markets = Array.isArray(list) ? list : [];
  emit('markets');
}
/** true/false si se conoce el estado de la bolsa del activo; las cripto siempre abiertas. */
export function marketOpen(asset) {
  if (!asset || asset.type !== 'stock') return true;
  return state.markets.find((m) => m.id === asset.market)?.open ?? null;
}

export function notify(title, body, type = 'info') {
  state.notifications = [{ id: uuid(), title, body, type, time: Date.now(), read: false }, ...state.notifications].slice(0, 30);
  emit('notifications');
}
export function markNotificationsRead() {
  state.notifications = state.notifications.map((n) => ({ ...n, read: true }));
  emit('notifications');
}

/* ---------- Copia de seguridad (RGPD) ---------- */
export function exportData() {
  return {
    app: APP.name,
    version: APP.version,
    schemaVersion: APP.schema,
    exportedAt: new Date().toISOString(),
    account: { hasPracticeAccount: state.practice, initialCapitalUsd: state.capital, balanceUsd: state.cash },
    positions: state.positions,
    pendingOrders: state.orders,
    trades: state.trades,
    equityHistory: state.equity,
    watchlist: state.watchlist,
    alerts: state.alerts,
    settings: state.settings,
  };
}

/** Importa una copia validando cada sección. Lanza Error con un mensaje legible si no es válida. */
export function importData(input) {
  let data;
  try { data = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Estructura de copia no válida.');
  if (!['PaperPulse', 'PaperPulse Terminal'].includes(data.app)) throw new Error('El archivo no pertenece a PaperPulse.');

  const acc = data.account ?? {};
  const capital = Number(acc.initialCapitalUsd ?? 1000);
  const balance = Number(acc.balanceUsd ?? capital);
  if (!(capital > 0 && capital <= 1e9)) throw new Error('El capital inicial debe ser un número positivo válido.');
  if (!(balance >= 0 && balance <= 1e10)) throw new Error('El saldo debe ser un número válido no negativo.');
  const strict = (list, fn) => (Array.isArray(list) ? list.map(fn) : []);

  const next = {
    practice: acc.hasPracticeAccount === true,
    capital: roundUsd(capital),
    cash: roundUsd(balance),
    positions: strict(data.positions, normalizePosition),
    orders: safeMap(data.pendingOrders, normalizeOrder),
    trades: strict(data.trades, normalizeTrade),
    equity: safeMap(data.equityHistory, (e) => ({ time: Number(e.time), value: roundUsd(e.value) })).filter((e) => e.time > 0),
    alerts: safeMap(data.alerts, normalizeAlert),
    watchlist: Array.isArray(data.watchlist) ? [...new Set(data.watchlist.filter((s) => typeof s === 'string').map(symbolOf))].slice(0, 50) : state.watchlist,
  };
  const s = data.settings ?? {};
  next.settings = {
    ...state.settings,
    ...(['dark', 'light'].includes(s.theme) && { theme: s.theme }),
    ...(['auto', 'EUR', 'USD', 'GBP'].includes(s.currency) && { currency: s.currency }),
    ...(typeof s.privacyMode === 'boolean' && { privacyMode: s.privacyMode }),
  };
  Object.assign(state, next);
  persist(...Object.keys(PERSIST));
  for (const e of ['account', 'trades', 'alerts', 'watchlist', 'settings']) emit(e);
  return { trades: state.trades.length, positions: state.positions.length };
}

/** Derecho de supresión: borra todas las claves paperpulse_* y restablece el estado. */
export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* sin almacenamiento */ }
  Object.assign(state, {
    practice: false, capital: 1000, cash: 0, positions: [], orders: [], trades: [], equity: [],
    alerts: [], watchlist: [...DEFAULT_WATCHLIST], recent: [], settings: { ...DEFAULT_SETTINGS },
  });
  write('schema_version', APP.schema);
  for (const e of ['account', 'trades', 'alerts', 'watchlist', 'settings']) emit(e);
}
