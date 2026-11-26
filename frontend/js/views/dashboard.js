// Vista Resumen: patrimonio, KPIs, sesiones de bolsa, favoritos, movimientos, amplitud y cartera.
import * as store from '../lib/store.js';
import { tick } from '../lib/feed.js';
import { ASSETS, CRYPTO, findAsset } from '../lib/catalog.js';
import { html, icon, render, on, $ } from '../lib/dom.js';
import { money, price, pct, units, num, trendClass, timeAgo } from '../lib/format.js';
import { portfolio, valuePosition } from '../lib/trading.js';
import { createEquityChart, createMiniChart, createAreaChart, sparkline } from '../lib/charts.js';
import { currentUser, onAuth, ready as authReady } from '../lib/auth.js';
import * as notifs from '../lib/notifications.js';
import * as community from '../lib/community.js';
import { h, mount as put } from '../lib/el.js';
import { cryptoMarkets, stockSpark, news, savedNews, safeUrl, candles, savedCryptoMarkets, savedStockSparks } from '../lib/marketdata.js';
import { assetIcon, changeChip, empty, seg, pressSeg, liveChange, moneyHtml, lockedNote } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { mountCard } from '../ui/retention-card.js';
import { whatIfParts, startedAmount } from '../lib/starting-balance.js';
import { goalsCard } from '../ui/goals-card.js';
import { isVisible } from '../lib/sections.js';
import { can } from '../lib/capabilities.js';
import { countTo } from '../lib/motion.js';
import * as account from '../lib/account.js';
import { sp500Since, comparison, sinceLabel } from '../lib/benchmark.js';
import { dashboardFocus, orderLabel } from '../lib/dashboard-focus.js';
import { lessonsRead, nextLesson, firstSteps, moversList, tickerFor, heatClass } from '../lib/home.js';
import { closePositionDialog } from '../ui/dialogs.js';
import { holdingRows, holdingTotals, allocation, ALLOCATION_TABS } from '../lib/holdings.js';
import { upcomingDividends, forPositions, exDateLabel, amountText, daysUntil, EX_DATE_NOTE, SIMULATION_NOTE } from '../lib/dividends.js';

const RANGES = [['1D', '1D'], ['1W', '1S'], ['1M', '1M'], ['3M', '3M'], ['ALL', 'Todo']];
const RANGE_SECONDS = { '1D': 86400, '1W': 604800, '1M': 2592000, '3M': 7776000, ALL: Infinity };
const SESSIONS = {
  us: { tz: 'America/New_York', open: [9, 30], close: [16, 0], name: 'Nueva York', sub: 'NYSE · Nasdaq' },
  es: { tz: 'Europe/Madrid', open: [9, 0], close: [17, 30], name: 'Madrid', sub: 'BME · IBEX 35' },
  lon: { tz: 'Europe/London', open: [8, 0], close: [16, 30], name: 'Londres', sub: 'LSE' },
  fra: { tz: 'Europe/Berlin', open: [9, 0], close: [17, 30], name: 'Fráncfort', sub: 'Xetra' },
  tyo: { tz: 'Asia/Tokyo', open: [9, 0], close: [15, 30], name: 'Tokio', sub: 'TSE' },
};

let root, equity, range = '1M', movers = 'gainers', moversKind = 'all', heatKind = 'es', allocBy = 'asset', timer;
let minis = []; // minigráficos de las tarjetas de cotización
let alias = null; // alias del perfil de comunidad para el saludo (null = aún no se sabe o no hay perfil)
let lastEquity; // último patrimonio pintado, para animar la cifra desde ahí
let pulseData = null; // última respuesta de /api/community/pulse (para repintar sin parpadeo)

/** Precio en vivo que parpadea al cambiar (data-flash); vacío = esqueleto hasta la primera cotización. */
const livePrice = (a) => html`<span class="num" data-px="${a.symbol}" data-q="${a.quote}" data-flash>${tick(a.symbol)?.price ? price(tick(a.symbol).price, a.quote) : ''}</span>`;
const skeletonRows = (n, caption) => html`<div class="sk-rows" role="status">${Array.from({ length: n }, () => html`<div class="sk-row"><span class="skeleton"></span><span class="skeleton sk-line w-60"></span><span class="skeleton sk-line"></span></div>`)}
  ${caption ? html`<span class="sk-caption">${caption}</span>` : html`<span class="sr-only">Cargando…</span>`}</div>`;

export const title = 'Resumen';

export function mount(el) {
  root = el;
  on(root, 'click', '[data-seg="range"] button', (_, b) => { range = b.dataset.value; pressSeg(root, 'range', range); drawEquity(); });
  on(root, 'click', '[data-seg="movers"] button', (_, b) => { movers = b.dataset.value; pressSeg(root, 'movers', movers); renderMovers(); });
  on(root, 'click', '[data-seg="mkind"] button', (_, b) => { moversKind = b.dataset.value; pressSeg(root, 'mkind', moversKind); renderMovers(); });
  on(root, 'click', '[data-seg="heat"] button', (_, b) => { heatKind = b.dataset.value; pressSeg(root, 'heat', heatKind); renderHeat(); });
  on(root, 'click', '[data-close-pos]', (e, b) => { e.stopPropagation(); closePositionDialog(b.dataset.closePos); });
  on(root, 'keydown', 'tr[data-asset]', (e, tr) => { if (e.key === 'Enter') go(`/trade/${tr.dataset.asset}`); });
  // Tarjeta destacada: BTC o IBEX 35; el precio grande y el último punto del gráfico siguen la cotización en vivo
  on(root, 'click', '[data-seg="feat"] button', (_, b) => {
    if (b.dataset.value === featSym) return;
    featSym = b.dataset.value;
    const card = $('.home-feature', root);
    if (!card) return;
    card.outerHTML = String(featureCard());
    loadFeature();
  });
  // Cifras en vivo: el feed agrupa los precios cada 500 ms, así que esto pinta como mucho 2 veces por segundo
  store.on('prices', (symbols) => {
    if (root.hidden) return;
    if ($('#d-movers .skeleton', root)) renderMovers();
    if ($('#d-heat-card', root)?.hidden) renderHeat(); // aparece en cuanto hay variaciones (sin datos, no se muestra)
    for (const el of root.querySelectorAll('[data-num-px]')) {
      if (!symbols.has(el.dataset.numPx)) continue;
      const px = tick(el.dataset.numPx)?.price;
      if (px) el.textContent = num(px);
    }
    if (store.hasPractice()) { renderSummary(); renderPositionsLive(); }
    if (!symbols.has(featSym)) return;
    const px = tick(featSym)?.price;
    const el = $('#d-feat-value', root);
    if (el && px) el.textContent = num(px);
    feat?.update(px);
  });
  on(root, 'click', '[data-seg="alloc"] button', (_, b) => { allocBy = b.dataset.value; pressSeg(root, 'alloc', allocBy); renderAllocation(); });
  on(root, 'click', '[data-asset]', (_, el2) => go(`/trade/${el2.dataset.asset}`));
  store.on('account', () => root.isConnected && !root.hidden && renderAll());
  let seenUser = currentUser()?.id ?? null; // la home cambia con la sesión: se repinta cuando entra o sale alguien (onAuth también salta en cada sincronización)
  onAuth((user) => { const id = user?.id ?? null; if (id === seenUser) return; seenUser = id; alias = null; if (root.isConnected && !root.hidden) renderAll(); });
  notifs.onChange(() => root.isConnected && !root.hidden && renderNotifCount());
  store.on('trades', () => { const box = $('#d-goals', root); if (box && !root.hidden) render(box, goalsCard({ compact: true })); });
  store.on('watchlist', () => !root.hidden && renderWatchlist());
  store.on('markets', () => !root.hidden && renderSessions());
  document.addEventListener('account:loaded', () => { if (root.isConnected && !root.hidden) renderAll(); });
}

