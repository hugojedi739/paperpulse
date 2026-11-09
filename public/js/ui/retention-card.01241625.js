// Tarjeta del Resumen: racha de días y primer reto guiado (onboarding de 2 minutos, saltable).
// Los textos del onboarding los define el servidor; se pintan con nodos de texto.
import * as R from '../lib/retention.98a64bcb.js';
import * as auth from '../lib/auth.bf0ddbaf.js';
import { h, svgIcon, mount as put } from '../lib/el.71f9edc9.js';
import { go } from '../lib/router.de30a562.js';

let el = null;

export async function mountCard(container) {
  el = container;
  if (!el || !auth.currentUser()) return put(el);
  let data;
  try { data = await R.summary(true); } catch { return put(el); }
  if (el !== container || !container.isConnected) return;
  const ob = data.onboarding, streak = data.streak;
  const parts = [];
  if (ob.visible) {
    parts.push(h('section', { class: 'card ob-card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, svgIcon('graduation-cap', 'sm'), ' Tu primer reto guiado · 2 minutos'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { ob: 'skip' } }, 'Saltar')),
      h('p', { class: 'hint' }, 'Tres pasos para conocer el simulador. Todo con dinero virtual: no hay riesgo.'),
      h('ol', { class: 'ob-steps' }, ob.steps.map((s) => h('li', { class: s.done ? 'done' : '' },
        svgIcon(s.done ? 'circle-check' : 'play', 'sm'), h('span', {}, h('strong', {}, s.title), h('small', {}, s.description)),
        s.done ? null : h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { ob: 'go', to: s.link, step: s.id } }, 'Ir'))))));
  } else if (ob.skipped && !ob.completed) {
    parts.push(h('p', { class: 'hint' }, 'Saltaste el primer reto guiado. ', h('button', { type: 'button', class: 'link', dataset: { ob: 'reopen' } }, 'Retomarlo')));
  }
  if (streak.current > 0 || streak.best > 0) {
    parts.push(h('p', { class: 'streak-chip' }, h('span', { class: 'chip up' }, svgIcon('flame', 'sm'), ` Racha: ${streak.current} ${streak.current === 1 ? 'día' : 'días'} operando`),
      h('small', { class: 'muted' }, ` Mejor: ${streak.best}. Los días cuentan en hora de Madrid.`)));
  }
  put(el, ...parts);
  if (!el.dataset.obBound) {
    el.dataset.obBound = '1';
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ob]');
      if (!b) return;
      if (b.dataset.ob === 'go') {
        if (b.dataset.step === 'visit_forum') await R.onboarding('visit-forum').catch(() => {});
        return go(b.dataset.to);
      }
      await R.onboarding(b.dataset.ob).catch(() => {});
      mountCard(el);
    });
  }
}
