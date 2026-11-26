// Vista Operar: gráfico con indicadores, ticket de órdenes, libro de órdenes y posiciones.
import * as store from '../lib/store.js';
import * as feed from '../lib/feed.js';
import { findAsset, displayPair } from '../lib/catalog.js';
import { html, icon, raw, render, on, $, confirmDialog, toast, anchorPopover, applyVars } from '../lib/dom.js';
import { money, price, units, pct, volume, compact, num, currency, convert, approx, trendClass, timeAgo, toUsd } from '../lib/format.js';
import * as trading from '../lib/trading.js';
import * as account from '../lib/account.js';
import { createTradingChart, INDICATORS, isAdvanced } from '../lib/charts.js';
import { candles, news, safeUrl, INTERVALS, QUICK_INTERVALS, RANGES, normalizeInterval } from '../lib/marketdata.js';
import { assetIcon, assetCell, empty, seg, pressSeg, liveChange, statusChip } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { watchScroll } from '../lib/scroll-hint.js';
import { closePositionDialog } from '../ui/dialogs.js';
import { shareButton, shareDialog } from '../ui/share.js';
import { isVisible } from '../lib/sections.js';
import { afterBuy } from '../ui/celebrate.js';
import { bookPressure, bookLevels } from '../lib/book.js';
import { can, LOCKED_TEXT } from '../lib/capabilities.js';
import { upcomingDividends, dividendLine, EX_DATE_NOTE, SIMULATION_NOTE } from '../lib/dividends.js';
import { h, svgIcon, mount as put } from '../lib/el.js';
import { currentUser, onAuth } from '../lib/auth.js';
import { ask } from '../ui/chat.js';
import { loadSentiment, castVote, nextVote, shares, votesLabel, SENTIMENT_NOTE } from '../lib/sentiment.js';

const TYPES = [['candles', 'Velas'], ['bars', 'Barras'], ['area', 'Área'], ['line', 'Línea']];

