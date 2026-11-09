// Panel de administración → Mensajes: los mensajes del formulario de contacto. Búsqueda, filtro de leídos, «marcar todo» y
// tarjetas plegables: al abrir un mensaje sin leer se marca como leído, y todo se actualiza en línea (sin redibujar la lista).
// El texto lo escribe cualquiera: se pinta siempre con nodos de texto (lib/el.js), nunca como HTML.
import { api } from '../lib/api.d1db7328.js';
import { h, svgIcon, mount, userText, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast, confirmDialog, debounce } from '../lib/dom.a575914e.js';
import { timeAgo } from '../lib/format.2cdb7d3b.js';
import { pickAllowed } from '../lib/admin-url.df7c25a4.js';

const FILTERS = [['all', 'Todos'], ['unread', 'Sin leer'], ['read', 'Leídos']];
const PAGE = 25;
const badgesChanged = () => document.dispatchEvent(new Event('admin-badges')); // refresca los contadores de las pestañas

let box, content, status = 'all', query = '', page = 1, items = [], total = 0, unread = 0, bound = false, renderId = 0, onState = null;
const expanded = new Set();

/** Estado que va a la URL (solo lo que no es el valor por defecto) y su restauración desde ella. */
export const state = () => ({ ...(status !== 'all' ? { status } : {}), ...(query ? { q: query } : {}) });
export function restore(s = {}) {
  status = pickAllowed(s.status, FILTERS.map(([v]) => v), 'all');
  query = String(s.q ?? '').slice(0, 100);
  page = 1;
}

/** Pinta la sección en `container` (el cuerpo del panel de administración). */
export function render(container, stateChanged) {
  box = container;
  onState = stateChanged;
  if (!bound) {
    bound = true;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-msg]');
      if (b && box.contains(b)) actions[b.dataset.msg]?.(b);
    });
    box.addEventListener('input', debounce((e) => {
      if (e.target.id !== 'msg-search' || !box.contains(e.target)) return;
      query = e.target.value.trim(); page = 1; onState?.(); load();
    }, 300));
  }
  draw();
}

const card = (...c) => h('section', { class: 'card' }, ...c);

/** Barra (filtros, búsqueda, marcar todo) y contenedor de la lista. La barra no se vuelve a crear al cargar datos. */
function draw() {
  const search = h('div', { class: 'input-group' }, svgIcon('search', 'sm'),
    h('input', { id: 'msg-search', type: 'search', value: query, placeholder: 'Buscar en motivo y mensaje', 'aria-label': 'Buscar mensajes', maxlength: '100' }));
  content = h('div', { class: 'stack' }, card(loading()));
  mount(box, h('div', { class: 'stack' },
    h('div', { class: 'msg-bar' },
      h('div', { class: 'seg md-nav', role: 'group' }, FILTERS.map(([v, label]) =>
        h('button', { type: 'button', dataset: { msg: 'filter', value: v }, 'aria-pressed': String(v === status) }, label))),
      search,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'msg-read-all', dataset: { msg: 'read-all' }, hidden: true }, svgIcon('circle-check', 'sm'), ' Marcar todo como leído')),
    content));
  load();
}

async function load() {
  const id = ++renderId;
  mount(content, card(loading()));
  try {
    const data = await api(`/api/admin/messages?status=${status}&page=${page}&q=${encodeURIComponent(query)}`);
    if (id !== renderId) return;
    items = data.items; total = data.total; unread = data.unread;
    drawList();
  } catch (err) {
    if (id === renderId) mount(content, card(emptyState('triangle-alert', 'No se pudo cargar', err.message)));
  }
}

function summary() {
  return h('p', { class: 'muted', id: 'msg-summary' }, `${total} ${total === 1 ? 'mensaje' : 'mensajes'}${query ? ` con «${query}»` : ''} · ${unread} sin leer en total`);
}

function syncBar() {
  box.querySelector('#msg-summary')?.replaceWith(summary());
  const all = box.querySelector('#msg-read-all');
  if (all) {
    all.hidden = unread === 0;
    all.lastChild.textContent = ` Marcar todo como leído (${unread})`;
  }
  for (const b of box.querySelectorAll('[data-msg="filter"]')) b.setAttribute('aria-pressed', String(b.dataset.value === status));
}

