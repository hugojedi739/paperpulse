// Vista Operar: gráfico con indicadores, ticket de órdenes, libro de órdenes y posiciones.
import * as store from '../lib/store.0a662702.js';
import * as feed from '../lib/feed.c2f1ea36.js';
import { findAsset, displayPair } from '../lib/catalog.f1b2b586.js';
import { html, icon, raw, render, on, $, confirmDialog, toast, anchorPopover, applyVars } from '../lib/dom.a575914e.js';
import { money, price, units, pct, volume, num, currency, convert, approx, trendClass, timeAgo, toUsd } from '../lib/format.ede94c05.js';
import * as trading from '../lib/trading.18f1299c.js';
import * as account from '../lib/account.91455ade.js';
import { createTradingChart, INDICATORS } from '../lib/charts.237b0f40.js';
import { candles, INTERVALS, QUICK_INTERVALS, RANGES, normalizeInterval } from '../lib/marketdata.c9567489.js';
import { assetIcon, assetCell, empty, seg, pressSeg, liveChange, statusChip } from '../lib/ui.13a5e1da.js';
import { go } from '../lib/router.de30a562.js';
import { watchScroll } from '../lib/scroll-hint.b6c0289f.js';
import { closePositionDialog } from '../ui/dialogs.b2671a40.js';
import { shareButton, shareDialog } from '../ui/share.36551d57.js';

const TYPES = [['candles', 'Velas'], ['bars', 'Barras'], ['area', 'Área'], ['line', 'Línea']];