let root, chart, asset;
let side = 'buy', orderType = 'market', dockTab = 'positions';
let direction = 'long'; // Long (alcista) o Short (bajista, solo en Demo y a mercado)
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
const EXITS_NOTE = 'Stop Loss y Take Profit se revisan al abrir la cartera.';
const SHORT_NOTE = 'En la vida real el short tiene más riesgos y costes que este simulador no refleja del todo.';
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
            <button type="button" class="btn btn-ghost btn-sm tb-settings" data-t="tb-settings" aria-expanded="false" aria-controls="t-tools">${icon('sliders-horizontal', 'sm')} Ajustes del gráfico ${icon('chevron-down', 'sm')}</button>
            <div class="tb-group" id="t-tools">
            ${seg('ctype', TYPES, store.settings().chartType)}
            <button class="btn btn-ghost btn-sm" popovertarget="ind-pop" aria-label="Indicadores" title="Indicadores">${icon('chart-line', 'sm')}<span class="tb-label">Indicadores</span></button>
            <button class="btn btn-ghost btn-sm" popovertarget="more-pop" aria-label="Más opciones del gráfico" title="Rango, escala, fecha y ajuste">${icon('sliders-horizontal', 'sm')}<span class="tb-label">Más</span></button>
            <div class="tb-tools">
              <button class="icon-btn sm" data-t="fullscreen" aria-label="Pantalla completa" title="Pantalla completa">${icon('maximize-2', 'sm')}</button>
            </div>
            </div>
          </div>
          <div class="chart-box" id="t-chart"><div class="legend" id="t-legend"></div><div class="chart-msg" id="t-msg" hidden></div>
            <div class="chart-loading" id="t-more" hidden>${icon('history', 'sm')} Cargando histórico…</div></div>
          <div class="range-bar">
            ${seg('range', Object.entries(RANGES).map(([k, v]) => [k, v.label]), '')}
            <span class="spacer"></span>
            <small class="muted rb-clock" id="t-clock" aria-hidden="true"></small>
            <button type="button" class="rb-toggle" data-t="log" aria-pressed="${String(store.settings().logScale === true)}" title="Escala logarítmica">log</button>
          </div>
          <small class="muted t-hist" id="t-hist"></small>
          <div popover id="more-pop" class="menu more-menu" role="menu">
            <button type="button" role="menuitem" data-t="fit">${icon('scan', 'sm')} Ajustar vista</button>
            <button type="button" role="menuitem" popovertarget="date-pop">${icon('calendar', 'sm')} Ir a una fecha</button>
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
            <div class="ind-search"><input type="search" id="ind-q" placeholder="Buscar indicador" aria-label="Buscar indicador" autocomplete="off"></div>
            <p class="menu-note muted" id="ind-limit">Hasta ${MAX_INDICATORS} a la vez, además del volumen.</p>
            ${Object.entries(INDICATORS).filter(([k]) => !isAdvanced(k)).map(([k, v]) => indItem(k, v))}
            <div class="ind-periods">
              <label>SMA <input type="number" inputmode="numeric" min="2" max="400" step="1" data-period="maPeriod" value="${store.settings().maPeriod ?? 20}" aria-label="Periodo de la media simple"></label>
              <label>EMA <input type="number" inputmode="numeric" min="2" max="400" step="1" data-period="emaPeriod" value="${store.settings().emaPeriod ?? 50}" aria-label="Periodo de la media exponencial"></label>
            </div>
            <button type="button" role="menuitemcheckbox" class="ind-adv-switch" data-adv aria-checked="${String(advancedOn())}">${icon('chart-line', 'sm')} Análisis avanzado</button>
            <div id="ind-adv" role="group" aria-label="Análisis avanzado" ${advancedOn() ? '' : 'hidden'}>
              ${Object.entries(INDICATORS).filter(([k]) => isAdvanced(k)).map(([k, v]) => indItem(k, v))}
              <p class="menu-note muted">Herramientas de estudio calculadas en tu navegador con las velas cargadas. No predicen el precio ni son una recomendación.</p>
            </div>
          </div>
        </section>
        <section class="card flush dock">
          <div class="tabs" role="tablist" id="t-tabs"></div>
          <div class="table-wrap" id="t-dock"></div>
        </section>
        <section class="card book" id="t-book-card" aria-label="Libro de órdenes" hidden>
          <div class="card-head"><h2 class="card-title">Libro de órdenes</h2><span class="card-sub" id="t-book-sub"></span></div>
          <div class="pressure" id="t-pressure" title="${PRESSURE_NOTE}"></div>
          <details class="book-depth" id="t-book-details"><summary>Ver profundidad</summary><div id="t-book"></div></details>
        </section>
      </div>
      <aside class="side">
        <section class="card side-panel" aria-label="Panel del activo">
          <div class="tabs side-tablist" role="tablist" aria-label="Panel del activo">
            ${SIDE_TABS.map(([id, label]) => html`<button type="button" role="tab" id="st-${id}" aria-controls="sp-${id}" data-side-tab="${id}" aria-selected="${String(id === 'order')}" tabindex="${id === 'order' ? '0' : '-1'}">${label}</button>`)}
          </div>
          <div role="tabpanel" id="sp-order" aria-labelledby="st-order"><section class="ticket" id="t-ticket" aria-label="Nueva orden"></section></div>
          <div role="tabpanel" id="sp-watch" aria-labelledby="st-watch" hidden><div id="t-watch"></div></div>
          <div role="tabpanel" id="sp-info" aria-labelledby="st-info" hidden><div id="t-info"></div></div>
        </section>
      </aside>
    </div>
    <div class="trade-bar">
      <button class="btn btn-primary btn-lg" data-t="side" data-side="buy">Comprar</button>
      <button class="btn btn-ghost btn-lg" data-t="side" data-side="sell">Vender</button>
      <button class="btn btn-ghost btn-lg trade-bar-chat" data-action="chat" aria-label="Abrir asistente" title="Asistente">${icon('sparkles')}</button>
    </div>`);

  chart = createTradingChart($('#t-chart', root), $('#t-legend', root));
  chart.setPeriods({ ma: store.settings().maPeriod ?? 20, ema: store.settings().emaPeriod ?? 50 });
  chart.setIndicators(effectiveIndicators());
  chart.setLogScale(store.settings().logScale === true);
  anchorPopover($('#ind-pop', root));
  anchorPopover($('#more-pop', root));
  anchorPopover($('#iv-pop', root));
  anchorPopover($('#date-pop', root));
  renderIntervals();
  watchScroll($('.toolbar', root)); // en móvil estas dos filas se desplazan: se difuminan los bordes con contenido oculto
  watchScroll($('.range-bar .seg', root));
  // Hora local bajo el gráfico (discreta), una vez por segundo y solo con Operar a la vista
  setInterval(() => { const el = $('#t-clock', root); if (el && !root.hidden) el.textContent = new Date().toLocaleTimeString('es-ES'); }, 1000);
  chart.onReachStart(() => loadOlder(loadId));

  const chooseInterval = (value) => {
    activeRange = null;
    pressSeg(root, 'range', '');
    store.setSetting('interval', value);
    renderIntervals();
    load();
  };
  on(root, 'click', '[data-sent]', (_, b) => vote(Number(b.dataset.sent)));
  onAuth(() => loadOpinion()); // al entrar o salir cambia mi voto
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
  on(root, 'click', '[data-adv]', (_, b) => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    $('#ind-adv', root).hidden = !next;
    store.setSetting('advanced', next);
    chart.setIndicators(effectiveIndicators());
  });
  on(root, 'input', '#ind-q', (_, el) => {
    const q = el.value.trim().toLowerCase();
    for (const b of root.querySelectorAll('#ind-pop [data-ind]')) b.hidden = !!q && !b.textContent.toLowerCase().includes(q);
  });
  on(root, 'click', '[data-ind]', (_, b) => {
    const onState = b.getAttribute('aria-checked') !== 'true';
    if (onState && b.dataset.ind !== 'volume' && effectiveIndicators().filter((k) => k !== 'volume').length >= MAX_INDICATORS) {
      return toast(`Puedes tener hasta ${MAX_INDICATORS} indicadores a la vez (además del volumen). Quita uno para añadir otro.`, 'info', 4000);
    }
    b.setAttribute('aria-checked', String(onState));
    chart.toggleIndicator(b.dataset.ind, onState);
    const list = new Set(store.settings().indicators);
    if (onState) list.add(b.dataset.ind); else list.delete(b.dataset.ind);
    store.setSetting('indicators', [...list]);
  });
  on(root, 'click', '[data-t]', (e, b) => actions[b.dataset.t]?.(b, e));
  on(root, 'click', '[data-side-tab]', (_, b) => showSideTab(b.dataset.sideTab));
  on(root, 'keydown', '[data-side-tab]', (e, b) => { // pestañas: flechas, Inicio y Fin
    const ids = SIDE_TABS.map(([id]) => id);
    const i = ids.indexOf(b.dataset.sideTab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    const id = ids[(next + ids.length) % ids.length];
    showSideTab(id);
    $(`#st-${id}`, root).focus();
  });
  on(root, 'click', '[data-watch-sym]', (_, b) => go(`/trade/${b.dataset.watchSym}`));
  store.on('watchlist', () => { if (!root.hidden && sideTab === 'watch') renderWatch(); });
  on(root, 'click', '[data-book-px]', (_, b) => {
    const input = $('#t-limit', root);
    if (!input) return toast('Elige «Límite» en el panel de órdenes para usar un precio del libro.', 'info', 3000);
    input.value = b.dataset.bookPx;
    updateTicketSummary();
    input.focus();
  });
  on(root, 'toggle', '#t-book-details', () => { if (pendingBook) renderBook(pendingBook); }, true); // toggle no burbujea: en captura
  on(root, 'change', '#ind-pop [data-period]', (_, el) => {
    const v = Math.round(Number(el.value));
    if (!(v >= 2 && v <= 400)) { el.value = store.settings()[el.dataset.period] ?? (el.dataset.period === 'maPeriod' ? 20 : 50); return; }
    store.setSetting(el.dataset.period, v);
    chart.setPeriods(el.dataset.period === 'maPeriod' ? { ma: v } : { ema: v });
  });
  on(root, 'click', '[data-seg="otype"] button', (_, b) => { orderType = b.dataset.value; renderTicket(); });
  on(root, 'click', '[data-t="tb-settings"]', (_, b) => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    $('.toolbar', root).classList.toggle('tools-open', open);
  });
  on(root, 'click', '[data-t="explain"]', (_, b) => {
    const p = store.positions().find((x) => String(x.id) === b.dataset.id);
    if (!p) return;
    const v = trading.valuePosition(p);
    ask(`Explícame esta operación: ${p.side === 'short' ? 'Short' : 'Long'} en ${p.symbol}, entrada a ${price(p.entryPrice, p.quote)}, precio actual ${price(feed.priceOf(p.symbol), p.quote)}, resultado ${money(v.pnlUsd, { signed: true })} (${pct(v.pnlPct)}). ¿Qué ha pasado y qué riesgos tiene? Sin darme recomendaciones de inversión.`);
  });
  on(root, 'click', '[data-t="explain-trade"]', (_, b) => {
    const t = store.trades().find((x) => String(x.id) === b.dataset.id);
    if (!t) return;
    ask(`Explícame esta operación cerrada: ${t.side === 'short' ? 'Short' : 'Long'} en ${t.symbol}, entrada ${price(t.entryPrice, t.quote)}, salida ${price(t.exitPrice, t.quote)}, resultado ${money(t.pnl, { signed: true })} (${pct(t.pnlPct)}). ¿Qué se puede aprender de ella? Sin recomendaciones de inversión.`);
  });
  on(root, 'click', '[data-seg="dir"] button', (_, b) => { direction = b.dataset.value; if (direction === 'short') orderType = 'market'; renderTicket(); });
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

