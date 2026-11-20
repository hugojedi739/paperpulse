// Vista Comunidad: clasificación, foro, feed de seguidos y perfil.
//
// Rutas (#/community/<param>):
//   ranking · forum · forum:<categoría> · thread:<id> · user:<alias> · feed · me
//
// SEGURIDAD: todo texto escrito por usuarios (alias, bio, títulos, mensajes) se pinta con h()/userText() de
// lib/el.js, es decir, con nodos de texto. Aquí no se usa innerHTML ni la plantilla html`` para datos de usuarios.
import * as C from '../lib/community.c762fa43.js';
import * as auth from '../lib/auth.3d41218e.js';
import * as R from '../lib/retention.6cddca54.js';
import { h, svgIcon, mount as put, userText, emptyState, loading, button } from '../lib/el.71f9edc9.js';
import { on, toast, confirmDialog, openDialog, $ } from '../lib/dom.a575914e.js';
import { pct, price, num, timeAgo, money } from '../lib/format.df74909c.js';
import { go } from '../lib/router.de30a562.js';
import { viewChallenge } from './challenge.7913a42b.js';
import { RULES, DISCLAIMER } from '../lib/legal-content.1ae6c030.js';

export const title = 'Comunidad';

const TABS = [['ranking', 'Clasificación', 'trophy'], ['challenge', 'Reto del mes', 'flame'], ['forum', 'Foro', 'message-square'], ['feed', 'Siguiendo', 'rss'], ['me', 'Mi perfil', 'user']];
let root, body, tabsBox, noticeBox;
let state = { tab: 'ranking', param: '' };
let period = 'total', rankPage = 1;
let sort = 'top', listPage = 1, threadSort = 'top', threadPage = 1;
let promptedAlias = false, visitedForum = false;
let renderId = 0; // descarta respuestas de una vista que ya no está en pantalla

/* ============================================================ montaje y navegación */
export function mount(el) {
  root = el;
  tabsBox = h('div', { class: 'tabs cm-tabs', role: 'tablist', 'aria-label': 'Secciones de la comunidad' });
  noticeBox = h('div', { class: 'cm-notice', role: 'note' },
    svgIcon('info', 'sm'), h('span', {}, DISCLAIMER), h('span', { class: 'cm-notice-links' }, h('button', { type: 'button', class: 'link', dataset: { c: 'rules' } }, 'Normas de la comunidad'), h('a', { class: 'link', href: '#/learn/glosario' }, 'Glosario'), h('a', { class: 'link', href: '#/learn' }, 'Aprender')));
  body = h('div', { class: 'stack cm-body' });
  root.replaceChildren(tabsBox, noticeBox, body);

  on(root, 'click', '[data-c]', (e, b) => { const fn = actions[b.dataset.c]; if (fn) { e.preventDefault(); fn(b); } });
  on(root, 'submit', 'form[data-form]', (e, f) => { e.preventDefault(); forms[f.dataset.form]?.(f); });
  on(root, 'input', 'textarea[data-count], input[data-count]', (_, t) => updateCounter(t));
  // La sesión puede terminar de cargarse después de mostrar la vista: entonces se repinta y se pide el alias
  auth.onAuth(() => { if (!root.hidden) { render(); maybeAskAlias(); } });
}

export function show(param = '') {
  const [kind, arg = ''] = String(param || 'ranking').split(':');
  const tab = { thread: 'forum', user: 'ranking' }[kind] ?? (TABS.some(([id]) => id === kind) ? kind : 'ranking');
  if (state.param !== param) {
    if (kind !== state.kind || arg !== state.arg) { listPage = 1; threadPage = 1; }
  }
  state = { tab, kind: kind in VIEWS ? kind : 'ranking', arg, param };
  render();
  maybeAskAlias();
  if (!visitedForum && C.loggedIn() && ['forum', 'thread'].includes(state.kind)) { visitedForum = true; R.onboarding('visit-forum').catch(() => {}); }
}

function render() {
  put(tabsBox, TABS.map(([id, label, ic]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), dataset: { c: 'tab', tab: id },
  }, svgIcon(ic, 'sm'), ' ', label)));
  noticeBox.hidden = !['forum', 'thread'].includes(state.kind);
  const id = ++renderId;
  VIEWS[state.kind](state.arg, id);
}

const current = (id) => id === renderId && !root.hidden;
const card = (...children) => h('section', { class: 'card' }, ...children);
const head = (titleText, ...right) => h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, titleText), right.length ? h('div', { class: 'gap-8 cm-head-actions' }, ...right) : null);

function fail(err, id, retry = true) {
  if (!current(id)) return;
  const login = err?.status === 401 && !C.loggedIn();
  put(body, card(emptyState('triangle-alert', 'No se pudo cargar', C.errorMessage(err),
    login ? loginButton() : retry ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { c: 'retry' } }, 'Reintentar') : null)));
}

