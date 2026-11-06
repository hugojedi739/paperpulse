// Vista Administración: métricas, usuarios, métodos de inicio de sesión (Google, Okta) e integraciones.
// Solo visible para usuarios con rol admin; el backend vuelve a comprobarlo en cada petición.
import { html, icon, render, on, $, $$, toast, confirmDialog, debounce } from '../lib/dom.js';
import { num, timeAgo } from '../lib/format.js';
import { api } from '../lib/api.js';
import * as auth from '../lib/auth.js';
import { empty } from '../lib/ui.js';
import * as moderation from './moderation.js';
import * as messages from './messages.js';

export const title = 'Administración';

const TABS = [['overview', 'Resumen', 'activity'], ['users', 'Usuarios', 'users'], ['login', 'Inicio de sesión', 'log-in'], ['integrations', 'Integraciones', 'zap'], ['moderation', 'Moderación', 'flag'], ['messages', 'Mensajes', 'message-square']];
const PAGE = 25;
let root, tab = 'overview';
let usersQuery = '', usersOffset = 0;
let cfg = null; // { settings, redirectUris }

export function mount(el) {
  root = el;
  render(root, html`<div class="tabs admin-tabs" role="tablist" id="ad-tabs"></div><div id="ad-body" class="stack"></div>`);
  on(root, 'click', '[data-tab]', (_, b) => { tab = b.dataset.tab; show(); });
  on(root, 'click', '[data-ad]', (e, b) => actions[b.dataset.ad]?.(b, e));
  on(root, 'input', '#ad-search', debounce((e) => { usersQuery = e.target.value; usersOffset = 0; renderUsers(); }, 300));
  on(root, 'submit', 'form[data-form]', (e, f) => { e.preventDefault(); saveForm(f); });
  auth.onAuth(() => { if (!root.hidden) show(); });
}

export function show(param) {
  if (param && TABS.some(([id]) => id === param)) tab = param;
  render($('#ad-tabs', root), TABS.map(([id, label, ic]) =>
    html`<button role="tab" data-tab="${id}" aria-selected="${tab === id}">${icon(ic, 'sm')} ${label}</button>`));
  const body = $('#ad-body', root);
  if (!auth.isAdmin()) {
    return render(body, html`<section class="card">${empty('shield-check', 'Acceso restringido', auth.currentUser()
      ? 'Tu cuenta no tiene permisos de administrador.'
      : 'Inicia sesión con una cuenta de administrador para gestionar la aplicación.',
    auth.currentUser() ? '' : html`<button class="btn btn-primary" data-action="login">${icon('log-in', 'sm')} Iniciar sesión</button>`)}</section>`);
  }
  render(body, html`<section class="card">${empty('refresh-cw', 'Cargando…')}</section>`);
  ({ overview: renderOverview, users: renderUsers, login: renderLogin, integrations: renderIntegrations, moderation: () => moderation.render(body), messages: () => messages.render(body) })[tab]();
}

const fail = (err) => render($('#ad-body', root), html`<section class="card">${empty('triangle-alert', 'No se pudo cargar', err.message)}</section>`);