let root, chart, asset;
let side = 'buy', orderType = 'market', dockTab = 'positions';
let unsubKline = null, unsubDepth = null, loadId = 0, abort = null, bookTimer = null, pendingBook = null, dockTimer = null;
let hasMore = false, loadingMore = null, activeRange = null;
const interval = () => normalizeInterval(store.settings().interval);
const dateLabel = (t) => new Date(t * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export const title = 'Operar';

/* Con sesión las órdenes van al servidor: límite y stop de compra y de venta, con un solo nivel.
   Sin sesión (modo local) se mantienen las de siempre: límite y stop-limit de compra. */
const serverMode = () => account.isActive();
const orderTypes = () => (serverMode()
  ? [['market', 'Mercado'], ['limit', 'Límite'], ['stop', 'Stop']]
  : [['market', 'Mercado'], ['limit', 'Límite'], ['stop-limit', 'Stop']]);
function currentType() {
  if (!orderTypes().some(([v]) => v === orderType)) orderType = 'market'; // cambió el modo (inicio/cierre de sesión)
  return orderType;
}
const levelLabel = () => (orderType === 'stop' ? 'Precio de activación' : 'Precio límite');
const ORDER_HINTS = {
  'buy-limit': 'Compra si el precio baja hasta tu nivel. Nunca pagarás más que el límite.',
  'buy-stop': 'Compra a mercado cuando el precio suba hasta tu nivel (ruptura).',
  'sell-limit': 'Vende si el precio sube hasta tu nivel (recoger beneficios). Nunca venderás por menos.',
  'sell-stop': 'Vende a mercado si el precio cae hasta tu nivel (stop-loss). Si el precio salta el nivel, se vende al siguiente precio disponible.',
};
const orderHint = () => (serverMode() && orderType !== 'market' ? html`<p class="hint">${icon('info', 'sm')} ${ORDER_HINTS[`${side}-${orderType}`]}</p>` : '');
const levelField = () => html`<div class="field"><label for="t-limit">${levelLabel()} (${asset.quote})</label>
  <div class="input-group"><input id="t-limit" inputmode="decimal" type="number" step="any" min="0" placeholder="${num(feed.priceOf(asset.symbol))}"><span>${asset.quote}</span></div></div>`;
const feeText = (notionalUsd) => (serverMode()
  ? `≈ ${money(account.estimateFeeUsd(notionalUsd))} (${(account.config().feeBps / 100).toLocaleString('es-ES')} %)`
  : '0 (simulación)');
/** Unidades que se pueden vender: con sesión, las bloqueadas por ventas pendientes no cuentan. */
const freeUnits = (pos) => (serverMode()
  ? Math.max(0, +(pos.amount - store.orders().filter((o) => o.side === 'sell' && o.symbol === pos.symbol).reduce((n, o) => n + o.amount, 0)).toFixed(8))
  : pos.amount);
export const orderLabel = (o) => (o.side
  ? `${o.side === 'buy' ? 'Compra' : 'Venta'} ${o.type === 'limit' ? 'límite' : 'stop'}`
  : o.type === 'limit' ? 'Límite' : 'Stop-límite');

export function mount(el) {
  root = el;
  render(root, html`
    <header class="sym-head" id="t-head"></header>
    <div class="trade">
      <div class="stack">
        <section class="card chart-card" id="t-chart-card">
          <div class="toolbar">
            <div class="gap-4" id="t-intervals"></div>
            ${seg('ctype', TYPES, store.settings().chartType)}
            <button class="btn btn-ghost btn-sm" popovertarget="ind-pop" aria-label="Indicadores" title="Indicadores">${icon('chart-line', 'sm')}<span class="tb-label">Indicadores</span></button>
            <div class="tb-tools">
              <button class="icon-btn sm" popovertarget="date-pop" aria-label="Ir a una fecha" title="Ir a una fecha">${icon('calendar', 'sm')}</button>
              <button class="icon-btn sm" data-t="fit" aria-label="Ajustar vista" title="Ajustar vista">${icon('scan', 'sm')}</button>
              <button class="icon-btn sm" data-t="fullscreen" aria-label="Pantalla completa" title="Pantalla completa">${icon('maximize-2', 'sm')}</button>
            </div>
          </div>
          <div class="chart-box" id="t-chart"><div class="legend" id="t-legend"></div><div class="chart-msg" id="t-msg" hidden></div>
            <div class="chart-loading" id="t-more" hidden>${icon('history', 'sm')} Cargando histórico…</div></div>
          <div class="range-bar">
            ${seg('range', Object.entries(RANGES).map(([k, v]) => [k, v.label]), '')}
            <span class="spacer"></span>
            <small class="muted" id="t-hist"></small>
          </div>
          <div popover id="iv-pop" class="menu iv-menu" role="menu">
            ${['Minutos', 'Horas', 'Días'].map((g) => html`<div class="menu-label">${g}</div><div class="iv-grid">
              ${Object.entries(INTERVALS).filter(([, v]) => v.group === g).map(([k, v]) => html`<button type="button" role="menuitemradio" data-iv="${k}">${v.name}</button>`)}</div>`)}
          </div>
          <form popover id="date-pop" class="menu date-menu">
            <label for="t-date" class="label">Ir a una fecha</label>
            <input type="date" id="t-date" required>
            <button class="btn btn-primary btn-sm btn-block">${icon('calendar', 'sm')} Ir</button>
          </form>
          <div popover id="ind-pop" class="menu ind-menu" role="menu">
            ${Object.entries(INDICATORS).map(([k, v]) => html`<button type="button" role="menuitemcheckbox" data-ind="${k}" aria-checked="${store.settings().indicators.includes(k)}">${v.label}</button>`)}
          </div>
        </section>
        <section class="card flush dock">
          <div class="tabs" role="tablist" id="t-tabs"></div>
          <div class="table-wrap" id="t-dock"></div>
        </section>
      </div>
      <aside class="side">
        <section class="card ticket" id="t-ticket" aria-label="Nueva orden"></section>
        <section class="card book" aria-label="Libro de órdenes">
          <div class="card-head"><h2 class="card-title">${icon('list-filter')} Libro de órdenes</h2><span class="card-sub" id="t-book-sub"></span></div>
          <div id="t-book"></div>
        </section>
      </aside>
    </div>
    <div class="trade-bar">
      <button class="btn btn-primary btn-lg" data-t="side" data-side="buy">Comprar</button>
      <button class="btn btn-ghost btn-lg" data-t="side" data-side="sell">Vender</button>
      <button class="btn btn-ghost btn-lg trade-bar-chat" data-action="chat" aria-label="Abrir asistente" title="Asistente">${icon('sparkles')}</button>
    </div>`);

  chart = createTradingChart($('#t-chart', root), $('#t-legend', root));
  chart.setIndicators(store.settings().indicators);
  anchorPopover($('#ind-pop', root));
  anchorPopover($('#iv-pop', root));
  anchorPopover($('#date-pop', root));
  renderIntervals();
  watchScroll($('.toolbar', root)); // en móvil estas dos filas se desplazan: se difuminan los bordes con contenido oculto
  watchScroll($('.range-bar .seg', root));
  chart.onReachStart(() => loadOlder(loadId));

  const chooseInterval = (value) => {
    activeRange = null;
    pressSeg(root, 'range', '');
    store.setSetting('interval', value);
    renderIntervals();
    load();
  };
  on(root, 'click', '[data-seg="interval"] button', (_, b) => chooseInterval(b.dataset.value));
  on(root, 'click', '[data-iv]', (_, b) => { $('#iv-pop', root).hidePopover(); chooseInterval(b.dataset.iv); });
  on(root, 'click', '[data-seg="range"] button', (_, b) => {
    activeRange = b.dataset.value;
    pressSeg(root, 'range', activeRange);
    store.setSetting('interval', RANGES[activeRange].interval);
    renderIntervals();
    load();
  });
  $('#date-pop', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const t = Date.parse($('#t-date', root).value) / 1000;
    $('#date-pop', root).hidePopover();
    if (Number.isFinite(t)) goToDate(t);
  });
  on(root, 'click', '[data-seg="ctype"] button', (_, b) => {
    store.setSetting('chartType', b.dataset.value);
    pressSeg(root, 'ctype', b.dataset.value);
    chart.setType(b.dataset.value);
    decorate();
  });
  on(root, 'click', '[data-ind]', (_, b) => {
    const onState = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(onState));
    chart.toggleIndicator(b.dataset.ind, onState);
    const list = new Set(store.settings().indicators);
    if (onState) list.add(b.dataset.ind); else list.delete(b.dataset.ind);
    store.setSetting('indicators', [...list]);
  });
  on(root, 'click', '[data-t]', (e, b) => actions[b.dataset.t]?.(b, e));
  on(root, 'click', '[data-seg="otype"] button', (_, b) => { orderType = b.dataset.value; renderTicket(); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('button')) go(tr.dataset.href); });
  on(root, 'click', '[data-share]', (_, b) => shareDialog(store.trades().find((t) => t.id === `f${b.dataset.share}`)));
  on(root, 'input', '#t-ticket input', updateTicketSummary);

  store.on('account', () => { if (!root.hidden) { renderTicket(); renderDock(); decorate(); } });
  store.on('trades', () => { if (!root.hidden) { renderDock(); decorate(); } });
  store.on('alerts', () => !root.hidden && decorate());
  store.on('watchlist', () => !root.hidden && renderHead());
  store.on('prices', (symbols) => {
    if (root.hidden || !asset) return;
    if (symbols.has(asset.symbol)) { onPrice(); updateTicketSummary(); }
    updateDockValues();
  });
}

