// Vista Resumen: patrimonio, KPIs, sesiones de bolsa, favoritos, movimientos, amplitud y cartera.
import * as store from '../lib/store.js';
import { tick } from '../lib/feed.js';
import { ASSETS, findAsset } from '../lib/catalog.js';
import { html, icon, render, on, $ } from '../lib/dom.js';
import { money, price, pct, trendClass, timeAgo } from '../lib/format.js';
import { portfolio } from '../lib/trading.js';
import { createEquityChart, sparkline } from '../lib/charts.js';
import { cryptoMarkets, stockSpark, news, safeUrl } from '../lib/marketdata.js';
import { assetIcon, changeChip, empty, seg, pressSeg, liveChange, moneyHtml } from '../lib/ui.js';
import { go } from '../lib/router.js';

const RANGES = [['1D', '1D'], ['1W', '1S'], ['1M', '1M'], ['3M', '3M'], ['ALL', 'Todo']];
const RANGE_SECONDS = { '1D': 86400, '1W': 604800, '1M': 2592000, '3M': 7776000, ALL: Infinity };
const SESSIONS = {
  us: { tz: 'America/New_York', open: [9, 30], close: [16, 0], name: 'Nueva York', sub: 'NYSE · Nasdaq' },
  es: { tz: 'Europe/Madrid', open: [9, 0], close: [17, 30], name: 'Madrid', sub: 'BME · IBEX 35' },
  lon: { tz: 'Europe/London', open: [8, 0], close: [16, 30], name: 'Londres', sub: 'LSE' },
  fra: { tz: 'Europe/Berlin', open: [9, 0], close: [17, 30], name: 'Fráncfort', sub: 'Xetra' },
  tyo: { tz: 'Asia/Tokyo', open: [9, 0], close: [15, 30], name: 'Tokio', sub: 'TSE' },
};

let root, equity, range = '1M', movers = 'gainers', timer;

/** Precio en vivo que parpadea al cambiar (data-flash); vacío = esqueleto hasta la primera cotización. */
const livePrice = (a) => html`<span class="num" data-px="${a.symbol}" data-q="${a.quote}" data-flash>${tick(a.symbol)?.price ? price(tick(a.symbol).price, a.quote) : ''}</span>`;
const skeletonRows = (n, caption) => html`<div class="sk-rows" role="status">${Array.from({ length: n }, () => html`<div class="sk-row"><span class="skeleton"></span><span class="skeleton sk-line w-60"></span><span class="skeleton sk-line"></span></div>`)}
  ${caption ? html`<span class="sk-caption">${caption}</span>` : html`<span class="sr-only">Cargando…</span>`}</div>`;

export const title = 'Resumen';

export function mount(el) {
  root = el;
  on(root, 'click', '[data-seg="range"] button', (_, b) => { range = b.dataset.value; pressSeg(root, 'range', range); drawEquity(); });
  on(root, 'click', '[data-seg="movers"] button', (_, b) => { movers = b.dataset.value; pressSeg(root, 'movers', movers); renderMovers(); });
  on(root, 'click', '[data-asset]', (_, el2) => go(`/trade/${el2.dataset.asset}`));
  store.on('account', () => root.isConnected && !root.hidden && renderAll());
  store.on('watchlist', () => !root.hidden && renderWatchlist());
  store.on('markets', () => !root.hidden && renderSessions());
}

export function show() {
  renderAll();
  clearInterval(timer);
  timer = setInterval(() => { renderSummary(); renderMovers(); renderBreadth(); renderAllocation(); renderSessions(); }, 3000);
}
export function hide() { clearInterval(timer); }
export function theme() { equity?.theme(); drawEquity(); }

function renderAll() {
  const practice = store.hasPractice();
  equity?.destroy();
  equity = null;
  render(root, html`
    <div class="dash">
      <div class="stack">
        ${practice ? html`
          <section class="card">
            <div class="hero-top">
              <div>
                <span class="hero-label">${icon('wallet', 'sm')} Patrimonio total</span>
                <div class="hero-value money" id="d-equity"></div>
                <div class="hero-delta" id="d-delta"></div>
              </div>
              ${seg('range', RANGES, range)}
            </div>
            <div class="hero-chart" id="d-chart"></div>
          </section>
          <div class="kpis" id="d-kpis"></div>` : html`
          <section class="card cta" aria-labelledby="d-cta-title">
            <span class="chip accent">${icon('graduation-cap', 'sm')} Simulador de trading</span>
            <h2 id="d-cta-title">Practica trading con cotizaciones reales y dinero virtual</h2>
            <p>Compra y vende criptomonedas y acciones de Wall Street e IBEX 35 a precio de mercado, con un saldo ficticio que eliges tú. Sin registro: todo se guarda en tu navegador.</p>
            <p class="disclaimer" role="note">${icon('info', 'sm')} Simulador con dinero virtual. No es asesoramiento financiero.</p>
            <div class="cta-points">
              <span>${icon('circle-check')} Cotizaciones en vivo</span>
              <span>${icon('circle-check')} Órdenes límite y stop</span>
              <span>${icon('circle-check')} Diario con estadísticas</span>
            </div>
            <div class="gap-8">
              <button class="btn btn-primary btn-lg" data-action="account">${icon('play')} Probar demo</button>
              <button class="btn btn-ghost btn-lg" data-action="tour">Ver cómo funciona</button>
            </div>
          </section>
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
            <div class="card-head"><h2 class="card-title">${icon('layers')} Distribución</h2></div>
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
  renderSummary();
  renderWatchlist();
  renderMovers();
  renderBreadth();
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
    box.insertAdjacentHTML('beforeend', String(empty('chart-area', 'Tu curva aparecerá aquí', 'Se registra un punto cada minuto mientras la app está abierta.')));
  }
  equity.setData(points, store.initialCapital());
}

