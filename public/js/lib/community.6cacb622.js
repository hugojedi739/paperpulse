// Cliente de la comunidad (/api/community, /api/forum) con una caché pequeña en memoria.
// La caché evita repetir peticiones al cambiar de pestaña o de periodo: la clasificación se recalcula en el
// servidor como mucho cada 5 minutos, así que pedirla más a menudo no aporta nada.
import { api } from './api.fadcc3a8.js';
import * as auth from './auth.79b9acc8.js';

const cache = new Map(); // clave -> { t, data }
const TTL = { leaderboard: 60_000, categories: 60_000, threads: 20_000, profile: 30_000, me: 5 * 60_000 };

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  const data = await load();
  cache.set(key, { t: Date.now(), data });
  return data;
}

/** Borra de la caché las claves que empiezan por alguno de los prefijos (tras publicar, votar, etc.). */
export function invalidate(...prefixes) {
  for (const key of cache.keys()) if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
}
auth.onAuth(() => invalidate('me', 'thread:', 'threads:', 'profile:', 'feed', 'summary'));

const enc = encodeURIComponent;

/* ---------- Mensajes de error ---------- */
/**
 * Texto para el usuario según el código HTTP. El servidor ya da mensajes en español (p. ej. «Tu cuenta está
 * suspendida…», «Ese alias ya está en uso»); aquí se completan los casos genéricos.
 */
export function errorMessage(err) {
  switch (err?.status) {
    case 401: return 'Inicia sesión para participar en la comunidad.';
    case 403: return err.message || 'No tienes permiso para hacer eso.';
    case 404: return err.message || 'No se ha encontrado. Puede que se haya borrado.';
    case 409: return err.message || 'Esa acción ya estaba hecha o ya no es posible.';
    case 413: return 'El texto es demasiado largo.';
    case 429: return err.message || 'Vas demasiado rápido. Espera un minuto antes de volver a intentarlo.';
    default: return err?.status ? (err.message || 'Error del servidor. Inténtalo de nuevo.') : 'No se pudo conectar con el servidor. Revisa tu conexión.';
  }
}
/** ¿Pide el error que el usuario cree su perfil? (403 del servidor al participar sin alias) */
export const needsProfile = (err) => err?.status === 403 && /perfil/i.test(err.message || '');

/* ---------- Lectura ---------- */
export const loggedIn = () => Boolean(auth.currentUser());
export const summary = () => cached('summary', 60_000, () => api('/api/retention/summary'));

/** Mi perfil y estado (null sin sesión). */
export const me = (force = false) => {
  if (!loggedIn()) return Promise.resolve(null);
  if (force) invalidate('me');
  return cached('me', TTL.me, () => api('/api/community/me'));
};

export const leaderboard = (period, page = 1) =>
  cached(`leaderboard:${period}:${page}`, TTL.leaderboard, () => api(`/api/community/leaderboard?period=${enc(period)}&page=${page}`));

/** Pulso público para la home sin sesión: top 5 de la semana, últimos hilos y traders activos (GET /api/community/pulse). */
let pulseInflight = null; // varias vistas pueden pedirlo a la vez al arrancar: una sola petición
export const pulse = () => (pulseInflight ??= cached('pulse', 5 * 60_000, () => api('/api/community/pulse')).finally(() => { pulseInflight = null; }));

export const categories = () => cached('categories', TTL.categories, () => api('/api/forum/categories'));

export const threads = (slug, sort, page = 1) =>
  cached(`threads:${slug}:${sort}:${page}`, TTL.threads, () => api(`/api/forum/categories/${enc(slug)}?sort=${enc(sort)}&page=${page}`));

export const thread = (id, sort, page = 1) => api(`/api/forum/threads/${enc(id)}?sort=${enc(sort)}&page=${page}`);

export const profile = (alias) => cached(`profile:${alias}`, TTL.profile, () => api(`/api/community/profiles/${enc(alias)}`));

export const profileThreads = (alias, page = 1) =>
  cached(`profile:${alias}:threads:${page}`, TTL.profile, () => api(`/api/community/profiles/${enc(alias)}/threads?page=${page}`));

export const feed = (before) => api(`/api/community/feed${before ? `?before=${enc(before)}` : ''}`);
export const following = () => cached('feed:following', 30_000, () => api('/api/community/following'));

/* ---------- Escritura (siempre invalida lo afectado) ---------- */
export async function saveMe(body) {
  const r = await api('/api/community/me', { method: 'PUT', body });
  cache.set('me', { t: Date.now(), data: r });
  invalidate('profile:', 'leaderboard:', 'threads:');
  return r;
}

export async function createThread(category, title, body) {
  const r = await api('/api/forum/threads', { method: 'POST', body: { category, title, body } });
  invalidate('threads:', 'categories', 'profile:');
  return r;
}

export async function reply(threadId, body) {
  const r = await api(`/api/forum/threads/${enc(threadId)}/posts`, { method: 'POST', body: { body } });
  invalidate('threads:', 'categories');
  return r;
}

export async function shareTrade(fillId, comment) {
  const r = await api('/api/forum/share', { method: 'POST', body: { fillId, comment } });
  invalidate('threads:', 'categories', 'profile:');
  return r;
}

export async function vote(postId, value) {
  const r = await api(`/api/forum/posts/${enc(postId)}/vote`, { method: 'PUT', body: { value } });
  invalidate('threads:');
  return r;
}

export async function deletePost(postId) {
  const r = await api(`/api/forum/posts/${enc(postId)}`, { method: 'DELETE' });
  invalidate('threads:', 'categories', 'profile:');
  return r;
}

export const report = (postId, reason, details) =>
  api(`/api/forum/posts/${enc(postId)}/report`, { method: 'POST', body: { reason, details } });

export async function follow(alias, on) {
  const r = await api(`/api/community/profiles/${enc(alias)}/follow`, { method: on ? 'POST' : 'DELETE' });
  invalidate(`profile:${alias}`, 'feed');
  return r;
}

/* ---------- Utilidades de presentación ---------- */
export const ALIAS_RE = /^[A-Za-z0-9_]{3,20}$/;
export const REPORT_REASONS = [['spam', 'Spam o promoción de servicios de pago, señales o afiliados'], ['abuso', 'Insultos o acoso'], ['estafa', 'Estafa o promesas de beneficios'], ['otro', 'Otro motivo']];
export const PERIODS = [['7d', '7 días'], ['30d', '30 días'], ['total', 'Total']];
export const SORTS = [['top', 'Más votados'], ['recent', 'Recientes']];

/** Fecha corta en español a partir de segundos epoch. */
export const dateShort = (s) => new Date(s * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
