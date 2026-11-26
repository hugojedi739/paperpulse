// Vista Administración: métricas, usuarios, métodos de inicio de sesión (Google, Okta) e integraciones.
// Solo visible para usuarios con rol admin; el backend vuelve a comprobarlo en cada petición.
import { isVisible } from '../lib/sections.b37aa67f.js';
import { html, icon, render, on, $, $$, toast, confirmDialog, debounce } from '../lib/dom.a575914e.js';
import { num, timeAgo } from '../lib/format.df8faa5e.js';
import { api } from '../lib/api.fadcc3a8.js';
import * as auth from '../lib/auth.79b9acc8.js';
import { empty } from '../lib/ui.df413464.js';
import * as moderation from './moderation.23b67670.js';
import * as messages from './messages.60f2d99b.js';
import * as audit from './audit.2ee1ed68.js';
import { parseParam, buildPath, nonDefault, pickAllowed } from '../lib/admin-url.129ac5cb.js';

export const title = 'Administración';

// Barra lateral: [id, etiqueta, icono, grupo]. «Contenido» es la moderación del foro; «Mensajes» los de contacto.
const SOURCE_NAMES = { direct: 'Directo', reddit: 'Reddit', tiktok: 'TikTok', x: 'X (Twitter)', instagram: 'Instagram', youtube: 'YouTube', google: 'Google', otro: 'Otro' };
const TABS = [
  ['overview', 'Resumen', 'layout-dashboard', 'Panel'], ['users', 'Usuarios', 'users', 'Panel'], ['activity', 'Actividad', 'activity', 'Panel'],
  ['messages', 'Mensajes de contacto', 'message-square', 'Panel'], ['moderation', 'Contenido', 'flag', 'Panel'], ['health', 'Salud de APIs', 'zap', 'Panel'],
  ['login', 'Inicio de sesión', 'log-in', 'Sistema'], ['integrations', 'Integraciones', 'settings', 'Sistema'], ['audit', 'Auditoría', 'scroll-text', 'Sistema'],
];
const PAGE = 25;
let root, tab = 'overview';
let usersOffset = 0;
const USER_FILTERS = [
  ['role', 'Rol', [['', 'Todos'], ['admin', 'Administradores'], ['user', 'Usuarios']]],
  ['status', 'Estado', [['', 'Todos'], ['active', 'Activos'], ['disabled', 'Desactivados'], ['suspended', 'Suspendidos']]],
  ['verified', 'Email', [['', 'Todos'], ['yes', 'Verificado'], ['no', 'Sin verificar']]],
];
const USER_ORDERS = [['created_desc', 'Alta reciente'], ['created_asc', 'Alta antigua'], ['login_desc', 'Acceso reciente'], ['login_asc', 'Acceso antiguo']];
const USERS_DEFAULT = { q: '', role: '', status: '', verified: '', order: 'created_desc' };
let usersState = { ...USERS_DEFAULT };
let cfg = null; // { settings, redirectUris }
let badges = { openReports: 0, unreadMessages: 0 }; // pendientes que se muestran en las pestañas

export function mount(el) {
  root = el;
  render(root, html`<div class="admin-layout"><nav class="admin-nav" id="ad-tabs" aria-label="Secciones del panel"></nav><div id="ad-body" class="admin-main"></div></div>`);
  on(root, 'click', '[data-tab]', (_, b) => { tab = b.dataset.tab; show(); });
  on(root, 'click', '[data-ad]', (e, b) => {
    if (b.getAttribute('aria-disabled') === 'true') return; // opción del menú no disponible: su motivo ya se ve debajo
    b.closest('[popover]')?.hidePopover?.();
    actions[b.dataset.ad]?.(b, e);
  });
  on(root, 'input', '#ad-search', debounce((e) => { usersState.q = e.target.value.trim(); usersOffset = 0; renderUsers(); syncUrl(); }, 300));
  on(root, 'change', '[data-uf]', (_, sel) => { usersState[sel.dataset.uf] = sel.value; usersOffset = 0; renderUsers(); syncUrl(); });
  root.addEventListener('toggle', (e) => { // los menús de fila se colocan junto a su botón (la tabla tiene scroll propio y un menú normal quedaría recortado)
    const pop = e.target;
    if (!pop.matches?.('.row-menu') || e.newState !== 'open') return;
    placeMenu(pop);
    pop.querySelector('[role="menuitem"]')?.focus();
    addEventListener('scroll', () => pop.hidePopover?.(), { once: true, passive: true });
  }, true);
  on(root, 'submit', 'form[data-form]', (e, f) => { e.preventDefault(); saveForm(f); });
  auth.onAuth(() => { if (!root.hidden) show(); });
  document.addEventListener('admin-badges', refreshBadges); // moderación y mensajes avisan al resolver algo
}

