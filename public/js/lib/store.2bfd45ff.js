// Estado de la aplicación con persistencia en localStorage (claves paperpulse_*, compatibles con v2).
import { findAsset, DEFAULT_WATCHLIST } from './catalog.847c7742.js';
import { toUsd } from './format.4a891f94.js';

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
    // Dirección: las posiciones anteriores (solo compra) y las del servidor son largas
    side: p.side === 'short' ? 'short' : 'long',
    stopLoss: Number(p.stopLoss) > 0 ? Number(p.stopLoss) : null,
    takeProfit: Number(p.takeProfit) > 0 ? Number(p.takeProfit) : null,
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
    side: t.side === 'short' ? 'short' : 'long',
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
/** Importe que eligió la persona al crear la cuenta: { amount, currency: 'EUR' } o null. */
const cleanInput = (x) => (x && Number(x.amount) > 0 && x.currency === 'EUR' ? { amount: Math.round(Number(x.amount) * 100) / 100, currency: 'EUR' } : null);

const safeMap = (list, fn) => (Array.isArray(list) ? list : []).flatMap((x) => { try { return [fn(x)]; } catch { return []; } });

const DEFAULT_SETTINGS = { theme: null, currency: 'auto', privacyMode: false, interval: '1h', chartType: 'candles', indicators: ['volume'], advanced: false, tourDone: false, maPeriod: 20, emaPeriod: 50, logScale: false, accent: 'neutral' };

/* ---------- Estado ---------- */
const state = {
  practice: false, capital: 1000, cash: 0, initialInput: null, // initialInput: lo que eligió la persona { amount, currency: 'EUR' }, solo para mostrarlo
  positions: [], orders: [], trades: [], equity: [],
  alerts: [], watchlist: [...DEFAULT_WATCHLIST], recent: [],
  settings: { ...DEFAULT_SETTINGS }, markets: [], notifications: [],
};

/* ---------- Dos cuentas que nunca se mezclan: Demo (este navegador) y Mi cuenta (copia del servidor) ---------- */
// `state` tiene siempre los datos de la cuenta ACTIVA (la que se ve y con la que se opera). La otra espera en su
// hueco. Demo se guarda en las claves de siempre (paperpulse_balance, _positions...); la copia del servidor NO se
// guarda en ellas: solo vive en memoria, salvo su curva de patrimonio (clave server_equity_history), que es
// un dibujo del navegador. Así Demo no hereda nunca saldos ni posiciones del servidor, ni al revés.
const ACCOUNT_FIELDS = ['practice', 'capital', 'cash', 'initialInput', 'positions', 'orders', 'trades', 'equity'];
const pick = (src) => Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, src[k]]));
const emptyAccount = () => ({ practice: false, capital: 1000, cash: 0, initialInput: null, positions: [], orders: [], trades: [], equity: [] });
let active = 'demo'; // 'demo' | 'server'
let demoSlot = null; // datos de Demo cuando la activa es Mi cuenta
let serverSlot = emptyAccount(); // copia del servidor cuando la activa es Demo
const demoSrc = () => (active === 'demo' ? state : demoSlot);
const serverSrc = () => (active === 'server' ? state : serverSlot);

/** El motor local (lib/trading.js) solo puede tocar Demo: con Mi cuenta activa, ejecutar en el navegador es un error. */
function assertDemo(what) {
  if (active !== 'demo') throw new Error(`${what}: la cuenta activa es «Mi cuenta» y la gestiona el servidor.`);
}

export const activeAccount = () => active;

/** Cambia la cuenta activa. Devuelve true si ha cambiado. Avisa a las vistas con { server: true } (no es un cambio de datos). */
export function useAccount(mode) {
  if (mode !== 'demo' && mode !== 'server') throw new Error(`Cuenta desconocida: ${mode}`);
  if (mode === active) return false;
  if (active === 'demo') { demoSlot = pick(state); Object.assign(state, serverSlot); }
  else { serverSlot = pick(state); Object.assign(state, demoSlot); demoSlot = null; }
  active = mode;
  serverMode = mode === 'server';
  emit('account', { server: true, switched: true });
  emit('trades', { server: true, switched: true });
  return true;
}

// Hasta esta versión, con sesión, la copia del servidor se guardaba en las claves locales. Al actualizar, si quien
// tiene esos datos tenía la sesión abierta, lo guardado no es su Demo sino esa copia: Demo empieza de cero.
const SPLIT_KEY = 'demo_split';
let legacy = false;
const hasStoredAccount = () => read('practice_active', false) === true || (read('trades', []) || []).length > 0;
/** Lo llama auth.init en cuanto sabe si hay sesión (antes de reconciliar con /api/data). Devuelve true si vació Demo. */
export function settleUpgrade(hasSession) {
  if (!legacy) return false;
  legacy = false;
  write(SPLIT_KEY, 1);
  if (!hasSession) return false;
  const fresh = emptyAccount();
  if (active === 'demo') Object.assign(state, fresh); else demoSlot = fresh;
  persist('practice_active', 'initial_capital', 'initial_input', 'balance', 'positions', 'pending_orders', 'trades', 'equity_history');
  if (active === 'demo') { emit('account', { server: true }); emit('trades', { server: true }); }
  return true;
}

