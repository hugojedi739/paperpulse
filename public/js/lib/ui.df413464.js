// Piezas de interfaz reutilizadas por varias vistas.
import { html, icon, raw } from './dom.a575914e.js';
import { findAsset } from './catalog.847c7742.js';
import { pct, trendClass, money, price } from './format.df8faa5e.js';
import { tick } from './feed.14272b63.js';
import { marketOpen } from './store.a368de54.js';

const hue = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;

export function assetIcon(assetOrSymbol, size = '') {
  const sym = typeof assetOrSymbol === 'string' ? assetOrSymbol : assetOrSymbol?.symbol ?? '?';
  const known = findAsset(sym);
  return html`<span class="asset ${size}" ${known ? html`data-sym="${known.symbol}"` : html`data-hue="${hue(sym)}"`} aria-hidden="true">${sym.slice(0, 4)}</span>`;
}

export function assetCell(asset, sub) {
  return html`<div class="asset-cell">${assetIcon(asset)}<div><strong>${asset.name}</strong><small>${sub ?? asset.symbol}</small></div></div>`;
}

export function changeChip(value) {
  if (!Number.isFinite(value)) return html`<span class="chip">—</span>`;
  const cls = trendClass(value);
  return html`<span class="chip ${cls}">${icon(value >= 0 ? 'arrow-up-right' : 'arrow-down-right', 'sm')}${pct(value)}</span>`;
}

/** Importe en divisa de la cuenta, difuminable con el modo privacidad. */
export const moneyHtml = (usd, opts) => html`<span class="money">${money(usd, opts)}</span>`;

export function statusChip(asset) {
  const open = marketOpen(asset);
  if (asset?.type !== 'stock') return html`<span class="chip up"><span class="dot"></span>24/7</span>`;
  if (open == null) return html`<span class="chip">Bolsa</span>`;
  return open ? html`<span class="chip up"><span class="dot"></span>Abierto</span>` : html`<span class="chip">Cerrado</span>`;
}

export function empty(iconName, title, text, action = '') {
  return html`<div class="empty">${icon(iconName)}<strong>${title}</strong>${text ? html`<p>${text}</p>` : ''}${action}</div>`;
}

export function seg(name, options, current) {
  return html`<div class="seg" role="group" data-seg="${name}">${options.map(([value, label]) =>
    html`<button type="button" data-value="${value}" aria-pressed="${String(value) === String(current)}">${label}</button>`)}</div>`;
}

/** Marca como pulsado el botón elegido de un control segmentado. */
export function pressSeg(root, name, value) {
  root.querySelectorAll(`[data-seg="${name}"] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(value))));
}

/* ---------- Valores en vivo: cualquier [data-px] / [data-chg] se refresca con cada lote de precios ---------- */
export function livePrice(asset) {
  const t = tick(asset.symbol);
  return html`<span class="num" data-px="${asset.symbol}" data-q="${asset.quote}">${price(t?.price, asset.quote)}</span>`;
}
export function liveChange(asset, tag = 'small') {
  const v = tick(asset.symbol)?.change24h;
  return html`<${raw(tag)} class="num ${trendClass(v)}" data-chg="${asset.symbol}">${pct(v)}</${raw(tag)}>`;
}
export function updateLive(symbols) {
  for (const el of document.querySelectorAll('[data-px]')) {
    if (!symbols.has(el.dataset.px)) continue;
    const t = tick(el.dataset.px);
    if (!t?.price) continue;
    el.textContent = price(t.price, el.dataset.q);
    if (t.prev && t.prev !== t.price && el.dataset.flash !== undefined) {
      el.classList.remove('flash-up', 'flash-down');
      el.classList.add(t.price > t.prev ? 'flash-up' : 'flash-down');
      setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 600);
    }
  }
  for (const el of document.querySelectorAll('[data-chg]')) {
    if (!symbols.has(el.dataset.chg)) continue;
    const v = tick(el.dataset.chg)?.change24h;
    el.textContent = pct(v);
    el.classList.remove('up', 'down', 'flat');
    el.classList.add(trendClass(v));
  }
}

/** Función que existe con cuenta gratuita: candado, texto breve y «Crear cuenta gratis». Sin popups ni cortes. */
export function lockedNote(what) {
  return html`<div class="locked" role="note">${icon('lock', 'sm')}<span><strong>${what}</strong> · Disponible con cuenta gratuita</span>
    <button type="button" class="btn btn-sm btn-ghost" data-action="register">Crear cuenta gratis</button></div>`;
}