export function show() {
  renderAll();
  clearInterval(timer);
  timer = setInterval(() => { renderCompare(); renderMovers(); renderSessions(); renderHeat(); }, 3000);
}
export function hide() { clearInterval(timer); }
export function theme() { equity?.theme(); drawEquity(); minis.forEach((m) => m.theme()); feat?.theme(); }

function renderAll() {
  const practice = store.hasPractice();
  const user = currentUser();
  equity?.destroy();
  equity = null;
  minis.forEach((m) => m.destroy());
  minis = [];
  feat?.destroy();
  feat = null;
  const focus = dashboardFocus({ signedIn: Boolean(user), practice, positions: store.positions().length, orders: store.orders().length });
  const steps = practice ? firstSteps({ practice, trades: store.trades().length, positions: store.positions().length, orders: store.orders().length,
    lessonsDone: lessonsRead().size, nextLessonId: 'que-es-paper-trading' }) : null;
  render(root, html`
    ${!practice && !user ? html`<div class="hero-row">    <section class="card cta" aria-labelledby="d-cta-title">
      <span class="chip accent">Simulador educativo</span>
      <h2 id="d-cta-title">Aprende trading en español, con euros y el IBEX 35. <span>Sin registrarte.</span></h2>
      <p class="hero-sub">Saldo virtual en euros, cotizaciones reales y lecciones en tu idioma, pensado para quien empieza en España y sin dinero real.</p>
      <div class="hero-actions">
        <button class="btn btn-primary" data-action="account">Elegir mi saldo</button>
        <a class="btn btn-ghost" href="#/trade">Probar la demo</a>
      </div>
      <p class="hero-note muted" role="note">${icon('info', 'sm')} Simulador educativo con dinero virtual. No es asesoramiento financiero.</p>
    </section>
    ${featureCard()}</div>` : ''}
    ${!practice && !user ? marketStrip() : ''}
    ${focus.setupFirst && account.pending() ? html`
    <section class="card cta focus-card" aria-busy="true" aria-label="Cargando tu cuenta">
      <div class="skeleton sk-line w-60"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line w-60"></div>
    </section>` : focus.setupFirst ? html`
    <section class="card cta focus-card" aria-labelledby="d-start-title">
      <h2 id="d-start-title">Crea tu cuenta de práctica</h2>
      <p class="hero-sub">Elige tu saldo virtual en euros (de 50 a 1.000.000 €) y practica con cotizaciones reales, sin arriesgar dinero.</p>
      <div class="hero-actions"><button class="btn btn-primary" data-action="account">Elegir mi saldo y empezar</button></div>
    </section>` : ''}
    <div class="home${focus.minimal ? ' home-minimal' : ''}${!practice && !user ? ' home-solo' : ''}">
      ${practice ? html`<section class="home-metrics" aria-label="Tu cuenta">
        ${metric('d-m-eq', 'Patrimonio')}${metric('d-m-day', 'P&L de hoy')}${metric('d-m-total', 'P&L total')}${metric('d-m-cash', 'Disponible')}
      </section>` : ''}
      <div class="home-main">
        ${practice ? html`
        ${user ? html`<div id="d-compare"></div>` : ''}
        ${can('compareSp500', Boolean(user)) ? '' : html`<section class="card compare-locked" aria-label="Comparación con el S&amp;P 500">
            <h2 class="card-title">¿Te ha compensado operar?</h2>
            <div class="compare-preview">
              <div class="compare-sample" aria-hidden="true">
                ${[['Tu cuenta', '+4,2 %', 62, 'up'], ['No invertir', '0 %', 4, ''], ['S&P 500', '+2,1 %', 34, 'up']].map(([l, v, w, c]) => html`<div class="compare-row"><span>${l}</span><i data-w="${w}" class="${c}"></i><strong>${v}</strong></div>`)}
              </div>
              <div class="compare-cta">
                <p>Ejemplo ilustrativo. Con una cuenta gratuita ves tu rentabilidad real, con comisiones, frente a no invertir y al S&amp;P 500.</p>
                <button type="button" class="btn btn-primary btn-sm" data-action="register">Crear cuenta gratis</button>
              </div>
            </div>
          </section>`}
        <section class="card home-equity" aria-labelledby="d-eq-title">
          <div class="card-head"><h2 class="card-title" id="d-eq-title">Patrimonio</h2>${seg('range', RANGES, range)}</div>
          <p class="whatif" id="d-whatif" hidden></p>
          <div class="hero-chart" id="d-chart"></div>
        </section>
        ${steps && !steps.complete ? stepsCard(steps) : ''}
        ${focus.orders ? ordersCard() : ''}
        <section class="card home-pos" aria-labelledby="d-pos-title">
          <div class="card-head"><h2 class="card-title" id="d-pos-title">Posiciones abiertas</h2><a class="see-all" href="#/trade">Ver todas ›</a></div>
          <div id="d-pos"></div>
        </section>
        <section class="card home-learn" id="d-learn" aria-labelledby="d-learn-title"></section>
          ${user ? html`<div id="d-divs"></div>` : ''}` : focus.minimal || (!practice && !user) ? '' : featureCard()}
      </div>
      <aside class="home-side" ${focus.minimal ? 'hidden' : ''}>
        <section class="card home-list" aria-labelledby="d-watch-title">
          <div class="card-head"><h2 class="card-title" id="d-watch-title">Favoritos</h2>
            <button class="icon-btn sm" data-action="palette" aria-label="Añadir favorito" title="Añadir favorito">${icon('plus')}</button></div>
          <div id="d-watch"></div>
          <a class="see-all" href="#/markets">Ver todos ›</a>
        </section>
      </aside>
      <div class="home-bottom" ${focus.minimal ? 'hidden' : ''}>
        <section class="card home-movers" aria-labelledby="d-movers-title">
          <div class="card-head"><h2 class="card-title" id="d-movers-title">Mayores movimientos</h2>
            ${seg('movers', [['gainers', 'Suben'], ['losers', 'Bajan']], movers)}</div>
          ${seg('mkind', [['all', 'Todos'], ['crypto', 'Cripto'], ['stock', 'Acciones']], moversKind)}
          <div id="d-movers"></div>
        </section>
        <section class="card home-news" aria-labelledby="d-news-title">
          <div class="card-head"><h2 class="card-title" id="d-news-title">Noticias</h2>${isVisible('news') ? html`<a class="see-all" href="#/news">Ver todas ›</a>` : ''}</div>
          <div class="news-list" id="d-news">${skeletonRows(4)}</div>
        </section>
        <section class="card home-sessions" aria-labelledby="d-sess-title">
          <div class="card-head"><h2 class="card-title" id="d-sess-title">Sesiones de mercado</h2><span class="card-sub">Tu hora local</span></div>
          <div class="sessions" id="d-sessions"></div>
        </section>
        <section class="card home-heat" id="d-heat-card" aria-labelledby="d-heat-title" hidden>
          <div class="card-head"><h2 class="card-title" id="d-heat-title">Mapa de calor</h2>${seg('heat', [['es', 'España'], ['crypto', 'Cripto']], heatKind)}</div>
          <p class="card-sub heat-sub" id="d-heat-sub"></p>
          <div class="heat" id="d-heat"></div>
        </section>
      </div>
      ${!practice && !user ? html`
      <section class="home-why" aria-label="Por qué PaperPulse">
        <ul class="why-line">
          <li><a href="#/learn">${icon('graduation-cap', 'sm')} Todo en español</a></li>
          <li><a href="#/markets">${icon('coins', 'sm')} En euros, con el IBEX 35</a></li>
          <li><a href="#/trade">${icon('play', 'sm')} Empieza sin registrarte</a></li>
        </ul>
      </section>` : ''}
    </div>`);

  if (practice) {
    equity = createEquityChart($('#d-chart', root), { formatter: (v) => money(v) });
    drawEquity();
    renderSummary();
    renderPositions();
    renderLearn();
  } else if ($('#d-feat-chart', root)) {
    loadFeature();
  }
  const retention = $('#d-retention', root);
  if (retention && isVisible('community')) mountCard(retention);
  renderCompare();
  renderDividends();
  renderWatchlist();
  renderMovers();
  renderSessions();
  renderNews();
  renderHeat();
}