export function load() {
  // Lo que se lee de las claves es Demo: la cuenta activa vuelve a ser Demo (la de Mi cuenta llega de /api/portfolio)
  active = 'demo';
  serverMode = false;
  demoSlot = null;
  state.practice = read('practice_active', false) === true;
  state.capital = roundUsd(read('initial_capital', 1000)) || 1000;
  state.cash = state.practice ? roundUsd(read('balance', state.capital)) : 0;
  state.initialInput = state.practice ? cleanInput(read('initial_input', null)) : null;
  state.positions = state.practice ? safeMap(read('positions', []), normalizePosition) : [];
  state.orders = state.practice ? safeMap(read('pending_orders', []), normalizeOrder) : [];
  state.equity = state.practice ? safeMap(read('equity_history', []), (e) => ({ time: Number(e.time), value: roundUsd(e.value) })).filter((e) => e.time > 0) : [];
  state.trades = safeMap(read('trades', []), normalizeTrade);
  state.alerts = safeMap(read('alerts', []), normalizeAlert);
  const wl = read('watchlist', null);
  state.watchlist = Array.isArray(wl) ? [...new Set(wl.map(symbolOf).filter(Boolean))] : [...DEFAULT_WATCHLIST];
  state.recent = (read('recent_searches', []) || []).slice(0, 8);
  state.settings = { ...DEFAULT_SETTINGS, ...(read('settings', {}) || {}) };

  serverSlot = { ...emptyAccount(), equity: safeMap(read('server_equity_history', []), (e) => ({ time: Number(e.time), value: roundUsd(e.value) })).filter((e) => e.time > 0) };
  legacy = read(SPLIT_KEY, 0) !== 1 && hasStoredAccount();
  if (!legacy) write(SPLIT_KEY, 1);

  if (read('schema_version', 1) < APP.schema) {
    persist('positions', 'pending_orders', 'trades', 'alerts', 'watchlist');
    write('schema_version', APP.schema);
  }
}

// Las claves de la cuenta se escriben SIEMPRE desde Demo, aunque la activa sea Mi cuenta
const PERSIST = {
  practice_active: () => demoSrc().practice,
  initial_capital: () => demoSrc().capital,
  initial_input: () => (demoSrc().practice ? demoSrc().initialInput : null),
  balance: () => (demoSrc().practice ? demoSrc().cash : null),
  positions: () => (demoSrc().practice ? demoSrc().positions : null),
  pending_orders: () => (demoSrc().practice ? demoSrc().orders : null),
  equity_history: () => (demoSrc().practice ? demoSrc().equity : null),
  server_equity_history: () => (serverSrc().practice ? serverSrc().equity : null),
  trades: () => demoSrc().trades,
  alerts: () => state.alerts,
  watchlist: () => state.watchlist,
  recent_searches: () => state.recent,
  settings: () => state.settings,
};
function persist(...keys) { for (const k of keys) write(k, PERSIST[k]()); }

/* ---------- Lecturas ---------- */
export const hasPractice = () => state.practice;
export const initialCapital = () => state.capital;
export const initialInput = () => state.initialInput;
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
export function activate(capitalUsd, input = null) {
  assertDemo('Crear la cuenta Demo');
  state.practice = true;
  state.capital = Math.max(10, roundUsd(capitalUsd) || 1000);
  state.initialInput = cleanInput(input);
  state.cash = state.capital;
  state.positions = [];
  state.orders = [];
  state.equity = [{ time: Math.floor(Date.now() / 1000), value: state.capital }];
  persist('practice_active', 'initial_capital', 'initial_input', 'balance', 'positions', 'pending_orders', 'equity_history');
  emit('account');
}

export function closeAccount() {
  assertDemo('Reiniciar la cuenta Demo');
  state.practice = false;
  state.initialInput = null;
  state.cash = 0;
  state.positions = [];
  state.orders = [];
  state.equity = [];
  persist('practice_active', 'initial_input', 'balance', 'positions', 'pending_orders', 'equity_history');
  emit('account');
}

export function setCash(usd) {
  assertDemo('Cambiar el saldo');
  state.cash = Math.max(0, roundUsd(usd));
  persist('balance');
  emit('account');
}

export function addPosition(p) {
  assertDemo('Abrir una posición');
  const pos = normalizePosition(p);
  state.positions = [pos, ...state.positions];
  persist('positions');
  emit('account');
  return pos;
}

export function updatePosition(id, patch) {
  assertDemo('Cambiar una posición');
  state.positions = state.positions.map((p) => (p.id === id ? normalizePosition({ ...p, ...patch }) : p));
  persist('positions');
  emit('account');
}

