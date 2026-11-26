// Vista Diario: estadísticas, curva de resultados, calendario de P&L y registro de operaciones.
import * as store from '../lib/store.js';
import { html, icon, raw, render, on, $, debounce, confirmDialog, download, toast } from '../lib/dom.js';
import { money, pct, price, units, num, duration, trendClass } from '../lib/format.js';
import { createEquityChart } from '../lib/charts.js';
import { assetIcon, empty, seg, pressSeg } from '../lib/ui.js';
import { noteDialog } from '../ui/dialogs.js';
import { shareButton, shareDialog } from '../ui/share.js';

const FILTERS = [['all', 'Todas'], ['win', 'Ganadoras'], ['loss', 'Perdedoras'], ['crypto', 'Cripto'], ['stock', 'Acciones']];
const DAY = 86400000;

let root, chart, filter = 'all', query = '';

export const title = 'Diario';

export function mount(el) {
  root = el;
  on(root, 'click', '[data-seg="jf"] button', (_, b) => { filter = b.dataset.value; pressSeg(root, 'jf', filter); drawTable(); });
  on(root, 'input', '#j-search', debounce((e) => { query = e.target.value.trim().toLowerCase(); drawTable(); }, 150));
  on(root, 'click', '[data-note]', (_, b) => noteDialog(b.dataset.note));
  on(root, 'click', '[data-share]', (_, b) => shareDialog(store.trades().find((t) => t.id === `f${b.dataset.share}`)));
  on(root, 'click', '[data-act="csv"]', exportCsv);
  on(root, 'click', '[data-act="reset"]', async () => {
    if (store.isServerMode()) return toast('Las operaciones de tu cuenta del servidor no se pueden borrar: son tu historial real de práctica.', 'info');
    if (await confirmDialog({ title: '¿Vaciar el diario?', body: 'Se borrarán todas las operaciones cerradas y sus notas. Tu cuenta y posiciones abiertas no cambian.', confirm: 'Vaciar diario', danger: true })) {
      store.clearTrades();
      toast('Diario vaciado', 'info');
    }
  });
  store.on('trades', () => !root.hidden && show());
}

export function show() {
  const trades = store.trades();
  chart?.destroy();
  chart = null;
  if (!trades.length) {
    return render(root, html`<section class="card">${empty('book-open', 'Tu diario está en blanco… por ahora',
      'Cada vez que vendas una posición se registrará aquí con su resultado, duración y tus notas. Así detectarás qué estrategias te funcionan.',
      html`<a class="btn btn-primary" href="#/trade">${icon('chart-candlestick', 'sm')} Ir a operar</a>`)}</section>`);
  }
  const s = stats(trades);
  render(root, html`
    <div class="toolbar-row">
      <p class="muted">${trades.length} ${trades.length === 1 ? 'operación cerrada' : 'operaciones cerradas'}</p>
      <span class="gap-8">
        <a class="btn btn-ghost btn-sm" href="#/stats">${icon('chart-column', 'sm')} Estadísticas</a>
        <button class="btn btn-ghost btn-sm" data-act="csv">${icon('download', 'sm')} Exportar CSV</button>
        <button class="btn btn-danger btn-sm" data-act="reset">${icon('trash-2', 'sm')} Vaciar</button>
      </span>
    </div>
    <div class="kpis">
      ${kpi('Resultado neto', html`<span class="money delta ${trendClass(s.net)}">${money(s.net, { signed: true })}</span>`, `Ganado ${money(s.gross)} · Perdido ${money(s.loss)}`)}
      ${kpi('Tasa de acierto', pct(s.winRate, { signed: false, decimals: 0 }), html`<div class="bar" role="img" aria-label="${s.wins} ganadoras de ${trades.length}"><i data-w="${s.winRate.toFixed(1)}"></i></div>`)}
      ${kpi('Factor de beneficio', s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : num(s.profitFactor, 2), s.profitFactor >= 1.5 ? 'Sólido (> 1,5)' : s.profitFactor > 1 ? 'Positivo' : s.profitFactor === 1 ? 'En equilibrio' : 'Por debajo de 1')}
      ${kpi('Racha actual', s.streak ? `${Math.abs(s.streak)} ${s.streak > 0 ? 'ganadoras' : 'perdedoras'}` : '—', `Mejor racha: ${s.bestStreak} · Media ${money(s.avg, { signed: true })}`)}
    </div>
    <div class="journal-charts">
      <section class="card"><div class="card-head"><h2 class="card-title">${icon('chart-area')} Resultado acumulado</h2></div><div class="equity-box" id="j-equity"></div></section>
      <section class="card"><div class="card-head"><h2 class="card-title">${icon('calendar')} Últimas 5 semanas</h2></div><div id="j-cal"></div></section>
    </div>
    <section class="card flush">
      <div class="card-head">${seg('jf', FILTERS, filter)}
        <label class="input-group"><span>${icon('search', 'sm')}</span><input id="j-search" type="search" placeholder="Buscar activo, estrategia o nota" aria-label="Buscar en el diario" value="${query}"></label></div>
      <div class="table-wrap" id="j-table"></div>
    </section>`);

  chart = createEquityChart($('#j-equity', root), { formatter: (v) => money(v) });
  let cum = 0, last = 0;
  const points = [...trades].reverse().map((t) => {
    let time = Math.floor(Date.parse(t.date) / 1000);
    time = Math.max(time, last + 1);
    last = time;
    return { time, value: (cum += t.pnl) };
  });
  chart.setData([{ time: points[0].time - 1, value: 0 }, ...points], 0);
  drawCalendar(trades);
  drawTable();
}

