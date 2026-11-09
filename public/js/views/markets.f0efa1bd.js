// Vista Mercados: tabla filtrable y ordenable con precios en vivo y tendencia.
import * as store from '../lib/store.0a662702.js';
import { tick } from '../lib/feed.c2f1ea36.js';
import { ASSETS } from '../lib/catalog.f1b2b586.js';
import { html, icon, render, on, $, debounce } from '../lib/dom.a575914e.js';
import { money, price, pct, trendClass, toUsd } from '../lib/format.ede94c05.js';
import { sparkline } from '../lib/charts.237b0f40.js';
import { cryptoMarkets, stockSpark } from '../lib/marketdata.c9567489.js';
import { assetCell, empty, seg, pressSeg, liveChange } from '../lib/ui.13a5e1da.js';
import { go } from '../lib/router.de30a562.js';

const CATEGORIES = [['all', 'Todos'], ['crypto', 'Cripto'], ['es', 'España'], ['us', 'EE. UU.'], ['fav', 'Favoritos']];
const COLUMNS = [
  ['rank', '#'], ['name', 'Activo'], ['price', 'Precio', 'r'], ['change', '24 h', 'r hide-sm'], ['change7d', '7 d', 'r hide-sm'],
  ['cap', 'Capitalización', 'r hide-sm'], ['volume', 'Volumen 24 h', 'r hide-sm'], [null, 'Tendencia', 'hide-sm'], [null, '', 'hide-sm'],
];

/** Precio en vivo que parpadea al cambiar (data-flash); vacío = esqueleto hasta la primera cotización. */
const livePrice = (a) => html`<span class="num" data-px="${a.symbol}" data-q="${a.quote}" data-flash>${tick(a.symbol)?.price ? price(tick(a.symbol).price, a.quote) : ''}</span>`;

let root, category = 'all', query = '', sortKey = 'rank', sortDir = 1, cg = new Map(), sparks = new Map();

export const title = 'Mercados';

export function mount(el) {
  root = el;
  render(root, html`
    <div class="toolbar-row">
      ${seg('cat', CATEGORIES, category)}
      <label class="input-group"><span>${icon('search', 'sm')}</span><input id="m-search" type="search" placeholder="Filtrar por nombre o símbolo" aria-label="Filtrar mercados"></label>
    </div>
    <section class="card flush"><div class="table-wrap"><table class="table markets-table">
      <thead><tr>${COLUMNS.map(([key, label, cls]) => html`<th class="${cls ?? ''}" ${key === sortKey ? html`aria-sort="${sortDir > 0 ? 'ascending' : 'descending'}"` : ''}>
        ${key ? html`<button class="th-sort" data-sort="${key}">${label}</button>` : label}</th>`)}</tr></thead>
      <tbody id="m-body"></tbody></table></div></section>`);

  on(root, 'click', '[data-seg="cat"] button', (_, b) => { category = b.dataset.value; pressSeg(root, 'cat', category); draw(); });
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

export async function show() {
  draw();
  cg = await cryptoMarkets();
  draw();
  await Promise.all(ASSETS.filter((a) => a.type === 'stock').map(async (a) => sparks.set(a.symbol, await stockSpark(a))));

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
      volume: m.volume ?? (t?.volume24h && t?.price ? toUsd(t.volume24h * t.price, a.quote) : null),
      spark: m.spark ?? sparks.get(a.symbol),
    };
  });
}

function draw() {
  const body = $('#m-body', root);
  let list = rows().filter((r) => category === 'all'
    || (category === 'fav' ? r.fav : category === 'crypto' ? r.a.type === 'crypto' : r.a.market === category));
  if (query) list = list.filter((r) => r.a.name.toLowerCase().includes(query) || r.a.symbol.toLowerCase().includes(query));
  list.sort((x, y) => {
    const a = x[sortKey], b = y[sortKey];
    if (a == null) return 1;
    if (b == null) return -1;
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * sortDir;
  });
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