/** «Practícalo» de Aprender: `#/trade/BTC:stop` abre Operar con el tipo de orden y un importe de ejemplo ya puestos. */
function applyPreset(preset) {
  if (!preset || !store.hasPractice()) return;
  side = 'buy'; direction = 'long';
  orderType = preset === 'limit' ? 'limit' : 'market';
  renderTicket();
  const px = feed.priceOf(asset.symbol);
  const set = (id, v) => { const el = $(`#${id}`, root); if (el && Number.isFinite(v) && v > 0) el.value = String(Math.round(v * 100) / 100); };
  set('t-amount', Math.max(10, Math.min(100, Math.floor(convert(store.cash(), 'USD', currency()) * 0.1))));
  if (px) {
    if (preset === 'limit') set('t-limit', px * 0.97);
    if ((preset === 'stop' || preset === 'bracket') && !serverMode()) set('t-sl', px * 0.95);
    if (preset === 'bracket' && !serverMode()) set('t-tp', px * 1.15);
  }
  updateTicketSummary();
}

export function show(rawParam) {
  const [param, preset] = String(rawParam ?? '').split(':');
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
  if (sideTab !== 'order') showSideTab(sideTab);
  clearInterval(dockTimer);
  dockTimer = setInterval(updateDockValues, 2000);
  if (preset) { applyPreset(preset); history.replaceState(null, '', `#/trade/${asset.symbol}`); }
}

export function hide() {
  unsubKline?.(); unsubKline = null;
  unsubDepth?.(); unsubDepth = null;
  clearInterval(dockTimer);
  clearTimeout(bookTimer); bookTimer = null;
  abort?.abort();
}

export function theme() { chart?.theme(); decorate(); }

export const currentAsset = () => asset;

/* ---------- Indicadores y análisis avanzado ---------- */
const MAX_INDICATORS = 3; // a la vez, sin contar el volumen: así el gráfico no se satura
const advancedOn = () => store.settings().advanced === true;
const indItem = (k, v) => html`<button type="button" role="menuitemcheckbox" data-ind="${k}" aria-checked="${String(store.settings().indicators.includes(k))}">${v.label}</button>`;
/** Los indicadores guardados que se dibujan: los avanzados solo con el interruptor encendido. */
const effectiveIndicators = () => store.settings().indicators.filter((k) => advancedOn() || !isAdvanced(k));

/* ---------- Cabecera del símbolo ---------- */
/** Móvil: la cabecera se queda en dos líneas y el resto va plegado en «Máx., mín., volumen y más». */
const headCompact = () => matchMedia('(max-width: 720px)').matches;

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
      <div class="gap-8">${liveChange(asset, 'span')} ${statusChip(asset)}${asset.type === 'stock' ? html` <span class="chip delay-chip" title="Las cotizaciones de bolsa pueden llegar con unos minutos de retraso (hasta unos 15 min en algunas bolsas).">con retraso</span>` : ''}</div>
    </div>
    <div class="sym-actions">
      <button class="icon-btn" data-t="star" aria-pressed="${starred}" aria-label="${starred ? 'Quitar de favoritos' : 'Añadir a favoritos'}" title="Favorito">${icon('star')}</button>
      <button class="icon-btn" data-t="alert" aria-label="Crear alerta de precio" title="Alerta de precio">${icon('bell-ring')}</button>
    </div>
    <details class="sym-more" id="t-more-info" ${headCompact() ? '' : 'open'}><summary>Máx., mín., volumen y más</summary>
      <div class="sym-stats" id="t-stats"></div>
      <p class="sym-div" id="t-div" hidden></p>
      <details class="sym-sent-fold" id="t-sent-fold" hidden><summary>Opinión de la comunidad</summary><div class="sym-sent" id="t-sent"></div></details>
    </details>`);
  renderStats();
  renderDividend();
  loadOpinion();
}

/* ---------- Opinión de la comunidad (voto alcista/bajista) ---------- */
let opinion = null; // reparto del activo mostrado
let voting = false;

async function loadOpinion() {
  const shown = asset;
  if (!shown) return;
  opinion = null;
  const s = await loadSentiment(shown.symbol);
  if (asset !== shown) return; // otro activo mientras llegaba la respuesta
  opinion = s;
  renderOpinion();
}

function renderOpinion() {
  const box = $('#t-sent', root);
  const fold = $('#t-sent-fold', root);
  if (!box || !fold) return;
  if (!opinion) { fold.hidden = true; return; } // sin dato (servidor caído): no se pinta nada
  fold.querySelector('summary').textContent = `Opinión de la comunidad · ${opinion.total ? votesLabel(opinion.total) : 'sin votos'}`;
  const sh = shares(opinion);
  const mine = opinion.myVote;
  const loggedIn = !!currentUser();
  const btn = (value, label, count) => h('button', {
    type: 'button', class: 'btn btn-sm btn-ghost', dataset: { sent: String(value) }, 'aria-pressed': String(mine === value), disabled: voting,
  }, `${label} · ${count}${sh ? ` (${value === 1 ? sh.bull : sh.bear} %)` : ''}`);
  const bar = h('div', { class: 'bar', role: 'img', 'aria-label': sh ? `${sh.bull} % alcistas, ${sh.bear} % bajistas` : 'Sin votos todavía' },
    sh ? [h('i', { class: 'up', dataset: { w: String(sh.bull) } }), h('i', { class: 'down', dataset: { w: String(sh.bear) } })] : null);
  put(box,
    h('div', { class: 'sym-sent-head' }, h('strong', {}, 'Opinión de la comunidad'), h('span', { class: 'muted' }, opinion.total ? votesLabel(opinion.total) : 'Aún nadie ha opinado')),
    bar,
    h('div', { class: 'sym-sent-row' },
      loggedIn ? [btn(1, 'Alcista', opinion.bullish), btn(-1, 'Bajista', opinion.bearish)]
        : [h('span', { class: 'muted' }, `${opinion.bullish} alcistas · ${opinion.bearish} bajistas`)],
      opinion.threadId && isVisible('community') ? h('a', { class: 'btn btn-sm btn-ghost', href: `#/community/thread:${opinion.threadId}` }, 'Ver el hilo del foro') : null),
    h('small', { class: 'muted' }, SENTIMENT_NOTE));
  if (!can('vote', loggedIn)) { // candado con nodos de texto, como el resto de la opinión
    box.append(h('div', { class: 'locked', role: 'note' }, svgIcon('lock', 'sm'),
      h('span', {}, h('strong', {}, 'Votar alcista o bajista'), ` · ${LOCKED_TEXT}`),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'data-action': 'register' }, 'Crear cuenta gratis'),
      h('button', { type: 'button', class: 'btn btn-sm btn-link', 'data-action': 'login' }, 'Iniciar sesión')));
  }
  applyVars(box);
  fold.hidden = false;
}

