// Menús desplegables de la cabecera (Mercados y Aprender), de dos columnas como en TradingView:
// a la izquierda icono + título + descripción y a la derecha las subcategorías.
// Accesibles con teclado: Intro/Espacio/↓ abren y llevan el foco al primer enlace, ↑/↓ recorren los enlaces,
// Esc cierra y devuelve el foco al botón, Tab fuera del panel lo cierra. Todo el texto va con nodos (lib/el.js).
import { ASSETS } from '../lib/catalog.js';
import { h, svgIcon, mount } from '../lib/el.js';

const MENUS = {
  markets: {
    label: 'Mercados',
    primary: [
      ['coins', 'Cripto', 'Bitcoin, Ethereum y más, con precio en vivo.', '#/markets/crypto'],
      ['trending-up', 'Acciones de EE. UU.', 'Wall Street, en dólares.', '#/markets/us'],
      ['globe', 'IBEX 35 y España', 'La bolsa española, en euros.', '#/markets/es'],
      ['star', 'Favoritos', 'Los activos que sigues.', '#/markets/fav'],
    ],
    secondaryTitle: 'Populares',
    secondary: () => ASSETS.slice(0, 7).map((a) => [`${a.name} (${a.symbol})`, `#/trade/${a.symbol}`]),
    footer: ['Ver todos los mercados', '#/markets'],
  },
  learn: {
    label: 'Aprender',
    primary: [
      ['graduation-cap', 'Lecciones', 'Mini-lecciones de 2 a 3 minutos.', '#/learn'],
      ['book-open', 'Glosario', 'Los términos del trading, explicados.', '#/learn/glosario'],
      ['sparkles', 'Qué es el paper trading', 'Empieza por aquí.', '#/learn/que-es-paper-trading'],
    ],
    secondaryTitle: 'Todas las lecciones',
    secondary: async () => (await import('../lib/learn-content.js')).LESSONS.slice(0, 8).map((l) => [l.title, `#/learn/${l.id}`]),
    footer: ['Ir a Aprender', '#/learn'],
  },
};

const links = (panel) => [...panel.querySelectorAll('a')];

async function fill(panel, key) {
  const m = MENUS[key];
  const second = await m.secondary();
  mount(panel,
    h('div', { class: 'mega-col mega-main' }, m.primary.map(([ic, title, desc, href]) =>
      h('a', { class: 'mega-item', href },
        h('span', { class: 'mega-ic' }, svgIcon(ic)),
        h('span', { class: 'mega-tx' }, h('strong', {}, title), h('small', {}, desc))))),
    h('div', { class: 'mega-col mega-side' },
      h('p', { class: 'mega-title' }, m.secondaryTitle),
      second.map(([text, href]) => h('a', { class: 'mega-link', href }, text)),
      h('a', { class: 'mega-link mega-all', href: m.footer[1] }, m.footer[0], ' ', svgIcon('arrow-right', 'sm'))));
}

export function initMegaMenus() {
  const nav = document.querySelector('.top-nav');
  if (!nav) return;
  const items = [...nav.querySelectorAll('[data-mega]')];
  let openItem = null;

  const close = (item, refocus = false) => {
    if (!item) return;
    const btn = item.querySelector('.mega-btn');
    item.querySelector('.mega-panel').hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    if (openItem === item) openItem = null;
    if (refocus) btn.focus();
  };
  const open = async (item, focusFirst = false) => {
    if (openItem && openItem !== item) close(openItem);
    const panel = item.querySelector('.mega-panel');
    if (!panel.childElementCount) await fill(panel, item.dataset.mega);
    panel.hidden = false;
    item.querySelector('.mega-btn').setAttribute('aria-expanded', 'true');
    openItem = item;
    if (focusFirst) links(panel)[0]?.focus();
  };

  for (const item of items) {
    const key = item.dataset.mega;
    const btn = item.querySelector('.mega-btn');
    const panel = item.querySelector('.mega-panel');
    mount(btn, MENUS[key].label, svgIcon('chevron-down', 'sm'));
    btn.addEventListener('click', () => (btn.getAttribute('aria-expanded') === 'true' ? close(item) : open(item)));
    // Con ratón se abre al pasar por encima (solo en puntero fino; en táctil basta con tocar)
    item.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(item); });
    item.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') close(item); });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(item, true); }
    });
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openItem === item) { e.stopPropagation(); close(item, true); return; }
      if (e.target.closest('.mega-panel') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const list = links(panel);
        const i = list.indexOf(document.activeElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      }
    });
    item.addEventListener('focusout', (e) => { if (!item.contains(e.relatedTarget)) close(item); });
    panel.addEventListener('click', (e) => { if (e.target.closest('a')) close(item); });
  }
  document.addEventListener('pointerdown', (e) => { if (openItem && !openItem.contains(e.target)) close(openItem); });
  addEventListener('hashchange', () => close(openItem));
}

/** Marca como activo el botón del menú cuyo grupo contiene la vista actual. */
export function markMegaActive(view) {
  for (const item of document.querySelectorAll('[data-mega]')) {
    const btn = item.querySelector('.mega-btn');
    if (item.dataset.mega === view) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  }
}
