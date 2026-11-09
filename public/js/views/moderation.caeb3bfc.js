// Panel de administración → Moderación: denuncias con acciones en línea. Al resolver una denuncia la tarjeta se actualiza o
// desaparece sin volver a pedir ni redibujar la lista, así que no se pierde la posición de scroll.
// Todo el texto de usuarios (mensajes denunciados, alias, motivos) se pinta con nodos de texto (lib/el.js).
// La gestión de usuarios (suspender/reactivar) vive en la pestaña «Usuarios»; el registro de acciones, en «Auditoría».
import { api } from '../lib/api.d1db7328.js';
import { h, svgIcon, mount, userText, emptyState, loading } from '../lib/el.71f9edc9.js';
import { toast, openDialog } from '../lib/dom.a575914e.js';
import { timeAgo } from '../lib/format.ede94c05.js';
import { go } from '../lib/router.de30a562.js';
import { errorMessage, REPORT_REASONS } from '../lib/community.23d94bf8.js';
import { pickAllowed } from '../lib/admin-url.df7c25a4.js';
import { PRESETS, OTHER, MAX_DETAIL, defaultPreset, buildReason, accountAgeLabel, isRepeatOffender } from '../lib/mod-helpers.04abd2eb.js';

const SECTIONS = [['open', 'Denuncias pendientes'], ['resolved', 'Resueltas'], ['dismissed', 'Descartadas']];
const REASON = Object.fromEntries(REPORT_REASONS);
const DAYS = [[1, '1 día'], [3, '3 días'], [7, '7 días'], [30, '30 días'], [0, 'Indefinida']];
const PAGE = 25;
const LEAVE_MS = 180;

let box, content, section = 'open', page = 1, items = [], total = 0, bound = false, renderId = 0, onState = null;

/** Estado que va a la URL (solo si no es el de por defecto) y su restauración desde ella. */
export const state = () => (section === 'open' ? {} : { section });
export function restore(s = {}) { section = pickAllowed(s.section, SECTIONS.map(([v]) => v), 'open'); page = 1; }

/** Pinta la sección en `container` (el cuerpo del panel de administración). */
export function render(container, stateChanged) {
  box = container;
  onState = stateChanged;
  if (!bound) {
    bound = true;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]');
      if (b && box.contains(b)) actions[b.dataset.m]?.(b);
    });
  }
  draw();
}

const card = (...c) => h('section', { class: 'card' }, ...c);
const when = (s) => h('time', { title: new Date(s * 1000).toLocaleString('es-ES') }, timeAgo(s * 1000));
const badgesChanged = () => document.dispatchEvent(new Event('admin-badges')); // los contadores de las pestañas se refrescan

function draw() {
  const id = ++renderId;
  const nav = h('div', { class: 'seg md-nav', role: 'group' }, SECTIONS.map(([v, label]) =>
    h('button', { type: 'button', dataset: { m: 'section', value: v }, 'aria-pressed': String(v === section) }, label)));
  content = h('div', { class: 'stack' }, card(loading()));
  mount(box, h('div', { class: 'stack' }, nav, content));
  api(`/api/admin/reports?status=${section}&page=${page}`).then((data) => {
    if (id !== renderId) return;
    items = data.items; total = data.total;
    drawItems();
  }).catch((err) => { if (id === renderId) mount(content, card(emptyState('triangle-alert', 'No se pudo cargar', errorMessage(err)))); });
}

function drawItems() {
  if (!items.length) {
    return mount(content, card(emptyState('circle-check', section === 'open' ? 'No hay denuncias pendientes' : 'Nada por aquí',
      section === 'open' ? 'Cuando alguien denuncie un mensaje aparecerá aquí.' : null)));
  }
  mount(content, items.map(cardFor), pager(page > 1, page * PAGE < total));
}