/* ---------- Resumen ---------- */
async function renderOverview() {
  let o;
  try { o = await api('/api/admin/overview'); } catch (err) { return fail(err); }
  if (tab !== 'overview') return;
  const u = o.users, use = o.usage, st = o.stream, int = o.integrations;
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86400_000).toISOString().slice(0, 10));
  const counts = new Map(u.signups30d.map((d) => [d.date, d.count]));
  const max = Math.max(1, ...counts.values());
  const ok = (v, yes = 'Activo', no = 'Inactivo') => html`<span class="chip ${v ? 'up' : ''}">${v ? html`<span class="dot"></span>${yes}` : no}</span>`;
  render($('#ad-body', root), html`
    <div class="kpis">
      <div class="card kpi"><span>Usuarios</span><strong>${num(u.users, 0)}</strong><small>${u.admins} admin · ${u.disabled} desactivados</small></div>
      <div class="card kpi"><span>Activos 7 días</span><strong>${num(u.activeUsers7d, 0)}</strong><small>${u.newUsers7d} altas nuevas</small></div>
      <div class="card kpi"><span>Sesiones abiertas</span><strong>${num(u.activeSessions, 0)}</strong><small>${u.withData} con datos en la nube</small></div>
      <div class="card kpi"><span>IA hoy</span><strong>${num(use.tokensToday, 0)}</strong><small>tokens · ${use.percentUsed}% del límite · ${use.costTodayUsd} $</small></div>
    </div>
    <div class="admin-grid">
      <section class="card">
        <div class="card-head"><h2 class="card-title">${icon('calendar')} Altas en los últimos 30 días</h2><span class="card-sub">${u.signups30d.reduce((a, d) => a + d.count, 0)} en total</span></div>
        <div class="spark-bars" role="img" aria-label="Altas por día">${days.map((d) => html`<i data-w="${Math.max(4, ((counts.get(d) ?? 0) / max) * 100)}" title="${d}: ${counts.get(d) ?? 0}"></i>`)}</div>
        <hr>
        <div class="status-list">
          ${Object.entries(u.byProvider).length ? Object.entries(u.byProvider).map(([p, n]) => html`<div><span>Cuentas vinculadas con ${p}</span><strong>${n}</strong></div>`) : html`<div><span>Cuentas vinculadas con Google/Okta</span><strong>0</strong></div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2 class="card-title">${icon('activity')} Servicios</h2><span class="card-sub">Activo desde ${timeAgo(Date.now() - use.uptimeSeconds * 1000)}</span></div>
        <div class="status-list">
          <div><span>Binance (relay en vivo)</span>${ok(st.upstreamConnected, 'Conectado', st.clients ? 'Desconectado' : 'En espera')}</div>
          <div><span>Clientes WebSocket · streams</span><strong>${st.clients} · ${st.streams}</strong></div>
          <div><span>Asistente (${int.anthropic.model})</span>${ok(int.anthropic.configured, 'Configurado', 'Sin clave')}</div>
          <div><span>Bolsa</span><strong>${int.stocks.provider}</strong></div>
          <div><span>Google</span>${ok(int.oauth.google)}</div>
          <div><span>Okta</span>${ok(int.oauth.okta)}</div>
          <div><span>Wall Street</span>${ok(o.markets.us.open, 'Abierto', 'Cerrado')}</div>
          <div><span>Bolsa de Madrid</span>${ok(o.markets.es.open, 'Abierta', 'Cerrada')}</div>
          <div><span>Chat hoy: con IA · respuestas fijas · errores</span><strong>${use.aiRequests} · ${use.fixedAnswers} · ${use.errors}</strong></div>
          <div><span>Media por pregunta con IA</span><strong>${num(use.avgTokensPerAiRequest, 0)} tokens</strong></div>
          <div><span>Mensajes de contacto sin leer</span><strong>${o.unreadMessages}</strong></div>
        </div>
      </section>
    </div>`);
}

/* ---------- Usuarios ---------- */
async function renderUsers() {
  const body = $('#ad-body', root);
  if (!$('#ad-users', root)) {
    render(body, html`<section class="card flush" id="ad-users">
      <div class="card-head"><h2 class="card-title">${icon('users')} Usuarios</h2>
        <div class="input-group">${icon('search', 'sm')}<input id="ad-search" type="search" placeholder="Buscar por nombre o email" value="${usersQuery}" aria-label="Buscar usuarios"></div></div>
      <div class="table-wrap" id="ad-users-table"></div><div class="pager" id="ad-pager"></div></section>`);
  }
  let r;
  try { r = await api(`/api/admin/users?q=${encodeURIComponent(usersQuery)}&limit=${PAGE}&offset=${usersOffset}`); } catch (err) { return fail(err); }
  if (tab !== 'users') return;
  const me = auth.currentUser();
  const providerName = { password: 'Email', google: 'Google', okta: 'Okta' };
  render($('#ad-users-table', root), r.users.length ? html`<table class="table admin-users"><thead><tr>
      <th>Usuario</th><th>Rol</th><th>Acceso</th><th>Alta</th><th>Último acceso</th><th>Estado</th><th class="r">Acciones</th></tr></thead>
    <tbody>${r.users.map((u) => html`<tr>
      <td><div class="asset-cell"><div><strong>${u.name}${u.id === me?.id ? html` <span class="you">(tú)</span>` : ''}</strong><small>${u.email}</small></div></div></td>
      <td>${u.role === 'admin' ? html`<span class="chip accent">${icon('shield-check', 'sm')}Admin</span>` : html`<span class="chip">Usuario</span>`}</td>
      <td><div class="gap-4">${u.providers.map((p) => html`<span class="chip">${providerName[p] ?? p}</span>`)}</div></td>
      <td class="muted">${new Date(u.createdAt * 1000).toLocaleDateString('es-ES')}</td>
      <td class="muted">${u.lastLoginAt ? timeAgo(u.lastLoginAt * 1000) : '—'}</td>
      <td>${u.disabled ? html`<span class="chip down">Desactivado</span>` : html`<span class="chip up"><span class="dot"></span>Activo</span>`}</td>
      <td class="r"><div class="gap-4">
        <button class="btn btn-ghost btn-sm" data-ad="role" data-id="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}" ${u.id === me?.id ? 'disabled' : ''}>${u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
        <button class="btn btn-ghost btn-sm" data-ad="toggle" data-id="${u.id}" data-disabled="${!u.disabled}" ${u.id === me?.id ? 'disabled' : ''}>${u.disabled ? 'Activar' : 'Desactivar'}</button>
        <button class="icon-btn sm" data-ad="delete" data-id="${u.id}" data-email="${u.email}" aria-label="Eliminar ${u.email}" title="Eliminar" ${u.id === me?.id ? 'disabled' : ''}>${icon('trash-2', 'sm')}</button>
      </div></td></tr>`)}</tbody></table>` : empty('search', 'Sin resultados', usersQuery ? `Ningún usuario coincide con «${usersQuery}».` : 'Aún no hay usuarios registrados.'));
  const to = Math.min(r.total, usersOffset + PAGE);
  render($('#ad-pager', root), html`<small class="muted">${r.total ? `${usersOffset + 1}–${to} de ${r.total}` : ''}</small>
    <div class="gap-8"><button class="btn btn-ghost btn-sm" data-ad="page" data-dir="-1" ${usersOffset === 0 ? 'disabled' : ''}>${icon('chevron-left', 'sm')} Anterior</button>
    <button class="btn btn-ghost btn-sm" data-ad="page" data-dir="1" ${to >= r.total ? 'disabled' : ''}>Siguiente ${icon('chevron-right', 'sm')}</button></div>`);
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
      <section class="card"><form class="admin-form" data-form>
        <div class="card-head"><h2 class="card-title">Okta</h2>${cfg.settings.oauth_okta_enabled.value ? html`<span class="chip up"><span class="dot"></span>Activo</span>` : ''}</div>
        ${toggle('oauth_okta_enabled', 'Mostrar «Continuar con Okta»')}
        <p class="hint">En Okta Admin → Applications → Create App Integration → OIDC → Web Application. Usa el issuer de tu servidor de autorización (p. ej. <code>https://tu-org.okta.com/oauth2/default</code>) y añade esta URI de redirección:</p>
        ${redirect('okta')}
        ${text('oauth_okta_issuer', 'Issuer', 'https://tu-org.okta.com/oauth2/default', 'url')}
        ${text('oauth_okta_client_id', 'Client ID', '0oa1b2c3d4…')}
        ${secret('oauth_okta_client_secret', 'Client secret')}
        <div class="actions"><button type="button" class="btn btn-ghost" data-ad="test" data-provider="okta">${icon('refresh-cw', 'sm')} Probar conexión</button><button class="btn btn-primary">${icon('circle-check', 'sm')} Guardar</button></div>
      </form></section>
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
  role(b) { patchUser(b.dataset.id, { role: b.dataset.role }, b.dataset.role === 'admin' ? 'Ahora es administrador.' : 'Ya no es administrador.'); },
  toggle(b) {
    const disabled = b.dataset.disabled === 'true';
    patchUser(b.dataset.id, { disabled }, disabled ? 'Usuario desactivado: se han cerrado sus sesiones.' : 'Usuario activado.');
  },
  async delete(b) {
    if (!(await confirmDialog({ title: `¿Eliminar ${b.dataset.email}?`, body: 'Se borrarán el usuario, sus sesiones, sus vínculos con Google/Okta y sus datos guardados. No se puede deshacer.', confirm: 'Eliminar', danger: true }))) return;
    try {
      await api(`/api/admin/users/${b.dataset.id}`, { method: 'DELETE' });
      toast('Usuario eliminado.', 'success');
    } catch (err) { toast(err.message, 'error'); }
    renderUsers();
  },
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
