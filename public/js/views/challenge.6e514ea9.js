// Reto del mes: cuenta de práctica aparte, mismo saldo para todos y clasificación propia.
// Usa las mismas rutas de trading que la cuenta normal, bajo /api/challenge (ver backend/retention/challenges.py).
import { api } from '../lib/api.d1db7328.js';
import { h, svgIcon, mount as put, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast } from '../lib/dom.a575914e.js';
import { pct, num, price, timeAgo } from '../lib/format.df74909c.js';
import { uuid } from '../lib/store.d46470b9.js';
import * as C from '../lib/community.912c99e3.js';

let box, status = null, port = null, slug = null, lastId = 0;

const usd = (cents) => (cents / 100).toLocaleString('es-ES', { style: 'currency', currency: 'USD', useGrouping: 'always', maximumFractionDigits: 2 });
const monthName = (s) => new Date(`${s}-15T12:00:00`).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

function bind(el) {
  if (el.dataset.chBound) return;
  el.dataset.chBound = '1';
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ch]');
    if (b && el.contains(b)) actions[b.dataset.ch]?.(b);
  });
  el.addEventListener('submit', (e) => { if (e.target.dataset.chForm) { e.preventDefault(); submitOrder(e.target); } });
  el.addEventListener('change', (e) => { if (e.target.dataset.ch === 'month') actions.month(e.target); if (e.target.name === 'type') e.target.form.querySelector('[data-trigger]').hidden = e.target.value === 'market'; });
}

export async function viewChallenge(container, isCurrent) {
  box = container;
  bind(box);
  const id = ++lastId;
  put(box, h('section', { class: 'card' }, loading('Cargando el reto…')));
  try {
    status = await api('/api/challenge');
    slug ??= status.slug;
    const [board, mine] = await Promise.all([api(`/api/challenge/leaderboard?slug=${slug}`), status.joined && slug === status.slug ? api('/api/challenge/portfolio') : null]);
    if (id !== lastId || !isCurrent()) return;
    port = mine;
    draw(board);
  } catch (err) {
    if (id === lastId) put(box, h('section', { class: 'card' }, emptyState('triangle-alert', 'No se pudo cargar el reto', C.errorMessage(err))));
  }
}

function draw(board) {
  const s = status, current = slug === s.slug;
  const left = Math.max(0, s.endsAt * 1000 - Date.now());
  const days = Math.ceil(left / 86_400_000);
  put(box,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, svgIcon('trophy', 'sm'), ` Reto de ${monthName(slug)}`),
        h('select', { 'aria-label': 'Elegir mes', dataset: { ch: 'month' } }, [s.slug, ...s.past].map((x) => h('option', { value: x, selected: x === slug }, monthName(x))))),
      h('p', { class: 'hint' }, `Cuenta aparte con ${usd(s.initialCents)} virtuales para todas las personas participantes, y su propia clasificación. Tu cuenta normal no se toca. `,
        current ? `Termina ${s.open ? `en ${days} ${days === 1 ? 'día' : 'días'}` : 'hoy'} (hora de Madrid) · ${num(s.participants, 0)} participantes.` : 'Reto cerrado: clasificación final.'),
      current ? joinBlock(s) : null),
    current && s.joined && port ? tradePanel() : null,
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Clasificación del reto')),
      board.entries.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table cm-ranking' },
          h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Alias'), h('th', { class: 'r' }, 'Rentabilidad'), h('th', { class: 'r' }, 'Operaciones'))),
          h('tbody', {}, board.entries.map((e) => h('tr', {}, h('td', {}, String(e.rank)),
            h('td', {}, h('button', { type: 'button', class: 'link cm-alias', dataset: { c: 'user', alias: e.alias } }, e.alias)),
            h('td', { class: 'r' }, h('span', { class: `num ${e.returnPct >= 0 ? 'up' : 'down'}` }, pct(e.returnPct))), h('td', { class: 'r num' }, num(e.trades, 0)))))))
        : emptyState('trophy', 'Aún no hay resultados', 'Aparecen quienes hayan hecho al menos una operación en el reto y tengan el perfil público.')));
}

function joinBlock(s) {
  if (!C.loggedIn()) return h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-action': 'login' }, svgIcon('log-in', 'sm'), ' Inicia sesión para participar');
  if (!s.joined) return h('button', { type: 'button', class: 'btn btn-primary', dataset: { ch: 'join' } }, svgIcon('play', 'sm'), ' Apuntarme al reto');
  return h('p', {}, h('span', { class: 'chip up' }, svgIcon('circle-check', 'sm'), ' Estás dentro'),
    s.me ? ` Rentabilidad actual: ` : ' Haz tu primera operación para aparecer en la clasificación.', s.me ? h('strong', { class: s.me.returnPct >= 0 ? 'up' : 'down' }, pct(s.me.returnPct)) : null,
    s.me ? h('small', { class: 'muted' }, ` (actualizada ${timeAgo(s.me.computedAt * 1000)})`) : null);
}