/* ---------- Franja de métricas ---------- */
const metric = (id, label) => html`<div class="card metric"><span class="metric-label">${label}</span>
  <strong class="metric-value money" id="${id}"><span class="skeleton sk-line"></span></strong><span class="metric-sub" id="${id}-sub"></span></div>`;

/* ---------- Primeros pasos (sustituye al aviso «Haz tu primera compra») ---------- */
function stepsCard(st) {
  return html`<section class="card home-steps" aria-labelledby="d-steps-title">
    <div class="card-head"><h2 class="card-title" id="d-steps-title">Primeros pasos</h2><span class="card-sub">${st.done} de ${st.total}</span></div>
    <div class="progress" role="progressbar" aria-label="Primeros pasos completados" aria-valuemin="0" aria-valuemax="${st.total}" aria-valuenow="${st.done}"><i data-w="${st.pct}"></i></div>
    <ol class="steps">${st.steps.map((x, i) => html`<li class="${x.done ? 'done' : ''}">
      <span class="step-mark" aria-hidden="true">${x.done ? icon('circle-check', 'sm') : String(i + 1)}</span>
      <span class="step-label">${x.label}${x.done ? html`<span class="sr-only"> (hecho)</span>` : ''}</span>
      ${x.done ? html`<span class="muted step-state">Hecho</span>` : x.href ? html`<a class="btn btn-sm btn-ghost" href="${x.href}">${x.cta}</a>`
        : html`<button type="button" class="btn btn-sm btn-ghost" data-action="${x.action}">${x.cta}</button>`}</li>`)}</ol>
  </section>`;
}

/* ---------- Continuar aprendiendo ---------- */
let lessonsMod = null; // lib/learn-content.js, descargado la primera vez que hace falta
async function renderLearn() {
  const box = $('#d-learn', root);
  if (!box) return;
  if (!lessonsMod) {
    render(box, html`<div class="card-head"><h2 class="card-title" id="d-learn-title">Continuar aprendiendo</h2></div><div class="skeleton sk-line"></div>`);
    try { lessonsMod = await import('../lib/learn-content.js'); } catch { box.hidden = true; return; }
    if (!box.isConnected) return;
  }
  const n = nextLesson(lessonsMod.LESSONS, lessonsRead());
  render(box, html`<div class="card-head"><h2 class="card-title" id="d-learn-title">Continuar aprendiendo</h2><span class="card-sub">${n.done} de ${n.total} lecciones</span></div>
    <div class="progress" role="progressbar" aria-label="Lecciones completadas" aria-valuemin="0" aria-valuemax="${n.total}" aria-valuenow="${n.done}"><i data-w="${n.pct}"></i></div>
    ${n.lesson ? html`<a class="learn-next" href="#/learn/${n.lesson.id}"><span><strong>${n.lesson.title}</strong>
        <small>${n.lesson.minutes} min · ${n.lesson.summary}</small></span><span aria-hidden="true">›</span></a>`
      : html`<p class="muted learn-done">Has completado todas las lecciones. <a class="link" href="#/learn/glosario">Repasa el glosario</a>.</p>`}`);
}

