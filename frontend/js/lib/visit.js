// Contador anónimo de visitas: un aviso por carga de la app, DESPUÉS de cargar, que nunca frena la portada.
// Sin cookies (credentials 'omit'): el servidor solo ve la IP y el user-agent para calcular un identificador del día
// que no guarda (backend/visits.py). Si falla o el contador está apagado, no pasa nada.
import { api } from './api.js';

let sent = false;

/** Envía el aviso una sola vez. `signedIn` reparte las cifras entre «con sesión» y «sin sesión». Nunca lanza. */
export async function sendVisit({ signedIn = false, fetcher = api } = {}) {
  if (sent) return false;
  sent = true;
  try {
    await fetcher('/api/visit', { method: 'POST', body: { signedIn: signedIn === true }, credentials: 'omit' });
    return true;
  } catch {
    return false; // sin servidor, límite por IP, contador apagado...: es una estadística, no algo que mostrar
  }
}

/** Solo para los tests. */
export function resetVisit() { sent = false; }
