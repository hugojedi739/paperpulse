// Resumen de retención (racha, logros, onboarding) con caché de 60 s.
import { api } from './api.c22010e9.js';
import * as auth from './auth.9ec4de74.js';

let cache = null;
auth.onAuth(() => { cache = null; });

export async function summary(force = false) {
  if (!auth.currentUser()) return null;
  if (!force && cache && Date.now() - cache.t < 60_000) return cache.data;
  const data = await api('/api/retention/summary');
  cache = { t: Date.now(), data };
  return data;
}
export const invalidate = () => { cache = null; };

export async function onboarding(action) {
  const state = await api('/api/retention/onboarding', { method: 'POST', body: { action } });
  invalidate();
  return state;
}
