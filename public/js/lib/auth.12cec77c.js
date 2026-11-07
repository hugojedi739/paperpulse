// Sesión de usuario y sincronización de la cuenta de práctica con la base de datos del servidor.
// La cookie de sesión es HttpOnly: este módulo nunca ve el token.
import * as store from './store.0fb0dfbb.js';
import { debounce, download } from './dom.700bdea1.js';
import { api, apiUrl } from './api.d1caad06.js';

let user = null;
let applying = false; // evita reenviar al servidor lo que acabamos de descargar
let lastSync = 0;
const listeners = new Set();
const OAUTH_PENDING = 'paperpulse_oauth_pending';

const changed = () => listeners.forEach((fn) => fn(user));
export const currentUser = () => user;
export const isAdmin = () => user?.role === 'admin';
export const lastSyncAt = () => lastSync;
export const onAuth = (fn) => (listeners.add(fn), () => listeners.delete(fn));

/** Métodos de acceso activos (contraseña, registro, Google, Okta), configurados en el panel de administración. */
export const providers = () => api('/api/auth/providers');

const hasLocalData = () => store.hasPractice() || store.trades().length > 0;
// Momento del último cambio local: decide quién gana al recargar con la sesión abierta
const MOD_KEY = 'paperpulse_modified_at';
const modifiedAt = () => { try { return Number(localStorage.getItem(MOD_KEY)) || 0; } catch { return 0; } };
const touch = (t = Date.now()) => { try { localStorage.setItem(MOD_KEY, String(t)); } catch { /* sin almacenamiento */ } };

export async function push() {
  if (!user) return;
  await api('/api/data', { method: 'PUT', body: { data: store.exportData() } });
  lastSync = Date.now();
  changed();
}
const schedulePush = debounce(() => push().catch(() => {}), 2000);

/** Decide entre los datos de la nube y los del navegador. `choose(remote)` resuelve true = usar los de la nube. */
async function reconcile(choose) {
  const remote = await api('/api/data');
  if (remote.data && (!hasLocalData() || (await choose(remote)))) {
    applying = true;
    try { store.importData(remote.data); } finally { applying = false; }
    touch(remote.updatedAt * 1000);
    lastSync = Date.now();
    changed();
  } else {
    await push();
  }
}

/**
 * Restaura la sesión al cargar. `chooseAfterOAuth(remote)` se usa si venimos de entrar con Google/Okta
 * (mismo diálogo que tras el login con contraseña); si no, ganan los datos más recientes.
 */
export async function init(chooseAfterOAuth) {
  for (const ev of ['account', 'trades', 'alerts', 'watchlist', 'settings']) store.on(ev, (detail) => {
    if (applying || detail?.server) return; // la cuenta del servidor no se copia en /api/data
    touch();
    if (user) schedulePush();
  });
  let fromOAuth = false;
  try { fromOAuth = sessionStorage.getItem(OAUTH_PENDING) === '1'; sessionStorage.removeItem(OAUTH_PENDING); } catch { /* sin almacenamiento */ }
  try {
    ({ user } = await api('/api/auth/me'));
    if (user) await reconcile(fromOAuth && chooseAfterOAuth ? chooseAfterOAuth : async (remote) => remote.updatedAt * 1000 > modifiedAt());
  } catch { user = null; }
  changed();
  return { user, fromOAuth };
}

export async function login(email, password, choose) {
  ({ user } = await api('/api/auth/login', { method: 'POST', body: { email, password } }));
  await reconcile(choose);
  changed();
}

/** Redirige al proveedor (Google, Okta). Al volver, init() completa la sesión. */
export function loginWith(provider) {
  try { sessionStorage.setItem(OAUTH_PENDING, '1'); } catch { /* sin almacenamiento */ }
  location.assign(apiUrl(`/api/auth/oauth/${encodeURIComponent(provider)}/start`));
}

export async function register(name, email, password, consent = {}) {
  ({ user } = await api('/api/auth/register', { method: 'POST', body: { name, email, password, acceptTerms: consent.acceptTerms === true, ageConfirmed: consent.ageConfirmed === true } }));
  await push();
  changed();
}

/** Vuelve a pedir el usuario al servidor (p. ej. tras aceptar los términos). */
export async function refreshUser() {
  ({ user } = await api('/api/auth/me'));
  changed();
  return user;
}

/** «Descargar mis datos» (RGPD, portabilidad): JSON con todo lo que el servidor guarda de la cuenta. */
export async function downloadMyData() {
  const data = await api('/api/account/export');
  download('paperpulse-mis-datos.json', JSON.stringify(data, null, 2), 'application/json');
}

/** Sube los últimos cambios, cierra la sesión y borra los datos de este navegador (ya están en la nube). */
export async function logout() {
  await push().catch(() => {});
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  user = null;
  applying = true;
  try { store.leaveServerMode(); store.clearAll(); } finally { applying = false; }
  changed();
}

/** Con contraseña se confirma con ella; las cuentas de Google/Okta escriben ELIMINAR. */
export async function deleteAccount(secret) {
  await api('/api/auth/me', { method: 'DELETE', body: user?.hasPassword ? { password: secret } : { confirm: secret } });
  user = null;
  changed();
}

export const OAUTH_ERRORS = {
  cancelled: 'Has cancelado el inicio de sesión.',
  provider_disabled: 'Ese método de acceso no está activado.',
  provider_unavailable: 'El proveedor de identidad no responde. Inténtalo más tarde.',
  provider_error: 'El proveedor de identidad devolvió un error. Revisa la configuración en el panel de administración.',
  invalid_state: 'La sesión de inicio caducó o no es válida. Vuelve a intentarlo.',
  invalid_token: 'No se pudo verificar tu identidad. Vuelve a intentarlo.',
  email_unverified: 'Tu cuenta del proveedor no tiene un email verificado.',
  registration_closed: 'El registro de cuentas nuevas está cerrado. Pide acceso a un administrador.',
  disabled: 'Tu cuenta está desactivada. Contacta con un administrador.',
  rate_limited: 'Demasiados intentos. Espera un minuto.',
};
