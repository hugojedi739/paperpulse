// Vista Noticias: titulares reales filtrables por categoría con lector integrado.
import { html, icon, render, on, $ } from '../lib/dom.a575914e.js';
import { timeAgo } from '../lib/format.2cdb7d3b.js';
import { news, safeUrl } from '../lib/marketdata.74c28a79.js';
import { empty } from '../lib/ui.e378caee.js';
import { newsDialog } from '../ui/dialogs.d51cb492.js';

const FILTERS = [['all', 'Todas'], ['crypto', 'Cripto'], ['stocks', 'Bolsa'], ['economy', 'Economía'], ['analysis', 'Análisis']];
const CATEGORY = { crypto: ['Cripto', 'coins'], stocks: ['Bolsa', 'chart-candlestick'], economy: ['Economía', 'globe'], analysis: ['Análisis', 'chart-line'] };

let root, filter = 'all', articles = [];

export const title = 'Noticias';

export function mount(el) {
  root = el;
  render(root, html`<div class="filters" role="group" aria-label="Categorías">
      ${FILTERS.map(([v, l]) => html`<button type="button" data-filter="${v}" aria-pressed="${v === filter}">${l}</button>`)}</div>
    <div class="news-grid" id="n-grid"></div>`);
  on(root, 'click', '[data-filter]', (_, b) => {
    filter = b.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw();
  });
  on(root, 'click', '[data-article]', (_, b) => newsDialog(articles[Number(b.dataset.article)]));
  on(root, 'click', '[data-act="retry"]', () => show());
}

export async function show() {
  const grid = $('#n-grid', root);
  if (!articles.length) render(grid, Array.from({ length: 6 }, () => html`<div class="news-card"><div class="news-media skeleton"></div><div class="news-body"><div class="skeleton">&nbsp;</div><div class="skeleton">&nbsp;</div></div></div>`));
  try {
    articles = await news();
    draw();
  } catch {
    render(grid, html`<div class="card">${empty('wifi-off', 'No se pudieron cargar las noticias', 'Comprueba tu conexión e inténtalo de nuevo. No mostramos noticias inventadas.',
      html`<button class="btn btn-primary" data-act="retry">${icon('refresh-cw', 'sm')} Reintentar</button>`)}</div>`);
  }
}

function draw() {
  const list = articles.map((a, i) => ({ a, i })).filter(({ a }) => filter === 'all' || a.category === filter);
  if (!list.length) return render($('#n-grid', root), html`<div class="card">${empty('newspaper', 'Sin noticias en esta categoría')}</div>`);
  render($('#n-grid', root), list.map(({ a, i }, pos) => {
    const [label, ico] = CATEGORY[a.category] ?? ['General', 'newspaper'];
    const img = safeUrl(a.imageUrl);
    return html`<button type="button" class="news-card ${pos === 0 ? 'feature' : ''}" data-article="${i}">
      ${img ? html`<div class="news-media"><img src="${img}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`
        : html`<div class="news-media placeholder">${icon(ico)}</div>`}
      <div class="news-body">
        <div class="news-meta"><span class="chip">${label}</span><span>${a.source}</span><span>·</span><span>${timeAgo(a.date)}</span></div>
        <h3>${a.title}</h3>
        ${a.excerpt ? html`<p>${a.excerpt}</p>` : ''}
      </div></button>`;
  }));
  // Si una imagen remota falla, se sustituye por el marcador neutro
  root.querySelectorAll('.news-media img').forEach((img) => img.addEventListener('error', () => {
    img.parentElement.classList.add('placeholder');
    img.replaceWith(document.createRange().createContextualFragment(String(icon('newspaper'))));
  }, { once: true }));
}