async function refreshBadges() {
  if (!auth.isAdmin() || !root || root.hidden) return;
  try { badges = await api('/api/admin/badges'); } catch { return; } // un fallo aquí no debe molestar: los contadores son un extra
  renderTabs();
}

const BADGE_TAB = { moderation: 'openReports', messages: 'unreadMessages' };

function renderTabs() {
  let group = '';
  render($('#ad-tabs', root), TABS.filter(([id]) => id !== 'moderation' || isVisible('community')).map(([id, label, ic, g]) => {
    const n = badges[BADGE_TAB[id]] ?? 0;
    const head = g !== group ? html`<span class="admin-nav-group">${g}</span>` : '';
    group = g;
    return html`${head}<button type="button" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${icon(ic, 'sm')} ${label}${n ? html` <span class="count alert" aria-label="${n} pendientes">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
  }));
}

function placeMenu(pop) {
  const btn = root.querySelector(`[popovertarget="${pop.id}"]`);
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  pop.style.left = 'auto';
  pop.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  pop.style.top = `${r.bottom + 4}px`;
  const height = pop.getBoundingClientRect().height;
  if (r.bottom + 4 + height > innerHeight - 8 && r.top - 4 - height > 8) pop.style.top = `${r.top - 4 - height}px`;
}

/* ---------- Estado en la URL: #/admin/<pestaña>:<filtros> (se escribe sin recargar ni añadir entradas al historial) ---------- */
function currentState() {
  if (tab === 'users') return nonDefault(usersState, USERS_DEFAULT);
  if (tab === 'moderation') return moderation.state();
  if (tab === 'messages') return messages.state();
  return {};
}