const loginButton = (text = 'Iniciar sesión') => h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'data-action': 'login' }, svgIcon('log-in', 'sm'), ` ${text}`);

/** Barra de páginas: anterior / página N / siguiente. */
const pager = (page, hasMore, action) => (page > 1 || hasMore) ? h('div', { class: 'pager' },
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: action, dir: '-1' }, disabled: page <= 1 }, svgIcon('chevron-left', 'sm'), ' Anterior'),
  h('span', { class: 'muted' }, `Página ${page}`),
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: action, dir: '1' }, disabled: !hasMore }, 'Siguiente ', svgIcon('chevron-right', 'sm')),
) : null;

/** Control segmentado (mismo marcado que seg() de lib/ui.js). */
const segmented = (name, options, value) => h('div', { class: 'seg', role: 'group', dataset: { seg: name } },
  options.map(([v, label]) => h('button', { type: 'button', dataset: { c: name, value: v }, 'aria-pressed': String(v === value) }, label)));

const aliasLink = (alias) => alias
  ? h('button', { type: 'button', class: 'link cm-alias', dataset: { c: 'user', alias } }, alias)
  : h('span', { class: 'muted' }, 'Usuario eliminado');

const when = (s) => h('time', { datetime: new Date(s * 1000).toISOString(), title: new Date(s * 1000).toLocaleString('es-ES') }, timeAgo(s * 1000));

const approxMark = () => h('abbr', { class: 'cm-approx', title: 'Dato aproximado: faltaba un precio o una instantánea del inicio del periodo.' }, '≈');

/* ============================================================ Clasificación */
async function viewRanking(_, id) {
  put(body, card(head('Clasificación', segmented('period', C.PERIODS, period)), loading('Cargando clasificación…')));
  let data;
  try { data = await C.leaderboard(period, rankPage); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  const intro = h('p', { class: 'hint' }, `Rentabilidad de las cuentas de práctica con al menos ${data.minTrades} ${data.minTrades === 1 ? 'operación' : 'operaciones'}, calculada en el servidor. Los perfiles privados no aparecen.`,
    data.computedAt ? ` Actualizada ${timeAgo(data.computedAt * 1000)}.` : '');
  if (!data.entries.length) {
    return put(body, card(head('Clasificación', segmented('period', C.PERIODS, period)), intro,
      emptyState('trophy', 'Todavía no hay nadie en la clasificación', 'Opera con tu cuenta de práctica (con sesión iniciada) y crea tu perfil público para aparecer.',
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { c: 'goto', to: 'me' } }, 'Crear mi perfil'))));
  }
  const rows = data.entries.map((e) => h('tr', {},
    h('td', { class: 'cm-rank' }, h('span', { class: `cm-pos${e.rank <= 3 ? ` top${e.rank}` : ''}` }, String(e.rank))),
    h('td', {}, aliasLink(e.alias)),
    h('td', { class: 'r' }, h('span', { class: `num ${e.returnPct > 0 ? 'up' : e.returnPct < 0 ? 'down' : 'flat'}` }, pct(e.returnPct)), e.approximate ? approxMark() : null),
    h('td', { class: 'r num' }, num(e.trades, 0)),
  ));
  put(body, card(
    head('Clasificación', segmented('period', C.PERIODS, period)), intro,
    h('div', { class: 'table-wrap' }, h('table', { class: 'table cm-ranking' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Alias'), h('th', { class: 'r' }, 'Rentabilidad'), h('th', { class: 'r' }, 'Operaciones'))),
      h('tbody', {}, rows))),
    pager(rankPage, rankPage * 50 < data.total, 'rank-page'),
  ));
}

/* ============================================================ Foro: portada */
async function viewForum(slug, id) {
  if (slug) return viewCategory(slug, id);
  put(body, card(head('Foro'), loading('Cargando foro…')));
  let data;
  try { data = await C.categories(); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  const row = (c) => h('button', { type: 'button', class: 'cm-cat', dataset: { c: 'goto', to: `forum:${c.slug}` } },
    svgIcon(c.kind === 'asset' ? 'coins' : c.kind === 'trades' ? 'share-2' : 'message-square'),
    h('span', { class: 'cm-cat-text' }, h('strong', {}, c.name), h('small', {}, c.description)),
    h('span', { class: 'cm-cat-meta' }, h('span', {}, `${num(c.threads, 0)} ${c.threads === 1 ? 'hilo' : 'hilos'}`),
      c.lastPostAt ? h('small', { class: 'muted' }, timeAgo(c.lastPostAt * 1000)) : null),
  );
  const general = data.categories.filter((c) => c.kind !== 'asset');
  const assets = data.categories.filter((c) => c.kind === 'asset');
  put(body,
    card(head('Foro', newThreadButton()), h('div', { class: 'cm-cats' }, general.map(row))),
    card(head('Hilos de activos'), h('p', { class: 'hint' }, 'Cada activo del simulador tiene su propio hilo para comentarlo.'), h('div', { class: 'cm-cats' }, assets.map(row))),
  );
}

const newThreadButton = (slug) => h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { c: 'new-thread', slug: slug ?? '' } }, svgIcon('plus', 'sm'), ' Nuevo hilo');

