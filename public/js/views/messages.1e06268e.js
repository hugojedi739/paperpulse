// Panel de administración → Mensajes: los mensajes del formulario de contacto, con marca de leído y borrado.
// El texto lo escribe cualquiera: se pinta siempre con nodos de texto (lib/el.js), nunca como HTML.
import { api } from '../lib/api.d1caad06.js';
import { h, svgIcon, mount, userText, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast, confirmDialog } from '../lib/dom.b3064165.js';
import { timeAgo } from '../lib/format.bcd91d41.js';

const FILTERS = [['all', 'Todos'], ['unread', 'Sin leer'], ['read', 'Leídos']];
const PAGE = 25;

let box, status = 'all', page = 1, bound = false, renderId = 0;

/** Pinta la sección en `container` (el cuerpo del panel de administración). */
export function render(container) {
  box = container;
  if (!bound) {
    bound = true;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-msg]');
      if (b && box.contains(b)) actions[b.dataset.msg]?.(b);
    });
  }
  draw();
}

const card = (...c) => h('section', { class: 'card' }, ...c);

async function draw() {
  const id = ++renderId;
  const content = h('div', { class: 'stack' }, card(loading()));
  mount(box, h('div', { class: 'stack' },
    h('div', { class: 'seg md-nav', role: 'group' }, FILTERS.map(([v, label]) =>
      h('button', { type: 'button', dataset: { msg: 'filter', value: v }, 'aria-pressed': String(v === status) }, label))),
    content));
  try {
    const data = await api(`/api/admin/messages?status=${status}&page=${page}`);
    if (id !== renderId) return;
    if (!data.items.length) {
      return mount(content, card(emptyState('message-square', 'No hay mensajes', 'Los mensajes del formulario de contacto aparecerán aquí.')));
    }
    mount(content, h('p', { class: 'muted' }, `${data.total} ${data.total === 1 ? 'mensaje' : 'mensajes'} · ${data.unread} sin leer`),
      data.items.map((m) => card(
        h('div', { class: 'card-head' },
          h('div', { class: 'md-title' }, h('strong', {}, m.reason), m.read ? null : h('span', { class: 'chip accent' }, 'Sin leer')),
          h('div', { class: 'gap-8' },
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'read', id: m.id, value: String(!m.read) } }, m.read ? 'Marcar sin leer' : 'Marcar como leído'),
            h('button', { type: 'button', class: 'icon-btn sm', dataset: { msg: 'delete', id: m.id }, 'aria-label': 'Borrar mensaje', title: 'Borrar' }, svgIcon('trash-2', 'sm')))),
        h('p', { class: 'muted md-meta' },
          h('time', { title: new Date(m.createdAt * 1000).toLocaleString('es-ES') }, timeAgo(m.createdAt * 1000)), ' · ',
          m.user ? `Con sesión: ${m.user.alias ?? `usuario #${m.user.id}`}` : 'Sin sesión'),
        h('div', { class: 'md-quote' }, userText(m.message)))),
      (page > 1 || data.total > page * PAGE) ? h('div', { class: 'pager' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'page', dir: '-1' }, disabled: page <= 1 }, 'Anterior'),
        h('span', { class: 'muted' }, `Página ${page}`),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'page', dir: '1' }, disabled: data.total <= page * PAGE }, 'Siguiente')) : null);
  } catch (err) {
    if (id === renderId) mount(content, card(emptyState('triangle-alert', 'No se pudo cargar', err.message)));
  }
}

const actions = {
  filter(b) { status = b.dataset.value; page = 1; draw(); },
  page(b) { page = Math.max(1, page + Number(b.dataset.dir)); draw(); },
  async read(b) {
    try { await api(`/api/admin/messages/${b.dataset.id}`, { method: 'PATCH', body: { read: b.dataset.value === 'true' } }); draw(); } catch (err) { toast(err.message, 'error'); }
  },
  async delete(b) {
    if (!await confirmDialog({ title: 'Borrar mensaje', body: 'El mensaje se eliminará de forma definitiva.', confirm: 'Borrar', danger: true })) return;
    try { await api(`/api/admin/messages/${b.dataset.id}`, { method: 'DELETE' }); toast('Mensaje borrado.', 'success', 2000); draw(); } catch (err) { toast(err.message, 'error'); }
  },
};