/* ---------- Tarjeta de una denuncia ---------- */
const statusChip = (s) => h('span', { class: `chip ${s === 'visible' ? 'up' : s === 'hidden' ? 'down' : ''}` },
  { visible: 'Visible', hidden: 'Oculto', deleted: 'Borrado por su autor' }[s] ?? s);

const btn = (cls, m, data, ...children) => h('button', { type: 'button', class: `btn ${cls} btn-sm`, dataset: { m, ...data } }, ...children);

/** Antecedentes del autor para decidir con contexto. */
function authorFile(a) {
  const repeat = isRepeatOffender(a);
  return h('p', { class: 'muted md-meta md-file' }, 'Historial: ', accountAgeLabel(a.accountCreatedAt),
    ` · ${a.posts} ${a.posts === 1 ? 'mensaje' : 'mensajes'}`,
    ` · ${a.hiddenPosts} ocultados`, ` · ${a.suspensions} ${a.suspensions === 1 ? 'suspensión' : 'suspensiones'}`,
    repeat ? h('span', { class: 'chip warn' }, 'Con antecedentes') : null);
}

function cardFor(it) {
  const a = it.author;
  return h('section', { class: 'card md-card', dataset: { card: it.postId }, tabindex: '-1' },
    h('div', { class: 'card-head' },
      h('div', { class: 'md-title' },
        h('strong', {}, `${it.count} ${it.count === 1 ? 'denuncia' : 'denuncias'}`),
        it.reasons.map((r) => h('span', { class: 'chip' }, REASON[r] ?? r)),
        statusChip(it.postStatus)),
      btn('btn-ghost', 'thread', { id: it.threadId }, svgIcon('external-link', 'sm'), ' Ver hilo')),
    h('p', { class: 'muted md-meta' }, 'Autor: ', h('strong', {}, it.reportedAuthor ?? 'desconocido'),
      a.alias && a.alias !== it.reportedAuthor ? ` (ahora «${a.alias}»)` : '',
      a.suspended ? h('span', { class: 'chip down' }, ' suspendido') : null,
      ' · En el hilo: ', h('em', {}, it.threadTitle), it.isThreadStart ? ' (mensaje inicial)' : ''),
    authorFile(a),
    h('div', { class: 'md-quote' }, h('small', { class: 'muted' }, 'Texto denunciado (copia guardada al denunciar):'),
      it.reportedBody != null ? userText(it.reportedBody) : h('p', { class: 'muted' }, 'Sin copia (denuncia anterior a esta versión).'),
      it.body != null && it.reportedBody != null && it.body !== it.reportedBody ? [h('small', { class: 'muted' }, 'Texto actual:'), userText(it.body)] : null),
    h('ul', { class: 'md-reports' }, it.reports.map((r) => h('li', {},
      h('span', { class: 'chip' }, REASON[r.reason] ?? r.reason), ' ', h('strong', {}, r.reporter ?? 'usuario eliminado'), ' · ', when(r.createdAt),
      r.details ? userText(r.details, 'user-text muted') : null))),
    h('div', { class: 'gap-8 md-actions' },
      it.postStatus === 'visible' ? btn('btn-danger', 'hide', { post: it.postId }, svgIcon('eye-off', 'sm'), ' Ocultar') : null,
      it.postStatus === 'hidden' ? btn('btn-ghost', 'restore', { post: it.postId }, svgIcon('rotate-ccw', 'sm'), ' Restaurar') : null,
      section === 'open' ? btn('btn-ghost', 'dismiss', { post: it.postId }, svgIcon('x', 'sm'), ' Descartar denuncias') : null,
      a.suspended
        ? btn('btn-ghost', 'unsuspend', { user: a.userId, alias: a.alias ?? '' }, 'Reactivar autor')
        : btn('btn-ghost', 'suspend', { user: a.userId, alias: a.alias ?? '' }, svgIcon('ban', 'sm'), ' Suspender autor')));
}