function syncUrl() {
  if (!root || root.hidden) return;
  const hash = `#${buildPath(tab, currentState())}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function restoreState(t, st) {
  if (t === 'users') {
    usersState = {
      q: String(st.q ?? '').slice(0, 100),
      ...Object.fromEntries(USER_FILTERS.map(([key, , opts]) => [key, pickAllowed(st[key], opts.map(([v]) => v), '')])),
      order: pickAllowed(st.order, USER_ORDERS.map(([v]) => v), USERS_DEFAULT.order),
    };
    usersOffset = 0;
  } else if (t === 'moderation') moderation.restore(st);
  else if (t === 'messages') messages.restore(st);
}


export function show(param) {
  const parsed = parseParam(param);
  if (parsed.tab) { tab = parsed.tab; restoreState(tab, parsed.state); } // sin parámetro se conserva la pestaña y los filtros actuales
  renderTabs();
  refreshBadges();
  const body = $('#ad-body', root);
  if (!auth.isAdmin()) {
    return render(body, html`<section class="card">${empty('shield-check', 'Acceso restringido', auth.currentUser()
      ? 'Tu cuenta no tiene permisos de administrador.'
      : 'Inicia sesión con una cuenta de administrador para gestionar la aplicación.',
    auth.currentUser() ? '' : html`<button class="btn btn-primary" data-action="login">${icon('log-in', 'sm')} Iniciar sesión</button>`)}</section>`);
  }
  render(body, html`<section class="card">${empty('refresh-cw', 'Cargando…')}</section>`);
  ({ overview: renderOverview, activity: renderActivity, health: renderHealth, users: renderUsers, login: renderLogin, integrations: renderIntegrations, moderation: () => moderation.render(body, syncUrl), messages: () => messages.render(body, syncUrl), audit: () => audit.render(body) })[tab]();
  syncUrl();
}

const fail = (err) => render($('#ad-body', root), html`<section class="card">${empty('triangle-alert', 'No se pudo cargar', err.message)}</section>`);

/* ---------- Resumen: usuarios, nuevos, activos y operaciones ---------- */
const last30 = (u) => {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400_000).toISOString().slice(0, 10));
  const counts = new Map(u.signups30d.map((d) => [d.date, d.count]));
  return { days, counts, max: Math.max(1, ...counts.values()) };
};

async function renderOverview() {
  let o;
  try { o = await api('/api/admin/overview'); } catch (err) { return fail(err); }
  if (tab !== 'overview') return;
  const u = o.users, act = o.activity, vis = o.visits;
  const { days, counts, max } = last30(u);
  render($('#ad-body', root), html`
    <div class="kpis">
      <div class="card kpi"><span>Usuarios</span><strong>${num(u.users, 0)}</strong><small>${u.admins} admin · ${u.disabled} desactivados</small></div>
      <div class="card kpi"><span>Nuevos (7 días)</span><strong>${num(u.newUsers7d, 0)}</strong><small>${num(vis.today.signups, 0)} hoy</small></div>
      <div class="card kpi"><span>Activos (7 días)</span><strong>${num(u.activeUsers7d, 0)}</strong><small>${num(u.activeSessions, 0)} sesiones abiertas</small></div>
      <div class="card kpi"><span>Operaciones hoy</span><strong>${num(act.trading.fillsToday, 0)}</strong><small>${act.trading.tradersToday} cuentas · ${act.trading.ordersToday} órdenes · ${act.trading.openOrders} pendientes</small></div>
    </div>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('calendar')} Altas en los últimos 30 días</h2><span class="card-sub">${u.signups30d.reduce((a, d) => a + d.count, 0)} en total</span></div>
      <div class="spark-bars" role="img" aria-label="Altas por día">${days.map((d) => html`<i data-w="${Math.max(4, ((counts.get(d) ?? 0) / max) * 100)}" title="${d}: ${counts.get(d) ?? 0}"></i>`)}</div>
    </section>
    <div class="kpis">
      <div class="card kpi"><span>Denuncias abiertas</span><strong>${num(act.community.openReports, 0)}</strong><small>en Contenido</small></div>
      <div class="card kpi"><span>Mensajes de contacto</span><strong>${num(o.unreadMessages, 0)}</strong><small>sin leer</small></div>
    </div>`);
}

/* ---------- Actividad: visitas, foro, asistente y servicios ---------- */
async function renderActivity() {
  let o;
  try { o = await api('/api/admin/overview'); } catch (err) { return fail(err); }
  if (tab !== 'activity') return;
  const u = o.users, use = o.usage, st = o.stream, int = o.integrations, act = o.activity, hist = o.aiHistory, vis = o.visits;
  const people = (d) => d.anon + d.user; // visitantes únicos (personas): sin sesión + con sesión; los bots aparte
  const maxPeople = Math.max(1, ...vis.history.map(people));
  const maxTokens = Math.max(1, ...hist.map((d) => d.tokens));
  const days14 = vis.history.map((d) => d.day);
  const fillMap = new Map((act.fillsByDay ?? []).map((d) => [d.day, d.count]));
  const fillDays = days14.map((day) => ({ day, count: fillMap.get(day) ?? 0 }));
  const maxFills = Math.max(1, ...fillDays.map((d) => d.count));
  const fillsTotal = fillDays.reduce((a, d) => a + d.count, 0);
  const sources = vis.sources ?? [];
  const sourcesTotal = Math.max(1, sources.reduce((a, x) => a + x.views, 0));
  const ok = (v, yes = 'Activo', no = 'Inactivo') => html`<span class="chip ${v ? 'up' : ''}">${v ? html`<span class="dot"></span>${yes}` : no}</span>`;
  render($('#ad-body', root), html`
    <div class="kpis">
      <div class="card kpi"><span>Visitantes hoy</span><strong>${num(people(vis.today), 0)}</strong><small>${vis.today.anon} sin sesión · ${vis.today.user} con sesión</small></div>
      <div class="card kpi"><span>Cargas de la portada hoy</span><strong>${num(vis.today.views, 0)}</strong><small>sin contar bots</small></div>
      <div class="card kpi"><span>Foro hoy</span><strong>${num(act.community.postsToday, 0)}</strong><small>mensajes · ${act.community.threadsToday} hilos nuevos</small></div>
      <div class="card kpi"><span>IA hoy</span><strong>${num(use.tokensToday, 0)}</strong><small>tokens · ${use.percentUsed}% del límite · ${use.costTodayUsd} $</small></div>
      <div class="card kpi"><span>Bots hoy</span><strong>${num(vis.today.bot, 0)}</strong><small>buscadores, previsualizaciones y monitores</small></div>
      <div class="card kpi"><span>Registros hoy</span><strong>${num(vis.today.signups, 0)}</strong><small>cuentas nuevas (día UTC)</small></div>
    </div>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('users')} Visitantes: últimos 14 días</h2><span class="card-sub">${vis.enabled ? `${num(vis.history.reduce((a, d) => a + people(d), 0), 0)} visitantes (suma de cada día) · ${num(vis.history.reduce((a, d) => a + d.bot, 0), 0)} bots` : 'Contador desactivado en Integraciones'}</span></div>
      <div class="spark-bars" role="img" aria-label="Visitantes únicos por día">${vis.history.map((d) => html`<i data-w="${Math.max(4, (people(d) / maxPeople) * 100)}" title="${d.day}: ${d.anon} sin sesión · ${d.user} con sesión · ${d.bot} bots · ${d.views} cargas"></i>`)}</div>
      <p class="hint">Visitantes únicos por día de la portada, sin cookies ni IP: un identificador anónimo que cambia cada día. Quien entra sin sesión y luego con sesión cuenta en los dos grupos.</p>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('chart-candlestick')} Operaciones por día</h2><span class="card-sub">${fillsTotal} en 14 días (cuentas del servidor)</span></div>
      <div class="spark-bars" role="img" aria-label="Operaciones por día">${fillDays.map((d) => html`<i data-w="${Math.max(4, (d.count / maxFills) * 100)}" title="${d.day}: ${d.count} operaciones"></i>`)}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('globe')} Origen de las visitas</h2><span class="card-sub">últimos 14 días · parámetro ?ref=</span></div>
      ${sources.length ? html`<div class="status-list">${sources.map((x) => html`<div><span>${SOURCE_NAMES[x.source] ?? x.source}</span><strong>${num(x.views, 0)} <small class="muted">· ${Math.round((x.views / sourcesTotal) * 100)} %</small></strong></div>`)}</div>`
        : html`<p class="hint">Aún no hay visitas con origen. Comparte enlaces con <code>?ref=reddit</code> o <code>?ref=tiktok</code>; sin parámetro se mira la página de procedencia y, si no hay, cuenta como «Directo».</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('sparkles')} Asistente: últimos 14 días</h2><span class="card-sub">${num(hist.reduce((a, d) => a + d.tokens, 0), 0)} tokens · ${hist.reduce((a, d) => a + d.aiRequests, 0)} con IA · ${hist.reduce((a, d) => a + d.fixedAnswers, 0)} respuestas fijas</span></div>
      <div class="spark-bars" role="img" aria-label="Tokens de IA por día">${hist.map((d) => html`<i data-w="${Math.max(4, (d.tokens / maxTokens) * 100)}" title="${d.day}: ${num(d.tokens, 0)} tokens · ${d.aiRequests} con IA · ${d.fixedAnswers} fijas"></i>`)}</div>
    </section>
    <section class="card">
      <div class="card-head"><h2 class="card-title">${icon('activity')} Servicios</h2><span class="card-sub">Configuración de las integraciones</span></div>
      <div class="status-list">
        <div><span>Relay de Binance (solo esta instancia)</span>${st.clients ? ok(st.upstreamConnected, 'Conectado', 'Desconectado') : html`<span class="chip" title="Ningún navegador está conectado a esta instancia ahora mismo; es normal. Los precios en vivo siguen llegando por el relay en cuanto alguien abre la app, y si cae, la app pasa a consultar por REST cada 5 s.">Sin navegadores conectados</span>`}</div>
        <div><span>Asistente (${int.anthropic.model})</span>${ok(int.anthropic.configured, 'Configurado', 'Sin clave')}</div>
        <div><span>Bolsa</span><strong>${int.stocks.provider}</strong></div>
        <div><span>Google</span>${ok(int.oauth.google)}</div>
        <div><span>Okta</span>${ok(int.oauth.okta)}</div>
        <div><span>Wall Street</span>${ok(o.markets.us.open, 'Abierto', 'Cerrado')}</div>
        <div><span>Bolsa de Madrid</span>${ok(o.markets.es.open, 'Abierta', 'Cerrada')}</div>
        <div><span>Cuentas vinculadas</span><strong>${Object.entries(u.byProvider).map(([p, n]) => `${p} ${n}`).join(' · ') || '0'}</strong></div>
        <div><span>Chat hoy: con IA · respuestas fijas</span><strong>${use.aiRequests} · ${use.fixedAnswers}</strong></div>
      </div>
    </section>`);
}

