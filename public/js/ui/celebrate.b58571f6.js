// Celebración breve y sobria cuando la persona hace algo bien (primera compra, un reto de la semana cumplido):
// un aviso y un destello de luz. Sin monedas, premios ni sonidos: esto es un simulador educativo, no un juego de azar.
import * as store from '../lib/store.a368de54.js';
import { toast } from '../lib/dom.a575914e.js';
import { reducedMotion } from '../lib/motion.d917c017.js';
import { weekGoals } from '../lib/goals.558164c8.js';

const KEY = 'paperpulse_celebrated';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* modo privado: se celebrará de nuevo, no pasa nada */ } };

function burst() {
  if (reducedMotion()) return;
  const el = document.createElement('div');
  el.className = 'burst';
  el.setAttribute('aria-hidden', 'true');
  el.append(...Array.from({ length: 12 }, () => document.createElement('i')));
  document.body.append(el);
  setTimeout(() => el.remove(), 1200);
}

export function celebrate(message) {
  toast(message, 'success', 6000);
  document.querySelector('#toasts .toast:last-child')?.classList.add('celebrate');
  burst();
}

/** Tras una compra: solo la primera de la cuenta (sin operaciones cerradas y con una única posición) y solo una vez. */
export function afterBuy() {
  const seen = read();
  if (seen.firstBuy) return false;
  const first = store.trades().length === 0 && store.positions().length <= 1;
  write({ ...seen, firstBuy: true }); // con historial previo tampoco se volverá a mirar
  if (first) celebrate('¡Primera compra hecha! Ya tienes una posición abierta: síguela en Operar y decide cuándo cerrarla.');
  return first;
}

const RECENT_MS = 120_000;

/**
 * Retos de la semana recién cumplidos. Solo se celebra si acaba de cerrarse una operación: al arrancar o al sincronizar la
 * cuenta en otro dispositivo se toma nota de lo ya cumplido, sin avisos a destiempo.
 */
export function checkGoals(now = Date.now()) {
  if (!store.hasPractice()) return [];
  const w = weekGoals(store.trades(), store.initialCapital(), now);
  const done = w.goals.filter((g) => g.state === 'done');
  const seen = read();
  const known = seen.week === w.start ? seen.goals ?? [] : [];
  const fresh = done.filter((g) => !known.includes(g.id));
  if (fresh.length || seen.week !== w.start) write({ ...seen, week: w.start, goals: done.map((g) => g.id) });
  const justTraded = store.trades().some((t) => now - Date.parse(t.date) < RECENT_MS);
  if (justTraded && fresh.length) celebrate(fresh.length === 1 ? `Reto cumplido: ${fresh[0].title.toLowerCase()}.` : `${fresh.length} retos de la semana cumplidos. Buen trabajo.`);
  return justTraded ? fresh.map((g) => g.id) : []; // lo celebrado ahora
}