/* ---------- Posiciones abiertas (compactas, con cierre) ---------- */
const POS_MAX = 5;
function renderPositions() {
  const box = $('#d-pos', root);
  if (!box) return;
  const list = store.positions();
  if (!list.length) {
    return render(box, html`<div class="home-empty"><p><strong>No tienes posiciones abiertas.</strong> Abre una Long o Short con tu saldo virtual y la verás aquí, con su resultado en vivo.</p>
      <a class="btn btn-sm btn-primary" href="#/trade">Ir a Operar</a></div>`);
  }
  render(box, html`<table class="table pos-mini" aria-labelledby="d-pos-title">
    <thead><tr><th scope="col">Activo</th><th scope="col">Dirección</th><th scope="col" class="r">P&amp;L</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
    <tbody>${list.slice(0, POS_MAX).map((p) => html`<tr>
      <th scope="row"><a class="pm-asset" href="#/trade/${p.symbol}">${assetIcon(p.symbol)}<span><strong>${p.symbol}</strong><small>${units(p.amount)}</small></span></a></th>
      <td>${p.side === 'short' ? html`<span class="chip down">Short</span>` : html`<span class="chip up">Long</span>`}</td>
      <td class="r"><span class="money pm-pnl" data-pm="${p.id}"></span><small class="pm-pct" data-pm-pct="${p.id}"></small></td>
      <td class="r"><button type="button" class="btn btn-ghost btn-sm" data-close-pos="${p.id}">Cerrar</button></td></tr>`)}</tbody>
  </table>${list.length > POS_MAX ? html`<p class="muted pos-more">Y ${list.length - POS_MAX} más en Operar.</p>` : ''}`);
  renderPositionsLive();
}
/** Solo cambia las cifras (como mucho 2 veces por segundo, con los precios): la tabla no se repinta. */
function renderPositionsLive() {
  for (const p of store.positions()) {
    const el = $(`[data-pm="${p.id}"]`, root);
    if (!el) continue;
    const v = valuePosition(p);
    el.textContent = money(v.pnlUsd, { signed: true });
    el.className = `money pm-pnl delta ${trendClass(v.pnlUsd)}`;
    const pc = $(`[data-pm-pct="${p.id}"]`, root);
    if (pc) { pc.textContent = pct(v.pnlPct); pc.className = `pm-pct ${trendClass(v.pnlUsd)}`; }
  }
}

/* ---------- Mapa de calor (España o Cripto). Sin datos, la tarjeta no aparece ---------- */
function renderHeat() {
  const card = $('#d-heat-card', root);
  if (!card) return;
  const pool = heatKind === 'es' ? ASSETS.filter((a) => a.market === 'es' && a.symbol !== 'IBEX') : CRYPTO;
  const items = pool.map((a) => ({ a, c: tick(a.symbol)?.change24h })).filter((x) => Number.isFinite(x.c));
  card.hidden = items.length < 3;
  if (card.hidden) return;
  $('#d-heat-sub', root).textContent = heatKind === 'es' ? `Valores del IBEX 35 en el catálogo (${items.length}) · variación de la sesión` : 'Cripto del catálogo · variación en 24 h';
  render($('#d-heat', root), items.map(({ a, c }) => html`<a class="heat-tile ${heatClass(c)}" href="#/trade/${a.symbol}" aria-label="${a.name}: ${pct(c)}">
    <strong>${a.symbol}</strong><span>${pct(c)}</span></a>`));
}

/* ---------- Tarjeta destacada: BTC o IBEX 35 con su gráfico de área (sin cuenta de práctica) ---------- */
const FEATURED = [['BTC', 'Bitcoin'], ['IBEX', 'IBEX 35']];
let featSym = 'BTC';
let feat = null;
let featLoad = 0;

/** Tira de mercados de la portada: precio y variación en vivo (los refresca el feed por data-px y data-chg). */
function marketStrip() {
  return html`<section class="market-strip" aria-label="Mercados en vivo">${['BTC', 'ETH', 'IBEX', 'NVDA', 'SAN'].map((sym) => {
    const a = findAsset(sym);
    return a ? html`<a class="strip-item" href="#/trade/${a.symbol}"><span class="strip-sym">${a.symbol}</span>
      <span class="num strip-px" data-px="${a.symbol}" data-q="${a.quote}">${tick(a.symbol)?.price ? price(tick(a.symbol).price, a.quote) : '—'}</span>${liveChange(a, 'span')}</a>` : '';
  })}</section>`;
}

function featureCard() {
  const a = findAsset(featSym);
  const t = tick(a.symbol);
  return html`<section class="card home-feature" aria-labelledby="d-feat-title">
    <div class="feat-head">
      <div class="feat-name"><h2 id="d-feat-title">${a.name}</h2><span class="chip">${a.symbol}</span></div>
      ${seg('feat', FEATURED, featSym)}
    </div>
    <div class="feat-price"><span class="feat-value" id="d-feat-value">${t?.price ? num(t.price) : '—'}</span><span class="feat-unit">${a.quote}</span>${liveChange(a, 'span')}</div>
    <div class="feat-chart" id="d-feat-chart"><div class="skeleton feat-sk" aria-hidden="true"></div></div>
    <p class="muted feat-note">Últimas 24 h${a.type === 'stock' ? ' · última sesión' : ''} · <a class="link" href="#/trade/${a.symbol}">Abrir en Operar</a></p>
  </section>`;
}

async function loadFeature() {
  const id = ++featLoad;
  const a = findAsset(featSym);
  const box = $('#d-feat-chart', root);
  feat?.destroy();
  feat = null;
  let list = [];
  try {
    list = (await candles(a, a.type === 'crypto' ? '15m' : '5m', { limit: a.type === 'crypto' ? 96 : 110 })).candles;
  } catch { /* sin datos */ }
  if (id !== featLoad || !box.isConnected) return;
  if (a.type !== 'crypto' && list.length) { // bolsa: solo la última sesión
    const lastDay = new Date(list.at(-1).time * 1000).toDateString();
    list = list.filter((c) => new Date(c.time * 1000).toDateString() === lastDay);
  }
  box.textContent = '';
  if (list.length < 2) return render(box, empty('chart-area', 'Sin datos ahora mismo', 'Vuelve a intentarlo en unos minutos.'));
  feat = createAreaChart(box);
  feat.setData(list.map((c) => ({ time: c.time, value: c.close })));
}