/* ============================================================ Foro: lista de hilos */
async function viewCategory(slug, id) {
  const back = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: 'goto', to: 'forum' } }, svgIcon('chevron-left', 'sm'), ' Foro');
  put(body, card(head('Cargando…', back), loading()));
  let data;
  try { data = await C.threads(slug, sort, listPage); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  const cat = data.category;
  const sortControl = segmented('sort', cat.kind === 'asset' ? [['top', 'A-Z'], ['recent', 'Recientes']] : C.SORTS, sort);
  const items = data.threads.map(threadRow);
  put(body, card(
    head(cat.name, back, sortControl, cat.kind === 'general' ? newThreadButton(cat.slug) : null),
    h('p', { class: 'hint' }, cat.description, cat.kind === 'trades' ? ' Para compartir una operación, usa «Compartir en el foro» en tu diario.' : ''),
    items.length ? h('ul', { class: 'cm-threads' }, items)
      : emptyState('message-square', 'Aún no hay hilos', cat.kind === 'general' ? 'Sé la primera persona en abrir uno.' : 'Todavía no se ha compartido nada aquí.'),
    pager(listPage, data.hasMore, 'list-page'),
  ));
}

function threadRow(t) {
  return h('li', { class: 'cm-thread' },
    h('span', { class: 'cm-score', title: 'Votos' }, svgIcon('arrow-big-up', 'sm'), String(t.score)),
    h('div', { class: 'cm-thread-main' },
      h('button', { type: 'button', class: 'cm-thread-title', dataset: { c: 'goto', to: `thread:${t.id}` } }, t.title),
      h('small', { class: 'muted cm-meta' },
        t.symbol ? 'Hilo del activo' : t.author ? ['por ', aliasLink(t.author)] : 'Autor eliminado',
        ' · ', `${num(t.replies, 0)} ${t.replies === 1 ? 'respuesta' : 'respuestas'}`, ' · ', when(t.lastPostAt)),
      t.trade ? tradeChip(t.trade) : null),
  );
}

/* ============================================================ Operación compartida */
function tradeChip(tr) {
  const buy = tr.side === 'buy';
  return h('span', { class: 'cm-trade-chip' },
    h('span', { class: `chip ${buy ? '' : tr.pnlCents >= 0 ? 'up' : 'down'}` }, buy ? 'Compra' : 'Venta'),
    ` ${tr.symbol} a ${price(tr.price, tr.quote)}`,
    !buy && tr.pnlPct != null ? h('strong', { class: tr.pnlPct >= 0 ? 'up' : 'down' }, ` ${pct(tr.pnlPct)}`) : null);
}

function tradeCard(tr) {
  const buy = tr.side === 'buy';
  const item = (label, value, cls = '') => h('div', {}, h('dt', {}, label), h('dd', { class: cls }, value));
  return h('div', { class: 'cm-trade' },
    h('div', { class: 'cm-trade-head' }, svgIcon('share-2', 'sm'), h('strong', {}, `Operación real de la cuenta de práctica`),
      h('small', { class: 'muted' }, ' · datos del servidor, no editables')),
    h('dl', { class: 'summary' },
      item('Activo', `${tr.symbol} · ${tr.name}`),
      item('Lado', buy ? 'Compra' : 'Venta'),
      item('Precio', price(tr.price, tr.quote)),
      !buy && tr.entryPrice ? item('Entrada media', price(tr.entryPrice, tr.quote)) : null,
      !buy && tr.pnlCents != null ? item('Resultado', `${money(tr.pnlCents / 100, { signed: true })} (${pct(tr.pnlPct)})`, tr.pnlCents >= 0 ? 'up' : 'down') : null,
      item('Fecha', new Date(tr.executedAt * 1000).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })),
    ));
}

