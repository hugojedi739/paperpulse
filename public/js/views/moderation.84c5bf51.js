// Panel de administración → Moderación: denuncias, usuarios (suspender / reactivar) y registro de acciones.
// Todo el texto de usuarios (mensajes denunciados, alias, motivos) se pinta con nodos de texto (lib/el.js).
import { api } from '../lib/api.d1caad06.js';
import { h, svgIcon, mount, userText, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast, openDialog, debounce } from '../lib/dom.700bdea1.js';
import { timeAgo } from '../lib/format.bcd91d41.js';
import { go } from '../lib/router.de30a562.js';
import { errorMessage, REPORT_REASONS } from '../lib/community.562a3224.js';

const SECTIONS = [['open', 'Denuncias pendientes'], ['resolved', 'Resueltas'], ['dismissed', 'Descartadas'], ['users', 'Usuarios'], ['log', 'Registro']];
const REASON = Object.fromEntries(REPORT_REASONS);
const ACTIONS = {
  hide_post: 'Ocultó un mensaje', restore_post: 'Restauró un mensaje', dismiss_reports: 'Descartó denuncias',
  suspend_user: 'Suspendió a un usuario', unsuspend_user: 'Reactivó a un usuario', author_delete: 'Borró su propio mensaje',
};
const DAYS = [[1, '1 día'], [3, '3 días'], [7, '7 días'], [30, '30 días'], [0, 'Indefinida']];

let box, section = 'open', page = 1, query = '', logItems = [], logNext = null, bound = false, renderId = 0;

/** Pinta la sección en `container` (el cuerpo del panel de administración). */
export function render(container) {
  box = container;
  if (!bound) {
    bound = true;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b && box.contains(b)) actions[b.dataset.m]?.(b);
    });
    box.addEventListener('input', debounce((e) => { if (e.target.id === 'md-search') { query = e.target.value.trim(); page = 1; draw(); } }, 300));
  }
  draw();
}

const card = (...c) => h('section', { class: 'card' }, ...c);
const when = (s) => h('time', { title: new Date(s * 1000).toLocaleString('es-ES') }, timeAgo(s * 1000));

function draw() {
  const id = ++renderId;
  const nav = h('div', { class: 'seg md-nav', role: 'group' }, SECTIONS.map(([v, label]) =>
    h('button', { type: 'button', dataset: { m: 'section', value: v }, 'aria-pressed': String(v === section) }, label)));
  const content = h('div', { class: 'stack' }, card(loading()));
  mount(box, h('div', { class: 'stack' }, nav, content));
  const loader = section === 'users' ? drawUsers : section === 'log' ? drawLog : drawReports;
  loader(content, id).catch((err) => { if (id === renderId) mount(content, card(emptyState('triangle-alert', 'No se pudo cargar', errorMessage(err)))); });
}

/* ---------- Denuncias ---------- */
async function drawReports(content, id) {
  const data = await api(`/api/admin/reports?status=${section}&page=${page}`);
  if (id !== renderId) return;
  if (!data.items.length) {
    return mount(content, card(emptyState('circle-check', section === 'open' ? 'No hay denuncias pendientes' : 'Nada por aquí',
      section === 'open' ? 'Cuando alguien denuncie un mensaje aparecerá aquí.' : null)));
  }
  mount(content, data.items.map((it) => card(
    h('div', { class: 'card-head' },
      h('div', { class: 'md-title' },
        h('strong', {}, `${it.count} ${it.count === 1 ? 'denuncia' : 'denuncias'}`),
        it.reasons.map((r) => h('span', { class: 'chip' }, REASON[r] ?? r)),
        statusChip(it.postStatus)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'thread', id: it.threadId } }, svgIcon('external-link', 'sm'), ' Ver hilo')),
    h('p', { class: 'muted md-meta' }, 'Autor: ', h('strong', {}, it.reportedAuthor ?? 'desconocido'),
      it.author.alias && it.author.alias !== it.reportedAuthor ? ` (ahora «${it.author.alias}»)` : '',
      it.author.suspended ? h('span', { class: 'chip down' }, ' suspendido') : null,
      ' · En el hilo: ', h('em', {}, it.threadTitle), it.isThreadStart ? ' (mensaje inicial)' : ''),
    h('div', { class: 'md-quote' }, h('small', { class: 'muted' }, 'Texto denunciado (copia guardada al denunciar):'),
      it.reportedBody != null ? userText(it.reportedBody) : h('p', { class: 'muted' }, 'Sin copia (denuncia anterior a esta versión).'),
      it.body != null && it.reportedBody != null && it.body !== it.reportedBody ? [h('small', { class: 'muted' }, 'Texto actual:'), userText(it.body)] : null),
    h('ul', { class: 'md-reports' }, it.reports.map((r) => h('li', {},
      h('span', { class: 'chip' }, REASON[r.reason] ?? r.reason), ' ', h('strong', {}, r.reporter ?? 'usuario eliminado'), ' · ', when(r.createdAt),
      r.details ? userText(r.details, 'user-text muted') : null))),
    h('div', { class: 'gap-8 md-actions' },
      it.postStatus === 'visible' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', dataset: { m: 'hide', post: it.postId } }, svgIcon('eye-off', 'sm'), ' Ocultar') : null,
      it.postStatus === 'hidden' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'restore', post: it.postId } }, svgIcon('rotate-ccw', 'sm'), ' Restaurar') : null,
      section === 'open' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'dismiss', post: it.postId } }, svgIcon('x', 'sm'), ' Descartar denuncias') : null,
      it.author.suspended
        ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'unsuspend', user: it.author.userId, alias: it.author.alias ?? '' } }, 'Reactivar autor')
        : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'suspend', user: it.author.userId, alias: it.author.alias ?? '' } }, svgIcon('ban', 'sm'), ' Suspender autor')),
  )), pager(page > 1, page * 25 < data.total));
}

