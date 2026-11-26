// Vista Mercados: tabla filtrable y ordenable con precios en vivo y tendencia.
import * as store from '../lib/store.a368de54.js';
import { tick } from '../lib/feed.14272b63.js';
import { ASSETS } from '../lib/catalog.847c7742.js';
import { html, icon, render, on, $, debounce } from '../lib/dom.a575914e.js';
import { money, price, pct, trendClass, toUsd } from '../lib/format.df8faa5e.js';
import { sparkline } from '../lib/charts.6e47b58d.js';
import { cryptoMarkets, stockSpark, savedCryptoMarkets, savedStockSparks } from '../lib/marketdata.96e24305.js';
import { assetCell, empty, seg, pressSeg, liveChange } from '../lib/ui.df413464.js';
import { go } from '../lib/router.de30a562.js';

const CATEGORIES = [['all', 'Todos'], ['crypto', 'Cripto'], ['es', 'España'], ['us', 'EE. UU.'], ['fav', 'Favoritos']];
const MOVERS = [['all', 'Todos'], ['up', 'Mayores subidas'], ['down', 'Mayores bajadas']];
const COLUMNS = [
  ['rank', '#'], ['name', 'Activo'], ['price', 'Precio', 'r'], ['change', '24 h', 'r hide-sm'], ['change7d', '7 d', 'r hide-sm'],
  ['cap', 'Capitalización', 'r hide-sm'], ['volume', 'Vol. 24 h (global)', 'r hide-sm', 'Volumen agregado de todo el mercado (CoinGecko). En Operar, el volumen es solo el de Binance, por eso las cifras no coinciden.'], [null, 'Tendencia', 'hide-sm'], [null, '', 'hide-sm'],
];

/** Precio en vivo que parpadea al cambiar (data-flash); vacío = esqueleto hasta la primera cotización. */
const livePrice = (a) => html`<span class="num" data-px="${a.symbol}" data-q="${a.quote}" data-flash>${tick(a.symbol)?.price ? price(tick(a.symbol).price, a.quote) : ''}</span>`;

let root, category = 'all', movers = 'all', query = '', sortKey = 'rank', sortDir = 1, cg = new Map(), sparks = new Map();

export const title = 'Mercados';