/* ---------- Salud de APIs: sondeo en vivo de las dependencias (solo admin; el servidor no devuelve trazas) ---------- */
async function renderHealth() {
  let r;
  try { r = await api('/api/admin/health'); } catch (err) { return fail(err); }
  if (tab !== 'health') return;
  render($('#ad-body', root), html`<section class="card">
    <div class="card-head"><h2 class="card-title">${icon('zap')} Salud de APIs</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-ad="recheck">${icon('refresh-cw', 'sm')} Volver a comprobar</button></div>
    <div class="health-list">${r.checks.map((c) => html`<div class="health-row">
      <div><strong>${c.name}</strong>${c.detail ? html`<br><small>${c.detail}</small>` : ''}</div>
      <small class="num">${c.ms} ms</small>
      <span class="chip ${c.ok ? 'up' : 'down'}">${c.ok ? 'Responde' : 'Falla'}</span></div>`)}</div>
    <p class="hint">Comprobado ${timeAgo(r.checkedAt * 1000)}. No se hace ninguna llamada de pago (el asistente solo comprueba que haya clave).</p></section>`);
}

/* ---------- Usuarios ---------- */
const usersActive = () => Object.keys(nonDefault(usersState, USERS_DEFAULT)).length > 0;

async function renderUsers() {
  const body = $('#ad-body', root);
  if (!$('#ad-users', root)) {
    render(body, html`<section class="card flush" id="ad-users">
      <div class="card-head"><h2 class="card-title">${icon('users')} Usuarios</h2>
        <div class="input-group">${icon('search', 'sm')}<input id="ad-search" type="search" placeholder="Buscar por nombre, alias o email" value="${usersState.q}" aria-label="Buscar usuarios" maxlength="100"></div></div>
      <div class="admin-filters">
        ${USER_FILTERS.map(([key, label, opts]) => html`<div class="field"><label for="uf-${key}">${label}</label>
          <select id="uf-${key}" data-uf="${key}">${opts.map(([v, l]) => html`<option value="${v}" ${v === usersState[key] ? 'selected' : ''}>${l}</option>`)}</select></div>`)}
        <div class="field"><label for="uf-order">Ordenar por</label>
          <select id="uf-order" data-uf="order">${USER_ORDERS.map(([v, l]) => html`<option value="${v}" ${v === usersState.order ? 'selected' : ''}>${l}</option>`)}</select></div>
        <button class="btn btn-ghost btn-sm" id="ad-clear" data-ad="clear-filters" hidden>${icon('x', 'sm')} Quitar filtros</button>
      </div>
      <div class="table-wrap" id="ad-users-table"></div><div class="pager" id="ad-pager"></div></section>`);
  }
  $('#ad-clear', root).hidden = !usersActive();
  const [sort, dir] = usersState.order.split('_');
  const qs = new URLSearchParams({ q: usersState.q, role: usersState.role, status: usersState.status, verified: usersState.verified, sort, dir, limit: PAGE, offset: usersOffset });
  let r;
  try { r = await api(`/api/admin/users?${qs}`); } catch (err) { return fail(err); }
  if (tab !== 'users') return;
  const me = auth.currentUser();
  const providerName = { password: 'Email', google: 'Google', okta: 'Okta' };
  render($('#ad-users-table', root), r.users.length ? html`<table class="table admin-users"><thead><tr>
      <th>Usuario</th><th>Rol</th><th class="hide-sm">Verificado</th><th class="hide-sm">Comunidad</th><th class="hide-sm">Acceso</th><th class="hide-sm">Alta</th><th class="hide-sm">Último acceso</th><th>Estado</th><th class="r"><span class="sr-only">Acciones</span></th></tr></thead>
    <tbody>${r.users.map((u) => userRow(u, me, providerName))}</tbody></table>`
    : empty('search', 'Sin resultados', usersActive() ? 'Ningún usuario coincide con la búsqueda y los filtros.' : 'Aún no hay usuarios registrados.'));
  const to = Math.min(r.total, usersOffset + PAGE);
  render($('#ad-pager', root), html`<small class="muted">${r.total ? `${usersOffset + 1}–${to} de ${r.total}` : '0 usuarios'}</small>
    <div class="gap-8"><button class="btn btn-ghost btn-sm" data-ad="page" data-dir="-1" ${usersOffset === 0 ? 'disabled' : ''}>${icon('chevron-left', 'sm')} Anterior</button>
    <button class="btn btn-ghost btn-sm" data-ad="page" data-dir="1" ${to >= r.total ? 'disabled' : ''}>Siguiente ${icon('chevron-right', 'sm')}</button></div>`);
}