export function theme() { if (!root.hidden) show(); }

const kpi = (label, value, sub) => html`<div class="card kpi"><span>${label}</span><strong>${value}</strong><small>${sub}</small></div>`;

export function stats(trades) {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const gross = wins.reduce((a, t) => a + t.pnl, 0);
  const loss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  let streak = 0, best = 0, run = 0;
  for (const t of trades) { // trades vienen de la más reciente a la más antigua
    if (t.pnl === 0) break;
    if (streak === 0 || Math.sign(streak) === Math.sign(t.pnl)) streak += Math.sign(t.pnl); else break;
  }
  for (const t of [...trades].reverse()) { run = t.pnl > 0 ? run + 1 : 0; best = Math.max(best, run); }
  return {
    net: gross - loss, gross, loss, wins: wins.length, winRate: (wins.length / trades.length) * 100,
    profitFactor: loss ? gross / loss : gross ? Infinity : null, streak, bestStreak: best,
    avg: (gross - loss) / trades.length,
  };
}

function drawCalendar(trades) {
  const byDay = new Map();
  for (const t of trades) {
    const k = new Date(t.date).toDateString();
    byDay.set(k, (byDay.get(k) ?? 0) + t.pnl);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY - 28 * DAY);
  const max = Math.max(1, ...[...byDay.values()].map(Math.abs));
  const cells = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY);
    const v = byDay.get(d.toDateString());
    const lvl = v ? Math.min(3, Math.ceil((Math.abs(v) / max) * 3)) : 0;
    const cls = d > today ? 'out' : v > 0 ? `p${lvl}` : v < 0 ? `n${lvl}` : '';
    const label = `${d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}: ${v ? money(v, { signed: true }) : 'sin operaciones'}`;
    return html`<div class="cal-cell ${cls} ${d.getTime() === today.getTime() ? 'today' : ''}" title="${label}" aria-label="${label}" role="img">${d.getDate()}</div>`;
  });
  render($('#j-cal', root), html`<div class="cal">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => html`<span class="cal-h">${x}</span>`)}${cells}</div>
    <div class="cal-legend"><span>Pérdidas</span><div>${['n3', 'n2', 'n1', '', 'p1', 'p2', 'p3'].map((c) => html`<i class="cal-cell ${c}"></i>`)}</div><span>Ganancias</span></div>`);
}

function filtered() {
  return store.trades().filter((t) => (filter === 'all'
    || (filter === 'win' && t.pnl > 0) || (filter === 'loss' && t.pnl < 0) || t.type === filter))
    .filter((t) => !query || [t.symbol, t.name, t.setup, t.emotion, t.notes].some((x) => x?.toLowerCase().includes(query)));
}

function drawTable() {
  const list = filtered();
  const box = $('#j-table', root);
  if (!box) return;
  if (!list.length) return render(box, empty('list-filter', 'Ninguna operación encaja con ese filtro'));
  render(box, html`<table class="table"><thead><tr><th>Fecha</th><th>Activo</th><th class="r">Cantidad</th><th class="r">Entrada → Salida</th><th class="r">Duración</th><th class="r">Resultado</th><th>Estrategia</th><th>Notas</th></tr></thead>
    <tbody>${list.map((t) => html`<tr>
      <td class="muted">${new Date(t.date).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td><div class="asset-cell">${assetIcon(t.symbol, 'sm')}<strong>${t.symbol}</strong>${t.side === 'short' ? html` <span class="chip down">Short</span>` : ""}</div></td>
      <td class="r">${units(t.amount)}</td>
      <td class="r">${price(t.entryPrice, t.quote)} → ${price(t.exitPrice, t.quote)}</td>
      <td class="r muted">${t.openedAt ? duration(Date.parse(t.date) - t.openedAt) : '—'}</td>
      <td class="r money delta ${trendClass(t.pnl)}"><strong>${money(t.pnl, { signed: true })}</strong> <small>${pct(t.pnlPct)}</small></td>
      <td>${t.setup || '—'}${t.emotion ? html` <span class="chip">${t.emotion}</span>` : ''}</td>
      <td class="row-end"><button class="btn btn-ghost btn-sm" data-note="${t.id}">${icon('pencil', 'sm')} ${t.notes ? 'Ver' : 'Añadir'}</button>${raw(shareButton(t))}</td></tr>`)}</tbody></table>`);
}

/* CSV para Excel: separador ; con BOM y protección contra inyección de fórmulas */
function exportCsv() {
  const cell = (v) => {
    if (typeof v === 'number') return String(v).replace('.', ',');
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Fecha', 'Símbolo', 'Nombre', 'Cantidad', 'Divisa', 'Entrada', 'Salida', 'Invertido USD', 'P&L USD', 'P&L %', 'Estrategia', 'Emoción', 'Notas'];
  const lines = store.trades().map((t) => [t.date, t.symbol, t.name, t.amount, t.quote, t.entryPrice, t.exitPrice, t.investedUsd, t.pnl, +t.pnlPct.toFixed(2), t.setup, t.emotion, t.notes]
    .map(cell).join(';'));
  download(`paperpulse_diario_${new Date().toISOString().slice(0, 10)}.csv`, `﻿${[head.map(cell).join(';'), ...lines].join('\r\n')}`, 'text/csv;charset=utf-8');
}