/* ============================================================ Foro: hilo */
async function viewThread(threadId, id) {
  put(body, card(loading('Cargando hilo…')));
  let data;
  try { data = await C.thread(threadId, threadSort, threadPage); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  const t = data.thread;
  const back = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: 'goto', to: `forum:${t.category.slug}` } },
    svgIcon('chevron-left', 'sm'), ` ${t.category.name}`);
  const replies = data.replies.map((p) => post(p));
  put(body,
    card(
      h('div', { class: 'cm-thread-top' }, back),
      h('h2', { class: 'cm-thread-h' }, t.title),
      h('small', { class: 'muted cm-meta' }, t.symbol ? 'Hilo automático del activo' : t.author ? ['Abierto por ', aliasLink(t.author)] : 'Autor eliminado', ' · ', when(t.createdAt)),
      t.status === 'deleted' ? h('p', { class: 'hint' }, svgIcon('info', 'sm'), ' Su autor ha borrado este hilo: ya no admite respuestas.') : null,
      t.status === 'hidden' ? h('p', { class: 'hint cm-warn' }, svgIcon('eye-off', 'sm'), ' Hilo oculto por moderación (solo lo ven los administradores).') : null,
      t.trade ? tradeCard(t.trade) : null,
      data.firstPost ? post(data.firstPost, true) : h('p', { class: 'hint' }, 'Comparte aquí tus análisis sobre este activo. Recuerda: es una simulación.'),
    ),
    card(
      head(`${num(t.replies, 0)} ${t.replies === 1 ? 'respuesta' : 'respuestas'}`, segmented('thread-sort', C.SORTS, threadSort)),
      replies.length ? h('ul', { class: 'cm-posts' }, replies) : emptyState('message-square', 'Sin respuestas todavía', t.acceptsReplies ? 'Escribe la primera.' : null),
      pager(threadPage, data.hasMore, 'thread-page'),
    ),
    t.acceptsReplies ? replyBox(t.id) : null,
  );
}

function post(p, isFirst = false) {
  const visible = p.body != null;
  return h(isFirst ? 'div' : 'li', { class: `cm-post${p.status !== 'visible' ? ' cm-post-off' : ''}`, dataset: { post: p.id } },
    voteBox(p),
    h('div', { class: 'cm-post-main' },
      h('div', { class: 'cm-post-head' }, aliasLink(p.author), h('small', { class: 'muted' }, ' · ', when(p.createdAt)),
        p.status === 'hidden' && visible ? h('span', { class: 'chip cm-chip-warn' }, 'Oculto por moderación') : null),
      visible ? userText(p.body) : h('p', { class: 'muted cm-notice-text' }, svgIcon(p.status === 'hidden' ? 'eye-off' : 'trash-2', 'sm'), ` ${p.notice}`),
      p.status === 'visible' ? h('div', { class: 'cm-post-actions' },
        p.mine ? button('Borrar', { dataset: { c: 'delete', post: p.id } }, 'trash-2')
          : button('Denunciar', { dataset: { c: 'report', post: p.id } }, 'flag')) : null,
    ));
}

function voteBox(p) {
  const disabled = p.status !== 'visible' || p.mine;
  const btn = (value, ic, label) => h('button', {
    type: 'button', class: 'icon-btn sm cm-vote-btn', dataset: { c: 'vote', post: p.id, value: String(value) },
    'aria-pressed': String(p.myVote === value), 'aria-label': label, title: p.mine ? 'No puedes votar tus mensajes' : label, disabled,
  }, svgIcon(ic, 'sm'));
  return h('div', { class: 'cm-vote', dataset: { vote: p.id } },
    btn(1, 'arrow-big-up', 'Voto positivo'), h('span', { class: 'cm-vote-score num', 'aria-live': 'polite' }, String(p.score)), btn(-1, 'arrow-big-down', 'Voto negativo'));
}

function replyBox(threadId) {
  if (!C.loggedIn()) {
    return card(emptyState('message-square', '¿Quieres responder?', 'Inicia sesión para participar en la conversación.', loginButton()));
  }
  return card(h('form', { class: 'cm-form', dataset: { form: 'reply', thread: threadId } },
    h('label', { class: 'label', for: 'cm-reply' }, 'Tu respuesta'),
    h('textarea', { id: 'cm-reply', name: 'body', maxlength: '5000', rows: '4', required: true, dataset: { count: '5000' }, placeholder: 'Aporta tu análisis. Sin enlaces promocionales ni promesas de beneficios.' }),
    h('div', { class: 'cm-form-foot' }, h('small', { class: 'muted', dataset: { counter: 'cm-reply' } }, '0 / 5000'),
      h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, svgIcon('send', 'sm'), ' Publicar')),
  ));
}

