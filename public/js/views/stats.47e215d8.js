// Vista Estadísticas: aciertos, pérdida máxima y resultado por semanas, con las operaciones cerradas de la cuenta de práctica.
import * as store from '../lib/store.d46470b9.js';
import { html, icon, render } from '../lib/dom.a575914e.js';
import { money, pct, trendClass } from '../lib/format.df74909c.js';
import { assetIcon, empty } from '../lib/ui.718834d3.js';
import { summary, weekLabel, WEEKS } from '../lib/stats.f991e639.js';
import { goalsCard } from '../ui/goals-card.2492f539.js';

const SERVER_TRADES = 500; // el servidor envía como mucho las últimas 500 operaciones cerradas

let root;

export const title = 'Estadísticas';

export function mount(el) {
  root = el;
  const redraw = () => root.isConnected && !root.hidden && show();
  store.on('trades', redraw);
  store.on('account', redraw);
}

const day = (ms) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const signedMoney = (v) => html`<span class="money delta ${trendClass(v)}">${money(v, { signed: true })}</span>`;

export function show() {
  const trades = store.trades();
  if (!trades.length) {
    return render(root, html`${goalsCard()}<section class="card">${empty('chart-column', 'Tus estadísticas empiezan con tu primera venta',
      'Se calculan con tus operaciones cerradas: cuando vendas tu primera posición verás aquí tus aciertos, tu pérdida máxima y cómo te va cada semana.',
      html`<a class="btn btn-primary" href="#/trade">${icon('chart-candlestick', 'sm')} Ir a operar</a>`)}</section>`);
  }
  const s = summary(trades, store.initialCapital());
  const { hit, worst, drawdown: dd, thisWeek } = s;
  render(root, html`
    <div class="toolbar-row">
      <p class="muted">Con tus ${plural(trades.length, 'operación cerrada', 'operaciones cerradas')}${store.isServerMode() && trades.length >= SERVER_TRADES ? ' más recientes' : ''}. Las posiciones abiertas no cuentan hasta que las vendes.</p>
      <span class="gap-8"><a class="btn btn-ghost btn-sm" href="#/journal">${icon('book-open', 'sm')} Ver el diario</a></span>
    </div>

    ${goalsCard()}

    <div class="stats-grid">
      <section class="card stat" aria-labelledby="st-hit">
        <h2 class="card-title" id="st-hit">${icon('target')} Aciertos</h2>
        <p class="stat-value">${pct(hit.winRate, { signed: false, decimals: 0 })}</p>
        <div class="bar" role="img" aria-label="${hit.wins} ganadoras de ${hit.total}"><i data-w="${hit.winRate.toFixed(1)}"></i></div>
        <p class="stat-sub">${plural(hit.wins, 'ganadora', 'ganadoras')} · ${plural(hit.losses, 'perdedora', 'perdedoras')}${hit.flats ? ` · ${hit.flats} en tablas` : ''}</p>
        <dl class="summary">
          <div><dt>Ganancia media</dt><dd>${hit.wins ? signedMoney(hit.avgWin) : '—'}</dd></div>
          <div><dt>Pérdida media</dt><dd>${hit.losses ? signedMoney(hit.avgLoss) : '—'}</dd></div>
          <div><dt>Resultado total</dt><dd>${signedMoney(hit.net)}</dd></div>
        </dl>
      </section>

      <section class="card stat" aria-labelledby="st-loss">
        <h2 class="card-title" id="st-loss">${icon('trending-down')} Pérdida máxima</h2>
        ${worst ? html`
          <p class="stat-value">${signedMoney(worst.pnl)}</p>
          <p class="stat-sub stat-asset">${assetIcon(worst.symbol, 'sm')} <span>En una sola operación: <strong>${worst.symbol}</strong>, ${day(Date.parse(worst.date))}${Number.isFinite(worst.pnlPct) ? html` (${pct(worst.pnlPct)})` : ''}</span></p>`
          : html`<p class="stat-value">—</p><p class="stat-sub">Ninguna de tus operaciones ha cerrado en pérdida.</p>`}
        <dl class="summary">
          <div><dt>Mayor caída acumulada</dt><dd>${dd.amount > 0 ? html`${signedMoney(-dd.amount)} <small class="muted">(${pct(-dd.pct)})</small>` : '—'}</dd></div>
          ${dd.amount > 0 ? html`<div><dt>Periodo</dt><dd>${day(dd.from)} → ${day(dd.to)}</dd></div>` : ''}
        </dl>
        <p class="hint">La caída acumulada es lo máximo que ha bajado tu saldo desde un máximo, sumando operaciones seguidas.</p>
      </section>

      <section class="card stat stat-wide" aria-labelledby="st-week">
        <div class="card-head">
          <h2 class="card-title" id="st-week">${icon('calendar')} Rendimiento semanal</h2>
          <span class="card-sub">Últimas ${WEEKS} semanas · de lunes a domingo</span>
        </div>
        <div class="stat-week">
          <div>
            <p class="stat-sub">Esta semana</p>
            <p class="stat-value">${signedMoney(thisWeek.pnl)}</p>
            <p class="stat-sub">${thisWeek.trades ? html`<span class="delta ${trendClass(thisWeek.pct)}">${pct(thisWeek.pct)}</span> sobre tu saldo inicial · ${plural(thisWeek.trades, 'operación', 'operaciones')}` : 'Todavía no has cerrado ninguna operación esta semana.'}</p>
          </div>
          <dl class="summary">
            <div><dt>Mejor semana</dt><dd>${s.bestWeek ? html`${signedMoney(s.bestWeek.pnl)} <small class="muted">${weekLabel(s.bestWeek)}</small>` : '—'}</dd></div>
            <div><dt>Peor semana</dt><dd>${s.worstWeek ? html`${signedMoney(s.worstWeek.pnl)} <small class="muted">${weekLabel(s.worstWeek)}</small>` : '—'}</dd></div>
          </dl>
        </div>
        <ol class="weeks" aria-label="Resultado de cada semana">
          ${s.weeks.map((w, i) => html`<li class="week ${i === s.weeks.length - 1 ? 'now' : ''}">
            <span class="week-label">${weekLabel(w)}</span>
            <span class="week-bar ${trendClass(w.pnl)}" aria-hidden="true"><i data-w="${s.scale > 0 ? ((Math.abs(w.pnl) / s.scale) * 100).toFixed(1) : 0}"></i></span>
            <span class="week-value">${w.trades ? html`${signedMoney(w.pnl)} <small class="delta ${trendClass(w.pct)}">${pct(w.pct)}</small>` : html`<small class="muted">Sin operaciones</small>`}</span>
          </li>`)}
        </ol>
        <p class="hint">${icon('info', 'sm')} Resultado de las operaciones cerradas en cada semana, en porcentaje sobre tu saldo inicial. Rentabilidades pasadas no garantizan resultados futuros.</p>
      </section>
    </div>`);
}