export function removePosition(id) {
  assertDemo('Cerrar una posición');
  const pos = state.positions.find((p) => p.id === id);
  state.positions = state.positions.filter((p) => p.id !== id);
  persist('positions');
  emit('account');
  return pos;
}

export function addOrder(o) {
  assertDemo('Crear una orden');
  const order = normalizeOrder(o);
  state.orders = [...state.orders, order];
  persist('pending_orders');
  emit('account');
  return order;
}

export function removeOrder(id) {
  assertDemo('Quitar una orden');
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
  persist(active === 'demo' ? 'equity_history' : 'server_equity_history');
}

/* ---------- Cuenta del servidor (con sesión) ---------- */
// Con sesión, saldo, posiciones, órdenes y operaciones cerradas vienen de /api/portfolio (lib/account.js) y el store
// guarda una copia en memoria para pintar (en `state` si la activa es Mi cuenta; si no, en su hueco). Nunca se
// escribe en las claves de Demo. Los eventos llevan { server: true } para que auth.js no los suba a /api/data.
let serverMode = false; // = la cuenta activa es Mi cuenta (ver useAccount)
export const isServerMode = () => serverMode;

/** Sustituye la cuenta por la del servidor. `snap` ya viene convertido a la forma del store (ver account.js). */
export function applyServer(snap) {
  const target = serverSrc();
  Object.assign(target, {
    practice: true, capital: snap.capital, cash: snap.cash, initialInput: cleanInput(snap.initialInput),
    positions: snap.positions, orders: snap.orders, trades: snap.trades,
  });
  if (!target.equity.length) target.equity = [{ time: Math.floor(Date.now() / 1000), value: snap.capital }];
  persist('server_equity_history');
  if (active !== 'server') return; // Demo activa: la copia espera en su hueco y no se pinta
  emit('account', { server: true });
  emit('trades', { server: true });
}

/** Con sesión pero sin cuenta de práctica todavía (hay que elegir el saldo inicial): modo servidor, sin cuenta. */
export function noServerAccount() {
  Object.assign(serverSrc(), emptyAccount());
  persist('server_equity_history');
  if (active === 'server') emit('account', { server: true });
}

/** Al cerrar sesión se vuelve al modo local (clearAll borra después la copia). */
export function leaveServerMode() {
  useAccount('demo');
  serverSlot = emptyAccount();
  persist('server_equity_history');
}

/* ---------- Diario ---------- */
export function addTrade(t) {
  assertDemo('Anotar una operación');
  const trade = normalizeTrade(t);
  state.trades = [trade, ...state.trades];
  persist('trades');
  emit('trades');
  return trade;
}
export function updateTrade(id, patch) {
  assertDemo('Cambiar una operación');
  state.trades = state.trades.map((t) => (t.id === id ? normalizeTrade({ ...t, ...patch }) : t));
  persist('trades');
  emit('trades');
}
export function clearTrades() {
  assertDemo('Borrar el diario');
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
    // Solo Demo: la cuenta del servidor ya está en el servidor y no se copia aquí (ni en /api/data)
    account: { hasPracticeAccount: demoSrc().practice, initialCapitalUsd: demoSrc().capital, balanceUsd: demoSrc().cash },
    positions: demoSrc().positions,
    pendingOrders: demoSrc().orders,
    trades: demoSrc().trades,
    equityHistory: demoSrc().equity,
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
    // Las operaciones con id «f123» son copias de la cuenta del servidor que versiones anteriores guardaban aquí: no son de Demo
    trades: strict(data.trades, normalizeTrade).filter((t) => !/^f\d+$/.test(String(t.id))),
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
    // La visita guiada vista en otro navegador no vuelve a anunciarse (solo se activa, nunca se desactiva al importar)
    ...(s.tourDone === true && { tourDone: true }),
  };
  const { alerts, watchlist, settings: newSettings, ...demoAccount } = next;
  Object.assign(state, { alerts, watchlist, settings: newSettings });
  Object.assign(demoSrc(), demoAccount); // la copia siempre va a Demo, aunque la activa sea Mi cuenta
  persist(...Object.keys(PERSIST));
  for (const e of ['alerts', 'watchlist', 'settings']) emit(e);
  if (active === 'demo') { emit('account'); emit('trades'); }
  return { trades: demoSrc().trades.length, positions: demoSrc().positions.length };
}

/** Derecho de supresión: borra todas las claves paperpulse_* y restablece el estado. */
export function clearAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* sin almacenamiento */ }
  Object.assign(state, {
    ...emptyAccount(), alerts: [], watchlist: [...DEFAULT_WATCHLIST], recent: [], settings: { ...DEFAULT_SETTINGS },
  });
  if (active === 'server') demoSlot = emptyAccount(); else serverSlot = emptyAccount();
  write('schema_version', APP.schema);
  write(SPLIT_KEY, 1);
  legacy = false;
  for (const e of ['account', 'trades', 'alerts', 'watchlist', 'settings']) emit(e);
}