/* ============================================================ Perfil público */
async function viewUser(alias, id) {
  put(body, card(loading('Cargando perfil…')));
  let p;
  try { p = await C.profile(alias); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  if (p.isPrivate && !p.isMe) {
    return put(body, card(h('div', { class: 'cm-profile-head' }, h('div', { class: 'cm-avatar', 'aria-hidden': 'true' }, p.alias.slice(0, 2).toUpperCase()),
      h('div', {}, h('h2', { class: 'cm-thread-h' }, p.alias), h('p', { class: 'muted' }, svgIcon('lock', 'sm'), ' Perfil privado. Sus estadísticas no son públicas y no se le puede seguir.')))));
  }
  const perf = p.performance;
  const stat = (label, value, cls = '') => h('div', { class: 'card kpi' }, h('span', {}, label), h('strong', { class: cls }, value));
  let followBtn = null;
  if (!p.isMe) {
    followBtn = !C.loggedIn() ? loginButton('Inicia sesión para seguir')
      : h('button', { type: 'button', class: `btn btn-sm ${p.isFollowing ? 'btn-ghost' : 'btn-primary'}`, dataset: { c: 'follow', alias: p.alias, on: String(!p.isFollowing) } },
        svgIcon(p.isFollowing ? 'user-check' : 'user-plus', 'sm'), p.isFollowing ? ' Siguiendo' : ' Seguir');
  }
  put(body,
    card(h('div', { class: 'cm-profile-head' },
      h('div', { class: 'cm-avatar', 'aria-hidden': 'true' }, p.alias.slice(0, 2).toUpperCase()),
      h('div', { class: 'cm-profile-id' }, h('h2', { class: 'cm-thread-h' }, p.alias, p.isPrivate ? h('span', { class: 'chip' }, svgIcon('lock', 'sm'), ' Privado') : null),
        h('small', { class: 'muted' }, `En PaperPulse desde ${C.dateShort(p.joinedAt)} · ${p.followers} ${p.followers === 1 ? 'seguidor' : 'seguidores'} · sigue a ${p.following}`)),
      h('div', { class: 'cm-profile-actions' }, followBtn, p.isMe ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: 'goto', to: 'me' } }, svgIcon('pencil', 'sm'), ' Editar') : null)),
    p.bio ? userText(p.bio, 'user-text cm-bio') : h('p', { class: 'muted' }, 'Sin biografía.')),
    h('div', { class: 'kpis cm-kpis' },
      stat('Rentabilidad total', perf ? [pct(perf.returnPct), perf.approximate ? approxMark() : null] : '—', perf ? (perf.returnPct >= 0 ? 'up' : 'down') : ''),
      stat('Operaciones', num(p.trades, 0)), stat('Mensajes', num(p.posts, 0)), stat('Seguidores', num(p.followers, 0))),
    badges(p.achievements, p.streak),
    h('div', { id: 'cm-user-threads' }, card(loading('Cargando sus hilos…'))),
  );
  let th;
  try { th = await C.profileThreads(p.alias, listPage); } catch (err) {
    if (current(id)) put($('#cm-user-threads', root), card(emptyState('triangle-alert', 'No se pudieron cargar sus hilos', C.errorMessage(err))));
    return;
  }
  if (!current(id)) return;
  put($('#cm-user-threads', root), card(head('Hilos y operaciones compartidas'),
    th.threads.length ? h('ul', { class: 'cm-threads' }, th.threads.map(threadRow)) : emptyState('message-square', 'Todavía no ha publicado nada'),
    pager(listPage, th.hasMore, 'list-page')));
}

/** Insignias conseguidas (y racha) de un perfil. `locked` = catálogo completo, con lo no conseguido atenuado. */
function badges(list, streak, locked = null) {
  const items = locked ?? list ?? [];
  if (!items.length && !streak) return null;
  return card(head('Logros'),
    streak ? h('p', {}, h('span', { class: 'chip up' }, svgIcon('flame', 'sm'), ` Racha: ${streak} ${streak === 1 ? 'día' : 'días'} operando`)) : null,
    items.length ? h('ul', { class: 'badges' }, items.map((a) => h('li', { class: `badge${a.earnedAt ? '' : ' locked'}`, title: a.description },
      svgIcon(a.icon, 'sm'), h('span', {}, h('strong', {}, a.name), h('small', {}, a.earnedAt ? `Conseguido ${C.dateShort(a.earnedAt)}` : a.description))))) : null);
}