async function vote(value) {
  const shown = asset;
  if (voting || !opinion) return;
  voting = true; renderOpinion();
  try {
    const s = await castVote(shown.symbol, nextVote(opinion.myVote, value));
    if (asset === shown) opinion = s;
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    voting = false;
    if (asset === shown) renderOpinion();
  }
}

/** «Próximo dividendo: ex-dividendo el … · importe» en las acciones que lo tienen; sin dato no se pinta nada. */
async function renderDividend() {
  const shown = asset;
  if (shown.type !== 'stock') return;
  const d = (await upcomingDividends())[shown.symbol];
  const box = $('#t-div', root);
  if (!box || asset !== shown || !d) return; // otra acción, la vista se repintó o no hay dividendo próximo
  put(box, h('span', { class: 'sym-div-line' }, dividendLine(d)), ' ',
    h('small', { class: 'muted' }, `${EX_DATE_NOTE} ${SIMULATION_NOTE}`));
  box.hidden = false;
}

function renderStats() {
  const t = feed.tick(asset.symbol);
  const conv = t?.price ? approx(t.price, asset.quote) : '';
  render($('#t-stats', root), html`
    ${conv ? html`<div><span>En ${currency()}</span><strong>${conv.replace('≈ ', '')}</strong></div>` : ''}
    <div><span>Máx. 24 h</span><strong>${price(t?.high24h, asset.quote)}</strong></div>
    <div><span>Mín. 24 h</span><strong>${price(t?.low24h, asset.quote)}</strong></div>
    ${asset.type === 'crypto'
      ? html`<div title="Volumen de 24 h solo del par ${asset.symbol}/${asset.quote} en Binance, no de todo el mercado"><span>Vol. 24 h · Binance</span><strong>${t?.volume24h ? compact(t.volume24h, asset.quote) : '—'}</strong></div>`
      : html`<div title="Acciones negociadas en la última sesión"><span>Vol. 24 h</span><strong>${t?.volume24h ? compact(t.volume24h, 'acciones') : '—'}</strong></div>`}`);
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

/* ---------- Carga de velas: timeout, reintentos y caché local ---------- */
const CANDLE_TIMEOUT = 10_000;
const CANDLE_RETRIES = 2;
const CANDLE_CACHE = 'paperpulse_candles_cache';
const CANDLE_CACHE_KEYS = 6;   // pares activo:temporalidad guardados como mucho
const CANDLE_CACHE_LEN = 300;  // velas por par (las más recientes)
const CANDLE_CACHE_TTL = 24 * 3600_000;

function readCandleCache() {
  try { return JSON.parse(localStorage.getItem(CANDLE_CACHE) || '{}') || {}; } catch { return {}; }
}
function cachedCandles(key) {
  const hit = readCandleCache()[key];
  return hit && Array.isArray(hit.list) && hit.list.length && Date.now() - hit.at < CANDLE_CACHE_TTL ? hit.list : null;
}
function saveCandles(key, list) {
  const all = readCandleCache();
  all[key] = { at: Date.now(), list: list.slice(-CANDLE_CACHE_LEN) };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, CANDLE_CACHE_KEYS);
  try { localStorage.setItem(CANDLE_CACHE, JSON.stringify(Object.fromEntries(keep))); } catch { /* cuota llena: no pasa nada */ }
}

/** Pide las velas con un tiempo máximo por intento y hasta CANDLE_RETRIES reintentos (1 s y 2 s de espera). */
async function candlesWithRetry(a, iv, signal) {
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, CANDLE_TIMEOUT);
    try {
      return await candles(a, iv, { signal: ctl.signal });
    } catch (err) {
      if (signal.aborted || attempt >= CANDLE_RETRIES) throw err;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  }
}

async function load() {
  const id = ++loadId;
  abort?.abort();
  abort = new AbortController();
  unsubKline?.(); unsubKline = null;
  loadingMore = null;
  const msg = $('#t-msg', root);
  const iv = interval();
  const cacheKey = `${asset.symbol}:${iv}`;
  const label = `${displayPair(asset)} · ${INTERVALS[iv].label}`;
  const intraday = INTERVALS[iv].secs < 86400;
  // Mientras llegan las velas: las últimas guardadas en este navegador o, si no hay, un esqueleto animado
  const saved = cachedCandles(cacheKey);
  if (saved) {
    msg.hidden = true;
    chart.setType(store.settings().chartType);
    chart.setData(saved, { label, symbol: asset.symbol, quote: asset.quote, intraday });
  } else {
    render(msg, html`<div class="sk-block skeleton" aria-hidden="true"></div><div class="sk-wrap" role="status"><span class="sr-only">Cargando ${displayPair(asset)}…</span></div>`);
    msg.hidden = false;
  }
  let page;
  try {
    page = await candlesWithRetry(asset, iv, abort.signal);
  } catch (err) {
    if (err.name === 'AbortError' && abort.signal.aborted) return;
    if (id !== loadId) return;
    if (saved) { toast(`No se pudo actualizar ${displayPair(asset)}: se muestran los últimos datos guardados.`, 'error'); return; }
    render(msg, html`<div class="empty" role="alert">${icon('wifi-off')}<strong>No se pudo cargar el gráfico</strong>
      <p>El servidor de datos no responde. Comprueba la conexión e inténtalo de nuevo.</p>
      <button class="btn btn-primary btn-sm" data-t="retry">${icon('refresh-cw', 'sm')} Reintentar</button></div>`);
    msg.hidden = false;
    return;
  }
  if (id !== loadId) return;
  const list = page.candles;
  hasMore = page.hasMore;
  if (list.length) saveCandles(cacheKey, list);
  if (!list.length) {
    render(msg, empty('chart-candlestick', 'Sin datos históricos', `No hay velas disponibles para ${displayPair(asset)} en ${INTERVALS[iv].name}. Prueba otra temporalidad o vuelve en unos minutos.`));
    renderHistInfo();
    return;
  }
  msg.hidden = true;
  chart.setType(store.settings().chartType);
  chart.setData(list, { label, symbol: asset.symbol, quote: asset.quote, intraday });
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
    lines.push({ price: p.entryPrice, color: c.text, title: `${p.side === 'short' ? 'Short' : 'Long'} ${units(p.amount)}`, lineStyle: 0 });
    if (p.stopLoss) lines.push({ price: p.stopLoss, color: c.down, title: 'SL', lineStyle: 2 });
    if (p.takeProfit) lines.push({ price: p.takeProfit, color: c.up, title: 'TP', lineStyle: 2 });
    if (p.side === 'short') lines.push({ price: trading.liquidationPrice(p), color: c.down, title: 'Liquidación', lineStyle: 1 });
  }
  for (const o of store.orders().filter((x) => x.symbol === asset.symbol)) {
    lines.push({ price: o.limitPrice, color: o.side === 'sell' ? c.down : c.up, title: o.side ? orderLabel(o) : 'Límite', lineStyle: 2 });
    if (o.stopPrice) lines.push({ price: o.stopPrice, color: c.muted, title: 'Stop', lineStyle: 2 });
  }
  for (const a of store.alerts().filter((x) => x.symbol === asset.symbol && !x.triggered)) {
    lines.push({ price: a.target, color: c.muted, title: 'Alerta', lineStyle: 1 });
  }
  chart.setLines(lines);
  const marks = [];
  for (const t of store.trades().filter((x) => x.symbol === asset.symbol).slice(0, 30)) {
    const short = t.side === 'short';
    if (t.openedAt) marks.push({ time: t.openedAt / 1000, position: short ? 'aboveBar' : 'belowBar', shape: short ? 'arrowDown' : 'arrowUp', color: c.accent, text: short ? 'Apertura Short' : 'Compra' });
    marks.push({ time: Date.parse(t.date) / 1000, position: short ? 'belowBar' : 'aboveBar', shape: short ? 'arrowUp' : 'arrowDown', color: t.pnl >= 0 ? c.up : c.down, text: `Cierre ${money(t.pnl, { signed: true })}` });
  }
  chart.setMarkers(marks);
}

