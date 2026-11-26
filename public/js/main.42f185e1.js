// Arranque de PaperPulse: estado, datos en vivo, enrutado, cabecera y atajos globales.
import * as store from './lib/store.a368de54.js';
import * as feed from './lib/feed.14272b63.js';
import { ASSETS, findAsset, toAsset, register } from './lib/catalog.847c7742.js';
import { html, icon, render, on, $, $$, toast, announce, confirmDialog } from './lib/dom.a575914e.js';
import { money, price, pct, trendClass, timeAgo, setRates, setCurrencyPreference, maskEmail } from './lib/format.df8faa5e.js';
import { portfolio, checkTriggers } from './lib/trading.cd85fc1b.js';
import { marketsInfo, fxRates } from './lib/marketdata.96e24305.js';
import { setRules as setAlertRules } from './lib/market-alert.9ca18474.js';
import { initMarketAlert } from './ui/market-alert.cdab3b46.js';
import { initAccountSwitch } from './ui/account-switch.0dbe0df1.js';
import { LABELS as ACCOUNT_LABELS } from './lib/account-mode.c78c079a.js';
import { sendVisit } from './lib/visit.82d3dcf2.js';
import { updateLive, assetIcon } from './lib/ui.df413464.js';
import { current, go } from './lib/router.de30a562.js';
import * as dashboard from './views/dashboard.02c6b26c.js';
import * as trade from './views/trade.45037910.js';
import * as markets from './views/markets.ebac8054.js';
import * as dialogs from './ui/dialogs.33b7a75a.js';
import * as auth from './lib/auth.79b9acc8.js';
import * as account from './lib/account.0d7687b0.js';
import * as notifs from './lib/notifications.4158ee83.js';
import { h, svgIcon, mount as putNodes } from './lib/el.71f9edc9.js';
import { maybeAskTerms } from './ui/terms.5ffd3770.js';
import { openWelcome } from './ui/welcome.fdc0285a.js';
import { initPalette, openPalette } from './ui/palette.78c6bad6.js';
import { initChat, toggleChat } from './ui/chat.be814e49.js';
import { startTour } from './ui/tour.0190f4c4.js';
import { checkGoals } from './ui/celebrate.b58571f6.js';
import { initMegaMenus, markMegaActive } from './ui/megamenu.6f39ad2d.js';
import { initDismiss } from './ui/dismiss.b802d012.js';
import { VISIBLE_SECTIONS, isVisible, isReachable } from './lib/sections.b37aa67f.js';

const VIEWS = { dashboard, trade, markets };
// Vistas que no hacen falta para arrancar (la portada es el Resumen, y Operar y Mercados se abren a menudo desde él):
// se descargan al entrar por primera vez
const LAZY = {
  news: () => import('./views/news.3f677735.js'),
  journal: () => import('./views/journal.a47e1e01.js'),
  community: () => import('./views/community.c1b8d14b.js'),
  contact: () => import('./views/contact.4420eb88.js'),
  stats: () => import('./views/stats.ad666886.js'),
  learn: () => import('./views/learn.86294e32.js'),
  legal: () => import('./views/legal.93a16ce6.js'),
  admin: () => import('./views/admin.ac3e0353.js'),
};
const mounted = new Set();
let active = null;

/* ---------- Teclado o puntero ---------- */
// El aro de foco de enlaces y botones solo se enseña a quien navega con teclado (css: :root[data-input='keyboard']).
// Al tocar o hacer clic no aparece: en el móvil la pestaña recién pulsada se quedaba con un contorno grueso.
addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) document.documentElement.dataset.input = 'keyboard'; }, true);
addEventListener('pointerdown', () => { delete document.documentElement.dataset.input; }, true);

/* ---------- Estado inicial ---------- */
store.load();
setCurrencyPreference(store.settings().currency);
store.positions().forEach((p) => register({ id: p.assetId, symbol: p.symbol, name: p.name, type: p.type, ticker: p.ticker, quote: p.quote, market: p.quote === 'EUR' ? 'es' : 'us', ...(p.type === 'crypto' && { pair: `${p.symbol}USDT` }) }));
store.recentSearches().forEach((r) => { const a = toAsset(r); if (a) register(a); });
applyTheme(document.documentElement.dataset.theme);
applyPrivacy();