const pager = (prev, next) => (prev || next) ? h('div', { class: 'pager' },
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'page', dir: '-1' }, disabled: !prev }, 'Anterior'),
  h('span', { class: 'muted' }, `Página ${page}`),
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { m: 'page', dir: '1' }, disabled: !next }, 'Siguiente')) : null;

/* ---------- Actualización en línea (sin volver a pedir la lista) ---------- */
const find = (postId) => items.find((i) => String(i.postId) === String(postId));
const el = (postId) => content.querySelector(`[data-card="${postId}"]`);

/** Quita la tarjeta con una transición corta y pasa el foco a la siguiente. */
function removeCard(postId) {
  const node = el(postId);
  items = items.filter((i) => String(i.postId) !== String(postId));
  total = Math.max(0, total - 1);
  const done = () => {
    const next = node?.nextElementSibling?.matches?.('[data-card]') ? node.nextElementSibling : node?.previousElementSibling?.matches?.('[data-card]') ? node.previousElementSibling : null;
    node?.remove();
    if (next) next.focus({ preventScroll: true });
    if (items.length) { // la página sigue teniendo tarjetas: solo se actualiza el paginador
      const old = content.querySelector('.pager');
      const fresh = pager(page > 1, page * PAGE < total);
      if (old) old.replaceWith(...(fresh ? [fresh] : [])); else if (fresh) content.append(fresh);
    } else if (total > 0) { // quedaban más páginas: se vuelve a pedir
      page = Math.max(1, Math.min(page, Math.ceil(total / PAGE)));
      draw();
    } else drawItems();
  };
  if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  node.classList.add('md-leaving');
  setTimeout(done, LEAVE_MS);
}

function refreshCard(postId) {
  const it = find(postId), node = el(postId);
  if (it && node) node.replaceWith(cardFor(it));
}

/** Suspender/reactivar afecta a todas las tarjetas del mismo autor. */
function setSuspended(userId, suspended) {
  for (const it of items.filter((i) => String(i.author.userId) === String(userId))) {
    it.author.suspended = suspended;
    if (suspended) it.author.suspensions += 1;
    refreshCard(it.postId);
  }
}

/* ---------- Diálogo: motivo rápido + detalle opcional (y días para suspender) ---------- */
function reasonDialog({ action, title, subtitle, confirm, danger = false, days = false, reportReasons = [], onSubmit, onDone }) {
  const d = document.getElementById('dlg');
  d.className = 'dlg dlg-sm';
  const chosen = defaultPreset(action, reportReasons);
  const detailLabel = h('label', { for: 'md-detail' }, 'Detalle (opcional; queda en el registro)');
  mount(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' }, h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))),
    h('form', { class: 'dlg-body cm-form', novalidate: true },
      days ? h('div', { class: 'field' }, h('label', { for: 'md-days' }, 'Duración'),
        h('select', { id: 'md-days', name: 'days' }, DAYS.map(([v, label]) => h('option', { value: String(v), selected: v === 7 }, label)))) : null,
      h('fieldset', { class: 'md-presets' }, h('legend', {}, 'Motivo'),
        PRESETS[action].map((p) => h('label', { class: 'md-preset' }, h('input', { type: 'radio', name: 'preset', value: p, checked: p === chosen }), h('span', {}, p)))),
      h('div', { class: 'field' }, detailLabel,
        h('textarea', { id: 'md-detail', name: 'detail', maxlength: String(MAX_DETAIL), rows: '2' })),
      h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
        h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, confirm))));
  openDialog(d);
  const form = d.querySelector('form');
  const syncLabel = () => { detailLabel.textContent = new FormData(form).get('preset') === OTHER ? 'Detalle (obligatorio; queda en el registro)' : 'Detalle (opcional; queda en el registro)'; };
  form.addEventListener('change', syncLabel);
  syncLabel();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const err = form.querySelector('.cm-form-error');
    const { reason, error } = buildReason(f.get('preset'), f.get('detail'));
    if (error) { err.textContent = error; return; }
    err.textContent = '';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await onSubmit(reason, Number(f.get('days')));
      d.close();
      badgesChanged();
      onDone?.();
    } catch (ex) { err.textContent = errorMessage(ex); } finally { submit.disabled = false; }
  });
}