export function show(param) {
  const next = findAsset(param) ?? asset ?? findAsset('BTC');
  if (param && !findAsset(param)) toast(`No se encontró «${param}». Mostrando ${next.symbol}.`, 'warning');
  if (!param) history.replaceState(null, '', `#/trade/${next.symbol}`);
  const changed = next !== asset;
  asset = next;
  feed.track(asset);
  renderHead();
  renderTicket();
  renderDock();
  if (changed || !chart.lastCandle()) load();
  connectBook();
  clearInterval(dockTimer);
  dockTimer = setInterval(updateDockValues, 2000);
}

export function hide() {
  unsubKline?.(); unsubKline = null;
  unsubDepth?.(); unsubDepth = null;
  clearInterval(dockTimer);
  abort?.abort();
}

export function theme() { chart?.theme(); decorate(); }

export const currentAsset = () => asset;

/* ---------- Cabecera del símbolo ---------- */
function renderHead() {
  const t = feed.tick(asset.symbol);
  const starred = store.inWatchlist(asset.symbol);
  render($('#t-head', root), html`
    <button class="sym-btn" data-action="palette" aria-label="Cambiar de activo">
      ${assetIcon(asset, 'lg')}
      <div><strong>${displayPair(asset)} ${icon('chevron-down', 'sm')}</strong><small>${asset.name}</small></div>
    </button>
    <div class="sym-price">
      <strong data-px="${asset.symbol}" data-q="${asset.quote}" data-flash>${price(t?.price, asset.quote)}</strong>
      <div class="gap-8">${liveChange(asset, 'span')} ${statusChip(asset)}</div>
    </div>
    <div class="sym-stats" id="t-stats"></div>
    <div class="sym-actions">
      <button class="icon-btn" data-t="star" aria-pressed="${starred}" aria-label="${starred ? 'Quitar de favoritos' : 'Añadir a favoritos'}" title="Favorito">${icon('star')}</button>
      <button class="icon-btn" data-t="alert" aria-label="Crear alerta de precio" title="Alerta de precio">${icon('bell-ring')}</button>
    </div>`);
  renderStats();
}

function renderStats() {
  const t = feed.tick(asset.symbol);
  const conv = t?.price ? approx(t.price, asset.quote) : '';
  render($('#t-stats', root), html`
    ${conv ? html`<div><span>En ${currency()}</span><strong>${conv.replace('≈ ', '')}</strong></div>` : ''}
    <div><span>Máx. 24 h</span><strong>${price(t?.high24h, asset.quote)}</strong></div>
    <div><span>Mín. 24 h</span><strong>${price(t?.low24h, asset.quote)}</strong></div>
    <div><span>Volumen 24 h</span><strong>${t?.volume24h ? volume(t.volume24h) : '—'}</strong></div>`);
}

