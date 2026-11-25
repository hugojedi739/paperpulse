// Sección Aprender: mini-lecciones y glosario (contenido propio y neutral, en lib/learn-content.js).
import { LESSONS, GLOSSARY } from '../lib/learn-content.js';
import { h, svgIcon, mount as put } from '../lib/el.js';
import { on } from '../lib/dom.js';
import { go } from '../lib/router.js';
import { isVisible } from '../lib/sections.js';

export const title = 'Aprender';
let root;
const READ_KEY = 'paperpulse_lessons_read';
const read = () => { try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]')); } catch { return new Set(); } };
const markRead = (id) => { try { const s = read(); s.add(id); localStorage.setItem(READ_KEY, JSON.stringify([...s])); } catch { /* sin almacenamiento */ } };

export function mount(el) {
  root = el;
  on(root, 'click', '[data-learn]', (_, b) => go(`/learn/${b.dataset.learn}`));
}

export function show(param = '') {
  if (param === 'glosario') return glossary();
  const lesson = LESSONS.find((l) => l.id === param);
  return lesson ? showLesson(lesson) : showIndex();
}

const aside = () => h('p', { class: 'hint cm-edu' }, svgIcon('info', 'sm'),
  ' Contenido educativo y neutral, con ejemplos inventados. PaperPulse es un simulador: nada de esto es asesoramiento financiero.');

function showIndex() {
  const done = read();
  put(root, h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Mini-lecciones'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: 'glosario' } }, svgIcon('book-open', 'sm'), ' Glosario')),
      h('p', { class: 'hint' }, `${LESSONS.length} lecciones de 2 a 3 minutos. Léelas en el orden que quieras.`), aside(),
      h('div', { class: 'learn-grid' }, LESSONS.map((l, i) => h('button', { type: 'button', class: 'learn-card', dataset: { learn: l.id } },
        h('span', { class: 'learn-num' }, done.has(l.id) ? svgIcon('circle-check', 'sm') : String(i + 1)),
        h('span', { class: 'learn-text' }, h('strong', {}, l.title), h('small', {}, l.summary)),
        h('small', { class: 'muted' }, `${l.minutes} min`)))))));
}

function showLesson(l) {
  markRead(l.id);
  const i = LESSONS.indexOf(l);
  const next = LESSONS[i + 1], prev = LESSONS[i - 1];
  put(root, h('div', { class: 'stack' }, h('section', { class: 'card learn-lesson' },
    h('div', { class: 'cm-thread-top' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: '' } }, svgIcon('chevron-left', 'sm'), ' Lecciones')),
    h('h2', { class: 'cm-thread-h' }, l.title), h('small', { class: 'muted' }, `Lección ${i + 1} de ${LESSONS.length} · ${l.minutes} min`),
    l.body.map((p) => h('p', { class: 'learn-p' }, p)),
    h('div', { class: 'cm-notice' }, svgIcon('graduation-cap', 'sm'), h('span', {}, l.tip), isVisible(l.link[0].replace(/^#\/?/, '').split('/')[0]) ? h('a', { class: 'link', href: l.link[0] }, l.link[1]) : null),
    aside(),
    h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: prev?.id ?? '' }, disabled: !prev }, svgIcon('chevron-left', 'sm'), ' Anterior'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: next?.id ?? 'glosario' } }, next ? 'Siguiente ' : 'Glosario ', svgIcon('chevron-right', 'sm'))))));
}

function glossary() {
  put(root, h('div', { class: 'stack' }, h('section', { class: 'card' },
    h('div', { class: 'cm-thread-top' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: '' } }, svgIcon('chevron-left', 'sm'), ' Lecciones')),
    h('h2', { class: 'card-title' }, 'Glosario'), aside(),
    h('dl', { class: 'glossary' }, GLOSSARY.map(([t, d]) => h('div', { id: `g-${t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }, h('dt', {}, t), h('dd', {}, d)))))));
}
