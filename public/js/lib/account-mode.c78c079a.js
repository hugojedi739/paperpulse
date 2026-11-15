// Selector de cuenta: «Demo» (la cuenta local de este navegador) o «Mi cuenta» (la cuenta del servidor, con sesión).
// Solo decide QUÉ cuenta se muestra y con qué motor se opera: la ejecución de cada motor no cambia
// (lib/trading.js para Demo, backend/trading/ para Mi cuenta).
// La preferencia se recuerda en el navegador; «Mi cuenta» solo está activa con sesión: sin ella, el modo efectivo es Demo.

export const DEMO = 'demo';
export const SERVER = 'server';
const KEY = 'paperpulse_account_mode';

export const LABELS = {
  [DEMO]: { short: 'Demo', tag: 'Demo · dinero virtual', hint: 'Cuenta de este navegador. Se puede reiniciar y no puntúa en clasificaciones ni retos.' },
  [SERVER]: { short: 'Mi cuenta', tag: 'Mi cuenta · dinero virtual', hint: 'Tu cuenta guardada en el servidor. Cuenta para la clasificación y los retos.' },
};

function readPref() {
  try { const v = localStorage.getItem(KEY); return v === DEMO || v === SERVER ? v : null; } catch { return null; }
}

/** Preferencia guardada; sin elegir nada, «Mi cuenta» (quien inicia sesión sigue viendo su cuenta, como hasta ahora). */
export const preferred = () => readPref() ?? SERVER;

export function setPreferred(mode) {
  if (mode !== DEMO && mode !== SERVER) throw new Error(`Modo de cuenta desconocido: ${mode}`);
  try { localStorage.setItem(KEY, mode); } catch { /* sin almacenamiento: dura lo que la pestaña */ }
}

/** Modo que se usa de verdad: «Mi cuenta» solo con sesión. */
export const effective = (hasSession, pref = preferred()) => (pref === SERVER && hasSession ? SERVER : DEMO);
