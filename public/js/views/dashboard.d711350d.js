// Vista Resumen: patrimonio, KPIs, sesiones de bolsa, favoritos, movimientos, amplitud y cartera.
import * as store from '../lib/store.13ad261a.js';
import { tick } from '../lib/feed.771cfbed.js';
import { ASSETS, findAsset } from '../lib/catalog.f1b2b586.js';
import { html, icon, render, on, $ } from '../lib/dom.a575914e.js';
import { money, price, pct, units, trendClass, timeAgo } from '../lib/format.df74909c.js';
import { portfolio } from '../lib/trading.031ca84b.js';
import { createEquityChart, createMiniChart, sparkline } from '../lib/charts.2c3b8f76.js';
import { currentUser, onAuth, ready as authReady } from '../lib/auth.3d41218e.js';
import * as notifs from '../lib/notifications.6a0ca81c.js';
import * as community from '../lib/community.c762fa43.js';
import { h, mount as put } from '../lib/el.71f9edc9.js';
import { cryptoMarkets, stockSpark, news, safeUrl } from '../lib/marketdata.c6db1b1f.js';
import { assetIcon, changeChip, empty, seg, pressSeg, liveChange, moneyHtml } from '../lib/ui.3d803e38.js';
import { go } from '../lib/router.de30a562.js';
import { mountCard } from '../ui/retention-card.b6816818.js';
import { whatIfParts } from '../lib/starting-balance.4c6d23aa.js';
import { goalsCard } from '../ui/goals-card.0f6da070.js';
import { countTo } from '../lib/motion.d917c017.js';
import * as account from '../lib/account.200b05ac.js';
import { sp500Since, comparison, sinceLabel } from '../lib/benchmark.555a4bbe.js';
import { holdingRows, holdingTotals, allocation, ALLOCATION_TABS } from '../lib/holdings.e72648f7.js';
import { upcomingDividends, forPositions, exDateLabel, amountText, daysUntil, EX_DATE_NOTE, SIMULATION_NOTE } from '../lib/dividends.1e314bd3.js';

const RANGES = [['1D', '1D'], ['1W', '1S'], ['1M', '1M'], ['3M', '3M'], ['ALL', 'Todo']];
const RANGE_SECONDS = { '1D': 86400, '1W': 604800, '1M': 2592000, '3M': 7776000, ALL: Infinity };
const SESSIONS = {
  us: { tz: 'America/New_York', open: [9, 30], close: [16, 0], name: 'Nueva York', sub: 'NYSE · Nasdaq' },
  es: { tz: 'Europe/Madrid', open: [9, 0], close: [17, 30], name: 'Madrid', sub: 'BME · IBEX 35' },
  lon: { tz: 'Europe/London', open: [8, 0], close: [16, 30], name: 'Londres', sub: 'LSE' },
  fra: { tz: 'Europe/Berlin', open: [9, 0], close: [17, 30], name: 'Fráncfort', sub: 'Xetra' },
  tyo: { tz: 'Asia/Tokyo', open: [9, 0], close: [15, 30], name: 'Tokio', sub: 'TSE' },
};

let root, equity, range = '1M', movers = 'gainers', allocBy = 'asset', timer;
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
  on(root, 'click', '[data-seg="alloc"] button', (_, b) => { allocBy = b.dataset.value; pressSeg(root, 'alloc', allocBy); renderAllocation(); });
  on(root, 'click', '[data-asset]', (_, el2) => go(`/trade/${el2.dataset.asset}`));
  store.on('account', () => root.isConnected && !root.hidden && renderAll());
  let seenUser = currentUser()?.id ?? null; // la home cambia con la sesión: se repinta cuando entra o sale alguien (onAuth también salta en cada sincronización)
  onAuth((user) => { const id = user?.id ?? null; if (id === seenUser) return; seenUser = id; alias = null; if (root.isConnected && !root.hidden) renderAll(); });
  notifs.onChange(() => root.isConnected && !root.hidden && renderNotifCount());
  store.on('trades', () => { const box = $('#d-goals', root); if (box && !root.hidden) render(box, goalsCard({ compact: true })); });
  store.on('watchlist', () => !root.hidden && renderWatchlist());
  store.on('markets', () => !root.hidden && renderSessions());
}

