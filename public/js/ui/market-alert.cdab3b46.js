// Luz roja de la cabecera: botón visible solo cuando alguna regla de lib/market-alert.js se cumple, y un
// popover con «qué ha pasado» y un enlace a Aprender. Texto propio con nodos (lib/el.js), sin innerHTML.
import { tick } from '../lib/feed.14272b63.js';
import { evaluate, describe, label, getRules, onRules, EXPLAIN } from '../lib/market-alert.9ca18474.js';
import { h, mount } from '../lib/el.71f9edc9.js';

const CHECK_MS = 5000;
let last = '';

function draw() {
  const btn = document.getElementById('market-alert');
  const pop = document.getElementById('market-alert-pop');
  if (!btn || !pop) return;
  const active = evaluate(getRules(), tick);
  const key = JSON.stringify(active.map((a) => [a.symbol, a.changePct.toFixed(1)]));
  if (key === last) return;
  last = key;
  btn.hidden = !active.length;
  if (!active.length) {
    if (pop.matches(':popover-open')) pop.hidePopover();
    return;
  }
  mount(btn.querySelector('span'), label(active));
  btn.setAttribute('aria-label', `Luz roja de mercado: ${active.map(describe).join(' ')}`);
  mount(pop,
    h('div', { class: 'menu-title' }, h('strong', {}, 'Luz roja de mercado')),
    h('div', { class: 'alert-body' },
      h('h3', {}, 'Qué ha pasado'),
      h('ul', {}, active.map((a) => h('li', {}, describe(a)))),
      ...EXPLAIN.map((p) => h('p', { class: 'muted' }, p)),
      h('a', { href: '#/learn', class: 'link' }, 'Aprender: volatilidad, stop-loss y tamaño de la posición')));
}

/** Se llama una vez al arrancar (main.js). */
export function initMarketAlert() {
  onRules(draw);
  setInterval(() => { if (!document.hidden) draw(); }, CHECK_MS);
  document.getElementById('market-alert-pop')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) e.currentTarget.hidePopover?.(); // al ir a Aprender se cierra
  });
  draw();
}