/* ---------- Patrimonio ---------- */
function drawEquity() {
  const box = $('#d-chart', root);
  if (!equity || !box) return;
  const cutoff = Date.now() / 1000 - RANGE_SECONDS[range];
  let points = store.equityHistory().filter((p) => p.time >= cutoff);
  if (points.length < 2) points = store.equityHistory();
  box.querySelector('.empty')?.remove();
  const values = points.map((p) => p.value);
  const flat = points.length >= 2 && Math.max(...values) - Math.min(...values) < Math.max(0.01, store.initialCapital() * 0.0001);
  box.classList.toggle('is-empty', points.length < 2 || flat);
  if (points.length < 2 || flat) {
    box.insertAdjacentHTML('beforeend', String(empty('chart-area', points.length < 2 ? 'Tu curva está por dibujar' : 'Tu patrimonio aún no se ha movido',
      points.length < 2 ? 'Se añade un punto cada minuto mientras tienes la app abierta.' : 'Cuando abras una posición, aquí verás cómo sube o baja.')));
  }
  equity.setData(points, store.initialCapital());
  // Los saltos de la curva suelen ser ventas: se marcan con un punto y su resultado como tooltip
  equity.setEvents(points.length < 2 ? [] : store.trades().map((t) => ({
    time: Date.parse(t.date) / 1000,
    text: `Venta de ${t.symbol}: ${money(t.pnl, { signed: true })}`,
  })).filter((e) => e.time >= points[0].time));
}

function renderSummary() {
  if (!store.hasPractice()) return;
  const p = portfolio();
  const total = p.equityUsd - store.initialCapital();
  const eq = $('#d-m-eq', root);
  if (!eq) return; // la cuenta se acaba de activar y la vista aún no se ha repintado (lo hace el evento de cuenta)
  // Si cambia el patrimonio, la cifra cuenta hasta él; si no, se repinta igual (puede haber cambiado el tipo de cambio)
  if (lastEquity != null && !eq.querySelector('.skeleton') && Math.abs(p.equityUsd - lastEquity) >= 0.005) countTo(eq, lastEquity, p.equityUsd, (v) => money(v));
  else eq.textContent = money(p.equityUsd);
  lastEquity = p.equityUsd;
  const set = (id, value, sub, trend) => {
    const v = $(`#${id}`, root), s = $(`#${id}-sub`, root);
    if (value != null) { v.textContent = value; v.className = `metric-value money${trend != null ? ` delta ${trendClass(trend)}` : ''}`; }
    if (s) render(s, sub);
  };
  set('d-m-eq', null, html`<span class="delta ${trendClass(p.returnPct)}">${pct(p.returnPct)}</span> desde el inicio`);
  const dayPct = p.equityUsd - p.change24hUsd > 0 ? (p.change24hUsd / (p.equityUsd - p.change24hUsd)) * 100 : 0;
  set('d-m-day', money(p.change24hUsd, { signed: true }), p.rows.length ? html`<span class="delta ${trendClass(p.change24hUsd)}">${pct(dayPct)}</span> en 24 h` : 'Sin posiciones abiertas', p.change24hUsd);
  set('d-m-total', money(total, { signed: true }), html`<span class="delta ${trendClass(total)}">${pct(p.returnPct)}</span> sobre ${startedAmount(store.initialInput()) || money(store.initialCapital())}`, total);
  set('d-m-cash', money(p.cashUsd), p.reservedUsd ? html`${money(p.reservedUsd)} en órdenes` : 'Listo para operar');
  renderWhatIf(p, store.trades().length > 0);
}

/** «Si hubieras invertido tus X € de verdad…»: solo si la persona eligió su saldo (las cuentas anteriores no lo tienen). */
function renderWhatIf(p, hasTrades) {
  const box = $('#d-whatif', root);
  if (!box) return;
  const w = whatIfParts(store.initialInput(), p.returnPct, hasTrades || p.rows.length > 0);
  box.hidden = !w;
  if (!w) return;
  render(box, w.intro ? html`${icon('wallet', 'sm')} ${w.intro}`
    : html`${icon('wallet', 'sm')} ${w.lead} <span class="money">${w.start}</span> ${w.mid} <strong class="money">${w.now}</strong>
      <span class="money delta ${trendClass(w.trend)}">(${w.diff})</span>.`);
}

/* ---------- Con la cuenta del servidor: ¿te ha compensado operar? ---------- */
/** Tu rentabilidad frente a no invertir y al S&P 500 desde la apertura de la cuenta. Sin dato del S&P 500 no se pinta. */
async function renderCompare() {
  const box = $('#d-compare', root);
  const since = account.openedAt();
  if (!box) return;
  if (!since || !store.isServerMode()) return box.replaceChildren();
  const sp = await sp500Since(since); // en caché unos minutos: el repintado cada 3 s no pide nada nuevo
  const now = $('#d-compare', root);
  if (!now || account.openedAt() !== since) return; // la vista se repintó o cambió la sesión mientras llegaba
  const c = sp && comparison(portfolio().returnPct, sp.returnPct);
  if (!c) return now.replaceChildren();
  render(now, html`<section class="card compare" aria-labelledby="d-compare-title">
    <div class="card-head"><h2 class="card-title" id="d-compare-title">${icon('scale')} ¿Te ha compensado operar?</h2>
      <span class="card-sub">Desde el ${sinceLabel(since)}</span></div>
    <ul class="compare-rows">${c.rows.map((r) => html`<li class="${r.key === 'mine' ? 'is-mine' : ''}">
      <div><strong>${r.label}</strong><small>${r.detail}</small></div>
      <span class="num delta ${trendClass(r.pct)}">${pct(r.pct)}</span></li>`)}</ul>
    <p class="compare-summary">${c.summary}</p>
    <p class="muted compare-note">${icon('info', 'sm')} Desde el día en que abriste la cuenta, en dólares. El S&amp;P 500 se mide por su precio, sin dividendos.
      El rendimiento pasado no garantiza resultados futuros.</p>
  </section>`);
}

/* ---------- Con la cuenta del servidor: próximos dividendos de mis posiciones ---------- */
/** Solo posiciones abiertas con fecha ex-dividendo conocida; si no hay ninguna, no se pinta nada. */
async function renderDividends() {
  const box = $('#d-divs', root);
  if (!box) return;
  if (!account.openedAt() || !store.isServerMode()) return box.replaceChildren();
  const data = await upcomingDividends();
  const now = $('#d-divs', root);
  if (!now || !account.openedAt()) return;
  const list = forPositions(store.positions(), data);
  if (!list.length) return now.replaceChildren();
  const when = (d) => { const n = daysUntil(d.exDate); return n <= 0 ? 'hoy' : n === 1 ? 'mañana' : `en ${n} días`; };
  put(now, h('section', { class: 'card divs', 'aria-labelledby': 'd-divs-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'd-divs-title' }, 'Próximos dividendos'),
      h('span', { class: 'card-sub' }, 'De tus posiciones abiertas')),
    h('ul', { class: 'divs-rows' }, list.map((d) => h('li', {},
      h('a', { href: `#/trade/${d.symbol}` }, h('strong', {}, d.symbol), h('small', {}, d.name)),
      h('div', {}, h('span', {}, `Ex-dividendo el ${exDateLabel(d.exDate)} (${when(d)})`), h('small', {}, amountText(d)))))),
    h('p', { class: 'muted divs-note' }, `${EX_DATE_NOTE} ${SIMULATION_NOTE}`)));
}