/** Fila de la tabla y su menú de acciones. Las opciones no disponibles se quedan visibles, atenuadas y con el motivo debajo. */
function userRow(u, me, providerName) {
  const self = u.id === me?.id, suspended = Boolean(u.suspendedUntil), admin = u.role === 'admin';
  const mi = (act, label, { hint = '', off = false, danger = false } = {}) => html`<button type="button" role="menuitem" class="menu-item${danger ? ' danger' : ''}" aria-disabled="${off}"
      data-ad="${act}" data-id="${u.id}" data-email="${u.email}" data-alias="${u.alias ?? u.name}" data-role="${admin ? 'user' : 'admin'}" data-disabled="${!u.disabled}"><span>${label}</span>${hint ? html`<small>${hint}</small>` : ''}</button>`;
  const yours = 'Es tu cuenta.';
  return html`<tr>
    <td><div class="asset-cell"><div><strong>${u.name}${self ? html` <span class="you">(tú)</span>` : ''}</strong><small>${u.email}</small></div></div></td>
    <td>${admin ? html`<span class="chip accent">${icon('shield-check', 'sm')}Admin</span>` : html`<span class="chip">Usuario</span>`}</td>
    <td class="hide-sm">${u.emailVerified ? html`<span class="chip up">Verificado</span>` : html`<span class="chip">Sin verificar</span>`}</td>
    <td class="hide-sm"><div class="md-user"><small class="muted">${u.alias ?? '(sin alias)'}</small>${suspended
      ? html`<span class="chip down" title="${u.suspensionReason ?? ''}">${u.suspendedUntil > 253402200000 ? 'Suspendido (indefinida)' : `Suspendido hasta ${new Date(u.suspendedUntil * 1000).toLocaleDateString('es-ES')}`}</span>` : ''}</div></td>
    <td class="hide-sm"><div class="gap-4">${u.providers.map((p) => html`<span class="chip">${providerName[p] ?? p}</span>`)}</div></td>
    <td class="muted hide-sm">${new Date(u.createdAt * 1000).toLocaleDateString('es-ES')}</td>
    <td class="muted hide-sm">${u.lastLoginAt ? timeAgo(u.lastLoginAt * 1000) : '—'}</td>
    <td>${u.disabled ? html`<span class="chip down">Desactivado</span>` : suspended ? html`<span class="chip warn">Suspendido</span>` : html`<span class="chip up"><span class="dot"></span>Activo</span>`}</td>
    <td class="r">
      <button type="button" class="icon-btn sm" popovertarget="um-${u.id}" aria-label="Acciones de ${u.email}" title="Acciones" aria-haspopup="menu">${icon('ellipsis', 'sm')}</button>
      <div popover id="um-${u.id}" class="menu row-menu" role="menu" aria-label="Acciones de ${u.email}">
        ${admin ? mi('role', 'Quitar administrador', { off: self, hint: self ? yours : '' })
          : mi('role', 'Hacer administrador', { off: self || !u.emailVerified, hint: self ? yours : u.emailVerified ? '' : 'Solo cuentas con el email verificado (acceso con Google u Okta).' })}
        ${mi('toggle', u.disabled ? 'Activar cuenta' : 'Desactivar cuenta', { off: self, hint: self ? yours : u.disabled ? '' : 'Cierra sus sesiones.' })}
        ${suspended ? mi('unsuspend', 'Reactivar en la comunidad')
          : mi('suspend', 'Suspender en la comunidad', { off: self || admin, hint: self ? yours : admin ? 'Quítale antes el rol de administrador.' : 'Impide publicar, votar y denunciar.' })}
        ${mi('delete', 'Eliminar cuenta…', { off: self, danger: true, hint: self ? yours : 'Irreversible.' })}
      </div>
    </td></tr>`;
}