function tradePanel() {
  const a = port.account;
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Mi cuenta del reto')),
    h('dl', { class: 'summary' }, h('div', {}, h('dt', {}, 'Efectivo libre'), h('dd', {}, usd(a.availableCents))), h('div', {}, h('dt', {}, 'Reservado en órdenes'), h('dd', {}, usd(a.reservedCents)))),
    port.positions.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Activo'), h('th', { class: 'r' }, 'Cantidad'), h('th', { class: 'r' }, 'Precio medio'), h('th', {}, ''))),
      h('tbody', {}, port.positions.map((p) => h('tr', {}, h('td', {}, h('strong', {}, p.symbol)), h('td', { class: 'r num' }, String(p.quantity)), h('td', { class: 'r num' }, price(p.avgPrice, p.quote)),
        h('td', { class: 'r' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { ch: 'sell', symbol: p.symbol, qty: String(p.quantity) } }, 'Vender todo'))))))) : h('p', { class: 'hint' }, 'Sin posiciones abiertas.'),
    port.orders.length ? h('ul', { class: 'cm-threads' }, port.orders.map((o) => h('li', { class: 'cm-thread' }, h('span', {}, o.type), h('div', {}, `${o.side === 'buy' ? 'Compra' : 'Venta'} ${o.type} de ${o.quantity} ${o.symbol} a ${o.triggerPrice}`,
      ' ', h('button', { type: 'button', class: 'link', dataset: { ch: 'cancel', id: o.id } }, 'Cancelar'))))) : null,
    h('form', { class: 'cm-form ch-form', dataset: { chForm: '1' }, novalidate: true },
      h('div', { class: 'ch-row' },
        h('div', { class: 'field' }, h('label', { for: 'ch-sym' }, 'Activo'), h('select', { id: 'ch-sym', name: 'symbol' }, status.assets.map((x) => h('option', { value: x.symbol }, `${x.symbol} · ${x.name}`)))),
        h('div', { class: 'field' }, h('label', { for: 'ch-side' }, 'Lado'), h('select', { id: 'ch-side', name: 'side' }, h('option', { value: 'buy' }, 'Comprar'), h('option', { value: 'sell' }, 'Vender'))),
        h('div', { class: 'field' }, h('label', { for: 'ch-type' }, 'Tipo'), h('select', { id: 'ch-type', name: 'type' }, h('option', { value: 'market' }, 'Mercado'), h('option', { value: 'limit' }, 'Límite'), h('option', { value: 'stop' }, 'Stop')))),
      h('div', { class: 'ch-row' },
        h('div', { class: 'field' }, h('label', { for: 'ch-qty' }, 'Cantidad (unidades)'), h('input', { id: 'ch-qty', name: 'quantity', inputmode: 'decimal', required: true, autocomplete: 'off' })),
        h('div', { class: 'field', dataset: { trigger: '1' }, hidden: true }, h('label', { for: 'ch-trg' }, 'Precio de activación'), h('input', { id: 'ch-trg', name: 'triggerPrice', inputmode: 'decimal', autocomplete: 'off' }))),
      h('p', { class: 'hint' }, 'El precio de ejecución lo decide el servidor con cotizaciones reales; las comisiones son las de tu cuenta normal.'),
      h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }), h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, 'Enviar orden'))));
}

async function order(body) {
  const r = await api('/api/challenge/orders', { method: 'POST', body: { clientOrderId: uuid(), ...body } });
  C.invalidate('leaderboard');
  return r;
}

async function submitOrder(form) {
  const f = Object.fromEntries(new FormData(form));
  const err = form.querySelector('.cm-form-error');
  err.textContent = '';
  const body = { symbol: f.symbol, side: f.side, type: f.type, quantity: String(f.quantity).trim() };
  if (f.type !== 'market') body.triggerPrice = String(f.triggerPrice).trim();
  try { await order(body); toast('Orden enviada al reto.', 'success'); await refresh(); } catch (ex) { err.textContent = C.errorMessage(ex); }
}

async function refresh() { await viewChallenge(box, () => true); }

const actions = {
  async join() {
    try { await api('/api/challenge/join', { method: 'POST' }); toast('¡Te has apuntado al reto! Tu cuenta del reto empieza con el saldo inicial.', 'success'); await refresh(); } catch (ex) { toast(C.errorMessage(ex), 'error'); }
  },
  async sell(b) {
    try { await order({ symbol: b.dataset.symbol, side: 'sell', type: 'market', quantity: b.dataset.qty }); toast('Posición vendida en el reto.', 'success'); await refresh(); } catch (ex) { toast(C.errorMessage(ex), 'error'); }
  },
  async cancel(b) {
    try { await api(`/api/challenge/orders/${b.dataset.id}`, { method: 'DELETE' }); await refresh(); } catch (ex) { toast(C.errorMessage(ex), 'error'); }
  },
  month(b) { slug = b.value; refresh(); },
};