export function show() {
  renderAll();
  clearInterval(timer);
  timer = setInterval(() => { renderSummary(); renderCompare(); renderMovers(); renderBreadth(); renderHoldings(); renderAllocation(); renderSessions(); }, 3000);
}
export function hide() { clearInterval(timer); }
export function theme() { equity?.theme(); drawEquity(); minis.forEach((m) => m.theme()); }

function renderAll() {
  const practice = store.hasPractice();
  const user = currentUser();
  equity?.destroy();
  equity = null;
  minis.forEach((m) => m.destroy());
  minis = [];
  render(root, html`
    <div id="d-retention" class="stack"></div>
    <div class="dash">
      <div class="stack">
        ${user ? greeting(user, practice) : ''}
        ${practice ? html`
          <section class="card">
            <div class="hero-top">
              ${user ? html`<span class="hero-label">${icon('activity', 'sm')} Evolución del patrimonio</span>` : html`<div>
                <span class="hero-label">${icon('wallet', 'sm')} Patrimonio total</span>
                <div class="hero-value money" id="d-equity"></div>
                <div class="hero-delta" id="d-delta"></div>
                <p class="whatif" id="d-whatif" hidden></p>
              </div>`}
              ${seg('range', RANGES, range)}
            </div>
            <div class="hero-chart" id="d-chart"></div>
          </section>
          <div class="kpis" id="d-kpis"></div>
          ${store.positions().length ? html`
          <section class="card" aria-labelledby="d-hold-title">
            <div class="card-head"><h2 class="card-title" id="d-hold-title">${icon('wallet')} Cartera</h2><a class="link" href="#/trade">Operar</a></div>
            <div class="table-wrap" id="d-hold"></div>
          </section>` : ''}
          ${user ? html`<div id="d-compare"></div><div id="d-divs"></div>` : ''}
          <div id="d-goals">${goalsCard({ compact: true })}</div>
          ${user ? '' : html`<div id="d-pulse"></div>`}` : user ? html`
          <section class="card" aria-labelledby="d-start-title">
            <h2 class="card-title" id="d-start-title">${icon('wallet')} Crea tu cuenta de práctica</h2>
            <p class="hero-sub">Elige con cuánto dinero virtual quieres empezar y practica con cotizaciones reales.</p>
            <div class="hero-actions"><button class="btn btn-primary btn-lg" data-action="account">${icon('play')} Elegir mi saldo</button></div>
          </section>
          <div class="kpis" id="d-tiles"></div>` : html`
          <section class="card cta" aria-labelledby="d-cta-title">
            <span class="chip accent">${icon('graduation-cap', 'sm')} Simulador educativo</span>
            <h2 id="d-cta-title">Practica con precios y costes reales. <span>Averigua si de verdad te compensa operar.</span></h2>
            <p class="hero-sub">Saldo virtual y cotizaciones reales de cripto, Wall Street e IBEX 35. Con tu cuenta gratuita, cada operación paga comisión y deslizamiento, y comparas tu resultado con no invertir y con el S&amp;P 500. Sin dinero real.</p>
            <div class="hero-actions">
              <button class="btn btn-primary btn-lg" data-action="register">Empezar gratis</button>
              <button class="btn btn-ghost btn-lg" data-action="account">Probar demo</button>
              <button class="btn btn-lg btn-link" data-action="tour">Ver cómo funciona</button>
            </div>
            <p class="disclaimer" role="note">${icon('info', 'sm')} Simulador educativo con dinero virtual. No es asesoramiento financiero.</p>
          </section>
          <section class="features" aria-label="Qué hace diferente a PaperPulse">
            <a class="card feature" href="#/community/forum">
              <span class="feature-icon">${icon('users')}</span>
              <h3>Comunidad de traders</h3>
              <p>Foro, perfiles y operaciones compartidas para aprender de otros.</p>
              <span class="feature-link">Ir al foro ${icon('arrow-right', 'sm')}</span>
            </a>
            <a class="card feature" href="#/community/ranking">
              <span class="feature-icon">${icon('trophy')}</span>
              <h3>Ranking y retos mensuales</h3>
              <p>Compite cada mes con el mismo saldo y sube en la clasificación.</p>
              <span class="feature-link">Ver clasificación ${icon('arrow-right', 'sm')}</span>
            </a>
            <a class="card feature" href="#/markets">
              <span class="feature-icon">${icon('chart-candlestick')}</span>
              <h3>Mercado real, saldo virtual</h3>
              <p>Cripto, Wall Street e IBEX 35 en vivo. Nunca dinero real.</p>
              <span class="feature-link">Ver mercados ${icon('arrow-right', 'sm')}</span>
            </a>
          </section>
          <div id="d-pulse"></div>
          <div class="kpis" id="d-tiles"></div>`}
        <section class="card">
          <div class="card-head"><h2 class="card-title">${icon('globe')} Sesiones de mercado</h2><span class="card-sub">Tu hora local</span></div>
          <div class="sessions" id="d-sessions"></div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="card-title">${icon('newspaper')} Últimas noticias</h2><a class="link" href="#/news">Ver todas</a></div>
          <div class="news-mini" id="d-news">${skeletonRows(4)}</div>
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <div class="card-head"><h2 class="card-title">${icon('star')} Favoritos</h2>
            <button class="icon-btn sm" data-action="palette" aria-label="Añadir favorito">${icon('plus')}</button></div>
          <div class="rows" id="d-watch"></div>
        </section>
        ${practice && store.positions().length ? html`
          <section class="card">
            <div class="card-head"><h2 class="card-title">${icon('layers')} Distribución</h2>${seg('alloc', ALLOCATION_TABS, allocBy)}</div>
            <div id="d-alloc"></div>
          </section>` : ''}
        <section class="card">
          <div class="card-head"><h2 class="card-title">${icon('flame')} Mayores movimientos</h2>
            ${seg('movers', [['gainers', 'Suben'], ['losers', 'Bajan']], movers)}</div>
          <div class="rows" id="d-movers"></div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="card-title">${icon('activity')} Amplitud del mercado</h2><span class="card-sub">24 h</span></div>
          <div id="d-breadth"></div>
        </section>
      </div>
    </div>`);

  if (practice) {
    equity = createEquityChart($('#d-chart', root), { formatter: (v) => money(v) });
    drawEquity();
  }
  mountCard($('#d-retention', root));
  if (user) { renderHello(user); renderNotifCount(); } else renderPulse(practice);
  if (!practice) renderTiles();
  renderSummary();
  renderCompare();
  renderDividends();
  renderWatchlist();
  renderMovers();
  renderBreadth();
  renderHoldings();
  renderAllocation();
  renderSessions();
  renderNews();
}