/* ---------- Con sesión: saludo, patrimonio, notificaciones y accesos rápidos ---------- */
function greeting(user, practice) {
  return html`<section class="card greet" aria-labelledby="d-hello">
    <div class="hero-top">
      <div>
        <h2 class="hero-label" id="d-hello">${icon('user', 'sm')} <span>Hola, ${user.name}</span></h2>
        ${practice ? html`<div class="hero-value money" id="d-equity"></div><div class="hero-delta" id="d-delta"></div><p class="whatif" id="d-whatif" hidden></p>` : ''}
      </div>
      <div id="d-notif"></div>
    </div>
    <nav class="quick" aria-label="Accesos rápidos">
      <a class="quick-link" href="#/trade">${icon('chart-candlestick')}<span>Operar</span></a>
      <a class="quick-link" href="#/markets">${icon('coins')}<span>Mercados</span></a>
      <a class="quick-link" href="#/learn">${icon('graduation-cap')}<span>Aprender</span></a>
    </nav>
  </section>`;
}

/** «Hola, alias» cuando hay perfil de comunidad; si no, el nombre de la cuenta (que ya está pintado). */
async function renderHello(user) {
  if (alias === null) {
    try { alias = (await community.me())?.profile?.alias ?? ''; } catch { alias = ''; }
  }
  const el = $('#d-hello span', root);
  if (alias && el && currentUser()?.id === user.id) el.textContent = `Hola, ${alias}`;
}

function renderNotifCount() {
  const box = $('#d-notif', root);
  if (!box) return;
  const { unread } = notifs.state();
  render(box, unread > 0
    ? html`<button type="button" class="chip accent" popovertarget="notif-pop">${icon('bell', 'sm')} ${unread === 1 ? '1 notificación sin leer' : `${unread} notificaciones sin leer`}</button>`
    : '');
}

/* ---------- Sin sesión: actividad real de la comunidad (solo si la hay) ---------- */
/** Lo que se ve sin iniciar sesión: top 5 de la semana, últimos hilos y traders activos. Si la comunidad está vacía no se pinta nada. */
async function renderPulse(localPractice) {
  const box = $('#d-pulse', root);
  if (!box) return;
  if (pulseData) drawPulse(box, pulseData, localPractice); // al repintar se enseña lo último que se sabía mientras llega lo nuevo
  await authReady; // hasta saber si hay sesión no se pide nada: quien ya ha entrado ve su panel, no esto
  if (currentUser() || !$('#d-pulse', root)) return;
  try { pulseData = await community.pulse(); } catch { return; } // sin servidor: se deja como está, nunca un error en la home
  const now = $('#d-pulse', root);
  if (now && !currentUser()) drawPulse(now, pulseData, localPractice);
}

function drawPulse(box, d, localPractice) {
  if (d.empty) return box.replaceChildren();
  const column = (title, body) => h('div', { class: 'pulse-col' }, h('h3', {}, title), body);
  const top = d.topWeek.length
    ? column('Mejores rentabilidades de la semana', h('ol', { class: 'pulse-list' }, d.topWeek.map((e) => h('li', {},
      h('span', { class: 'pulse-rank' }, String(e.rank)), h('a', { href: `#/community/user:${e.alias}` }, e.alias),
      h('strong', { class: `delta ${trendClass(e.returnPct)}` }, pct(e.returnPct)), e.approximate ? h('small', { class: 'muted' }, 'aprox.') : null))))
    : null;
  const threads = d.latestThreads.length
    ? column('Últimos hilos del foro', h('ul', { class: 'pulse-list' }, d.latestThreads.map((t) => h('li', {},
      h('a', { href: `#/community/thread:${t.id}` }, t.title), h('small', { class: 'muted' }, t.categoryName)))))
    : null;
  put(box, h('section', { class: 'card', 'aria-labelledby': 'd-pulse-title' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title', id: 'd-pulse-title' }, 'La comunidad esta semana'),
      h('a', { class: 'link', href: '#/community/ranking' }, 'Ver clasificación')),
    h('div', { class: 'pulse-grid' }, top, threads),
    d.activeTraders7d != null ? h('p', { class: 'muted pulse-foot' }, `${d.activeTraders7d} traders han operado esta semana.`) : null,
    localPractice ? h('p', { class: 'pulse-foot' }, 'Tu cuenta de práctica vive solo en este navegador. Regístrate para guardarla y poder aparecer en la clasificación. ',
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { action: 'register' } }, 'Crear cuenta')) : null));
}

/* ---------- Tarjetas de cotización con minigráfico (series que ya se cargan: 7 días cripto, 1 mes bolsa; sin peticiones nuevas) ---------- */
const TILES = ['BTC', 'ETH', 'IBEX', 'NVDA'];
async function renderTiles() {
  const box = $('#d-tiles', root);
  if (!box) return;
  const assets = TILES.map(findAsset).filter(Boolean);
  render(box, assets.map((a) => html`<button class="card kpi kpi-spark" data-asset="${a.symbol}">
    <span>${a.name}</span><strong>${livePrice(a)}</strong>${liveChange(a)}
    <div class="kpi-chart" data-spark="${a.symbol}" aria-hidden="true"></div>
    <small class="kpi-range">${a.type === 'crypto' ? '7 días' : '1 mes'}</small></button>`));
  const cg = await cryptoMarkets();
  const series = await Promise.all(assets.map((a) => (a.type === 'crypto' ? cg.get(a.symbol)?.spark : stockSpark(a))));
  if (!box.isConnected || !box.querySelector('.kpi-spark')) return; // la vista se repintó mientras llegaban los datos
  assets.forEach((a, i) => {
    const holder = box.querySelector(`[data-spark="${a.symbol}"]`);
    if (!holder || !series[i]?.length) return;
    const mini = createMiniChart(holder);
    if (mini.setData(series[i])) minis.push(mini); else mini.destroy();
  });
}

