// Notificaciones del servidor (usuarios con sesión). Se consultan al abrir la app y al abrir la campana: sin sondeo.
import { api } from './api.d1caad06.js';
import * as auth from './auth.71ee1dd2.js';

let items = [], unread = 0, hasMore = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const active = () => Boolean(auth.currentUser());
export const state = () => ({ items, unread, hasMore });
export const onChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

export function reset() { items = []; unread = 0; hasMore = false; emit(); }

export async function refresh() {
  if (!active()) return;
  const r = await api('/api/notifications?limit=20');
  ({ items, unread, hasMore } = r);
  emit();
}

export async function more() {
  if (!active() || !items.length) return;
  const r = await api(`/api/notifications?limit=20&before=${items.at(-1).id}`);
  items = [...items, ...r.items];
  ({ unread, hasMore } = r);
  emit();
}

export async function markRead(ids) {
  const body = ids === 'all' ? { all: true } : { ids };
  const r = await api('/api/notifications/read', { method: 'POST', body });
  items = items.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n));
  unread = r.unread;
  emit();
}

export async function remove(id) {
  const r = id === 'all' ? await api('/api/notifications/clear', { method: 'POST', body: { all: true } }) : await api(`/api/notifications/${id}`, { method: 'DELETE' });
  items = id === 'all' ? [] : items.filter((n) => n.id !== id);
  unread = r.unread;
  hasMore = id === 'all' ? false : hasMore;
  emit();
}

/** Las alertas de precio se evalúan en el navegador: se avisa al servidor para que quede en la campana. */
export async function alertTriggered(symbol, condition, target) {
  await api('/api/notifications/alert', { method: 'POST', body: { symbol, condition, target } });
  await refresh();
}