async function patchUser(id, body, message) {
  try {
    await api(`/api/admin/users/${id}`, { method: 'PATCH', body });
    toast(message, 'success');
  } catch (err) { toast(err.message, 'error'); }
  renderUsers();
}

/* ---------- Ajustes (inicio de sesión e integraciones) ---------- */
async function loadSettings() {
  cfg = await api('/api/admin/settings');
  return cfg;
}

const SOURCE = { panel: 'guardado en el panel', env: 'desde .env', default: 'valor por defecto' };
const src = (key) => html`<span class="src">${SOURCE[cfg.settings[key].source]}</span>`;

function toggle(key, label, hint = '') {
  return html`<label class="switch"><span><strong>${label}</strong>${hint ? html`<small>${hint}</small>` : ''}</span>
    <input type="checkbox" role="switch" data-key="${key}" ${cfg.settings[key].value ? 'checked' : ''}></label>`;
}
function text(key, label, placeholder = '', type = 'text') {
  return html`<div class="field"><label for="f-${key}">${label} ${src(key)}</label>
    <input id="f-${key}" type="${type}" data-key="${key}" value="${cfg.settings[key].value ?? ''}" placeholder="${placeholder}" autocomplete="off" spellcheck="false"></div>`;
}
function secret(key, label) {
  const s = cfg.settings[key];
  return html`<div class="field"><label for="f-${key}">${label} ${src(key)}</label>
    <div class="copy-field"><input id="f-${key}" class="input" type="password" data-key="${key}" data-secret autocomplete="new-password"
      placeholder="${s.configured ? `${s.hint} — deja vacío para conservarla` : 'Sin configurar'}">
    ${s.source === 'panel' ? html`<button type="button" class="btn btn-ghost btn-sm" data-ad="reset" data-key="${key}" title="Volver al valor de .env">${icon('rotate-ccw', 'sm')}</button>` : ''}</div></div>`;
}
function select(key, label, labels) {
  const s = cfg.settings[key];
  return html`<div class="field"><label for="f-${key}">${label} ${src(key)}</label><select id="f-${key}" data-key="${key}">
    ${s.choices.map((c) => html`<option value="${c}" ${c === s.value ? 'selected' : ''}>${labels[c] ?? c}</option>`)}</select></div>`;
}
const redirect = (pid) => html`<div class="field"><span class="label">URI de redirección autorizada</span>
  <div class="copy-field"><code>${cfg.redirectUris[pid]}</code><button type="button" class="btn btn-ghost btn-sm" data-ad="copy" data-text="${cfg.redirectUris[pid]}">${icon('copy', 'sm')} Copiar</button></div></div>`;
const save = (label = 'Guardar') => html`<div class="actions"><button class="btn btn-primary">${icon('circle-check', 'sm')} ${label}</button></div>`;