const statusChip = (s) => h('span', { class: `chip ${s === 'visible' ? 'up' : s === 'hidden' ? 'down' : ''}` },
  { visible: 'Visible', hidden: 'Oculto', deleted: 'Borrado por su autor' }[s] ?? s);

const pager = (prev, next) => (prev || next) ? h('div', { class: 'pager' },
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'page', dir: '-1' }, disabled: !prev }, 'Anterior'),
  h('span', { class: 'muted' }, `Página ${page}`),
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'page', dir: '1' }, disabled: !next }, 'Siguiente')) : null;

/* ---------- Usuarios ---------- */
async function drawUsers(content, id) {
  const data = await api(`/api/admin/users?q=${encodeURIComponent(query)}&limit=25&offset=${(page - 1) * 25}`);
  if (id !== renderId) return;
  const search = h('div', { class: 'input-group' }, svgIcon('search', 'sm'),
    h('input', { id: 'md-search', type: 'search', value: query, placeholder: 'Buscar por alias, nombre o email', 'aria-label': 'Buscar usuarios' }));
  const rows = data.users.map((u) => h('tr', {},
    h('td', {}, h('div', { class: 'md-user' }, h('strong', {}, u.alias ?? '(sin alias)'), h('small', { class: 'muted' }, u.name))),
    h('td', {}, u.role === 'admin' ? h('span', { class: 'chip accent' }, 'Admin') : h('span', { class: 'chip' }, 'Usuario')),
    h('td', {}, u.suspendedUntil
      ? [h('span', { class: 'chip down' }, u.suspendedUntil > 253402200000 ? 'Suspendido (indefinida)' : `Suspendido hasta ${new Date(u.suspendedUntil * 1000).toLocaleDateString('es-ES')}`),
        u.suspensionReason ? h('small', { class: 'muted md-reason' }, u.suspensionReason) : null]
      : h('span', { class: 'chip up' }, 'Puede participar')),
    h('td', { class: 'r' }, u.role === 'admin' ? h('span', { class: 'muted' }, '—') : u.suspendedUntil
      ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'unsuspend', user: u.id, alias: u.alias ?? u.name } }, 'Reactivar')
      : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'suspend', user: u.id, alias: u.alias ?? u.name } }, svgIcon('ban', 'sm'), ' Suspender')),
  ));
  mount(content, card(
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Usuarios de la comunidad'), search),
    h('p', { class: 'hint' }, 'La suspensión impide publicar, votar, denunciar y seguir. No impide entrar ni operar (para eso, desactiva la cuenta en «Usuarios»).'),
    rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Usuario'), h('th', {}, 'Rol'), h('th', {}, 'Comunidad'), h('th', { class: 'r' }, 'Acción'))),
      h('tbody', {}, rows))) : emptyState('search', 'Sin resultados'),
    pager(page > 1, page * 25 < data.total)));
  const input = content.querySelector('#md-search');
  if (query) { input.focus(); input.setSelectionRange(query.length, query.length); }
}