function drawList() {
  syncBar();
  if (!items.length) {
    return mount(content, card(emptyState('message-square', query || status !== 'all' ? 'Sin resultados' : 'No hay mensajes',
      query || status !== 'all' ? 'Ningún mensaje coincide con el filtro o la búsqueda.' : 'Los mensajes del formulario de contacto aparecerán aquí.')));
  }
  mount(content, summary(), items.map(cardFor),
    (page > 1 || total > page * PAGE) ? h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'page', dir: '-1' }, disabled: page <= 1 }, 'Anterior'),
      h('span', { class: 'muted' }, `Página ${page}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'page', dir: '1' }, disabled: total <= page * PAGE }, 'Siguiente')) : null);
}

function cardFor(m) {
  const open = expanded.has(m.id);
  return h('section', { class: 'card msg-card', dataset: { card: m.id } },
    h('div', { class: 'card-head' },
      h('button', { type: 'button', class: 'msg-toggle', dataset: { msg: 'toggle', id: m.id }, 'aria-expanded': String(open) },
        svgIcon('chevron-right', 'sm'), h('strong', {}, m.reason), m.read ? null : h('span', { class: 'chip accent' }, 'Sin leer')),
      h('div', { class: 'gap-8' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { msg: 'read', id: m.id, value: String(!m.read) } }, m.read ? 'Marcar sin leer' : 'Marcar como leído'),
        h('button', { type: 'button', class: 'icon-btn sm', dataset: { msg: 'delete', id: m.id }, 'aria-label': 'Borrar mensaje', title: 'Borrar' }, svgIcon('trash-2', 'sm')))),
    h('p', { class: 'muted md-meta' },
      h('time', { title: new Date(m.createdAt * 1000).toLocaleString('es-ES') }, timeAgo(m.createdAt * 1000)), ' · ',
      m.user ? `Con sesión: ${m.user.alias ?? `usuario #${m.user.id}`}` : 'Sin sesión'),
    h('div', { class: `md-quote msg-body${open ? '' : ' clamp'}` }, userText(m.message)));
}

const find = (id) => items.find((m) => String(m.id) === String(id));
const refresh = (m) => { content.querySelector(`[data-card="${m.id}"]`)?.replaceWith(cardFor(m)); syncBar(); };

/** Marca un mensaje como leído o sin leer sin recargar la lista. Devuelve true si se aplicó. */
async function setRead(m, read) {
  try { await api(`/api/admin/messages/${m.id}`, { method: 'PATCH', body: { read } }); } catch (err) { toast(err.message, 'error'); return false; }
  if (m.read !== read) unread = Math.max(0, unread + (read ? -1 : 1));
  m.read = read;
  refresh(m);
  badgesChanged();
  return true;
}

const actions = {
  filter(b) { status = b.dataset.value; page = 1; onState?.(); load(); },
  page(b) { page = Math.max(1, page + Number(b.dataset.dir)); load(); },
  async toggle(b) {
    const m = find(b.dataset.id);
    if (!m) return;
    if (expanded.has(m.id)) { expanded.delete(m.id); return refresh(m); }
    expanded.add(m.id);
    refresh(m);
    if (!m.read) await setRead(m, true); // abrirlo es leerlo
    content.querySelector(`[data-card="${m.id}"] [data-msg="toggle"]`)?.focus({ preventScroll: true });
  },
  async read(b) {
    const m = find(b.dataset.id);
    if (m) await setRead(m, b.dataset.value === 'true');
  },
  async 'read-all'() {
    try {
      const r = await api('/api/admin/messages/read-all', { method: 'POST', body: {} });
      toast(r.marked ? `${r.marked} ${r.marked === 1 ? 'mensaje marcado' : 'mensajes marcados'} como ${r.marked === 1 ? 'leído' : 'leídos'}.` : 'No había mensajes sin leer.', 'success', 2500);
      badgesChanged();
      load();
    } catch (err) { toast(err.message, 'error'); }
  },
  async delete(b) {
    if (!await confirmDialog({ title: 'Borrar mensaje', body: 'El mensaje se eliminará de forma definitiva.', confirm: 'Borrar', danger: true })) return;
    try {
      await api(`/api/admin/messages/${b.dataset.id}`, { method: 'DELETE' });
      toast('Mensaje borrado.', 'success', 2000);
      expanded.delete(Number(b.dataset.id));
      badgesChanged();
      load();
    } catch (err) { toast(err.message, 'error'); }
  },
};
