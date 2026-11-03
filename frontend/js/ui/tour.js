// Visita guiada breve que resalta las zonas clave de la interfaz.
import * as store from '../lib/store.js';
import { html, render, $ } from '../lib/dom.js';
import { go } from '../lib/router.js';

const STEPS = [
  { sel: '.search-trigger', title: 'Busca cualquier activo', text: 'Bitcoin, Santander, NVIDIA… Pulsa Ctrl + K desde cualquier pantalla. También sirve para lanzar acciones.' },
  { sel: '.nav, .tabbar', title: 'Cinco secciones', text: 'Resumen de tu cartera, Operar con gráficos en vivo, Mercados, Noticias y tu Diario de operaciones.' },
  { sel: '#account-chip', title: 'Tu cuenta de práctica', text: 'Activa un saldo virtual para comprar y vender con precios reales. Puedes reiniciarlo cuando quieras.' },
  { sel: '#t-chart-card', route: '/trade/BTC', title: 'Gráfico profesional', text: 'Cambia la temporalidad y el tipo de gráfico, y añade indicadores como medias móviles, Bollinger o RSI.' },
  { sel: '#t-ticket', route: '/trade/BTC', title: 'Panel de órdenes', text: 'Compra a mercado o deja órdenes límite y stop. Al vender, anota qué aprendiste para tu diario.' },
  { sel: '.fab', title: 'Asistente', text: 'Pregunta por conceptos o por cómo cotiza un activo. Explica, no recomienda.' },
];

let i = 0;

export function startTour() {
  i = 0;
  $('#tour').hidden = false;
  step();
}

function end() {
  $('#tour').hidden = true;
  store.setSetting('tourDone', true);
}

function step() {
  const s = STEPS[i];
  if (s.route && !location.hash.startsWith(`#${s.route.split('/').slice(0, 2).join('/')}`)) go(s.route);
  setTimeout(() => {
    // checkVisibility también detecta elementos fijos (.fab, .tabbar), cuyo offsetParent es null
    const target = [...document.querySelectorAll(s.sel)].find((el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null));
    if (!target) { i < STEPS.length - 1 ? (i++, step()) : end(); return; }
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = target.getBoundingClientRect();
    const spot = $('#tour-spot');
    const pad = 6;
    for (const [k, v] of [['--t', r.top - pad], ['--l', r.left - pad], ['--sw', r.width + pad * 2], ['--sh', r.height + pad * 2]]) spot.style.setProperty(k, `${v}px`);
    const card = $('#tour-card');
    render(card, html`<span class="chip accent">Paso ${i + 1} de ${STEPS.length}</span><h3>${s.title}</h3><p>${s.text}</p>
      <footer><button class="btn btn-ghost btn-sm" data-tour="skip">Saltar</button>
        <span class="gap-8">${i > 0 ? html`<button class="btn btn-ghost btn-sm" data-tour="prev">Anterior</button>` : ''}
        <button class="btn btn-primary btn-sm" data-tour="next">${i === STEPS.length - 1 ? 'Terminar' : 'Siguiente'}</button></span></footer>`);
    const below = r.bottom + 16 + 200 < innerHeight;
    card.style.setProperty('--ct', `${below ? r.bottom + 16 : Math.max(16, r.top - card.offsetHeight - 16)}px`);
    card.style.setProperty('--cl', `${Math.min(Math.max(16, r.left), innerWidth - card.offsetWidth - 16)}px`);
    card.querySelector('[data-tour="next"]').focus();
  }, s.route ? 350 : 0);
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tour]');
  if (!b) return;
  if (b.dataset.tour === 'skip') return end();
  if (b.dataset.tour === 'prev') i = Math.max(0, i - 1);
  else if (++i >= STEPS.length) return end();
  step();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#tour').hidden) end(); });