/** Etiqueta de dirección: Long en verde, Short en rojo (las posiciones sin dirección son Long). */
const sideChip = (p) => (p.side === 'short' ? html`<span class="chip down">Short</span>` : html`<span class="chip up">Long</span>`);

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
  const short = direction === 'short';
  render(box, html`
    <div class="side-tabs" role="group" aria-label="Lado de la orden">
      <button type="button" data-t="side" data-side="buy" aria-pressed="${side === 'buy'}">Abrir</button>
      <button type="button" data-t="side" data-side="sell" aria-pressed="${side === 'sell'}">Cerrar</button>
    </div>
    ${side === 'buy' ? html`
      <div class="seg seg-dir" role="group" data-seg="dir">
        <button type="button" data-value="long" aria-pressed="${direction === 'long'}">Long</button>
        <button type="button" data-value="short" aria-pressed="${direction === 'short'}">Short</button></div>
      <p class="hint">${short ? 'Ganas si el precio baja. Se aparta el importe entero como garantía (tu pérdida máxima); se liquida si el precio llega al doble.' : 'Ganas si el precio sube.'}</p>
      ${short ? '' : html`${seg('otype', orderTypes(), currentType())}
      ${orderHint()}`}
      ${orderType === 'stop-limit' ? html`<div class="field"><label for="t-stop">Precio de activación (${asset.quote})</label>
        <div class="input-group"><input id="t-stop" inputmode="decimal" type="number" step="any" min="0" placeholder="${num(feed.priceOf(asset.symbol))}"><span>${asset.quote}</span></div></div>` : ''}
      ${orderType !== 'market' ? levelField() : ''}
      <div class="field"><label for="t-amount">Importe a invertir</label>
        <div class="input-group"><input id="t-amount" inputmode="decimal" type="number" step="any" min="0" placeholder="0,00"><span>${cur}</span></div></div>
      <div class="pct-row">${[25, 50, 75, 100].map((p) => html`<button type="button" data-t="pct" data-pct="${p}">${p === 100 ? 'Máx' : `${p}%`}</button>`)}</div>
      ${orderType === 'market' ? html`<div class="exit-row">
        <div class="field"><label for="t-sl">Stop Loss <span class="muted">(opcional)</span></label>
          <div class="input-group"><input id="t-sl" inputmode="decimal" type="number" step="any" min="0" placeholder="${short ? 'Por encima' : 'Por debajo'}"><span>${asset.quote}</span></div></div>
        <div class="field"><label for="t-tp">Take Profit <span class="muted">(opcional)</span></label>
          <div class="input-group"><input id="t-tp" inputmode="decimal" type="number" step="any" min="0" placeholder="${short ? 'Por debajo' : 'Por encima'}"><span>${asset.quote}</span></div></div>
      </div>
      ${serverMode() ? html`<p class="hint exit-note">${icon('info', 'sm')} ${EXITS_NOTE}</p>` : ''}` : ''}
      <dl class="summary" id="t-summary"></dl>
      <button class="btn ${short ? 'btn-down' : 'btn-primary'} btn-lg btn-block" data-t="submit">${short ? `Abrir Short en ${asset.symbol}` : orderType === 'market' ? `Comprar ${asset.symbol} (Long)` : `Colocar orden ${orderType === 'limit' ? 'límite' : 'stop'}`}</button>
      <p class="hint edu-note">Simulador educativo, no es asesoramiento.</p>
      ${short ? html`<p class="hint short-note">${icon('triangle-alert', 'sm')} ${SHORT_NOTE}</p>` : ''}`
    : pos ? html`
      ${serverMode() && pos.side !== 'short' ? html`${seg('otype', orderTypes(), currentType())}${orderHint()}` : ''}
      ${serverMode() && pos.side !== 'short' && orderType !== 'market' ? levelField() : ''}
      <div class="summary"><div><span>Tienes</span><strong>${sideChip(pos)} ${units(pos.amount, pos.symbol)}</strong></div>
        <div><span>Precio medio</span><strong>${price(pos.entryPrice, pos.quote)}</strong></div></div>
      <div class="field"><label for="t-units">Cantidad a cerrar</label>
        <div class="input-group"><input id="t-units" inputmode="decimal" type="number" step="any" min="0" max="${freeUnits(pos)}" value="${freeUnits(pos)}"><span>${asset.symbol}</span></div></div>
      <div class="pct-row">${[25, 50, 75, 100].map((p) => html`<button type="button" data-t="pct" data-pct="${p}">${p === 100 ? 'Todo' : `${p}%`}</button>`)}</div>
      <dl class="summary" id="t-summary"></dl>
      <button class="btn btn-primary btn-lg btn-block" data-t="submit">${serverMode() && pos.side !== 'short' && orderType !== 'market' ? `Colocar venta ${orderType === 'limit' ? 'límite' : 'stop'}` : `Cerrar ${pos.side === 'short' ? 'Short' : 'Long'} de ${asset.symbol}`}</button>
      <p class="hint edu-note">Simulador educativo, no es asesoramiento.</p>`
    : empty('wallet', `No tienes posición en ${asset.symbol}`, 'Abre una posición Long o Short para poder cerrarla aquí.')}
    <p class="hint">Disponible: <span class="money">${money(store.cash())}</span></p>
    ${serverMode() ? '' : html`<p class="hint demo-note">${icon('info', 'sm')} Demo: se guarda solo en este navegador. Si borras los datos del navegador, se pierde.</p>`}`);
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
    const equityUsd = trading.portfolio().equityUsd;
    const share = amount && equityUsd > 0 ? (convert(amount, currency(), 'USD') / equityUsd) * 100 : null;
    render(box, html`
      <div><dt>${direction === 'short' ? 'Tamaño del corto' : 'Recibirás aprox.'}</dt><dd>${qty ? units(qty, asset.symbol) : '—'}</dd></div>
      <div><dt>${orderType === 'market' ? 'Precio de mercado' : levelLabel()}</dt><dd>${price(execPx, asset.quote)}</dd></div>
      ${direction === 'short' ? html`<div><dt>Liquidación a</dt><dd>${execPx ? price(execPx * 2, asset.quote) : '—'}</dd></div>` : ''}
      <div><dt>Comisión</dt><dd>${feeText(amount ? convert(amount, currency(), 'USD') : 0)}</dd></div>
      ${share != null ? html`<div><dt>% de tu cuenta</dt><dd class="${share > 25 ? 'delta down' : ''}">${share.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</dd></div>` : ''}
      ${share > 25 ? html`<div class="warn-note"><dd>${icon('triangle-alert', 'sm')} Supera el 25 % de tu cuenta: una sola posición concentra mucho riesgo.</dd></div>` : ''}`);
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
    if (sideTab !== 'order') showSideTab('order');
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
  alert() { import('../ui/dialogs.js').then((m) => m.alertsDialog(asset)); },
  fit() { chart.fit(); },
  sideTab(b) { showSideTab(b.dataset.sideTab); },
  log(b) {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    store.setSetting('logScale', on);
    chart.setLogScale(on);
  },
  retry() { load(); },
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
  const short = direction === 'short';
  const exits = orderType === 'market' ? { stopLoss: readNumber('t-sl'), takeProfit: readNumber('t-tp') } : {};
  try { if (orderType === 'market') trading.validateExits(short ? 'short' : 'long', px, exits); } catch (err) { return toast(err.message, 'warning'); }
  const exitText = [exits.stopLoss && `Stop Loss ${price(exits.stopLoss, asset.quote)}`, exits.takeProfit && `Take Profit ${price(exits.takeProfit, asset.quote)}`].filter(Boolean).join(' · ');

  if (short) {
    const okShort = await confirmDialog({
      title: `Abrir Short en ${asset.symbol}`,
      body: `${units(qty, asset.symbol)} a ${price(px, asset.quote)}. Ganas si baja y pierdes si sube. Se aparta ${money(amount, { from: currency() })} como garantía: es tu pérdida máxima, y la posición se liquida sola si el precio llega a ${price(px * 2, asset.quote)}.${exitText ? ` ${exitText}.` : ''} ${serverMode() ? `Comisión estimada ${feeText(convert(amount, currency(), 'USD'))} al abrir y otra al cerrar. El precio final lo decide el servidor.` : 'Operación simulada sin comisiones.'} ${SHORT_NOTE}`,
      confirm: 'Abrir Short',
    });
    if (!okShort) return;
    try {
      const r = await trading.shortMarket(asset, qty, exits);
      toast(`Short abierto: ${units(r.amount, asset.symbol)} a ${price(r.price, asset.quote)}`, 'success');
      input.value = '';
      updateTicketSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
    return;
  }

  const ok = await confirmDialog({
    title: orderType === 'market' ? `Comprar ${asset.symbol}` : `Orden ${{ limit: 'límite', stop: 'stop', 'stop-limit': 'stop-limit' }[orderType]} de ${asset.symbol}`,
    body: `${units(qty, asset.symbol)} por ${money(amount, { from: currency() })} a ${price(px, asset.quote)}${stopPrice ? `, se activa en ${price(stopPrice, asset.quote)}` : ''}. `
      + (serverMode()
        ? `Comisión estimada ${feeText(convert(amount, currency(), 'USD'))}. El precio final lo decide el servidor con la cotización real${orderType === 'market' ? ', con un pequeño deslizamiento' : ''}.`
        : `Operación simulada sin comisiones.`)
      + (exitText ? ` ${exitText}.` : ''),
    confirm: orderType === 'market' ? 'Comprar' : 'Colocar orden',
  });
  if (!ok) return;
  try {
    if (orderType === 'market') {
      const r = await trading.buyMarket(asset, qty, exits);
      toast(`Has comprado ${units(r.amount, asset.symbol)} a ${price(r.price, asset.quote)}`, 'success');
      afterBuy();
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
  if (!serverMode() || pos.side === 'short' || currentType() === 'market') return closePositionDialog(pos.id, Math.min(qty, pos.amount));

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

/* ---------- Columna derecha: Orden / Favoritos / Info ---------- */
const SIDE_TABS = [['order', 'Orden'], ['watch', 'Favoritos'], ['info', 'Info']];
let sideTab = 'order';

function showSideTab(id) {
  sideTab = id;
  for (const [t] of SIDE_TABS) {
    const tab = $(`#st-${t}`, root), panel = $(`#sp-${t}`, root);
    tab.setAttribute('aria-selected', String(t === id));
    tab.tabIndex = t === id ? 0 : -1;
    panel.hidden = t !== id;
  }
  if (id === 'watch') renderWatch();
  if (id === 'info') renderInfo();
}

/** Favoritos agrupados en Cripto y Acciones: símbolo, último precio y cambio. La fila del activo abierto, resaltada. */
function renderWatch() {
  const box = $('#t-watch', root);
  const list = store.watchlist().map((sym) => findAsset(sym)).filter(Boolean);
  if (!list.length) return render(box, empty('star', 'Sin favoritos', 'Pulsa la estrella junto al precio para seguir un activo aquí.'));
  const group = (title, items) => (items.length ? html`<div class="wl-group"><div class="wl-title">${title}</div>
    <div class="wl-head"><span>Símbolo</span><span>Última</span><span>Cambio</span></div>
    ${items.map((a) => html`<button type="button" class="wl-row" data-watch-sym="${a.symbol}" aria-current="${a.symbol === asset.symbol ? 'true' : 'false'}">
      <span class="wl-sym">${assetIcon(a)}<span><strong>${a.symbol}</strong><small>${a.name}</small></span></span>
      <span class="wl-px" data-px="${a.symbol}" data-q="${a.quote}">${price(feed.priceOf(a.symbol), a.quote)}</span>
      ${liveChange(a, 'span')}</button>`)}</div>` : '');
  render(box, html`${group('Cripto', list.filter((a) => a.type === 'crypto'))}${group('Acciones e índices', list.filter((a) => a.type !== 'crypto'))}`);
}

const dailyVolume = new Map(); // símbolo → { today, avg } (velas diarias, una petición por activo y sesión)
/** Info: nombre y mercado, precio grande, volumen del día frente al medio de 20 días y la última noticia del activo. */
async function renderInfo() {
  const box = $('#t-info', root);
  const shown = asset;
  const t = feed.tick(shown.symbol);
  const market = shown.type === 'crypto' ? 'Cripto · Binance · 24/7' : shown.market === 'es' ? 'Bolsa de Madrid' : 'Bolsa de EE. UU.';
  render(box, html`<div class="info-head"><strong>${shown.name}</strong><span class="chip">${shown.symbol}</span></div>
    <p class="muted info-market">${market}</p>
    <div class="info-price"><span data-px="${shown.symbol}" data-q="${shown.quote}">${price(t?.price, shown.quote)}</span> ${liveChange(shown, 'span')}</div>
    <div class="info-block" id="t-info-vol"><div class="info-label">Volumen del día frente al medio (20 días)</div><div class="skeleton sk-line"></div></div>
    <div class="info-block" id="t-info-news"><div class="info-label">Última noticia</div><div class="skeleton sk-line"></div></div>`);
  // Volumen: hoy (vela diaria en curso) frente a la media de las 20 anteriores
  (async () => {
    let v = dailyVolume.get(shown.symbol);
    if (!v) {
      try {
        const page = await candles(shown, '1d', { limit: 21 });
        const list = page.candles;
        if (list.length > 1) {
          const past = list.slice(0, -1).slice(-20);
          v = { today: list.at(-1).volume, avg: past.reduce((n, c) => n + c.volume, 0) / past.length };
          dailyVolume.set(shown.symbol, v);
        }
      } catch { /* sin datos: se dice abajo */ }
    }
    const el = $('#t-info-vol', root);
    if (!el || asset !== shown) return;
    if (!v || !(v.avg > 0)) return render(el, html`<div class="info-label">Volumen del día frente al medio (20 días)</div><p class="muted">Sin datos de volumen.</p>`);
    const ratio = v.today / v.avg;
    const unit = shown.type === 'crypto' ? shown.symbol : 'acciones';
    render(el, html`<div class="info-label">Volumen del día frente al medio (20 días)</div>
      <div class="vol-bar" role="img" aria-label="${pct(ratio * 100, { signed: false, decimals: 0 })} del volumen medio"><i data-w="${Math.min(100, ratio * 50).toFixed(1)}"></i><b class="vol-mark"></b></div>
      <p class="info-vol"><span>${compact(v.today, unit)}</span><span class="muted">media ${compact(v.avg, unit)} · ${pct(ratio * 100, { signed: false, decimals: 0 })}</span></p>`);
    applyVars(el);
  })();
  // Última noticia que nombra el activo (titulares del backend; el enlace abre el medio original)
  (async () => {
    let item = null;
    try {
      const words = [shown.name, shown.symbol].map((w) => w.toLowerCase());
      item = (await news()).find((n) => words.some((w) => n.title.toLowerCase().includes(w)));
    } catch { /* sin noticias */ }
    const el = $('#t-info-news', root);
    if (!el || asset !== shown) return;
    const url = item ? safeUrl(item.url) : null;
    render(el, html`<div class="info-label">Última noticia</div>${item
      ? (url ? html`<a class="info-news" href="${url}" target="_blank" rel="noopener noreferrer"><strong>${item.title}</strong><small class="muted">${item.source} · ${timeAgo(item.date)}</small></a>`
        : html`<div class="info-news"><strong>${item.title}</strong><small class="muted">${item.source} · ${timeAgo(item.date)}</small></div>`)
      : html`<p class="muted">Sin noticias recientes de ${shown.name}.</p>`}`);
  })();
}

/* ---------- Libro de órdenes (compacto) ---------- */
const BOOK_LEVELS = 5;      // niveles por lado
const BOOK_THROTTLE = 500;  // como mucho 2 repintados por segundo
const PRESSURE_NOTE = 'Presión compradora/vendedora: cómo se reparte el volumen de las órdenes visibles del libro entre compra y venta. Describe este momento; no predice el precio.';


function connectBook() {
  unsubDepth?.(); unsubDepth = null;
  clearTimeout(bookTimer); bookTimer = null;
  const card = $('#t-book-card', root);
  // Solo hay libro en vivo para cripto: en acciones e índices el bloque no aparece
  card.hidden = asset.type !== 'crypto';
  if (card.hidden) return;
  $('#t-book-sub', root).textContent = 'Binance · en vivo';
  const details = $('#t-book-details', root);
  if (!details.dataset.init) { details.open = false; details.dataset.init = '1'; } // plegado por defecto: la barra de presión ya resume
  render($('#t-pressure', root), html`<div class="pressure-bar skeleton" aria-hidden="true"></div><p class="pressure-text muted">Conectando con el libro de Binance…</p>`);
  render($('#t-book', root), html`<div class="sk-rows" role="status">${Array.from({ length: 4 }, () => html`<span class="skeleton sk-line"></span>`)}</div>`);
  unsubDepth = feed.subscribe(`${(asset.pair ?? `${asset.symbol}USDT`).toLowerCase()}@depth20@100ms`, (d) => {
    pendingBook = d;
    bookTimer ??= setTimeout(() => { bookTimer = null; renderBook(pendingBook); }, BOOK_THROTTLE);
  });
}

function renderBook(d) {
  if (!d?.bids?.length || !d?.asks?.length || asset.type !== 'crypto') return;
  const all = (rows) => rows.map(([p, q]) => [+p, +q]).filter(([p, q]) => p > 0 && q > 0);
  const bidsAll = all(d.bids), asksAll = all(d.asks);
  if (!bidsAll.length || !asksAll.length) return;

  // Presión: con los 20 niveles que llegan de Binance
  const pr = bookPressure(bidsAll, asksAll);
  const pBox = $('#t-pressure', root);
  pBox.innerHTML = String(html`
    <div class="pressure-bar" role="img" aria-label="${pr.buyPct} % compra, ${pr.sellPct} % venta"><i data-w="${pr.buyPct}"></i></div>
    <p class="pressure-text"><span class="up">${pr.buyPct} % compra</span> · <span class="down">${pr.sellPct} % venta</span>
      <strong>${pr.label}</strong>${pr.walls ? html`<small class="muted pressure-note">Sin contar ${pr.walls === 1 ? 'un muro' : `${pr.walls} muros`}</small>` : ''}</p>`);
  applyVars(pBox);

  const box = $('#t-book', root);
  const details = $('#t-book-details', root);
  if (!details.open) return; // plegado: no se pintan los niveles
  const asks = asksAll.slice(0, BOOK_LEVELS), bids = bidsAll.slice(0, BOOK_LEVELS);
  const A = bookLevels(asks), B = bookLevels(bids);
  const row = (cls, r) => html`<button type="button" class="book-row ${cls}${r.wall ? ' wall' : ''}" data-book-px="${r.p}" data-w="${(r.depth * 100).toFixed(1)}"
      title="${r.wall ? 'Muro: más del 30 % del volumen visible de este lado. ' : ''}Pulsa para usar este precio en una orden límite">
      <span>${num(r.p)}</span><span>${compact(r.q)}</span><span>${pct(r.share * 100, { signed: false, decimals: 0 })}${r.wall ? html` <b class="wall-tag">Muro</b>` : ''}</span></button>`;
  const bestAsk = asks[0][0], bestBid = bids[0][0];
  const spread = bestAsk - bestBid;
  const last = feed.priceOf(asset.symbol) ?? (bestAsk + bestBid) / 2;
  box.innerHTML = String(html`
    <div class="book-head"><span>Precio (${asset.quote})</span><span>Cantidad (${asset.symbol})</span><span>% del lado</span></div>
    ${[...A].reverse().map((r) => row('ask', r))}
    <div class="book-mid"><strong class="num ${trendClass(feed.tick(asset.symbol)?.change24h)}">${num(last)}</strong>
      <span class="muted">Spread ${num(spread)} · ${pct((spread / bestAsk) * 100, { signed: false, decimals: 3 })}</span></div>
    ${B.map((r) => row('bid', r))}`);
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
    return render(box, empty('wallet', 'Aún no tienes cuenta de práctica', 'Elige tu saldo virtual y tus posiciones y órdenes aparecerán aquí.'));
  }
  if (dockTab === 'positions') {
    if (!positions.length) return render(box, empty('layers', 'Tu cartera está en blanco', 'Usa el panel de órdenes para hacer tu primera compra: es dinero virtual, puedes equivocarte tranquilo.'));
    // Compacta: dirección junto al activo y entrada/actual en una celda. Cantidad, SL/TP y valor (col-x) solo si cabe
    // (container query en .dock): así P&L y Cerrar nunca quedan fuera de la vista.
    render(box, html`<table class="table pos-table"><thead><tr><th>Activo</th><th class="r col-px">Entrada · Actual</th><th class="r col-x">Cantidad</th><th class="r col-x">SL / TP</th><th class="r col-x">Valor</th><th class="r">P&amp;L</th><th><span class="sr-only">Acciones</span></th></tr></thead>
      <tbody>${positions.map((p) => html`<tr data-href="/trade/${p.symbol}">
        <td><div class="pos-asset">${assetCell(p, displayPair(p))}${sideChip(p)}</div></td>
        <td class="r col-px"><div class="pos-px"><span class="muted">${price(p.entryPrice, p.quote)}</span><span data-px="${p.symbol}" data-q="${p.quote}">${price(feed.priceOf(p.symbol), p.quote)}</span></div></td>
        <td class="r col-x">${units(p.amount)}</td>
        <td class="r col-x muted">${p.stopLoss ? price(p.stopLoss, p.quote) : '—'} / ${p.takeProfit ? price(p.takeProfit, p.quote) : '—'}</td>
        <td class="r money col-x" data-pv="${p.id}"></td>
        <td class="r money" data-pp="${p.id}"></td>
        <td class="r"><div class="pos-actions"><button class="btn btn-ghost btn-sm" data-t="explain" data-id="${p.id}" aria-label="Explícame esta posición" title="Pregunta al asistente por esta posición">${icon('sparkles', 'sm')}<span class="explain-label">Explícame</span></button> <button class="btn btn-ghost btn-sm" data-t="close" data-id="${p.id}">Cerrar</button></div></td></tr>`)}</tbody></table>`);
    updateDockValues();
  } else if (dockTab === 'orders') {
    if (!orders.length) return render(box, empty('clock', 'Nada en la cola', 'Las órdenes límite y stop esperan aquí, con su saldo reservado, hasta ejecutarse o cancelarse.'));
    render(box, html`<table class="table"><thead><tr><th>Activo</th><th>Tipo</th><th class="r">Cantidad</th><th class="r">Precio</th><th class="r">Stop</th><th class="r">Reservado</th><th>Creada</th><th></th></tr></thead>
      <tbody>${orders.map((o) => html`<tr data-href="/trade/${o.symbol}">
        <td><strong>${o.symbol}</strong></td><td><span class="chip">${orderLabel(o)}</span></td>
        <td class="r">${units(o.amount)}</td><td class="r">${price(o.limitPrice, o.quote)}</td><td class="r">${o.stopPrice ? price(o.stopPrice, o.quote) : '—'}</td>
        <td class="r money">${money(o.reservedUsd)}</td><td class="muted">${timeAgo(o.createdAt)}</td>
        <td class="r"><button class="btn btn-ghost btn-sm" data-t="cancel" data-id="${o.id}">Cancelar</button></td></tr>`)}</tbody></table>`);
  } else {
    const trades = store.trades().slice(0, 25);
    if (!trades.length) return render(box, empty('history', 'Tu historial empieza con tu primera venta', 'Cuando cierres una posición aparecerá aquí con su resultado.'));
    render(box, html`<table class="table"><thead><tr><th>Fecha</th><th>Activo</th><th class="r">Cantidad</th><th class="r">Entrada</th><th class="r">Salida</th><th class="r">Resultado</th><th></th></tr></thead>
      <tbody>${trades.map((t) => html`<tr data-href="/trade/${t.symbol}">
        <td class="muted">${new Date(t.date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td><td><strong>${t.symbol}</strong> ${sideChip(t)}${t.closeReason ? html` <span class="chip warn" title="Cierre automático del servidor">${t.closeReason}</span>` : ''}</td>
        <td class="r">${units(t.amount)}</td><td class="r">${price(t.entryPrice, t.quote)}</td><td class="r">${price(t.exitPrice, t.quote)}</td>
        <td class="r money delta ${trendClass(t.pnl)}">${money(t.pnl, { signed: true })} · ${pct(t.pnlPct)}</td><td class="r"><button class="btn btn-ghost btn-sm" data-t="explain-trade" data-id="${t.id}" title="Pregunta al asistente por esta operación">${icon('sparkles', 'sm')}Explícame</button> ${raw(isVisible('community') ? shareButton(t) : '')}</td></tr>`)}</tbody></table>`);
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