async function renderLogin() {
  try { await loadSettings(); } catch (err) { return fail(err); }
  if (tab !== 'login') return;
  render($('#ad-body', root), html`
    <section class="card"><form class="admin-form" data-form>
      <div class="card-head"><h2 class="card-title">${icon('shield-check')} Métodos de acceso</h2></div>
      ${toggle('auth_password_enabled', 'Email y contraseña', 'Si lo desactivas, solo se podrá entrar con Google u Okta.')}
      ${toggle('auth_registration_enabled', 'Permitir registro de cuentas nuevas', 'Afecta también a la primera entrada con Google/Okta. Las cuentas existentes pueden seguir entrando.')}
      ${save()}
    </form></section>
    <div class="admin-grid">
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">Google</h2>${cfg.settings.oauth_google_enabled.value ? html`<span class="chip up"><span class="dot"></span>Activo</span>` : ''}</div>
        ${toggle('oauth_google_enabled', 'Mostrar «Continuar con Google»')}
        <p class="hint">Crea un «ID de cliente de OAuth» de tipo Aplicación web en Google Cloud Console → APIs y servicios → Credenciales, y añade esta URI de redirección:</p>
        ${redirect('google')}
        ${text('oauth_google_client_id', 'Client ID', '1234-abc.apps.googleusercontent.com')}
        ${secret('oauth_google_client_secret', 'Client secret')}
        <div class="actions"><button type="button" class="btn btn-ghost" data-ad="test" data-provider="google">${icon('refresh-cw', 'sm')} Probar conexión</button><button class="btn btn-primary">${icon('circle-check', 'sm')} Guardar</button></div>
      </form></section>
      <details class="card okta-card" ${cfg.settings.oauth_okta_enabled.value ? 'open' : ''}><summary class="card-title">Okta <span class="muted">${cfg.settings.oauth_okta_enabled.value ? '' : '· sin usar'}</span></summary><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">Okta</h2>${cfg.settings.oauth_okta_enabled.value ? html`<span class="chip up"><span class="dot"></span>Activo</span>` : ''}</div>
        ${toggle('oauth_okta_enabled', 'Mostrar «Continuar con Okta»')}
        <p class="hint">En Okta Admin → Applications → Create App Integration → OIDC → Web Application. Usa el issuer de tu servidor de autorización (p. ej. <code>https://tu-org.okta.com/oauth2/default</code>) y añade esta URI de redirección:</p>
        ${redirect('okta')}
        ${text('oauth_okta_issuer', 'Issuer', 'https://tu-org.okta.com/oauth2/default', 'url')}
        ${text('oauth_okta_client_id', 'Client ID', '0oa1b2c3d4…')}
        ${secret('oauth_okta_client_secret', 'Client secret')}
        <div class="actions"><button type="button" class="btn btn-ghost" data-ad="test" data-provider="okta">${icon('refresh-cw', 'sm')} Probar conexión</button><button class="btn btn-primary">${icon('circle-check', 'sm')} Guardar</button></div>
      </form></details>
    </div>`);
}

async function renderIntegrations() {
  try { await loadSettings(); } catch (err) { return fail(err); }
  if (tab !== 'integrations') return;
  render($('#ad-body', root), html`
    <p class="hint">Todas las llamadas a servicios externos (Binance, CoinGecko, Yahoo Finance, Finnhub, Anthropic…) se hacen desde el servidor. Las claves nunca llegan al navegador.</p>
    <div class="admin-grid">
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">${icon('sparkles')} Asistente (Anthropic)</h2></div>
        ${secret('anthropic_api_key', 'Clave de API')}
        ${text('anthropic_model', 'Modelo', 'claude-haiku-5-5')}
        ${select('anthropic_effort', 'Esfuerzo (cuánto razona antes de responder)', { low: 'Bajo (recomendado: más barato y rápido)', medium: 'Medio', high: 'Alto', auto: 'El del modelo' })}
        ${save()}
      </form></section>
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">${icon('chart-candlestick')} Datos de bolsa</h2></div>
        ${select('stock_data_provider', 'Proveedor', { yfinance: 'Yahoo Finance (sin clave)', finnhub: 'Finnhub (requiere clave)' })}
        ${secret('finnhub_api_key', 'Clave de Finnhub')}
        <p class="hint">Las criptomonedas usan siempre la API pública de Binance y CoinGecko a través del servidor.</p>
        ${save()}
      </form></section>
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">${icon('scale')} Simulación (usuarios con sesión)</h2></div>
        ${text('trading_initial_balance_usd', 'Saldo inicial de las cuentas nuevas (USD)', '10000', 'number')}
        ${text('trading_fee_bps', 'Comisión por operación (puntos básicos; 10 = 0,10 %)', '10', 'number')}
        ${text('trading_slippage_bps', 'Deslizamiento en órdenes a mercado y stop (puntos básicos)', '5', 'number')}
        ${text('community_min_trades', 'Operaciones mínimas para aparecer en la clasificación', '5', 'number')}
        <p class="hint">El saldo inicial solo se aplica a las cuentas que se crean a partir de ahora. Sin sesión, el modo local no cobra comisiones.</p>
        ${save()}
      </form></section>
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">${icon('triangle-alert')} Luz roja de mercado</h2></div>
        ${text('market_alert_btc_drop_bps', 'Caída de BTC en 24 h que la enciende (puntos básicos; 1000 = 10 %)', '1000', 'number')}
        ${text('market_alert_index_drop_bps', 'Caída del IBEX 35 en la sesión que la enciende (puntos básicos; 400 = 4 %)', '400', 'number')}
        <p class="hint">Aviso de la cabecera con reglas fijas sobre las cotizaciones en vivo, sin IA ni predicciones. El del IBEX 35 solo cuenta con la bolsa abierta. 0 desactiva la regla. Los cambios llegan a los navegadores en un minuto.</p>
        ${save()}
      </form></section>
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">${icon('users')} Contador de visitas</h2></div>
        ${toggle('visits_enabled', 'Contar las visitas de la portada', 'Anónimo y agregado: sin cookies, sin guardar IP ni user-agent. Se ve en el Resumen.')}
        ${save()}
      </form></section>
    </div>`);
}