/* ============================================================ Siguiendo (feed) */
let feedItems = [], feedNext = null;
async function viewFeed(_, id, more = false) {
  if (!C.loggedIn()) {
    return put(body, card(emptyState('rss', 'Tu feed', 'Inicia sesión y sigue a otros usuarios para ver aquí sus hilos y operaciones compartidas.', loginButton())));
  }
  if (!more) { feedItems = []; feedNext = null; put(body, card(head('Siguiendo'), loading('Cargando tu feed…'))); }
  let data, followed;
  try { [data, followed] = await Promise.all([C.feed(more ? feedNext : null), C.following()]); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  feedItems = [...feedItems, ...data.items];
  feedNext = data.nextBefore;
  const chips = followed.following.length
    ? h('div', { class: 'cm-following' }, h('span', { class: 'muted' }, 'Sigues a: '), followed.following.map((f) => aliasLink(f.alias)))
    : null;
  if (!feedItems.length) {
    return put(body, card(head('Siguiendo'), chips,
      emptyState('rss', followed.following.length ? 'Nada nuevo por aquí' : 'Aún no sigues a nadie',
        followed.following.length ? 'Las personas que sigues todavía no han publicado.' : 'Entra en la clasificación o en el foro, abre un perfil y pulsa «Seguir».',
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', dataset: { c: 'goto', to: 'ranking' } }, 'Ver la clasificación'))));
  }
  put(body, card(head('Siguiendo'), chips,
    h('ul', { class: 'cm-feed' }, feedItems.map((i) => h('li', { class: 'cm-feed-item' },
      h('div', { class: 'cm-post-head' }, aliasLink(i.author), h('small', { class: 'muted' }, i.isThreadStart ? ' abrió un hilo · ' : ' respondió en · ', when(i.createdAt))),
      h('button', { type: 'button', class: 'cm-thread-title', dataset: { c: 'goto', to: `thread:${i.threadId}` } }, i.threadTitle),
      i.trade ? tradeChip(i.trade) : null,
      i.body != null ? userText(i.body, 'user-text cm-clamp') : null))),
    feedNext ? h('div', { class: 'pager' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: 'feed-more' } }, 'Cargar más')) : null));
}

/* ============================================================ Mi perfil */
async function viewMe(_, id) {
  if (!C.loggedIn()) {
    return put(body, card(emptyState('user', 'Tu perfil público', 'Inicia sesión para elegir tu alias y participar en la comunidad.', loginButton())));
  }
  put(body, card(head('Mi perfil'), loading()));
  let m;
  try { m = await C.me(); } catch (err) { return fail(err, id); }
  if (!current(id)) return;
  const pr = m.profile;
  let sum = null;
  try { sum = await C.summary(); } catch { /* los logros no son imprescindibles */ }
  if (!current(id)) return;
  put(body,
    m.suspension ? h('div', { class: 'cm-suspended', role: 'alert' }, svgIcon('ban', 'sm'),
      h('span', {}, `Tu participación en la comunidad está suspendida hasta el ${new Date(m.suspension.until * 1000).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}.`,
        m.suspension.reason ? ` Motivo: ${m.suspension.reason}` : '', ' Puedes leer y operar, pero no publicar, votar ni seguir.')) : null,
    card(head(pr ? 'Mi perfil' : 'Crea tu perfil', pr ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { c: 'user', alias: pr.alias } }, svgIcon('eye', 'sm'), ' Ver mi perfil público') : null),
      pr ? null : h('p', { class: 'hint' }, 'Elige un alias para publicar en el foro y aparecer en la clasificación. Tu email nunca se muestra.'),
      profileForm(pr)),
    sum ? badges(null, sum.streak.current, sum.achievements) : null,
  );
}