const post = (id, action, body) => api(`/api/admin/posts/${id}/${action}`, { method: 'POST', body });
const user = (id, action, body) => api(`/api/admin/users/${id}/${action}`, { method: 'POST', body });

/** Suspender a un usuario (también desde la pestaña «Usuarios»). `onDone` se llama al terminar con éxito. */
export function suspendUser({ userId, alias, reportReasons = [], onDone }) {
  reasonDialog({ action: 'suspend', title: `Suspender a ${alias || 'este usuario'}`, subtitle: 'No podrá publicar, votar, denunciar ni seguir. Podrá seguir entrando y operando.',
    confirm: 'Suspender', danger: true, days: true, reportReasons,
    onSubmit: async (reason, days) => { await user(userId, 'suspend', { reason, days: days || null }); toast('Usuario suspendido.', 'success'); }, onDone });
}

export function unsuspendUser({ userId, alias, onDone }) {
  reasonDialog({ action: 'unsuspend', title: `Reactivar a ${alias || 'este usuario'}`, subtitle: 'Podrá volver a participar en la comunidad.', confirm: 'Reactivar',
    onSubmit: async (reason) => { await user(userId, 'unsuspend', { reason }); toast('Usuario reactivado.', 'success'); }, onDone });
}

const actions = {
  section(b) { section = b.dataset.value; page = 1; onState?.(); draw(); },
  page(b) { page = Math.max(1, page + Number(b.dataset.dir)); draw(); },
  thread(b) { go(`/community/thread:${b.dataset.id}`); },
  hide(b) {
    const it = find(b.dataset.post);
    reasonDialog({ action: 'hide', title: 'Ocultar mensaje', confirm: 'Ocultar', danger: true, reportReasons: it?.reasons,
      subtitle: 'Dejará de verse en el foro (los admins lo seguirán viendo) y se resolverán sus denuncias. Oculta también lo que promocione servicios de pago, señales, afiliados o enlaces comerciales (normas de la comunidad).',
      onSubmit: async (reason) => { await post(b.dataset.post, 'hide', { reason }); toast('Mensaje oculto.', 'success'); },
      onDone: () => { if (section === 'open') removeCard(b.dataset.post); else { if (it) it.postStatus = 'hidden'; refreshCard(b.dataset.post); } } });
  },
  restore(b) {
    const it = find(b.dataset.post);
    reasonDialog({ action: 'restore', title: 'Restaurar mensaje', subtitle: 'Volverá a verse en el foro.', confirm: 'Restaurar',
      onSubmit: async (reason) => { await post(b.dataset.post, 'restore', { reason }); toast('Mensaje restaurado.', 'success'); },
      onDone: () => { if (it) it.postStatus = 'visible'; refreshCard(b.dataset.post); } });
  },
  dismiss(b) {
    reasonDialog({ action: 'dismiss', title: 'Descartar denuncias', subtitle: 'El mensaje no incumple las normas y seguirá visible.', confirm: 'Descartar',
      onSubmit: async (reason) => { await post(b.dataset.post, 'dismiss', { reason }); toast('Denuncias descartadas.', 'success'); },
      onDone: () => removeCard(b.dataset.post) });
  },
  suspend(b) {
    const mine = items.find((i) => String(i.author.userId) === b.dataset.user);
    suspendUser({ userId: b.dataset.user, alias: b.dataset.alias, reportReasons: mine?.reasons, onDone: () => setSuspended(b.dataset.user, true) });
  },
  unsuspend(b) { unsuspendUser({ userId: b.dataset.user, alias: b.dataset.alias, onDone: () => setSuspended(b.dataset.user, false) }); },
};
