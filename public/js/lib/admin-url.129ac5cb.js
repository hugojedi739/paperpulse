// Estado del panel de administración en la URL: #/admin/<pestaña>[:<clave>=<valor>&...]
// Sin DOM, para probarla con node --test. Los valores se codifican dos veces porque el enrutador (router.js) ya decodifica
// el parámetro una vez antes de entregarlo: así un «&», un «=» o un «%» escritos en una búsqueda no rompen el estado.

export const TABS = ['overview', 'users', 'activity', 'health', 'login', 'integrations', 'moderation', 'messages', 'audit'];

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/** Separa el parámetro de la ruta en { tab, state }. `tab` es null si no es una pestaña conocida. */
export function parseParam(param, tabs = TABS) {
  const text = String(param ?? '');
  const i = text.indexOf(':');
  const tab = i < 0 ? text : text.slice(0, i);
  if (!tabs.includes(tab)) return { tab: null, state: {} };
  const state = {};
  if (i >= 0) {
    for (const pair of text.slice(i + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq > 0) state[pair.slice(0, eq)] = safeDecode(pair.slice(eq + 1));
    }
  }
  return { tab, state };
}

/** Ruta (sin «#») de una pestaña con su estado; solo se escriben los valores no vacíos. */
export function buildPath(tab, state = {}) {
  const sub = Object.entries(state).filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(encodeURIComponent(String(v)))}`).join('&');
  return `/admin/${tab}${sub ? `:${sub}` : ''}`;
}

/** Deja solo los valores que difieren de los de por defecto (para no ensuciar la URL). */
export const nonDefault = (state, defaults) => Object.fromEntries(Object.entries(state).filter(([k, v]) => v !== (defaults[k] ?? '')));

/** Valor permitido o el de por defecto: la URL la puede escribir cualquiera. */
export const pickAllowed = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
