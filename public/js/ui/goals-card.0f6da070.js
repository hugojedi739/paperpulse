// Tarjeta «Retos de la semana»: metas personales con su progreso. Sin clasificación: solo las ve quien opera.
import * as store from '../lib/store.13ad261a.js';
import { html, icon } from '../lib/dom.a575914e.js';
import { weekGoals, lastWeek, STATE_LABEL } from '../lib/goals.558164c8.js';
import { weekLabel } from '../lib/stats.f991e639.js';

const STATE_ICON = { pending: 'clock', ontrack: 'trending-up', done: 'circle-check', missed: 'rotate-ccw' };
const es = (v) => String(v).replace('.', ',');
const progress = (g) => (g.kind === 'limit' ? `${es(g.value)} % de ${g.target} %` : `${g.value} de ${g.target}`);

/** Plantilla de la tarjeta, o cadena vacía si no hay cuenta de práctica. `compact`: versión corta para el Resumen. */
export function goalsCard({ compact = false } = {}) {
  if (!store.hasPractice()) return '';
  const trades = store.trades();
  const capital = store.initialCapital();
  const w = weekGoals(trades, capital);
  const prev = compact ? null : lastWeek(trades, capital);
  const titleId = compact ? 'goals-title-summary' : 'goals-title'; // la versión del Resumen y la de Estadísticas conviven en el DOM
  const left = w.daysLeft === 0 ? 'Termina hoy' : w.daysLeft === 1 ? 'Queda 1 día' : `Quedan ${w.daysLeft} días`;
  return html`<section class="card goals${compact ? ' compact' : ''}" aria-labelledby="${titleId}">
    <div class="card-head">
      <h2 class="card-title" id="${titleId}">${icon('target')} Retos de la semana</h2>
      <span class="card-sub">${weekLabel(w)} · ${left}</span>
    </div>
    <p class="goals-intro">Metas personales para practicar con cabeza. Son solo para ti: no hay clasificación y el lunes empiezan de nuevo.</p>
    <ul class="goals-list">
      ${w.goals.map((g) => html`<li class="goal ${g.state}">
        <span class="goal-icon" aria-hidden="true">${icon(STATE_ICON[g.state], 'sm')}</span>
        <div class="goal-main">
          <div class="goal-head"><strong>${g.title}</strong><span class="chip goal-chip">${STATE_LABEL[g.state]}</span></div>
          <div class="goal-bar ${g.kind}" role="img" aria-label="${g.kind === 'limit' ? 'Límite usado' : 'Progreso'}: ${progress(g)}"><i data-w="${(g.ratio * 100).toFixed(1)}"></i></div>
          <p class="goal-detail"><span class="goal-progress">${progress(g)}</span><span class="goal-why"> · ${g.detail}</span></p>
        </div>
      </li>`)}
    </ul>
    ${prev ? html`<p class="hint goals-prev">${icon('history', 'sm')} La semana pasada (${weekLabel(prev)}) cumpliste ${prev.done} de ${prev.total} retos.</p>` : ''}
    ${compact ? html`<a class="link" href="#/stats">Ver mis estadísticas ${icon('arrow-right', 'sm')}</a>` : ''}
  </section>`;
}