/* ---------- Secciones visibles (lib/sections.js) ---------- */
// Se quitan del menú, de la barra inferior y del menú de perfil los enlaces a secciones ocultas (antes de initTabbar,
// que mide las pestañas). Los enlaces de Administración se conservan (data-admin-only) y solo se enseñan a quien tiene rol admin.
$$('.nav a[data-route], .top-nav a[data-route], .tabbar a[data-route], #user-pop a[href^="#/"]').forEach((a) => {
  const target = a.dataset.route ?? a.getAttribute('href').replace(/^#\/?/, '').split('/')[0];
  if (a.hasAttribute('data-admin-only') || a.hasAttribute('data-keep')) return; // Administración: la enseña u oculta auth.onAuth según el rol (el servidor lo vuelve a comprobar)
  if (!isVisible(target)) a.remove();
});

/* ---------- Enrutado ---------- */
let viewTransition = null; // transición de vista en curso (solo una a la vez)
async function route() {
  const { route: name, param } = current();
  const view = VIEWS[name] || LAZY[name] ? name : 'dashboard';
  if (!isReachable(view)) { location.replace('#/trade'); return; } // sección oculta: a Operar (sin dejarla en el historial)
  const boot = $('#boot');
  if (!VIEWS[view]) {
    // Vista perezosa: si tarda en llegar se enseña el esqueleto (con un pequeño retardo para que una descarga rápida no parpadee)
    const wait = setTimeout(() => { $$('.view').forEach((section) => { section.hidden = true; }); boot.hidden = false; }, 150);
    try { VIEWS[view] = await LAZY[view](); } catch {
      clearTimeout(wait);
      boot.hidden = true;
      $$('.view').forEach((section) => { section.hidden = section.dataset.view !== active; }); // se vuelve a la vista anterior
      toast('No se pudo cargar la sección. Comprueba la conexión e inténtalo de nuevo.', 'error');
      return;
    }
    clearTimeout(wait);
    if (current().route !== name) return; // se cambió de vista mientras se descargaba: ya la gestiona otro route()
  }
  const swap = () => {
    // El título va primero: si mount()/show() fallan, la pestaña no se queda con el de la sección anterior
    document.title = `${VIEWS[view].title} — PaperPulse`;
    boot.hidden = true;
    if (active && active !== view) VIEWS[active].hide?.();
    for (const section of $$('.view')) section.hidden = section.dataset.view !== view;
    const section = $(`.view[data-view="${view}"]`);
    if (!mounted.has(view)) { VIEWS[view].mount(section); mounted.add(view); }
    VIEWS[view].show(param);
    if (view === 'trade' && trade.currentAsset()) document.title = `${trade.currentAsset().symbol} · ${VIEWS[view].title} — PaperPulse`;
    active = view;
    feed.setPollRate(view === 'trade'); // 5 s en Operar, 10 s en el resto (solo afecta al respaldo REST)
    $$('[data-route]').forEach((a) => (a.dataset.route === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    markMegaActive(view);
    $('#page-title').textContent = VIEWS[view].title;
    announce(`${VIEWS[view].title}`);
  };
  const changing = active !== view;
  // «Transition was aborted… Prepaint layout check failed»: pasa si empieza otra transición mientras la anterior sigue
  // en curso o con la pestaña oculta. Es solo cosmética: se omite en esos casos y se silencian sus promesas de fin.
  if (changing && document.startViewTransition && document.visibilityState === 'visible' && !viewTransition
    && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const t = document.startViewTransition(swap);
    viewTransition = t;
    const done = () => { if (viewTransition === t) viewTransition = null; };
    t.ready.catch(() => {});
    t.finished.then(done, done);
  } else swap();
  if (changing) scrollTo({ top: 0 });
}
addEventListener('hashchange', route);
// PWA: service worker propio (solo estáticos; nunca cachea /api). Falla en silencio si el navegador no lo admite.
if ('serviceWorker' in navigator && location.protocol !== 'file:') addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

/* ---------- Tema y privacidad ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('[data-action="theme"] use')?.setAttribute('href', `/img/icons.svg#${theme === 'dark' ? 'sun' : 'moon'}`);
  for (const v of mounted) VIEWS[v].theme?.();
}
function applyPrivacy() {
  document.body.classList.toggle('privacy', store.settings().privacyMode);
}
store.on('settings', (detail) => {
  // Sin detalle = importación o borrado: se reaplican todos los ajustes
  const { key, value } = detail ?? {};
  const s = store.settings();
  if (!key || key === 'theme') applyTheme(value ?? s.theme ?? document.documentElement.dataset.theme);
  if (!key || key === 'accent') {
    const teal = (value ?? s.accent) === 'teal';
    if (teal) document.documentElement.dataset.accent = 'teal'; else delete document.documentElement.dataset.accent;
    if (key) for (const v of mounted) VIEWS[v].theme?.(); // los gráficos leen los colores al pintarse
  }
  if (!key || key === 'privacyMode') applyPrivacy();
  if (key === 'hideIdentity') renderAuth(auth.currentUser());
  if (!key) setCurrencyPreference(s.currency);
  if (!key || key === 'currency') { renderAccountChip(); if (active) VIEWS[active].show(current().param); }
});

/* ---------- Cabecera: cuenta, estado del feed, notificaciones, cinta ---------- */
function renderAccountChip() {
  const chip = $('#account-chip');
  // Sin sesión y sin cuenta de práctica el botón no aparece: el CTA principal ("Empezar gratis") está en el Resumen
  chip.hidden = !store.hasPractice() && !auth.currentUser();
  if (!store.hasPractice()) {
    chip.classList.remove('is-cta');
    chip.removeAttribute('aria-label');
    return render(chip, html`${icon('user', 'sm')}<span>Ir a mi cuenta</span>`);
  }
  const p = portfolio();
  chip.classList.remove('is-cta');
  // El saldo de la cuenta activa (Demo o Mi cuenta): en el móvil es lo único de la cuenta que queda en la cabecera
  render(chip, html`${icon('wallet', 'sm')}<span class="money">${money(p.equityUsd)}</span><small class="${trendClass(p.returnPct)}">${pct(p.returnPct)}</small>`);
  chip.setAttribute('aria-label', `${ACCOUNT_LABELS[store.activeAccount()].tag}: patrimonio. Abrir la cuenta`);
  render($('#user-pop-head'), html`<strong>${ACCOUNT_LABELS[store.activeAccount()].tag}</strong><small>Efectivo: <span class="money">${money(p.cashUsd)}</span></small>`);
}

function renderAuth(user) {
  const hidden = store.settings().hideIdentity;
  render($('#user-id'), user
    ? html`<div class="menu-head"><strong>${hidden ? 'Cuenta oculta' : user.name}</strong><small>${hidden ? 'Identidad oculta' : maskEmail(user.email)}${auth.lastSyncAt() ? ` · guardado ${timeAgo(auth.lastSyncAt())}` : ''}</small></div><hr>` : '');
  render($('#user-auth'), user
    ? html`<button type="button" data-action="export-data">${icon('download')}Descargar mis datos</button>
      <button type="button" data-action="logout">${icon('log-out')}Cerrar sesión</button>`
    : html`<button type="button" data-action="login">${icon('log-in')}Iniciar sesión</button>
      <button type="button" data-action="register">${icon('cloud-upload')}Crear cuenta y guardar en la nube</button>`);
  const idBtn = $('[data-action="identity"]');
  idBtn?.setAttribute('aria-pressed', String(hidden));
  const lbl = $('#identity-label');
  if (lbl) lbl.textContent = hidden ? 'Mostrar mi identidad' : 'Ocultar mi identidad';
  if (idBtn) idBtn.hidden = !user;
}
auth.onAuth(renderAuth);
auth.onAuth(renderAccountChip);
notifs.onChange(renderNotifications);
// Notificaciones del servidor: se consultan al abrir la app y al abrir la campana (sin sondeo)
$('#notif-pop')?.addEventListener('toggle', (e) => { if (e.newState === 'open' && notifs.active()) notifs.refresh().catch(() => {}); });
on($('#notif-list'), 'click', '[data-nid]', (_, b) => {
  const id = Number(b.dataset.nid);
  notifs.markRead([id]).catch(() => {});
  if (b.dataset.link.startsWith('/')) { $('#notif-pop')?.hidePopover?.(); go(b.dataset.link); }
});
on($('#notif-list'), 'click', '[data-ndel]', (_, b) => notifs.remove(Number(b.dataset.ndel)).catch(() => {}));
on($('#notif-list'), 'click', '[data-nmore]', () => notifs.more().catch(() => {}));
on($('#notif-list'), 'click', '[data-nclear]', () => notifs.remove('all').catch(() => {}));
// Con sesión, la cuenta de práctica es la del servidor. onAuth también salta tras cada sincronización:
// solo se recarga la cuenta cuando cambia el usuario.
let accountUserId;
let welcomedFor = null;
/** Con sesión y sin cuenta de práctica: elegir el saldo inicial. Espera a que se hayan aceptado los términos (comparten el diálogo) y
 *  se abre con un pequeño retardo: el diálogo de términos se cierra justo después de refrescar el usuario y cerraría también este. */
function maybeWelcome(user) {
  if (!user || user.termsVersion == null || welcomedFor === user.id) return;
  setTimeout(() => {
    if (!account.needsSetup() || welcomedFor === user.id) return;
    if (location.hash.startsWith('#/admin')) return; // en Administración no se abre ni tapa el panel; se ofrece al salir (hashchange)
    welcomedFor = user.id; // una vez por sesión: si la cierra, puede volver a abrirla con «Empezar a practicar»
    openWelcome();
  }, 400);
}
auth.onAuth((user) => {
  if ((user?.id ?? null) === accountUserId) { maybeWelcome(user); return; } // p. ej. tras aceptar los términos
  accountUserId = user?.id ?? null;
  account.setUser(user).then(() => maybeWelcome(user));
  if (user) { notifs.refresh().catch(() => {}); maybeAskTerms(user); } else { notifs.reset(); welcomedFor = null; }
});
addEventListener('hashchange', () => { const u = auth.currentUser(); if (u && welcomedFor !== u.id && !location.hash.startsWith('#/admin')) maybeWelcome(u); });
auth.onAuth(() => $$('[data-admin-only]').forEach((el) => { el.hidden = !auth.isAdmin(); }));

function renderFeedStatus(state) {
  const el = $('#feed-status');
  el.dataset.state = state;
  el.querySelector('span').textContent = { live: 'En vivo', polling: 'Actualizando', connecting: 'Conectando', offline: 'Sin conexión' }[state];
  $('#offline-banner').hidden = state !== 'offline';
}

const NOTIF_ICON = { alert: 'bell-ring', order: 'circle-check', error: 'triangle-alert', info: 'info',
  reply: 'message-square', follower: 'user-plus', hidden: 'eye-off', achievement: 'trophy', challenge: 'flame' };
/** Campana con sesión: notificaciones del servidor. Sus textos incluyen alias y títulos de otros usuarios, así que
 *  se construyen con nodos de texto (nunca con plantillas HTML). */
/** Avisos sin leer: punto en la campana (escritorio) y en el perfil, y número en «Notificaciones» del menú (móvil). */
function setUnread(n) {
  $('#notif-badge').hidden = n === 0;
  $('#avatar-badge').hidden = n === 0;
  const count = $('#menu-notif-count');
  count.hidden = n === 0;
  count.textContent = n > 99 ? '99+' : String(n);
  $('#avatar-btn').setAttribute('aria-label', n ? `Menú de cuenta (${n} ${n === 1 ? 'notificación sin leer' : 'notificaciones sin leer'})` : 'Menú de cuenta');
}
function renderServerNotifications() {
  const { items, unread, hasMore } = notifs.state();
  setUnread(unread);
  const box = $('#notif-list');
  if (!items.length) return putNodes(box, h('p', { class: 'hint menu-head' }, 'Sin notificaciones. Aquí verás respuestas, seguidores, órdenes ejecutadas, alertas y logros.'));
  putNodes(box, items.map((n) => h('div', { class: `notif ${n.read ? '' : 'unread'}` },
    svgIcon(NOTIF_ICON[n.kind] ?? 'info'),
    h('button', { type: 'button', class: 'notif-main', dataset: { nid: n.id, link: n.link } },
      h('strong', {}, n.title), n.body ? h('small', {}, n.body) : null, h('small', {}, timeAgo(n.createdAt * 1000))),
    h('button', { type: 'button', class: 'icon-btn sm', dataset: { ndel: n.id }, 'aria-label': 'Borrar notificación' }, svgIcon('x', 'sm')))),
  hasMore ? h('button', { type: 'button', class: 'link menu-head', dataset: { nmore: '1' } }, 'Cargar más') : null,
  h('button', { type: 'button', class: 'link menu-head', dataset: { nclear: '1' } }, 'Borrar todas'));
}
function renderNotifications() {
  if (notifs.active()) return renderServerNotifications();
  const list = store.notifications();
  setUnread(list.filter((n) => !n.read).length);
  render($('#notif-list'), list.length ? list.map((n) => html`<div class="notif ${n.read ? '' : 'unread'}">${icon(NOTIF_ICON[n.type] ?? 'info')}
    <div><strong>${n.title}</strong><small>${n.body}</small><small>${timeAgo(n.time)}</small></div></div>`)
    : html`<p class="hint menu-head">Sin notificaciones. Crea alertas de precio para que te avisemos.</p>`);
}

const TAPE = ['BTC', 'ETH', 'SOL', 'IBEX', 'SAN', 'NVDA', 'AAPL', 'BBVA', 'BNB', 'TSLA', 'XRP', 'MSFT'].map(findAsset);
function renderTape() {
  const items = TAPE.map((a) => {
    const t = feed.tick(a.symbol);
    return html`<a class="tape-item" href="#/trade/${a.symbol}">${assetIcon(a, 'sm')}<strong>${a.symbol}</strong>
      <span class="num" data-px="${a.symbol}" data-q="${a.quote}">${price(t?.price, a.quote)}</span>
      <span class="num ${trendClass(t?.change24h)}" data-chg="${a.symbol}">${pct(t?.change24h)}</span></a>`;
  });
  render($('#ticker-track'), html`${items}<span aria-hidden="true" class="gap-8">${items}</span>`);
}

/* ---------- Acciones globales ---------- */
const ACTIONS = {
  palette: () => openPalette(),
  theme: () => store.setSetting('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  account: () => dialogs.accountDialog(),
  login: () => dialogs.authDialog('login'),
  register: () => dialogs.authDialog('register'),
  logout: async () => {
    const body = auth.hasUndecidedDemo()
      ? 'Aún no has elegido qué Demo conservar. Si cierras sesión ahora, se borrará la Demo de este navegador y se quedará la guardada en tu cuenta. «Mi cuenta», tus favoritos, alertas y ajustes no se pierden.'
      : 'Tus datos ya están guardados en tu cuenta. Se borrarán de este navegador y podrás recuperarlos al volver a entrar.';
    if (!(await confirmDialog({ title: '¿Cerrar sesión?', body, confirm: 'Cerrar sesión', danger: auth.hasUndecidedDemo() }))) return;
    await auth.logout();
    toast('Sesión cerrada.', 'info');
  },
  settings: () => dialogs.settingsDialog(),
  alerts: () => dialogs.alertsDialog(trade.currentAsset()),
  guide: () => dialogs.guideDialog(),
  legal: () => go('/legal'),
  'export-data': () => auth.downloadMyData().then(() => toast('Datos descargados.', 'success', 2500)).catch((e) => toast(e.message, 'error')),
  shortcuts: () => dialogs.shortcutsDialog(),
  tour: () => startTour(),
  chat: () => toggleChat(),
  // Móvil: la campana vive en el menú de perfil; se abre bajo la cabecera
  notifications: () => { $('#user-pop')?.hidePopover?.(); $('#notif-pop')?.showPopover?.(); },
  privacy: () => store.setSetting('privacyMode', !store.settings().privacyMode),
  identity: () => store.setSetting('hideIdentity', !store.settings().hideIdentity),
  'read-all': () => (notifs.active() ? notifs.markRead('all').catch(() => {}) : store.markNotificationsRead()),
  'collapse-nav': () => {
    const collapsed = document.documentElement.classList.toggle('nav-collapsed');
    store.setSetting('sidebarCollapsed', collapsed);
  },
};
on(document, 'click', '[data-action]', (e, el) => {
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  el.closest('[popover]')?.hidePopover();
  fn();
});

initPalette([
  { section: 'dashboard', label: 'Ir a Resumen', icon: 'layout-dashboard', keywords: 'inicio dashboard', run: () => go('/dashboard') },
  { section: 'trade', label: 'Ir a Operar', icon: 'chart-candlestick', keywords: 'trading grafico', run: () => go('/trade') },
  { section: 'markets', label: 'Ir a Mercados', icon: 'coins', keywords: 'tabla', run: () => go('/markets') },
  { section: 'learn', label: 'Ir a Aprender', icon: 'graduation-cap', keywords: 'lecciones glosario', run: () => go('/learn') },
  { section: 'news', label: 'Ir a Noticias', icon: 'newspaper', run: () => go('/news') },
  { section: 'journal', label: 'Ir al Diario', icon: 'book-open', keywords: 'journal historial', run: () => go('/journal') },
  { section: 'stats', label: 'Ir a Estadísticas', icon: 'chart-column', keywords: 'aciertos perdida maxima rendimiento semanal drawdown', run: () => go('/stats') },
  { label: 'Cuenta de práctica', icon: 'wallet', keywords: 'saldo capital reiniciar', run: ACTIONS.account },
  { label: 'Alertas de precio', icon: 'bell-ring', run: ACTIONS.alerts },
  { label: 'Cambiar tema claro/oscuro', icon: 'sun', keywords: 'theme modo', run: ACTIONS.theme },
  { label: 'Ajustes y copia de seguridad', icon: 'settings', keywords: 'exportar importar divisa', run: ACTIONS.settings },
  { label: 'Administración', icon: 'shield-check', keywords: 'admin panel usuarios salud apis mensajes', when: () => auth.isAdmin(), run: () => go('/admin') },
  { label: 'Abrir asistente', icon: 'sparkles', keywords: 'chat ia ayuda', run: () => toggleChat(true) },
  { label: 'Manual de operativa', icon: 'graduation-cap', keywords: 'guia ayuda', run: ACTIONS.guide },
].filter((c) => !c.section || isVisible(c.section)));
initChat({ getAsset: () => trade.currentAsset() ?? findAsset('BTC') });
initMegaMenus(); // menús desplegables de Mercados y Aprender en la cabecera
// Franja de estado: en el móvil el estado de las bolsas se pliega (recordado en este navegador); en escritorio, siempre a la vista
{
  const bar = $('#statusbar');
  const btn = $('#strip-toggle');
  const KEY = 'paperpulse_strip_open';
  const set = (open) => {
    bar.dataset.open = String(open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Ocultar el estado de las bolsas' : 'Mostrar el estado de las bolsas');
  };
  let saved = false;
  try { saved = localStorage.getItem(KEY) === '1'; } catch { /* sin almacenamiento */ }
  set(saved);
  btn.addEventListener('click', () => {
    const open = bar.dataset.open !== 'true';
    set(open);
    try { localStorage.setItem(KEY, open ? '1' : '0'); } catch { /* sin almacenamiento */ }
  });
}
initDismiss(); // los menús se cierran al elegir, al tocar fuera y al cambiar de vista

/* ---------- Atajos de teclado ---------- */
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape' && !$('#chat').hidden) { toggleChat(false); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable], dialog')) return;
  const key = e.key.toLowerCase();
  const section = /^[1-9]$/.test(key) ? VISIBLE_SECTIONS[key - 1] : null; // 1, 2, 3… = secciones visibles, en orden
  if (section) go(`/${section}`);
  else if (key === '/') { e.preventDefault(); openPalette(); }
  else if (key === '?') dialogs.shortcutsDialog();
  else if (key === 't') ACTIONS.theme();
  else if (key === 'a') toggleChat();
  else if (key === 'b' || key === 's') {
    go(`/trade/${trade.currentAsset()?.symbol ?? 'BTC'}`);
    setTimeout(() => $(`#t-ticket [data-side="${key === 'b' ? 'buy' : 'sell'}"]`)?.click(), 50);
  }
});

/* ---------- Datos en vivo ---------- */
let chipTimer = null;
store.on('prices', (symbols) => {
  updateLive(symbols);
  checkTriggers(symbols, (type, message, alert) => {
    const title = { alert: 'Alerta de precio', order: 'Orden ejecutada', error: 'Orden no ejecutada' }[type];
    if (type === 'alert' && alert && notifs.active()) notifs.alertTriggered(alert.symbol, alert.condition, alert.target).catch(() => store.notify(title, message, type));
    else store.notify(title, message, type);
    toast(message, type === 'error' ? 'error' : type === 'alert' ? 'warning' : 'success', 6000);
  });
  chipTimer ??= setTimeout(() => { chipTimer = null; renderAccountChip(); }, 1000);
});
store.on('account', renderAccountChip);
store.on('trades', () => checkGoals()); // celebra un reto de la semana recién cumplido
store.on('notifications', renderNotifications);
store.on('feed', renderFeedStatus);
store.on('feed-delay', (delayed) => { $('#delay-banner').hidden = !delayed; });

let marketsAt = 0;
let ratesAt = 0;
async function refreshMarkets() {
  if (document.hidden) return; // sin pestaña visible no se pide nada; al volver se actualiza si hace falta
  marketsAt = Date.now();
  try {
    const info = await marketsInfo();
    store.setMarkets(info.markets);
    setAlertRules(info.alertRules); // umbrales de la luz roja (ajustes del panel)
  } catch { /* sin servidor: el estado de bolsa queda desconocido y no hay luz roja */ }
}
async function refreshRates() {
  if (document.hidden) return;
  ratesAt = Date.now();
  try {
    const changed = setRates(await fxRates());
    renderAccountChip();
    // Diario y Estadísticas no se repintan solos: si el tipo de cambio era otro, sus importes se quedarían con el antiguo
    if (changed && (active === 'journal' || active === 'stats')) VIEWS[active].show(current().param);
  } catch { /* se usan tipos por defecto */ }
}

// Curva de patrimonio: un punto por minuto mientras la app está abierta
setInterval(() => {
  if (!store.hasPractice()) return;
  const p = portfolio();
  if (p.rows.every((r) => r.live)) store.snapshotEquity(p.equityUsd);
}, 60_000);

renderAccountChip();
renderNotifications();
renderTape();
renderAuth(null);
auth.init(dialogs.chooseDemo).then(({ user, fromOAuth }) => {
  if (fromOAuth && user) toast(`Hola, ${user.name}.`, 'success');
});
// Errores al volver de Google/Okta: ?auth_error=código
{
  const code = new URLSearchParams(location.search).get('auth_error');
  if (code) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => toast(auth.OAUTH_ERRORS[code] ?? 'No se pudo iniciar sesión.', 'error', 8000), 300);
  }
}
renderFeedStatus(feed.getStatus());
feed.start();
renderTape(); // la cinta se pintó antes de que el feed sembrara los últimos precios conocidos (caché local)
initMarketAlert();
initAccountSwitch({ login: () => dialogs.authDialog('login'), welcome: () => openWelcome() });
// Contador anónimo de visitas: después de cargar y de saber si hay sesión, sin cookies y sin frenar nada
auth.ready.then(() => {
  const go = () => setTimeout(() => sendVisit({ signedIn: Boolean(auth.currentUser()) }), 0);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
});
refreshMarkets();
refreshRates();
setInterval(refreshMarkets, 60_000);
setInterval(refreshRates, 3_600_000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (Date.now() - marketsAt > 60_000) refreshMarkets();
  if (Date.now() - ratesAt > 3_600_000) refreshRates();
});
route();

if (ASSETS.length && !store.settings().tourDone && !store.hasPractice() && !store.trades().length) {
  const hint = matchMedia('(pointer: coarse)').matches ? 'Toca la lupa para buscar' : 'Pulsa Ctrl + K para buscar';
  setTimeout(() => toast(`Bienvenido. ${hint} cualquier activo, o abre la visita guiada desde tu menú.`, 'info', 7000), 1500);
}
