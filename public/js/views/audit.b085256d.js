// Panel de administración → Auditoría: acciones de administración (roles, cuentas, ajustes) y de moderación, juntas.
// Los alias y los motivos los escriben personas: se pintan siempre con nodos de texto (lib/el.js).
import { api } from '../lib/api.d1caad06.js';
import { h, mount, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast } from '../lib/dom.700bdea1.js';
import { timeAgo } from '../lib/format.bcd91d41.js';

const ACTIONS = {
  user_role: 'Cambió el rol de', user_disable: 'Desactivó la cuenta de', user_enable: 'Activó la cuenta de', user_delete: 'Eliminó la cuenta de',
  settings_update: 'Cambió los ajustes',
  hide_post: 'Ocultó un mensaje de', restore_post: 'Restauró un mensaje de', dismiss_reports: 'Descartó denuncias sobre un mensaje de',
  suspend_user: 'Suspendió a', unsuspend_user: 'Reactivó a', author_delete: 'Borró su propio mensaje',
};
const SOURCE = { admin: 'Administración', moderation: 'Moderación' };

let box, items = [], next = null, bound = false, renderId = 0;

/** Pinta la sección en `container` (el cuerpo del panel de administración). */
export function render(container) {
  box = container;
  if (!bound) {
    bound = true;
    box.addEventListener('click', (e) => { if (e.target.closest('[data-audit="more"]') && box.contains(e.target)) more(); });
  }
  const id = ++renderId;
  mount(box, h('section', { class: 'card' }, loading()));
  api('/api/admin/audit').then((data) => {
    if (id !== renderId) return;
    items = data.items; next = data.nextCursor;
    draw();
  }).catch((err) => { if (id === renderId) mount(box, h('section', { class: 'card' }, emptyState('triangle-alert', 'No se pudo cargar', err.message))); });
}

async function more() {
  const btn = box.querySelector('[data-audit="more"]');
  if (btn) btn.disabled = true;
  try {
    const data = await api(`/api/admin/audit?before=${encodeURIComponent(next)}`);
    items = [...items, ...data.items]; next = data.nextCursor;
    draw();
  } catch (err) { toast(err.message, 'error'); if (btn) btn.disabled = false; }
}

function draw() {
  if (!items.length) return mount(box, h('section', { class: 'card' }, emptyState('scroll-text', 'Sin acciones registradas', 'Los cambios de roles, cuentas y ajustes y las acciones de moderación aparecerán aquí.')));
  mount(box, h('section', { class: 'card flush' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Auditoría'), h('span', { class: 'card-sub' }, 'Quién hizo qué. Los ajustes solo muestran los nombres de las claves, nunca sus valores.')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ['Cuándo', 'Origen', 'Quién', 'Acción', 'Detalle'].map((c) => h('th', {}, c)))),
      h('tbody', {}, items.map((i) => h('tr', {},
        h('td', { class: 'muted' }, h('time', { title: new Date(i.createdAt * 1000).toLocaleString('es-ES') }, timeAgo(i.createdAt * 1000))),
        h('td', {}, h('span', { class: 'chip' }, SOURCE[i.source] ?? i.source)),
        h('td', {}, i.actor ?? '—'),
        h('td', {}, `${ACTIONS[i.action] ?? i.action}${i.target ? ' ' : ''}`, i.target ? h('strong', {}, i.target) : (i.targetType === 'user' && i.targetId ? h('strong', {}, `usuario #${i.targetId}`) : null)),
        h('td', {}, i.detail ? h('span', { class: 'md-reason' }, i.detail) : h('span', { class: 'muted' }, '—'))))))),
    next ? h('div', { class: 'pager' }, h('span', {}), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { audit: 'more' } }, 'Cargar más')) : null));
}
