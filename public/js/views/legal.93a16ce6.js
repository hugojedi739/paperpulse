// Páginas legales (aviso legal, privacidad, términos, cookies y normas). Texto en lib/legal-content.js.
import { PAGES, pageById, LAST_UPDATED } from '../lib/legal-content.ebcde7ce.js';
import { h, svgIcon, mount as put } from '../lib/el.71f9edc9.js';
import { on } from '../lib/dom.a575914e.js';
import { go } from '../lib/router.de30a562.js';

export const title = 'Información legal';
let root;

export function mount(el) {
  root = el;
  on(root, 'click', '[data-legal]', (_, b) => go(`/legal/${b.dataset.legal}`));
}

const tabs = (current) => h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Textos legales' }, PAGES.map((p) =>
  h('button', { type: 'button', role: 'tab', 'aria-selected': String(p.id === current), dataset: { legal: p.id } }, svgIcon(p.icon, 'sm'), ` ${p.title}`)));

// Bloques: texto, {list: [...]} con viñetas o {link: [texto, '#/ruta']} con un enlace interno
const block = (item) => {
  if (typeof item === 'string') return h('p', { class: 'learn-p' }, item);
  if (item.link) return h('p', { class: 'learn-p' }, h('a', { href: item.link[1] }, item.link[0]));
  return h('ul', { class: 'legal-list' }, item.list.map((x) => h('li', {}, x)));
};

export function show(param = '') {
  const page = pageById(param) ?? PAGES[0];
  document.title = `${page.title} — PaperPulse`;
  put(root, h('div', { class: 'stack' }, tabs(page.id),
    h('section', { class: 'card legal-page' },
      h('h2', { class: 'cm-thread-h' }, page.title),
      page.sections.map((s) => h('section', { class: 'legal-sec' }, h('h3', {}, s.h), s.p.map(block))),
      h('p', { class: 'legal-updated' }, `Última actualización: ${LAST_UPDATED}.`))));
  scrollTo({ top: 0 });
}
