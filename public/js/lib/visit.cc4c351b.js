// Contador anónimo de visitas: un aviso por carga de la app, DESPUÉS de cargar, que nunca frena la portada.
// Sin cookies (credentials 'omit'): el servidor solo ve la IP y el user-agent para calcular un identificador del día
// que no guarda (backend/visits.py). Si falla o el contador está apagado, no pasa nada.
import { api } from './api.c22010e9.js';

let sent = false;

const HOSTS = [['reddit', /(^|\.)reddit\.com$|^redd\.it$/], ['tiktok', /(^|\.)tiktok\.com$/], ['x', /(^|\.)(x|twitter)\.com$|^t\.co$/],
  ['instagram', /(^|\.)instagram\.com$/], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/], ['google', /(^|\.)google\.[a-z.]+$/]];

/** Origen de la visita: ?ref= (reddit, tiktok…) o, si no, el dominio de la página de procedencia; si no, «direct». Solo un nombre de la lista. */
export function sourceOf(search = globalThis.location?.search ?? '', referrer = globalThis.document?.referrer ?? '') {
  const ref = new URLSearchParams(search).get('ref')?.trim().toLowerCase();
  if (ref) return ref.slice(0, 20);
  try {
    const host = new URL(referrer).hostname;
    if (host && host !== globalThis.location?.hostname) return HOSTS.find(([, re]) => re.test(host))?.[0] ?? 'otro';
  } catch { /* sin página de procedencia */ }
  return 'direct';
}

/** Envía el aviso una sola vez. `signedIn` reparte las cifras entre «con sesión» y «sin sesión». Nunca lanza. */
export async function sendVisit({ signedIn = false, fetcher = api } = {}) {
  if (sent) return false;
  sent = true;
  try {
    await fetcher('/api/visit', { method: 'POST', body: { signedIn: signedIn === true, ref: sourceOf() }, credentials: 'omit' });
    return true;
  } catch {
    return false; // sin servidor, límite por IP, contador apagado...: es una estadística, no algo que mostrar
  }
}

/** Solo para los tests. */
export function resetVisit() { sent = false; }