const kpi = (label, value, sub) => html`<div class="card kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;

/* ---------- Favoritos: agrupados en Cripto y Acciones, con minigráfico ---------- */
/** Precio en vivo con la unidad aparte (pequeña y gris); lo actualiza el oyente de precios de la vista. */
const liveNum = (a) => html`<span class="num" data-num-px="${a.symbol}">${tick(a.symbol)?.price ? num(tick(a.symbol).price) : '—'}</span><small class="unit">${a.quote}</small>`;

async function renderWatchlist() {
  const box = $('#d-watch', root);
  if (!box) return;
  const list = store.watchlist().map(findAsset).filter(Boolean);
  if (!list.length) return render(box, empty('star', 'Aún no sigues ningún activo', 'Pulsa + o la estrella de cualquier activo y lo tendrás aquí.'));
  const row = (a, spark) => html`<tr data-asset="${a.symbol}" tabindex="0">
    <th scope="row"><span class="wl-sym">${assetIcon(a)}<span><strong>${a.symbol}</strong><small>${a.name}</small></span></span></th>
    <td class="wl-spark">${spark ?? ''}</td><td class="r">${liveNum(a)}</td><td class="r">${liveChange(a, 'span')}</td></tr>`;
  const paint = (sparks) => render(box, html`<table class="table home-watch" aria-labelledby="d-watch-title">
    <thead><tr><th scope="col">Símbolo</th><th scope="col" class="wl-spark"><span class="sr-only">Tendencia</span></th><th scope="col" class="r">Última</th><th scope="col" class="r">Cambio</th></tr></thead>
    ${[['Cripto', list.filter((a) => a.type === 'crypto')], ['Acciones e índices', list.filter((a) => a.type !== 'crypto')]].filter(([, g]) => g.length)
      .map(([t, g]) => html`<tbody><tr class="wl-group"><th scope="colgroup" colspan="4">${t}</th></tr>${g.map((a) => row(a, sparks?.get(a.symbol)))}</tbody>`)}
  </table>`);
  // Al instante con las minigráficas guardadas; después, las nuevas
  const savedCg = savedCryptoMarkets(), savedSt = savedStockSparks();
  const fromSaved = new Map(list.map((a) => [a.symbol, sparkline(a.type === 'crypto' ? savedCg?.get(a.symbol)?.spark : savedSt[a.symbol])]));
  paint(fromSaved);
  const cg = await cryptoMarkets();
  const sparks = await Promise.all(list.map(async (a) => (a.type === 'crypto' ? cg.get(a.symbol)?.spark : stockSpark(a))));
  if (box.isConnected) paint(new Map(list.map((a, i) => [a.symbol, sparks[i]?.length ? sparkline(sparks[i]) : fromSaved.get(a.symbol)])));
}

/* ---------- Mayores movimientos (Suben / Bajan; Todos / Cripto / Acciones) ---------- */
function withChange() {
  return ASSETS.map((a) => ({ a, t: tick(a.symbol) })).filter((x) => Number.isFinite(x.t?.change24h) && x.t.price > 0);
}

function renderMovers() {
  const box = $('#d-movers', root);
  if (!box) return;
  const list = moversList(withChange().map(({ a, t }) => ({ a, change: t.change24h })), { dir: movers, kind: moversKind });
  if (!list.length) return render(box, skeletonRows(5, 'Esperando cotizaciones…'));
  render(box, html`<table class="table home-movers-t" aria-labelledby="d-movers-title">
    <thead><tr><th scope="col">Activo</th><th scope="col" class="r">Última</th><th scope="col" class="r">24 h</th></tr></thead>
    <tbody>${list.map(({ a }) => html`<tr data-asset="${a.symbol}" tabindex="0">
      <th scope="row"><span class="wl-sym">${assetIcon(a)}<span><strong>${a.symbol}</strong><small>${a.name}</small></span></span></th>
      <td class="r">${liveNum(a)}</td><td class="r">${liveChange(a, 'span')}</td></tr>`)}</tbody></table>`);
}

function renderBreadth() {
  const box = $('#d-breadth', root);
  if (!box) return;
  const list = withChange();
  if (!list.length) return render(box, skeletonRows(2, 'No hay datos ahora mismo, reintentando…'));
  const ups = list.filter((x) => x.t.change24h > 0).length;
  const share = Math.round((ups / list.length) * 100);
  const mood = share >= 60 ? ['Predominio comprador', 'up'] : share <= 40 ? ['Predominio vendedor', 'down'] : ['Mercado equilibrado', 'flat'];
  render(box, html`<div class="breadth">
    <div class="gap-8"><span class="breadth-value ${mood[1]}">${share}&nbsp;%</span><span class="muted">de los activos suben · ${mood[0]}</span></div>
    <div class="breadth-bar" role="img" aria-label="${ups} suben y ${list.length - ups} bajan"><i class="b-up" data-w="${share}"></i><i class="b-down" data-w="${100 - share}"></i></div>
    <div class="breadth-legend"><span class="up">${ups} suben</span><span class="down">${list.length - ups} bajan</span></div></div>`);
}

/* ---------- Órdenes pendientes (arriba del Resumen mientras las haya) ---------- */
function ordersCard() {
  const list = store.orders();
  const shown = list.slice(0, 5);
  return html`<section class="card focus-card" aria-labelledby="d-orders-title">
    <div class="card-head"><h2 class="card-title" id="d-orders-title">${icon('clock')} Órdenes pendientes</h2><span class="card-sub">${list.length}</span></div>
    <div class="rows">${shown.map((o) => html`<a class="row" href="#/trade/${o.symbol}">${assetIcon(o.symbol)}
      <div><strong>${o.name || o.symbol}</strong><small>${orderLabel(o)} · ${units(o.amount)} ${o.symbol}</small></div>
      <div class="row-end"><span class="num">${price(o.limitPrice, o.quote)}</span><small><span class="money">${money(o.reservedUsd)}</span> reservado</small></div></a>`)}</div>
    ${list.length > shown.length ? html`<a class="link" href="#/trade">Ver las ${list.length} en Operar ${icon('arrow-right', 'sm')}</a>` : ''}
  </section>`;
}

/* ---------- Cartera y distribución (solo presentación de portfolio()) ---------- */
const signedMoney = (usd) => html`<span class="money">${money(usd, { signed: true })}</span>`;

function renderHoldings() {
  const box = $('#d-hold', root);
  if (!box) return;
  const list = holdingRows(portfolio().rows, findAsset);
  const t = holdingTotals(list);
  // En el móvil no caben cuatro columnas: el resultado se pinta bajo el valor (y su columna se oculta)
  const result = (usd, pctValue) => html`<td class="r hold-pnl hide-sm ${trendClass(usd)}">${signedMoney(usd)}<small>${pct(pctValue)}</small></td>`;
  const value = (usd, pnl, pctValue) => html`<td class="r"><span class="money">${money(usd)}</span>
    <small class="show-sm hold-pnl-sm ${trendClass(pnl)}"><span class="money">${money(pnl, { signed: true })}</span> · ${pct(pctValue)}</small></td>`;
  render(box, html`<table class="table holdings" aria-labelledby="d-hold-title">
    <thead><tr><th scope="col">Activo</th><th scope="col" class="r hide-sm">Coste</th><th scope="col" class="r">Valor</th><th scope="col" class="r hide-sm">Ganancia / pérdida</th></tr></thead>
    <tbody>${list.map((r) => html`<tr>
      <td><a class="hold-asset" href="#/trade/${r.symbol}">${assetIcon(r.symbol)}<span><strong>${r.name}</strong><small>${units(r.amount)} ${r.symbol}</small></span></a></td>
      <td class="r hide-sm"><span class="money">${money(r.costUsd)}</span></td>
      ${value(r.valueUsd, r.pnlUsd, r.pnlPct)}
      ${result(r.pnlUsd, r.pnlPct)}</tr>`)}</tbody>
    ${list.length > 1 ? html`<tfoot><tr><th scope="row">Total</th><td class="r hide-sm"><span class="money">${money(t.costUsd)}</span></td>
      ${value(t.valueUsd, t.pnlUsd, t.pnlPct)}${result(t.pnlUsd, t.pnlPct)}</tr></tfoot>` : ''}
  </table>`);
}

/* Distribución: barra apilada + leyenda, por activo, tipo o divisa */
function renderAllocation() {
  const box = $('#d-alloc', root);
  if (!box) return;
  const p = portfolio();
  if (!(p.equityUsd > 0)) return;
  const parts = allocation(holdingRows(p.rows, findAsset), p.cashUsd + p.reservedUsd, allocBy);
  const label = ALLOCATION_TABS.find(([k]) => k === allocBy)?.[1].toLowerCase() ?? '';
  render(box, html`<div class="alloc-bar" role="img" aria-label="Distribución de la cartera por ${label}">
      ${parts.filter((s) => s.usd > 0).map((s) => html`<i class="${s.cls}" data-w="${s.share.toFixed(2)}"></i>`)}</div>
    <div class="alloc-legend">${parts.map((s) => html`<div><i class="${s.cls}"></i><span>${s.label}</span><span class="money">${money(s.usd)}</span><span>${pct(s.share, { signed: false, decimals: 1 })}</span></div>`)}</div>`);
}

/* ---------- Sesiones en una línea de 24 h ---------- */
function tzNow(tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { minutes: +parts.hour * 60 + +parts.minute, weekend: ['Sat', 'Sun'].includes(parts.weekday) };
}

function renderSessions() {
  const box = $('#d-sessions', root);
  if (!box) return;
  const now = new Date();
  const localMin = now.getHours() * 60 + now.getMinutes();
  const server = new Map(store.markets().map((m) => [m.id, m]));
  const toPct = (min) => ((((min % 1440) + 1440) % 1440) / 1440) * 100;

  const rows = Object.entries(SESSIONS).map(([id, s]) => {
    const there = tzNow(s.tz);
    const offset = ((there.minutes - localMin + 720) % 1440 + 1440) % 1440 - 720;
    const start = s.open[0] * 60 + s.open[1] - offset;
    const end = s.close[0] * 60 + s.close[1] - offset;
    const thereMin = there.minutes;
    const inHours = thereMin >= s.open[0] * 60 + s.open[1] && thereMin < s.close[0] * 60 + s.close[1];
    const open = server.get(id)?.open ?? (!there.weekend && inHours);
    const segs = toPct(start) < toPct(end)
      ? [[toPct(start), toPct(end) - toPct(start)]]
      : [[toPct(start), 100 - toPct(start)], [0, toPct(end)]];
    const localTime = new Intl.DateTimeFormat('es-ES', { timeZone: s.tz, hour: '2-digit', minute: '2-digit' }).format(now);
    return html`<div class="session">
      <div class="session-name"><div><strong>${s.name}</strong><small>${s.sub} · ${localTime}</small></div></div>
      <div class="track ${open ? 'open' : ''}">${segs.map(([l, w]) => html`<i data-l="${l.toFixed(2)}" data-w="${w.toFixed(2)}"></i>`)}<b data-l="${toPct(localMin).toFixed(2)}"></b></div>
      ${open ? html`<span class="chip up"><span class="dot"></span>Abierta</span>` : html`<span class="chip">Cerrada</span>`}
    </div>`;
  });
  render(box, html`${rows}
    <div class="session-axis"><span></span><div><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><span></span></div>
    <div class="session"><div class="session-name"><div><strong>Cripto</strong><small>Binance · continuo</small></div></div>
      <div class="track open"><i data-l="0" data-w="100"></i><b data-l="${toPct(localMin).toFixed(2)}"></b></div><span class="chip up"><span class="dot"></span>24/7</span></div>`);
}

/* ---------- Noticias ---------- */
async function renderNews() {
  const box = $('#d-news', root);
  if (!box) return;
  const paint = (list) => render(box, list.map((n) => {
    const a = tickerFor(n.title, ASSETS);
    const url = safeUrl(n.url);
    const body = html`<strong>${n.title}</strong><small><span>${n.source}</span> · <span>${timeAgo(n.date)}</span>${a ? html` <span class="chip">${a.symbol}</span>` : ''}</small>`;
    return url ? html`<a class="news-row" href="${url}" target="_blank" rel="noopener noreferrer">${body}</a>` : html`<div class="news-row">${body}</div>`;
  }));
  const saved = savedNews().slice(0, 5);
  if (saved.length) paint(saved); // al instante lo último guardado; lo nuevo lo sustituye al llegar
  try {
    const list = (await news()).slice(0, 5);
    if (!box.isConnected) return;
    if (list.length) paint(list);
    else if (!saved.length) render(box, empty('newspaper', 'Los mercados están callados', 'Las fuentes no han publicado titulares financieros recientes.'));
  } catch {
    if (!saved.length) render(box, empty('wifi-off', 'No hay noticias ahora mismo', 'No se pudo conectar con las fuentes. Vuelve a abrir el Resumen en unos minutos.'));
  }
}

