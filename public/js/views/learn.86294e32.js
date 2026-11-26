// Sección Aprender: mini-lecciones y glosario (contenido propio y neutral, en lib/learn-content.js).
import { LESSONS, GLOSSARY } from '../lib/learn-content.19d814b7.js';
import { QUIZ } from '../lib/learn-quiz.8afb583a.js';
import { h, svgIcon, mount as put } from '../lib/el.71f9edc9.js';
import { on } from '../lib/dom.a575914e.js';
import { go } from '../lib/router.de30a562.js';
import { isVisible } from '../lib/sections.b37aa67f.js';

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

/** «Practícalo» lleva a la sección de la lección si está disponible; si no, a Operar (donde se practica todo). */
const PRESETS = { 'orden-mercado-vs-limite': 'limit', 'stop-loss': 'stop', 'riesgo-beneficio': 'bracket', 'tamano-posicion': 'size', 'comisiones-slippage': 'size' };
const practiceHref = (l) => PRESETS[l.id] && isVisible('trade') ? `#/trade/BTC:${PRESETS[l.id]}` : (isVisible(l.link[0].replace(/^#\/?/, '').split('/')[0]) ? l.link[0] : '#/trade');

const aside = () => h('p', { class: 'hint cm-edu' }, svgIcon('info', 'sm'),
  ' Contenido educativo y neutral, con ejemplos inventados. PaperPulse es un simulador: nada de esto es asesoramiento financiero.');

function showIndex() {
  const done = read();
  const doneCount = LESSONS.filter((l) => done.has(l.id)).length;
  put(root, h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Mini-lecciones'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: 'glosario' } }, svgIcon('book-open', 'sm'), ' Glosario')),
      h('p', { class: 'hint' }, `${LESSONS.length} lecciones de 2 a 3 minutos. Léelas en el orden que quieras.`),
      h('div', { class: 'learn-progress' },
        h('div', { class: 'learn-progress-text' }, h('strong', {}, `${doneCount} de ${LESSONS.length} lecciones completadas`), h('span', { class: 'muted' }, ` · ${Math.round(doneCount / LESSONS.length * 100)} %`)),
        h('progress', { class: 'progress', value: String(doneCount), max: String(LESSONS.length), 'aria-label': 'Progreso de las lecciones' }, `${doneCount} de ${LESSONS.length}`)),
      aside(),
      h('div', { class: 'learn-grid' }, LESSONS.map((l, i) => h('button', { type: 'button', class: 'learn-card', dataset: { learn: l.id } },
        h('span', { class: 'learn-num' }, done.has(l.id) ? svgIcon('circle-check', 'sm') : String(i + 1)),
        h('span', { class: 'learn-text' }, h('strong', {}, l.title), h('small', {}, l.summary)),
        h('small', { class: 'muted' }, `${l.minutes} min`)))))));
}

/** Mini-cuestionario de 3 preguntas: cada opción se corrige al instante y explica la respuesta. */
function quiz(l) {
  const qs = QUIZ[l.id];
  if (!qs) return '';
  let right = 0, answered = 0;
  const result = h('p', { class: 'quiz-result', role: 'status' });
  const box = h('section', { class: 'quiz', 'aria-label': 'Comprueba lo aprendido' },
    h('h3', { class: 'quiz-title' }, 'Comprueba lo aprendido'),
    qs.map((item, n) => {
      const why = h('p', { class: 'hint quiz-why', hidden: true });
      const opts = item.options.map((text, i) => h('button', { type: 'button', class: 'quiz-opt' }, text));
      opts.forEach((b, i) => b.addEventListener('click', () => {
        if (answered === qs.length || why.hidden === false) return;
        const ok = i === item.answer;
        b.classList.add(ok ? 'is-right' : 'is-wrong');
        opts[item.answer].classList.add('is-right');
        opts.forEach((o) => { o.disabled = true; });
        why.textContent = `${ok ? 'Correcto. ' : 'No exactamente. '}${item.why}`;
        why.hidden = false;
        answered++; if (ok) right++;
        if (answered === qs.length) result.textContent = `Has acertado ${right} de ${qs.length}.`;
      }));
      return h('fieldset', { class: 'quiz-q' }, h('legend', {}, `${n + 1}. ${item.text}`), h('div', { class: 'quiz-opts' }, opts), why);
    }), result);
  return box;
}

function showLesson(l) {
  markRead(l.id);
  const i = LESSONS.indexOf(l);
  const next = LESSONS[i + 1], prev = LESSONS[i - 1];
  put(root, h('div', { class: 'stack' }, h('section', { class: 'card learn-lesson' },
    h('div', { class: 'cm-thread-top' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { learn: '' } }, svgIcon('chevron-left', 'sm'), ' Lecciones')),
    h('h2', { class: 'cm-thread-h' }, l.title), h('small', { class: 'muted' }, `Lección ${i + 1} de ${LESSONS.length} · ${l.minutes} min`),
    l.body.map((p) => h('p', { class: 'learn-p' }, p)),
    h('div', { class: 'cm-notice' }, svgIcon('graduation-cap', 'sm'), h('span', {}, l.tip)),
    h('a', { class: 'btn btn-primary practice-btn', href: practiceHref(l) }, svgIcon('chart-candlestick', 'sm'), ' Practícalo'),
    quiz(l),
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
