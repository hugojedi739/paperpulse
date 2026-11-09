// Paleta de comandos (Ctrl/Cmd + K): busca activos en el catálogo y en Binance/bolsa, y ejecuta acciones.
import * as store from '../lib/store.0a662702.js';
import { tick } from '../lib/feed.c2f1ea36.js';
import { ASSETS, findAsset, toAsset, register } from '../lib/catalog.f1b2b586.js';
import { html, icon, render, openDialog, debounce, $ } from '../lib/dom.a575914e.js';
import { price, pct, trendClass } from '../lib/format.ede94c05.js';
import { search } from '../lib/marketdata.c9567489.js';
import { assetIcon } from '../lib/ui.13a5e1da.js';
import { go } from '../lib/router.de30a562.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let dialog, input, list, items = [], active = 0, abort, commands = [];

/** `cmds`: [{ label, icon, keywords, run }] */
export function initPalette(cmds) {
  commands = cmds;
  dialog = $('#palette');
  input = $('#palette-input');
  list = $('#palette-list');
  input.addEventListener('input', debounce(() => update(input.value), 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  });
  list.addEventListener('click', (e) => {
    const el = e.target.closest('[data-i]');
    if (el) items[Number(el.dataset.i)]?.run();
  });
  list.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-i]');
    if (el && Number(el.dataset.i) !== active) select(Number(el.dataset.i));
  });
}

export function openPalette(prefill = '') {
  input.value = prefill;
  openDialog(dialog);
  input.focus();
  update(prefill);
}

const assetItem = (a) => ({
  kind: 'asset', asset: a,
  run: () => { register(a); store.addRecent(a); dialog.close(); go(`/trade/${a.symbol}`); },
});

function localMatches(q) {
  const n = norm(q);
  return ASSETS.filter((a) => norm(a.symbol).startsWith(n) || norm(a.name).includes(n) || norm(a.ticker).startsWith(n));
}

async function update(q) {
  abort?.abort();
  const query = q.trim();
  if (!query) {
    const recent = store.recentSearches().map((r) => findAsset(r.symbol) ?? register(toAsset(r))).filter(Boolean);
    const fav = store.watchlist().map(findAsset).filter(Boolean);
    return draw([
      ['Recientes', recent.slice(0, 5).map(assetItem)],
      ['Favoritos', fav.filter((a) => !recent.includes(a)).slice(0, 6).map(assetItem)],
      ['Acciones', commands.map((c) => ({ kind: 'cmd', ...c, run: () => { dialog.close(); c.run(); } }))],
    ]);
  }
  const cmdHits = commands.filter((c) => norm(`${c.label} ${c.keywords ?? ''}`).includes(norm(query)))
    .map((c) => ({ kind: 'cmd', ...c, run: () => { dialog.close(); c.run(); } }));
  const local = localMatches(query).map(assetItem);
  draw([['Activos', local], ['Acciones', cmdHits]], query.length >= 2);
  if (query.length < 2) return;
  abort = new AbortController();
  try {
    const remote = (await search(query, abort.signal)).map(toAsset).filter((a) => a && !local.some((l) => l.asset.symbol === a.symbol));
    if (input.value.trim() === query) draw([['Activos', local], ['Más resultados', remote.slice(0, 8).map(assetItem)], ['Acciones', cmdHits]]);
  } catch (err) {
    if (err.name !== 'AbortError') draw([['Activos', local], ['Acciones', cmdHits]]);
  }
}

function draw(groups, loading = false) {
  items = groups.flatMap(([, g]) => g);
  active = 0;
  let i = 0;
  const row = (it) => {
    const idx = i++;
    if (it.kind === 'cmd') {
      return html`<button class="pl-item" role="option" data-i="${idx}" aria-selected="${idx === 0}"><span class="pl-icon">${icon(it.icon)}</span><span>${it.label}</span><span></span></button>`;
    }
    const a = it.asset, t = tick(a.symbol);
    return html`<button class="pl-item" role="option" data-i="${idx}" aria-selected="${idx === 0}">${assetIcon(a)}
      <span><strong>${a.name}</strong> <small>${a.symbol} · ${a.type === 'crypto' ? 'Cripto' : a.market === 'es' ? 'Bolsa de Madrid' : 'Bolsa EE. UU.'}</small></span>
      <span class="row-end">${t?.price ? price(t.price, a.quote) : ''}<small class="delta ${trendClass(t?.change24h)}">${t?.change24h != null ? pct(t.change24h) : ''}</small></span></button>`;
  };
  const body = groups.filter(([, g]) => g.length).map(([label, g]) => html`<div class="pl-group">${label}</div>${g.map(row)}`);
  render(list, items.length ? body : html`<div class="empty">${icon(loading ? 'refresh-cw' : 'search')}<p>${loading ? 'Buscando en Binance y bolsas…' : 'Sin resultados'}</p></div>`);
}

function select(i) {
  if (!items.length) return;
  active = (i + items.length) % items.length;
  list.querySelectorAll('[data-i]').forEach((el) => el.setAttribute('aria-selected', String(Number(el.dataset.i) === active)));
  list.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
}