async function saveForm(form, extra = {}) {
  const values = { ...extra };
  for (const el of $$('[data-key]', form)) {
    if (el.type === 'checkbox') values[el.dataset.key] = el.checked;
    else if (el.dataset.secret !== undefined) { if (el.value.trim()) values[el.dataset.key] = el.value.trim(); }
    else values[el.dataset.key] = el.value.trim();
  }
  const btns = $$('button', form);
  btns.forEach((b) => { b.disabled = true; });
  try {
    cfg = await api('/api/admin/settings', { method: 'PUT', body: { values } });
    toast('Ajustes guardados.', 'success');
    show();
  } catch (err) {
    toast(err.message, 'error');
    btns.forEach((b) => { b.disabled = false; });
  }
}

const actions = {
  page(b) { usersOffset = Math.max(0, usersOffset + Number(b.dataset.dir) * PAGE); renderUsers(); },
  async role(b) {
    const admin = b.dataset.role === 'admin';
    if (!(await confirmDialog({ title: admin ? 'Dar el rol de administrador' : 'Quitar el rol de administrador',
      body: admin ? 'Esta cuenta podrá ver y cambiar todo el panel. Solo se admite con el email verificado.' : 'Esta cuenta perderá el acceso al panel.', confirm: 'Confirmar', danger: !admin }))) return;
    patchUser(b.dataset.id, { role: b.dataset.role }, admin ? 'Ahora es administrador.' : 'Ya no es administrador.');
  },
  async toggle(b) {
    const disabled = b.dataset.disabled === 'true';
    if (disabled && !(await confirmDialog({ title: 'Desactivar usuario', body: 'Se cerrarán todas sus sesiones y no podrá entrar hasta que lo actives de nuevo.', confirm: 'Desactivar', danger: true }))) return;
    patchUser(b.dataset.id, { disabled }, disabled ? 'Usuario desactivado: se han cerrado sus sesiones.' : 'Usuario activado.');
  },
  async delete(b) {
    if (!(await confirmDialog({ title: `¿Eliminar ${b.dataset.email}?`, body: 'Se borrarán el usuario, sus sesiones, sus vínculos con Google/Okta y sus datos guardados. No se puede deshacer. Escribe su email para confirmar.', confirm: 'Eliminar', danger: true, requireText: b.dataset.email }))) return;
    try {
      await api(`/api/admin/users/${b.dataset.id}`, { method: 'DELETE', body: { confirmEmail: b.dataset.email } });
      toast('Usuario eliminado.', 'success');
    } catch (err) { toast(err.message, 'error'); }
    renderUsers();
  },
  recheck() { show(); },
  'clear-filters'() {
    usersState = { ...USERS_DEFAULT };
    usersOffset = 0;
    for (const sel of $$('[data-uf]', root)) sel.value = usersState[sel.dataset.uf];
    $('#ad-search', root).value = '';
    renderUsers();
    syncUrl();
  },
  suspend(b) { moderation.suspendUser({ userId: b.dataset.id, alias: b.dataset.alias, onDone: renderUsers }); },
  unsuspend(b) { moderation.unsuspendUser({ userId: b.dataset.id, alias: b.dataset.alias, onDone: renderUsers }); },
  async copy(b) {
    try { await navigator.clipboard.writeText(b.dataset.text); toast('Copiado.', 'success', 1500); } catch { toast('No se pudo copiar; selecciónalo a mano.', 'warning'); }
  },
  reset(b) { saveForm(b.closest('form'), { [b.dataset.key]: null }); },
  async test(b) {
    b.disabled = true;
    try {
      const r = await api(`/api/admin/oauth/${b.dataset.provider}/test`, { method: 'POST' });
      if (r.ok) toast(`Conexión correcta con ${r.issuer}.${r.configured ? '' : ' Falta activar y completar client ID y secret.'}`, r.configured ? 'success' : 'info', 6000);
      else toast(`No se pudo conectar: ${r.error}`, 'error', 8000);
    } catch (err) { toast(err.message, 'error'); } finally { b.disabled = false; }
  },
};