export function mount(el) {
  root = el;
  render(root, html`
    <div class="toolbar-row">
      ${seg('cat', CATEGORIES, category)}
      ${seg('movers', MOVERS, movers)}
      <label class="input-group"><span>${icon('search', 'sm')}</span><input id="m-search" type="search" placeholder="Filtrar por nombre o símbolo" aria-label="Filtrar mercados"></label>
    </div>
    <section class="card flush"><div class="table-wrap"><table class="table markets-table">
      <thead><tr>${COLUMNS.map(([key, label, cls, tip]) => html`<th class="${cls ?? ''}" ${tip ? html`title="${tip}"` : ''} ${key === sortKey ? html`aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>
        ${key ? html`<button class="th-sort" data-sort="${key}">${label}</button>` : label}</th>`)}</tr></thead>
      <tbody id="m-body"></tbody></table></div></section>`);

  on(root, 'click', '[data-seg="cat"] button', (_, b) => { category = b.dataset.value; pressSeg(root, 'cat', category); draw(); });
  on(root, 'click', '[data-seg="movers"] button', (_, b) => {
    movers = b.dataset.value; pressSeg(root, 'movers', movers);
    sortKey = 'change'; sortDir = movers === 'down' ? 1 : -1; // subidas: de mayor a menor; bajadas: de la peor a la mejor
    root.querySelectorAll('th').forEach((th) => th.removeAttribute('aria-sort'));
    draw();
  });
  on(root, 'input', '#m-search', debounce((e) => { query = e.target.value.trim().toLowerCase(); draw(); }, 150));
  on(root, 'click', '[data-sort]', (_, b) => {
    const key = b.dataset.sort;
    sortDir = key === sortKey ? -sortDir : key === 'name' || key === 'rank' ? 1 : -1;
    sortKey = key;
    root.querySelectorAll('th').forEach((th) => th.removeAttribute('aria-sort'));
    b.closest('th').setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
    draw();
  });
  on(root, 'click', '[data-star]', (e, b) => { e.stopPropagation(); b.setAttribute('aria-pressed', String(store.toggleWatchlist(b.dataset.star))); });
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('button')) go(tr.dataset.href); });
  on(root, 'click', '[data-href-btn]', (_, b) => go(b.closest('tr').dataset.href));
  on(root, 'keydown', 'tr[data-href]', (e, tr) => { if (e.key === 'Enter' && e.target === tr) go(tr.dataset.href); });
}

const CATEGORY_IDS = new Set(CATEGORIES.map(([id]) => id));

export async function show(param = '') {
  if (CATEGORY_IDS.has(param)) { category = param; pressSeg(root, 'cat', category); } // #/markets/crypto, /us, /es, /fav
  // Primero lo último guardado (capitalización, 7 d, minigráficas) y después lo nuevo, por detrás
  if (!cg.size) cg = savedCryptoMarkets() ?? cg;
  if (!sparks.size) for (const [sym, v] of Object.entries(savedStockSparks())) sparks.set(sym, v);
  draw();
  const fresh = await cryptoMarkets();
  if (fresh.size) cg = fresh; // si CoinGecko falla, se queda lo guardado en vez de vaciar la tabla
  draw();
  await Promise.all(ASSETS.filter((a) => a.type === 'stock').map(async (a) => { const v = await stockSpark(a); if (v) sparks.set(a.symbol, v); }));

  if (!root.hidden) draw();
}

function rows() {
  const fav = new Set(store.watchlist());
  return ASSETS.map((a, i) => {
    const t = tick(a.symbol);
    const m = cg.get(a.symbol) ?? {};
    return {
      a, fav: fav.has(a.symbol),
      rank: m.rank ?? 100 + i, name: a.name, price: t?.price ? toUsd(t.price, a.quote) : null,
      change: t?.change24h ?? null, change7d: m.change7d ?? null, cap: m.cap ?? null,
      // En cripto, volume24h ya viene en la divisa de cotización (USDT); en bolsa, en acciones
      volume: m.volume ?? (t?.volume24h && t?.price ? toUsd(a.type === 'crypto' ? t.volume24h : t.volume24h * t.price, a.quote) : null),
      spark: m.spark ?? sparks.get(a.symbol),
    };
  });
}

function draw() {
  const body = $('#m-body', root);
  let list = rows().filter((r) => category === 'all'
    || (category === 'fav' ? r.fav : category === 'crypto' ? r.a.type === 'crypto' : r.a.market === category));
  if (movers !== 'all') list = list.filter((r) => (tick(r.a.symbol)?.change24h ?? r.change ?? 0) * (movers === 'up' ? 1 : -1) > 0);
  if (query) list = list.filter((r) => r.a.name.toLowerCase().includes(query) || r.a.symbol.toLowerCase().includes(query));
  list.sort((x, y) => {
    const a = x[sortKey], b = y[sortKey];
    if (a == null) return 1;
    if (b == null) return -1;
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * sortDir;
  });
  // Columnas sin dato en esta lista (p. ej. capitalización en bolsa o con CoinGecko caído): se ocultan en vez de llenarse de «—»
  const table = body.closest('table');
  for (const [cls, key] of [['no-7d', 'change7d'], ['no-cap', 'cap'], ['no-vol', 'volume'], ['no-spark', 'spark']]) {
    table.classList.toggle(cls, list.length > 0 && !list.some((r) => (key === 'spark' ? r.spark?.length : r[key] != null)));
  }
  if (!list.length) return render(body, html`<tr><td colspan="9">${empty('search', category === 'fav' && !query ? 'Sin favoritos todavía' : 'Sin resultados', category === 'fav' && !query ? 'Pulsa la estrella de cualquier activo para seguirlo aquí.' : 'Prueba con otro filtro o busca cualquier activo con Ctrl + K.')}</td></tr>`);
  render(body, list.map((r, i) => html`<tr data-href="/trade/${r.a.symbol}" tabindex="0">
    <td class="muted"><button class="icon-btn sm star" data-star="${r.a.symbol}" aria-pressed="${r.fav}" aria-label="Favorito ${r.a.symbol}">${icon('star')}</button> <span class="hide-sm">${i + 1}</span></td>
    <td>${assetCell(r.a)}</td>
    <td class="r"><strong>${livePrice(r.a)}</strong><div class="show-sm">${liveChange(r.a)}</div></td>
    <td class="r hide-sm">${liveChange(r.a, 'span')}</td>
    <td class="r hide-sm"><span class="delta ${trendClass(r.change7d)}">${pct(r.change7d)}</span></td>
    <td class="r hide-sm">${r.cap ? money(r.cap, { compact: true }) : '—'}</td>
    <td class="r hide-sm">${r.volume ? money(r.volume, { compact: true }) : '—'}</td>
    <td class="hide-sm">${sparkline(r.spark, { width: 110 })}</td>
    <td class="r hide-sm"><button class="btn btn-ghost btn-sm" data-href-btn>Operar</button></td></tr>`));
}