// `prefix` evita ids duplicados cuando el formulario sale a la vez en la página y en el diálogo «Elige tu alias»
function profileForm(pr, prefix = 'cm') {
  return h('form', { class: 'cm-form', dataset: { form: 'profile' }, novalidate: true },
    h('div', { class: 'field' }, h('label', { for: `${prefix}-alias` }, 'Alias'),
      h('input', { id: `${prefix}-alias`, name: 'alias', value: pr?.alias ?? '', required: true, minlength: '3', maxlength: '20', pattern: '[A-Za-z0-9_]{3,20}',
        autocomplete: 'nickname', spellcheck: 'false', 'aria-describedby': `${prefix}-alias-hint` }),
      h('small', { class: 'hint', id: `${prefix}-alias-hint` }, 'De 3 a 20 caracteres: letras sin tilde, números y guion bajo. Debe ser único.')),
    h('div', { class: 'field' }, h('label', { for: `${prefix}-bio` }, 'Bio (opcional)'),
      h('textarea', { id: `${prefix}-bio`, name: 'bio', maxlength: '280', rows: '3', dataset: { count: '280' }, placeholder: 'Cuéntanos qué te interesa: cripto, bolsa española, análisis técnico…' }, pr?.bio ?? ''),
      h('small', { class: 'muted', dataset: { counter: `${prefix}-bio` } }, `${(pr?.bio ?? '').length} / 280`)),
    h('label', { class: 'switch' }, h('span', {}, h('strong', {}, 'Perfil privado'), h('small', {}, 'No apareces en la clasificación ni en las búsquedas y nadie puede seguirte. Tus mensajes del foro siguen siendo públicos.')),
      h('input', { type: 'checkbox', role: 'switch', name: 'isPrivate', checked: Boolean(pr?.isPrivate) })),
    h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
      h('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, svgIcon('circle-check', 'sm'), pr ? ' Guardar' : ' Crear perfil')));
}

/* ============================================================ diálogos (en el <dialog id="dlg"> compartido) */
function dialog(titleText, subtitle, content, size = 'dlg-sm') {
  const d = document.getElementById('dlg');
  d.className = `dlg ${size}`;
  put(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' }, h('div', {}, h('h2', {}, titleText), subtitle ? h('p', {}, subtitle) : null),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))),
    content);
  openDialog(d);
  return d;
}

function rulesDialog() {
  dialog('Normas de la comunidad', DISCLAIMER, h('div', { class: 'dlg-body' },
    h('ol', { class: 'cm-rules' }, RULES.map(([t, d]) => h('li', {}, h('strong', {}, t), h('span', {}, d)))),
    h('p', { class: 'hint' }, 'Si ves algo que las incumple, usa «Denunciar». Los moderadores pueden ocultar mensajes y suspender cuentas. ', h('a', { href: '#/legal/normas' }, 'Ver las normas completas'), '.')),
  );
}

/** La primera vez que alguien con sesión entra en Comunidad sin perfil, se le pide el alias. */
async function maybeAskAlias() {
  if (promptedAlias || !C.loggedIn()) return;
  let m;
  try { m = await C.me(); } catch { return; }
  if (m?.profile || promptedAlias || root.hidden) return;
  promptedAlias = true;
  askAlias('Antes de publicar, votar o seguir a alguien, elige el alias con el que te verán los demás.');
}

function askAlias(subtitle) {
  const d = dialog('Elige tu alias', subtitle, h('div', { class: 'dlg-body' }, profileForm(null, 'cd')));
  const form = d.querySelector('form');
  form.addEventListener('submit', (e) => { e.preventDefault(); forms.profile(form, d); });
  form.addEventListener('input', (e) => { if (e.target.dataset.count) updateCounter(e.target); });
  d.querySelector('#cd-alias')?.focus();
}

function newThreadDialog(preset) {
  if (!requireLogin()) return;
  C.categories().then((data) => {
    const general = data.categories.filter((c) => c.kind === 'general');
    const d = dialog('Nuevo hilo', 'Recuerda las normas: sin promoción, sin promesas de beneficios y con respeto.', h('form', { class: 'dlg-body cm-form', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'nt-cat' }, 'Categoría'),
        h('select', { id: 'nt-cat', name: 'category' }, general.map((c) => h('option', { value: c.slug, selected: c.slug === preset }, c.name)))),
      h('div', { class: 'field' }, h('label', { for: 'nt-title' }, 'Título'),
        h('input', { id: 'nt-title', name: 'title', required: true, minlength: '5', maxlength: '120', dataset: { count: '120' } }),
        h('small', { class: 'muted', dataset: { counter: 'nt-title' } }, '0 / 120')),
      h('div', { class: 'field' }, h('label', { for: 'nt-body' }, 'Mensaje'),
        h('textarea', { id: 'nt-body', name: 'body', required: true, maxlength: '5000', rows: '7', dataset: { count: '5000' } }),
        h('small', { class: 'muted', dataset: { counter: 'nt-body' } }, '0 / 5000')),
      h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
        h('button', { type: 'submit', class: 'btn btn-primary' }, svgIcon('send', 'sm'), ' Publicar hilo'))));
    const form = d.querySelector('form');
    form.addEventListener('input', (e) => { if (e.target.dataset.count) updateCounter(e.target); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const titleText = String(f.get('title')).trim(), text = String(f.get('body')).trim();
      if (titleText.length < 5) return formError(form, 'El título debe tener al menos 5 caracteres.');
      if (!text) return formError(form, 'Escribe el mensaje.');
      await submitting(form, async () => {
        const r = await C.createThread(f.get('category'), titleText, text);
        d.close();
        toast('Hilo publicado.', 'success');
        go(`/community/thread:${r.threadId}`);
      });
    });
  }).catch((err) => toast(C.errorMessage(err), 'error'));
}