/* ---------- Patrimonio ---------- */
function drawEquity() {
  const box = $('#d-chart', root);
  if (!equity || !box) return;
  const cutoff = Date.now() / 1000 - RANGE_SECONDS[range];
  let points = store.equityHistory().filter((p) => p.time >= cutoff);
  if (points.length < 2) points = store.equityHistory();
  box.querySelector('.empty')?.remove();
  if (points.length < 2) {
    box.insertAdjacentHTML('beforeend', String(empty('chart-area', 'Tu curva está por dibujar', 'Se añade un punto cada minuto mientras tienes la app abierta.')));
  }
  equity.setData(points, store.initialCapital());
}

function renderSummary() {
  if (store.hasPractice()) {
    const p = portfolio();
    const total = p.equityUsd - store.initialCapital();
    if (!$('#d-equity', root)) return; // la cuenta se acaba de activar y la vista aún no se ha repintado (lo hace el evento de cuenta)
    countTo($('#d-equity', root), lastEquity, p.equityUsd, (v) => money(v)); // la cifra cuenta hasta su nuevo valor
    lastEquity = p.equityUsd;
    render($('#d-delta', root), html`${changeChip(p.returnPct)}
      <span class="money delta ${trendClass(total)}">${money(total, { signed: true })}</span> desde el inicio
      ${p.rows.length ? html`· <span class="money delta ${trendClass(p.change24hUsd)}">${money(p.change24hUsd, { signed: true })}</span> hoy` : ''}`);
    const t = store.trades();
    renderWhatIf(p, t.length > 0);
    const wins = t.filter((x) => x.pnl > 0).length;
    render($('#d-kpis', root), html`
      ${kpi('Efectivo disponible', moneyHtml(p.cashUsd), p.reservedUsd ? html`<span class="money">${money(p.reservedUsd)}</span> en órdenes` : 'Listo para operar')}
      ${kpi('Invertido', moneyHtml(p.holdingsUsd), `${p.rows.length} ${p.rows.length === 1 ? 'posición' : 'posiciones'}`)}
      ${kpi('P&L no realizado', html`<span class="money delta ${trendClass(p.unrealizedUsd)}">${money(p.unrealizedUsd, { signed: true })}</span>`, p.investedUsd ? pct((p.unrealizedUsd / p.investedUsd) * 100) : '—')}
      ${kpi('Tasa de acierto', t.length ? pct((wins / t.length) * 100, { signed: false, decimals: 0 }) : '—', `${t.length} operaciones cerradas`)}`);
  }
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
      <a class="quick-link" href="#/community">${icon('users')}<span>Comunidad</span></a>
      <a class="quick-link" href="#/community/challenge">${icon('flame')}<span>Reto del mes</span></a>
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

/* ---------- Favoritos con sparklines ---------- */
async function renderWatchlist() {
  const box = $('#d-watch', root);
  if (!box) return;
  const list = store.watchlist().map(findAsset).filter(Boolean);
  if (!list.length) return render(box, empty('star', 'Aún no sigues ningún activo', 'Pulsa + o la estrella de cualquier activo y lo tendrás aquí, a un vistazo.'));
  const row = (a, spark) => html`<button class="row" data-asset="${a.symbol}">
      ${assetIcon(a)}
      <div class="asset-cell"><div><strong>${a.symbol}</strong><small>${a.name}</small></div><span class="hide-sm">${spark ?? ''}</span></div>
      <div class="row-end">${livePrice(a)}${liveChange(a)}</div></button>`;
  render(box, list.map((a) => row(a)));
  const cg = await cryptoMarkets();
  const sparks = await Promise.all(list.map(async (a) => (a.type === 'crypto' ? cg.get(a.symbol)?.spark : stockSpark(a))));
  if (box.isConnected) render(box, list.map((a, i) => row(a, sparkline(sparks[i]))));
}

/* ---------- Movimientos y amplitud ---------- */
function withChange() {
  return ASSETS.map((a) => ({ a, t: tick(a.symbol) })).filter((x) => Number.isFinite(x.t?.change24h) && x.t.price > 0);
}

function renderMovers() {
  const box = $('#d-movers', root);
  if (!box) return;
  const list = withChange().sort((x, y) => (movers === 'gainers' ? y.t.change24h - x.t.change24h : x.t.change24h - y.t.change24h)).slice(0, 5);
  if (!list.length) return render(box, skeletonRows(5, 'No hay datos ahora mismo, reintentando…'));
  render(box, list.map(({ a }) => html`<button class="row" data-asset="${a.symbol}">${assetIcon(a)}
    <div class="asset-cell"><div><strong>${a.symbol}</strong><small>${a.name}</small></div></div>
    <div class="row-end">${livePrice(a)}${liveChange(a)}</div></button>`));
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
  try {
    const list = (await news()).slice(0, 5);
    if (!box.isConnected) return;
    render(box, list.length ? list.map((n) => html`<a href="${safeUrl(n.url) ?? '#/news'}" target="_blank" rel="noopener noreferrer">
      <strong>${n.title}</strong><small>${n.source} · ${timeAgo(n.date)}</small></a>`) : empty('newspaper', 'Los mercados están callados', 'Las fuentes no han publicado titulares financieros recientes.'));
  } catch {
    render(box, empty('wifi-off', 'No hay noticias ahora mismo', 'No se pudo conectar con las fuentes. Vuelve a abrir el Resumen en unos minutos.'));
  }
}