function renderSummary() {
  if (store.hasPractice()) {
    const p = portfolio();
    const total = p.equityUsd - store.initialCapital();
    render($('#d-equity', root), money(p.equityUsd));
    render($('#d-delta', root), html`${changeChip(p.returnPct)}
      <span class="money delta ${trendClass(total)}">${money(total, { signed: true })}</span> desde el inicio
      ${p.rows.length ? html`· <span class="money delta ${trendClass(p.change24hUsd)}">${money(p.change24hUsd, { signed: true })}</span> hoy` : ''}`);
    const t = store.trades();
    const wins = t.filter((x) => x.pnl > 0).length;
    render($('#d-kpis', root), html`
      ${kpi('Efectivo disponible', moneyHtml(p.cashUsd), p.reservedUsd ? html`<span class="money">${money(p.reservedUsd)}</span> en órdenes` : 'Listo para operar')}
      ${kpi('Invertido', moneyHtml(p.holdingsUsd), `${p.rows.length} ${p.rows.length === 1 ? 'posición' : 'posiciones'}`)}
      ${kpi('P&L no realizado', html`<span class="money delta ${trendClass(p.unrealizedUsd)}">${money(p.unrealizedUsd, { signed: true })}</span>`, p.investedUsd ? pct((p.unrealizedUsd / p.investedUsd) * 100) : '—')}
      ${kpi('Tasa de acierto', t.length ? pct((wins / t.length) * 100, { signed: false, decimals: 0 }) : '—', `${t.length} operaciones cerradas`)}`);
  } else {
    render($('#d-tiles', root), ['BTC', 'ETH', 'IBEX', 'NVDA'].map((s) => {
      const a = findAsset(s);
      return html`<button class="card kpi" data-asset="${a.symbol}"><span>${a.name}</span><strong>${livePrice(a)}</strong>${liveChange(a)}</button>`;
    }));
  }
}

const kpi = (label, value, sub) => html`<div class="card kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;

/* ---------- Favoritos con sparklines ---------- */
async function renderWatchlist() {
  const box = $('#d-watch', root);
  if (!box) return;
  const list = store.watchlist().map(findAsset).filter(Boolean);
  if (!list.length) return render(box, empty('star', 'Sin favoritos', 'Pulsa + o la estrella de cualquier activo para seguirlo aquí.'));
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

/* ---------- Distribución de cartera (barra apilada + leyenda) ---------- */
function renderAllocation() {
  const box = $('#d-alloc', root);
  if (!box) return;
  const p = portfolio();
  if (!(p.equityUsd > 0)) return;
  const rows = [...p.rows].sort((a, b) => b.valueUsd - a.valueUsd);
  const top = rows.slice(0, 5).map((r, i) => ({ label: r.symbol, usd: r.valueUsd, cls: `c-${i + 1}` }));
  const rest = rows.slice(5).reduce((s, r) => s + r.valueUsd, 0);
  if (rest > 0) top.push({ label: 'Otros', usd: rest, cls: 'c-6' });
  top.push({ label: 'Efectivo', usd: p.cashUsd + p.reservedUsd, cls: 'c-6' });
  const share = (usd) => (usd / p.equityUsd) * 100;
  render(box, html`<div class="alloc-bar" role="img" aria-label="Distribución de la cartera">
      ${top.filter((s) => s.usd > 0).map((s) => html`<i class="${s.cls}" data-w="${share(s.usd).toFixed(2)}"></i>`)}</div>
    <div class="alloc-legend">${top.map((s) => html`<div><i class="${s.cls}"></i><span>${s.label}</span><span class="money">${money(s.usd)}</span><span>${pct(share(s.usd), { signed: false, decimals: 1 })}</span></div>`)}</div>`);
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
      <strong>${n.title}</strong><small>${n.source} · ${timeAgo(n.date)}</small></a>`) : empty('newspaper', 'Sin noticias por ahora', 'Las fuentes no han publicado titulares financieros recientes.'));
  } catch {
    render(box, empty('wifi-off', 'No hay noticias ahora mismo', 'No se pudo conectar con las fuentes. Vuelve a abrir el Resumen en unos minutos.'));
  }
}