function reportDialog(postId) {
  if (!requireLogin()) return;
  const d = dialog('Denunciar mensaje', 'Un moderador lo revisará. Las denuncias falsas pueden acarrear una suspensión.', h('form', { class: 'dlg-body cm-form' },
    h('fieldset', { class: 'cm-reasons' }, h('legend', { class: 'label' }, 'Motivo'),
      C.REPORT_REASONS.map(([v, label], i) => h('label', { class: 'cm-radio' }, h('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), ` ${label}`))),
    h('div', { class: 'field' }, h('label', { for: 'rp-details' }, 'Detalles (opcional)'),
      h('textarea', { id: 'rp-details', name: 'details', maxlength: '500', rows: '3' })),
    h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
      h('button', { type: 'submit', class: 'btn btn-danger' }, svgIcon('flag', 'sm'), ' Enviar denuncia'))));
  const form = d.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    await submitting(form, async () => {
      await C.report(postId, f.get('reason'), String(f.get('details') ?? '').trim());
      d.close();
      toast('Denuncia enviada. Gracias por ayudar a cuidar la comunidad.', 'success');
    });
  });
}

/* ============================================================ acciones */
function requireLogin() {
  if (C.loggedIn()) return true;
  toast('Inicia sesión para participar en la comunidad.', 'info');
  document.querySelector('[data-action="login"]')?.click();
  return false;
}

/** Ejecuta una escritura mostrando el error del servidor (y ofreciendo el alias si falta el perfil). */
async function attempt(fn) {
  try { return await fn(); } catch (err) {
    if (C.needsProfile(err)) { askAlias('Para participar necesitas un alias público.'); return null; }
    if (err.status === 401) { requireLogin(); return null; }
    toast(C.errorMessage(err), err.status === 429 ? 'warning' : 'error', err.status === 429 ? 6000 : 4000);
    return null;
  }
}

async function submitting(form, fn) {
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  formError(form, '');
  try { await fn(); } catch (err) {
    if (C.needsProfile(err)) { form.closest('dialog')?.close(); askAlias('Para participar necesitas un alias público.'); return; }
    formError(form, C.errorMessage(err));
  } finally { btn.disabled = false; }
}

function formError(form, message) {
  const box = form.querySelector('.cm-form-error');
  if (box) box.textContent = message;
}

function updateCounter(t) {
  const counter = (t.closest('form') ?? root).querySelector(`[data-counter="${t.id}"]`);
  if (counter) {
    counter.textContent = `${t.value.length} / ${t.dataset.count}`;
    counter.classList.toggle('down', t.value.length > Number(t.dataset.count) * 0.95);
  }
}

const actions = {
  tab: (b) => go(`/community/${b.dataset.tab}`),
  goto: (b) => go(`/community/${b.dataset.to}`),
  user: (b) => { listPage = 1; go(`/community/user:${b.dataset.alias}`); },
  retry: () => render(),
  rules: () => rulesDialog(),
  period: (b) => { period = b.dataset.value; rankPage = 1; render(); },
  sort: (b) => { sort = b.dataset.value; listPage = 1; render(); },
  'thread-sort': (b) => { threadSort = b.dataset.value; threadPage = 1; render(); },
  'rank-page': (b) => { rankPage = Math.max(1, rankPage + Number(b.dataset.dir)); render(); },
  'list-page': (b) => { listPage = Math.max(1, listPage + Number(b.dataset.dir)); render(); },
  'thread-page': (b) => { threadPage = Math.max(1, threadPage + Number(b.dataset.dir)); render(); },
  'feed-more': () => viewFeed('', renderId, true),
  'new-thread': (b) => newThreadDialog(b.dataset.slug),
  report: (b) => reportDialog(Number(b.dataset.post)),
  async vote(b) {
    if (!requireLogin()) return;
    const boxEl = b.closest('.cm-vote');
    const pressed = b.getAttribute('aria-pressed') === 'true';
    const value = pressed ? 0 : Number(b.dataset.value); // pulsar otra vez el mismo voto lo quita
    boxEl.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    const r = await attempt(() => C.vote(Number(b.dataset.post), value));
    boxEl.querySelectorAll('button').forEach((x) => { x.disabled = false; });
    if (!r) return;
    boxEl.querySelector('.cm-vote-score').textContent = String(r.score);
    boxEl.querySelectorAll('[data-value]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.value) === r.myVote)));
  },
  async delete(b) {
    if (!(await confirmDialog({ title: '¿Borrar el mensaje?', body: 'Se mostrará «Mensaje eliminado por su autor». No se puede deshacer.', confirm: 'Borrar', danger: true }))) return;
    if (await attempt(() => C.deletePost(Number(b.dataset.post)))) { toast('Mensaje borrado.', 'info'); render(); }
  },
  async follow(b) {
    if (!requireLogin()) return;
    b.disabled = true;
    const r = await attempt(() => C.follow(b.dataset.alias, b.dataset.on === 'true'));
    b.disabled = false;
    if (r) { toast(r.isFollowing ? `Ahora sigues a ${r.alias}.` : `Has dejado de seguir a ${r.alias}.`, 'success', 2500); render(); }
  },
};

const forms = {
  async reply(form) {
    const textarea = form.querySelector('textarea');
    const text = textarea.value.trim();
    if (!text) return toast('Escribe tu respuesta.', 'warning');
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    const r = await attempt(() => C.reply(Number(form.dataset.thread), text));
    btn.disabled = false;
    if (r) { textarea.value = ''; toast('Respuesta publicada.', 'success', 2500); threadSort = 'recent'; render(); }
  },
  async profile(form, dlg) {
    const f = new FormData(form);
    const alias = String(f.get('alias') ?? '').trim();
    if (!C.ALIAS_RE.test(alias)) return formError(form, 'El alias debe tener de 3 a 20 caracteres: letras sin tilde, números y guion bajo.');
    await submitting(form, async () => {
      await C.saveMe({ alias, bio: String(f.get('bio') ?? '').trim(), isPrivate: f.get('isPrivate') === 'on' });
      dlg?.close?.();
      toast('Perfil guardado.', 'success');
      render();
    });
  },
};

const VIEWS = { challenge: (_, id) => viewChallenge(body, () => id === renderId && !root.hidden), ranking: viewRanking, forum: viewForum, thread: viewThread, user: viewUser, feed: viewFeed, me: viewMe };