/* ---------- Velas ---------- */
function renderIntervals() {
  const cur = interval();
  const extra = !QUICK_INTERVALS.includes(cur);
  render($('#t-intervals', root), html`
    ${seg('interval', QUICK_INTERVALS.map((k) => [k, INTERVALS[k].label]), cur)}
    <button class="btn btn-ghost btn-sm" popovertarget="iv-pop" aria-pressed="${extra}" title="Más temporalidades">${extra ? INTERVALS[cur].label : 'Más'} ${icon('chevron-down', 'sm')}</button>`);
  root.querySelectorAll('[data-iv]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.iv === cur)));
}

function renderHistInfo() {
  const first = chart.firstCandle();
  const el = $('#t-hist', root);
  if (!el) return;
  el.textContent = !first ? '' : `Desde ${dateLabel(first.time)} · ${hasMore ? 'desplaza a la izquierda para ver más' : 'inicio del histórico disponible'}`;
}

async function load() {
  const id = ++loadId;
  abort?.abort();
  abort = new AbortController();
  unsubKline?.(); unsubKline = null;
  loadingMore = null;
  const msg = $('#t-msg', root);
  render(msg, html`<div class="sk-block skeleton" aria-hidden="true"></div><div class="sk-wrap" role="status"><span class="sk-caption">Cargando ${displayPair(asset)}…</span></div>`);
  msg.hidden = false;
  const iv = interval();
  let page = { candles: [], hasMore: false };
  try {
    page = await candles(asset, iv, { signal: abort.signal });
  } catch (err) {
    if (err.name === 'AbortError') return;
  }
  if (id !== loadId) return;
  const list = page.candles;
  hasMore = page.hasMore;
  if (!list.length) {
    render(msg, empty('chart-candlestick', 'Sin datos históricos', `No hay velas disponibles para ${displayPair(asset)} en ${INTERVALS[iv].name}. Prueba otra temporalidad o vuelve en unos minutos.`));
    renderHistInfo();
    return;
  }
  msg.hidden = true;
  chart.setType(store.settings().chartType);
  chart.setData(list, { label: `${displayPair(asset)} · ${INTERVALS[iv].label}`, symbol: asset.symbol, quote: asset.quote, intraday: INTERVALS[iv].secs < 86400 });
  feed.setFallbackPrice(asset.symbol, list.at(-1).close);
  decorate();
  renderHistInfo();
  if (activeRange) {
    const from = RANGES[activeRange].from(Date.now() / 1000);
    await loadUntil(from, id);
    if (id === loadId) chart.showRange(from);
  }
  if (asset.type === 'crypto' && id === loadId) {
    unsubKline = feed.subscribe(`${(asset.pair ?? `${asset.symbol}USDT`).toLowerCase()}@kline_${iv}`, ({ k }) => {
      if (id === loadId) chart.update({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    });
  }
}

/** Carga la página anterior a la primera vela visible. Devuelve una promesa (compartida si ya está en curso). */
function loadOlder(id, limit) {
  if (loadingMore || !hasMore || id !== loadId || !chart.firstCandle()) return loadingMore ?? Promise.resolve();
  const spinner = $('#t-more', root);
  spinner.hidden = false;
  loadingMore = (async () => {
    try {
      const page = await candles(asset, interval(), { end: chart.firstCandle().time, signal: abort?.signal, limit });
      if (id !== loadId) return;
      hasMore = page.hasMore && chart.prepend(page.candles) > 0;
      decorate();
    } catch (err) {
      if (err.name !== 'AbortError') hasMore = false;
    } finally {
      if (id === loadId) { loadingMore = null; spinner.hidden = true; renderHistInfo(); }
    }
  })();
  return loadingMore;
}

/** Sigue cargando páginas antiguas hasta cubrir `t` (epoch s) o agotar el histórico. */
async function loadUntil(t, id) {
  for (let i = 0; i < 25 && hasMore && id === loadId && chart.firstCandle()?.time > t; i++) await loadOlder(id, 1000);
}

/** Temporalidad para saltar a una fecha sin descargar demasiadas velas (y dentro de lo que ofrece cada fuente). */
function intervalFor(t) {
  const age = Date.now() / 1000 - t;
  const fits = (k) => age / INTERVALS[k].secs <= 5000
    && (asset.type !== 'stock' || INTERVALS[k].secs >= 86400 || age < (INTERVALS[k].secs < 3600 ? 55 : 700) * 86400);
  const cur = interval();
  return fits(cur) ? cur : ['1h', '4h', '1d', '1w'].find(fits) ?? '1M';
}

async function goToDate(t) {
  if (t > Date.now() / 1000) return toast('Elige una fecha pasada.', 'warning');
  const next = intervalFor(t);
  if (next !== interval()) {
    activeRange = null;
    pressSeg(root, 'range', '');
    store.setSetting('interval', next);
    renderIntervals();
    await load();
  }
  await loadUntil(t, loadId);
  const first = chart.firstCandle();
  if (first && first.time > t) toast(`El histórico de ${displayPair(asset)} en ${INTERVALS[interval()].name} empieza el ${dateLabel(first.time)}.`, 'info');
  chart.scrollToTime(Math.max(t, first?.time ?? t));
}

function onPrice() {
  renderStats();
  const t = feed.tick(asset.symbol);
  const last = chart.lastCandle();
  if (asset.type === 'stock' && last && t?.price && t.marketOpen !== false) {
    chart.update({ ...last, close: t.price, high: Math.max(last.high, t.price), low: Math.min(last.low, t.price) });
  }
}

/** Líneas de precio (entradas, órdenes, alertas) y marcadores de operaciones cerradas. */
function decorate() {
  if (!chart || !asset) return;
  const c = chart.colors();
  const lines = [];
  for (const p of store.positions().filter((x) => x.symbol === asset.symbol)) {
    lines.push({ price: p.entryPrice, color: c.accent, title: `Entrada ${units(p.amount)}`, lineStyle: 0 });
  }
  for (const o of store.orders().filter((x) => x.symbol === asset.symbol)) {
    lines.push({ price: o.limitPrice, color: o.side === 'sell' ? c.down : c.up, title: o.side ? orderLabel(o) : 'Límite', lineStyle: 2 });
    if (o.stopPrice) lines.push({ price: o.stopPrice, color: c.muted, title: 'Stop', lineStyle: 2 });
  }
  for (const a of store.alerts().filter((x) => x.symbol === asset.symbol && !x.triggered)) {
    lines.push({ price: a.target, color: c.text, title: 'Alerta', lineStyle: 1 });
  }
  chart.setLines(lines);
  const marks = [];
  for (const t of store.trades().filter((x) => x.symbol === asset.symbol).slice(0, 30)) {
    if (t.openedAt) marks.push({ time: t.openedAt / 1000, position: 'belowBar', shape: 'arrowUp', color: c.accent, text: 'Compra' });
    marks.push({ time: Date.parse(t.date) / 1000, position: 'aboveBar', shape: 'arrowDown', color: t.pnl >= 0 ? c.up : c.down, text: money(t.pnl, { signed: true }) });
  }
  chart.setMarkers(marks);
}

/* ---------- Ticket de órdenes ---------- */
function renderTicket() {
  const box = $('#t-ticket', root);
  if (!store.hasPractice()) {
    return render(box, html`<div class="lock">${icon('graduation-cap')}<strong>Practica sin riesgo</strong>
      <p>Activa una cuenta de práctica con saldo virtual para comprar y vender ${asset.symbol} con precios reales.</p>
      <button class="btn btn-primary btn-block" data-action="account">${icon('play')} Empezar a practicar</button></div>`);
  }
  const pos = store.positions().find((p) => p.symbol === asset.symbol);
  const cur = currency();
  render(box, html`
    <div class="side-tabs" role="group" aria-label="Lado de la orden">
      <button type="button" data-t="side" data-side="buy" aria-pressed="${side === 'buy'}">Comprar</button>
      <button type="button" data-t="side" data-side="sell" aria-pressed="${side === 'sell'}">Vender</button>
    </div>
    ${side === 'buy' ? html`
      ${seg('otype', orderTypes(), currentType())}
      ${orderHint()}
      ${orderType === 'stop-limit' ? html`<div class="field"><label for="t-stop">Precio de activación (${asset.quote})</label>
        <div class="input-group"><input id="t-stop" inputmode="decimal" type="number" step="any" min="0" placeholder="${num(feed.priceOf(asset.symbol))}"><span>${asset.quote}</span></div></div>` : ''}
      ${orderType !== 'market' ? levelField() : ''}
      <div class="field"><label for="t-amount">Importe a invertir</label>
        <div class="input-group"><input id="t-amount" inputmode="decimal" type="number" step="any" min="0" placeholder="0,00"><span>${cur}</span></div></div>
      <div class="pct-row">${[25, 50, 75, 100].map((p) => html`<button type="button" data-t="pct" data-pct="${p}">${p === 100 ? 'Máx' : `${p}%`}</button>`)}</div>
      <dl class="summary" id="t-summary"></dl>
      <button class="btn btn-primary btn-lg btn-block" data-t="submit">${orderType === 'market' ? `Comprar ${asset.symbol}` : `Colocar orden ${orderType === 'limit' ? 'límite' : 'stop'}`}</button>`
    : pos ? html`
      ${serverMode() ? html`${seg('otype', orderTypes(), currentType())}${orderHint()}` : ''}
      ${serverMode() && orderType !== 'market' ? levelField() : ''}
      <div class="summary"><div><span>Tienes</span><strong>${units(pos.amount, pos.symbol)}</strong></div>
        <div><span>Precio medio</span><strong>${price(pos.entryPrice, pos.quote)}</strong></div></div>
      <div class="field"><label for="t-units">Cantidad a vender</label>
        <div class="input-group"><input id="t-units" inputmode="decimal" type="number" step="any" min="0" max="${freeUnits(pos)}" value="${freeUnits(pos)}"><span>${asset.symbol}</span></div></div>
      <div class="pct-row">${[25, 50, 75, 100].map((p) => html`<button type="button" data-t="pct" data-pct="${p}">${p === 100 ? 'Todo' : `${p}%`}</button>`)}</div>
      <dl class="summary" id="t-summary"></dl>
      <button class="btn btn-primary btn-lg btn-block" data-t="submit">${serverMode() && orderType !== 'market' ? `Colocar venta ${orderType === 'limit' ? 'límite' : 'stop'}` : `Vender ${asset.symbol}`}</button>`
    : empty('wallet', `No tienes ${asset.symbol}`, 'Compra primero para poder vender. En esta simulación no se permiten ventas en corto.')}
    <p class="hint">Disponible: <span class="money">${money(store.cash())}</span></p>`);
  updateTicketSummary();
}

function readNumber(id) {
  const el = $(`#${id}`, root);
  const v = parseFloat(el?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function updateTicketSummary() {
  const box = $('#t-summary', root);
  if (!box) return;
  const px = feed.priceOf(asset.symbol);
  if (side === 'buy') {
    const amount = readNumber('t-amount');
    const execPx = orderType === 'market' ? px : readNumber('t-limit');
    const qty = amount && execPx ? convert(amount, currency(), asset.quote) / execPx : 0;
    render(box, html`
      <div><dt>Recibirás aprox.</dt><dd>${qty ? units(qty, asset.symbol) : '—'}</dd></div>
      <div><dt>${orderType === 'market' ? 'Precio de mercado' : levelLabel()}</dt><dd>${price(execPx, asset.quote)}</dd></div>
      <div><dt>Comisión</dt><dd>${feeText(amount ? convert(amount, currency(), 'USD') : 0)}</dd></div>`);
  } else {
    const pos = store.positions().find((p) => p.symbol === asset.symbol);
    const qty = readNumber('t-units');
    if (!pos || !qty || !px) return render(box, html`<div><dt>Recibirás aprox.</dt><dd>—</dd></div>`);
    const sold = Math.min(qty, pos.amount);
    const level = serverMode() && orderType !== 'market' ? readNumber('t-limit') : null;
    const gross = level ? toUsd(sold * level, pos.quote) : trading.valuePosition({ ...pos, amount: sold }).valueUsd;
    const proceeds = serverMode() ? gross - account.estimateFeeUsd(gross) : gross;
    const pnl = proceeds - pos.investedUsd * (sold / pos.amount);
    render(box, html`
      <div><dt>Recibirás aprox.</dt><dd class="money">${money(proceeds)}</dd></div>
      ${serverMode() ? html`<div><dt>Comisión</dt><dd>${feeText(gross)}</dd></div>` : ''}
      <div><dt>Resultado estimado</dt><dd class="money delta ${trendClass(pnl)}">${money(pnl, { signed: true })}</dd></div>`);
  }
}

const actions = {
  side(b) {
    side = b.dataset.side;
    renderTicket();
    if (matchMedia('(max-width: 1080px)').matches) $('#t-ticket', root).scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  pct(b) {
    const share = Number(b.dataset.pct) / 100;
    if (side === 'buy') {
      const input = $('#t-amount', root);
      input.value = (Math.floor(convert(store.cash(), 'USD', currency()) * share * 100) / 100).toFixed(2);
    } else {
      const pos = store.positions().find((p) => p.symbol === asset.symbol);
      if (pos) $('#t-units', root).value = share === 1 ? freeUnits(pos) : +(freeUnits(pos) * share).toFixed(8);
    }
    updateTicketSummary();
  },
  submit() { (side === 'buy' ? submitBuy : submitSell)(); },
  star(b) {
    const added = store.toggleWatchlist(asset.symbol);
    b.setAttribute('aria-pressed', String(added));
    toast(added ? `${asset.symbol} añadido a favoritos` : `${asset.symbol} quitado de favoritos`, 'success', 2500);
  },
  alert() { import('../ui/dialogs.b2671a40.js').then((m) => m.alertsDialog(asset)); },
  fit() { chart.fit(); },
  fullscreen() {
    const card = $('#t-chart-card', root);
    if (document.fullscreenElement) document.exitFullscreen(); else card.requestFullscreen?.();
  },
  tab(b) { dockTab = b.dataset.tab; renderDock(); },
  close(b) { closePositionDialog(b.dataset.id); },
  async cancel(b) {
    b.disabled = true;
    try {
      const o = await trading.cancelOrder(b.dataset.id);
      if (o) toast(`Orden de ${o.symbol} cancelada. Saldo liberado.`, 'info');
    } catch (err) {
      toast(err.message, 'error');
      b.disabled = false;
    }
  },
};

async function submitBuy() {
  const amount = readNumber('t-amount');
  const input = $('#t-amount', root);
  input.closest('.input-group').classList.toggle('invalid', !amount);
  if (!amount) return toast('Introduce el importe que quieres invertir.', 'warning');
  currentType();
  const limitPrice = orderType === 'market' ? null : readNumber('t-limit');
  const stopPrice = orderType === 'stop-limit' ? readNumber('t-stop') : null;
  if (orderType !== 'market' && !limitPrice) return toast(`Introduce el ${levelLabel().toLowerCase()}.`, 'warning');
  if (orderType === 'stop-limit' && !stopPrice) return toast('Introduce el precio de activación.', 'warning');
  const px = limitPrice ?? feed.priceOf(asset.symbol);
  if (!px) return toast(`Sin cotización de ${asset.symbol} ahora mismo.`, 'warning');
  const qty = +(convert(amount, currency(), asset.quote) / px).toFixed(8);

  const ok = await confirmDialog({
    title: orderType === 'market' ? `Comprar ${asset.symbol}` : `Orden ${{ limit: 'límite', stop: 'stop', 'stop-limit': 'stop-limit' }[orderType]} de ${asset.symbol}`,
    body: `${units(qty, asset.symbol)} por ${money(amount, { from: currency() })} a ${price(px, asset.quote)}${stopPrice ? `, se activa en ${price(stopPrice, asset.quote)}` : ''}. `
      + (serverMode()
        ? `Comisión estimada ${feeText(convert(amount, currency(), 'USD'))}. El precio final lo decide el servidor con la cotización real${orderType === 'market' ? ', con un pequeño deslizamiento' : ''}.`
        : 'Operación simulada sin comisiones.'),
    confirm: orderType === 'market' ? 'Comprar' : 'Colocar orden',
  });
  if (!ok) return;
  try {
    if (orderType === 'market') {
      const r = await trading.buyMarket(asset, qty);
      toast(`Has comprado ${units(r.amount, asset.symbol)} a ${price(r.price, asset.quote)}`, 'success');
    } else {
      const r = await trading.placeOrder(asset, { type: orderType, amount: qty, limitPrice, stopPrice });
      toast(r.filled ? `Orden ejecutada al instante: ${units(qty, asset.symbol)}` : 'Orden colocada. Se ejecutará cuando el precio alcance tu nivel.', 'success');
    }
    input.value = '';
    updateTicketSummary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function submitSell() {
  const pos = store.positions().find((p) => p.symbol === asset.symbol);
  const qty = readNumber('t-units');
  if (!pos || !qty) return toast('Indica cuántas unidades quieres vender.', 'warning');
  if (!serverMode() || currentType() === 'market') return closePositionDialog(pos.id, Math.min(qty, pos.amount));

  // Venta límite o stop (solo con sesión): queda pendiente en el servidor
  const level = readNumber('t-limit');
  if (!level) return toast(`Introduce el ${levelLabel().toLowerCase()}.`, 'warning');
  const amount = Math.min(qty, pos.amount);
  const ok = await confirmDialog({
    title: `Venta ${orderType === 'limit' ? 'límite' : 'stop'} de ${asset.symbol}`,
    body: `${units(amount, asset.symbol)} a ${price(level, asset.quote)}. ${ORDER_HINTS[`sell-${orderType}`]} Las unidades quedan bloqueadas hasta que se ejecute o la canceles.`,
    confirm: 'Colocar orden',
  });
  if (!ok) return;
  try {
    const r = await trading.placeOrder(asset, { side: 'sell', type: orderType, amount, limitPrice: level });
    toast(r.filled ? 'El precio ya estaba en tu nivel: venta ejecutada al momento.' : 'Orden de venta colocada.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------- Libro de órdenes ---------- */
function connectBook() {
  unsubDepth?.(); unsubDepth = null;
  const box = $('#t-book', root);
  $('#t-book-sub', root).textContent = asset.type === 'crypto' ? 'Binance · en vivo' : '';
  if (asset.type !== 'crypto') {
    return render(box, empty('list-filter', 'No disponible', 'El libro de órdenes en vivo solo está disponible para criptomonedas.'));
  }
  render(box, html`<div class="sk-rows" role="status">${Array.from({ length: 6 }, () => html`<span class="skeleton sk-line"></span>`)}<span class="sk-caption">Conectando con el libro de Binance…</span></div>`);
  unsubDepth = feed.subscribe(`${(asset.pair ?? `${asset.symbol}USDT`).toLowerCase()}@depth20@100ms`, (d) => {
    pendingBook = d;
    bookTimer ??= setTimeout(() => { bookTimer = null; renderBook(pendingBook); }, 300);
  });
}

function renderBook(d) {
  const box = $('#t-book', root);
  if (!box || !d?.bids?.length || !d?.asks?.length) return;
  const asks = d.asks.slice(0, 8).map(([p, q]) => [+p, +q]);
  const bids = d.bids.slice(0, 8).map(([p, q]) => [+p, +q]);
  const cum = (rows) => rows.reduce((acc, [, q], i) => [...acc, (acc[i - 1] ?? 0) + q], []);
  const ca = cum(asks), cb = cum(bids);
  const max = Math.max(ca.at(-1), cb.at(-1));
  const row = (cls, [p, q], c) => html`<div class="book-row ${cls}" data-w="${((c / max) * 100).toFixed(1)}"><span>${num(p)}</span><span>${num(q, 4)}</span><span>${volume(p * q)}</span></div>`;
  const spread = asks[0][0] - bids[0][0];
  box.innerHTML = String(html`
    <div class="book-head"><span>Precio (${asset.quote})</span><span>Cantidad</span><span>Total</span></div>
    ${asks.map((a, i) => ({ a, c: ca[i] })).reverse().map(({ a, c }) => row('ask', a, c))}
    <div class="book-mid"><strong class="num">${num((asks[0][0] + bids[0][0]) / 2)}</strong><span class="muted">Spread ${num(spread)} (${pct((spread / asks[0][0]) * 100, { signed: false, decimals: 3 })})</span></div>
    ${bids.map((b, i) => row('bid', b, cb[i]))}`);
  applyVars(box);
}

/* ---------- Posiciones, órdenes e historial ---------- */
function renderDock() {
  const positions = store.positions();
  const orders = store.orders();
  render($('#t-tabs', root), [['positions', 'Posiciones', positions.length], ['orders', 'Órdenes', orders.length], ['history', 'Historial', null]]
    .map(([id, label, n]) => html`<button role="tab" data-t="tab" data-tab="${id}" aria-selected="${dockTab === id}">${label}${n != null ? html`<span class="count">${n}</span>` : ''}</button>`));
  const box = $('#t-dock', root);
  if (!store.hasPractice() && dockTab !== 'history') {
    return render(box, empty('wallet', 'Sin cuenta de práctica', 'Tus posiciones y órdenes aparecerán aquí cuando empieces a practicar.'));
  }
  if (dockTab === 'positions') {
    if (!positions.length) return render(box, empty('layers', 'Sin posiciones abiertas', 'Usa el panel de órdenes para hacer tu primera compra.'));
    render(box, html`<table class="table"><thead><tr><th>Activo</th><th class="r">Cantidad</th><th class="r">Entrada</th><th class="r">Actual</th><th class="r">Valor</th><th class="r">P&amp;L</th><th></th></tr></thead>
      <tbody>${positions.map((p) => html`<tr data-href="/trade/${p.symbol}">
        <td>${assetCell(p, displayPair(p))}</td>
        <td class="r">${units(p.amount)}</td>
        <td class="r">${price(p.entryPrice, p.quote)}</td>
        <td class="r"><span data-px="${p.symbol}" data-q="${p.quote}">${price(feed.priceOf(p.symbol), p.quote)}</span></td>
        <td class="r money" data-pv="${p.id}"></td>
        <td class="r money" data-pp="${p.id}"></td>
        <td class="r"><button class="btn btn-ghost btn-sm" data-t="close" data-id="${p.id}">Cerrar</button></td></tr>`)}</tbody></table>`);
    updateDockValues();
  } else if (dockTab === 'orders') {
    if (!orders.length) return render(box, empty('clock', 'Sin órdenes pendientes', 'Las órdenes límite y stop reservan saldo hasta ejecutarse o cancelarse.'));
    render(box, html`<table class="table"><thead><tr><th>Activo</th><th>Tipo</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Stop</th><th class="r">Reservado</th><th>Creada</th><th></th></tr></thead>
      <tbody>${orders.map((o) => html`<tr data-href="/trade/${o.symbol}">
        <td><strong>${o.symbol}</strong></td><td><span class="chip">${orderLabel(o)}</span></td>
        <td class="r">${units(o.amount)}</td><td class="r">${price(o.limitPrice, o.quote)}</td><td class="r">${o.stopPrice ? price(o.stopPrice, o.quote) : '—'}</td>
        <td class="r money">${money(o.reservedUsd)}</td><td class="muted">${timeAgo(o.createdAt)}</td>
        <td class="r"><button class="btn btn-ghost btn-sm" data-t="cancel" data-id="${o.id}">Cancelar</button></td></tr>`)}</tbody></table>`);
  } else {
    const trades = store.trades().slice(0, 25);
    if (!trades.length) return render(box, empty('history', 'Sin operaciones todavía', 'Cuando vendas una posición aparecerá aquí con su resultado.'));
    render(box, html`<table class="table"><thead><tr><th>Fecha</th><th>Activo</th><th class="r">Cantidad</th><th class="r">Entrada</th><th class="r">Salida</th><th class="r">Resultado</th><th></th></tr></thead>
      <tbody>${trades.map((t) => html`<tr data-href="/trade/${t.symbol}">
        <td class="muted">${new Date(t.date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td><td><strong>${t.symbol}</strong></td>
        <td class="r">${units(t.amount)}</td><td class="r">${price(t.entryPrice, t.quote)}</td><td class="r">${price(t.exitPrice, t.quote)}</td>
        <td class="r money delta ${trendClass(t.pnl)}">${money(t.pnl, { signed: true })} · ${pct(t.pnlPct)}</td><td class="r">${raw(shareButton(t))}</td></tr>`)}</tbody></table>`);
  }
}

function updateDockValues() {
  if (dockTab !== 'positions') return;
  for (const p of store.positions()) {
    const v = trading.valuePosition(p);
    const val = root.querySelector(`[data-pv="${p.id}"]`);
    const pnl = root.querySelector(`[data-pp="${p.id}"]`);
    if (val) val.textContent = money(v.valueUsd);
    if (pnl) {
      pnl.textContent = `${money(v.pnlUsd, { signed: true })} · ${pct(v.pnlPct)}`;
      pnl.className = `r money delta ${trendClass(v.pnlUsd)}`;
    }
  }
}

