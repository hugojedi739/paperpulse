// Sesión de usuario y sincronización de la cuenta de práctica con la base de datos del servidor.
// La cookie de sesión es HttpOnly: este módulo nunca ve el token.
import * as store from './store.a368de54.js';
import { debounce, download } from './dom.a575914e.js';
import { api, apiUrl } from './api.fadcc3a8.js';
import { mergeAtLogin, demoOf } from './cloud-merge.972072aa.js';

let user = null;
let applying = false; // evita reenviar al servidor lo que acabamos de descargar
let lastSync = 0;
const listeners = new Set();
const OAUTH_PENDING = 'paperpulse_oauth_pending';

let markReady;
/** Se cumple cuando ya se sabe si hay sesión (tras /api/auth/me al arrancar): para no pedir datos de visitante a quien ya ha entrado. */
export const ready = new Promise((resolve) => { markReady = resolve; });

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

// Conflicto de Demos sin decidir: hasta que la persona elija, la copia de la cuenta conserva su Demo (se sube la local
// solo con favoritos, alertas y ajustes) y al recargar se vuelve a preguntar en vez de pisar una con la otra.
const UNDECIDED_KEY = 'paperpulse_demo_undecided';
let heldDemo = null;
const undecided = () => { try { return localStorage.getItem(UNDECIDED_KEY) === '1'; } catch { return false; } };
const setUndecided = (on) => { try { if (on) localStorage.setItem(UNDECIDED_KEY, '1'); else localStorage.removeItem(UNDECIDED_KEY); } catch { /* sin almacenamiento */ } };

export async function push() {
  if (!user) return;
  const data = store.exportData();
  if (heldDemo) Object.assign(data, heldDemo);
  await api('/api/data', { method: 'PUT', body: { data } });
  lastSync = Date.now();
  changed();
}
const schedulePush = debounce(() => push().catch(() => {}), 2000);

function apply(data, at) {
  applying = true;
  try { store.importData(data); } finally { applying = false; }
  touch(at);
}

/**
 * Al recargar con la sesión ya abierta en este navegador: lo local y la copia de la cuenta son la misma cuenta,
 * así que gana lo más reciente (si se combinara, volverían favoritos y alertas borrados aquí).
 */
async function refreshFromCloud() {
  const remote = await api('/api/data');
  if (remote.data && (!hasLocalData() || remote.updatedAt * 1000 > modifiedAt())) {
    apply(remote.data, remote.updatedAt * 1000);
    lastSync = Date.now();
    changed();
  } else {
    await push();
  }
}

/**
 * Al iniciar sesión: se juntan los datos de este navegador con los de la cuenta (lib/cloud-merge.js) sin preguntar.
 * Solo si las dos Demos tienen operaciones distintas se llama a `chooseDemo({ local, remote, updatedAt })`, que
 * resuelve 'cloud' (usar la guardada), 'local' (quedarse con la de este navegador) o null (decidir más tarde: no se
 * pierde ninguna). «Mi cuenta» no entra: ya es la misma en todos los navegadores.
 */
async function mergeOnLogin(chooseDemo) {
  const remote = await api('/api/data');
  heldDemo = null;
  if (!remote.data) { setUndecided(false); await push(); return; }
  const local = store.exportData();
  let { data, conflict } = mergeAtLogin(local, remote.data, { localNewer: modifiedAt() >= remote.updatedAt * 1000 });
  if (conflict) {
    const pick = chooseDemo ? await chooseDemo({ local, remote: remote.data, updatedAt: remote.updatedAt }) : null;
    if (pick === 'cloud') data = { ...data, ...demoOf(remote.data) };
    else if (pick !== 'local') heldDemo = demoOf(remote.data); // sin decidir: la guardada no se toca
    setUndecided(pick !== 'cloud' && pick !== 'local');
  } else setUndecided(false);
  apply(data);
  await push();
}

/**
 * Restaura la sesión al cargar. Si venimos de entrar con Google/Okta (o quedó un conflicto de Demos sin decidir) se
 * juntan los datos como tras el login con contraseña y `chooseAfterOAuth` resuelve el conflicto; si no, gana lo más reciente.
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
    // Versiones anteriores guardaban la copia del servidor en las claves locales: con sesión, esa «Demo» no es tal
    // y empieza de cero. Se marca como lo más reciente para que no se importe una copia antigua de /api/data.
    if (store.settleUpgrade(Boolean(user))) touch();
    if (user) await (fromOAuth || undecided() ? mergeOnLogin(chooseAfterOAuth) : refreshFromCloud());
  } catch { user = null; }
  changed();
  markReady();
  return { user, fromOAuth };
}

export async function login(email, password, chooseDemo) {
  ({ user } = await api('/api/auth/login', { method: 'POST', body: { email, password } }));
  await mergeOnLogin(chooseDemo);
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
/** Hay dos Demos distintas y aún no se ha elegido: al cerrar sesión se perdería la de este navegador. */
export const hasUndecidedDemo = () => Boolean(heldDemo);

export async function logout() {
  await push().catch(() => {});
  heldDemo = null;
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
  heldDemo = null;
  setUndecided(false);
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