/* ---------- Registro ---------- */
async function drawLog(content, id, more = false) {
  const data = await api(`/api/admin/moderation-log${more && logNext ? `?before=${logNext}` : ''}`);
  if (id !== renderId) return;
  logItems = more ? [...logItems, ...data.items] : data.items;
  logNext = data.hasMore ? logItems.at(-1).id : null;
  if (!logItems.length) return mount(content, card(emptyState('scroll-text', 'Sin acciones registradas')));
  mount(content, card(h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Registro de moderación')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Cuándo'), h('th', {}, 'Quién'), h('th', {}, 'Acción'), h('th', {}, 'Sobre'), h('th', {}, 'Motivo'))),
      h('tbody', {}, logItems.map((i) => h('tr', {},
        h('td', { class: 'muted' }, when(i.createdAt)), h('td', {}, i.actor ?? '—'), h('td', {}, ACTIONS[i.action] ?? i.action),
        h('td', {}, i.targetType === 'user' ? `Usuario ${i.targetAlias ?? `#${i.targetId}`}` : `Mensaje #${i.targetId}${i.targetAlias ? ` de ${i.targetAlias}` : ''}`),
        h('td', {}, i.reason ? h('span', { class: 'md-reason' }, i.reason) : h('span', { class: 'muted' }, '—'))))))),
    logNext ? h('div', { class: 'pager' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'log-more' } }, 'Cargar más')) : null));
}

/* ---------- Diálogo con motivo (y días para suspender) ---------- */
function reasonDialog({ title, subtitle, confirm, danger = false, days = false, onSubmit }) {
  const d = document.getElementById('dlg');
  d.className = 'dlg dlg-sm';
  mount(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' }, h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))),
    h('form', { class: 'dlg-body cm-form', novalidate: true },
      days ? h('div', { class: 'field' }, h('label', { for: 'md-days' }, 'Duración'),
        h('select', { id: 'md-days', name: 'days' }, DAYS.map(([v, label]) => h('option', { value: String(v), selected: v === 7 }, label)))) : null,
      h('div', { class: 'field' }, h('label', { for: 'md-reason' }, 'Motivo (queda en el registro)'),
        h('textarea', { id: 'md-reason', name: 'reason', maxlength: '300', rows: '3', required: true })),
      h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
        h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirm))));
  openDialog(d);
  const form = d.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const reason = String(f.get('reason') ?? '').trim();
    const err = form.querySelector('.cm-form-error');
    if (!reason) { err.textContent = 'Indica el motivo.'; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit(reason, Number(f.get('days')));
      d.close();
      draw();
    } catch (ex) { err.textContent = errorMessage(ex); } finally { btn.disabled = false; }
  });
}

const post = (id, action, body) => api(`/api/admin/posts/${id}/${action}`, { method: 'POST', body });
const user = (id, action, body) => api(`/api/admin/users/${id}/${action}`, { method: 'POST', body });

const actions = {
  section(b) { section = b.dataset.value; page = 1; draw(); },
  page(b) { page = Math.max(1, page + Number(b.dataset.dir)); draw(); },
  thread(b) { go(`/community/thread:${b.dataset.id}`); },
  'log-more'() { const content = box.querySelector('.stack > .stack'); drawLog(content, renderId, true).catch((err) => toast(errorMessage(err), 'error')); },
  hide: (b) => reasonDialog({ title: 'Ocultar mensaje', subtitle: 'Dejará de verse en el foro (los admins lo seguirán viendo) y se resolverán sus denuncias. Oculta también lo que promocione servicios de pago, señales, afiliados o enlaces comerciales (normas de la comunidad).', confirm: 'Ocultar', danger: true,
    onSubmit: async (reason) => { await post(b.dataset.post, 'hide', { reason }); toast('Mensaje oculto.', 'success'); } }),
  restore: (b) => reasonDialog({ title: 'Restaurar mensaje', subtitle: 'Volverá a verse en el foro.', confirm: 'Restaurar',
    onSubmit: async (reason) => { await post(b.dataset.post, 'restore', { reason }); toast('Mensaje restaurado.', 'success'); } }),
  dismiss: (b) => reasonDialog({ title: 'Descartar denuncias', subtitle: 'El mensaje no incumple las normas y seguirá visible.', confirm: 'Descartar',
    onSubmit: async (reason) => { await post(b.dataset.post, 'dismiss', { reason }); toast('Denuncias descartadas.', 'success'); } }),
  suspend: (b) => reasonDialog({ title: `Suspender a ${b.dataset.alias || 'este usuario'}`, subtitle: 'No podrá publicar, votar, denunciar ni seguir. Podrá seguir entrando y operando.',
    confirm: 'Suspender', danger: true, days: true,
    onSubmit: async (reason, days) => { await user(b.dataset.user, 'suspend', { reason, days: days || null }); toast('Usuario suspendido.', 'success'); } }),
  unsuspend: (b) => reasonDialog({ title: `Reactivar a ${b.dataset.alias || 'este usuario'}`, subtitle: 'Podrá volver a participar en la comunidad.', confirm: 'Reactivar',
    onSubmit: async (reason) => { await user(b.dataset.user, 'unsuspend', { reason }); toast('Usuario reactivado.', 'success'); } }),
};
