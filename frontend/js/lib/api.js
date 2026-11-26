// Cliente del backend. El frontend solo habla con nuestra API (/api/*, /ws/market): nunca con servicios de terceros.
// Por defecto la API está en el mismo origen; <meta name="api-base" content="https://api.ejemplo.com"> la cambia.
const meta = globalThis.document?.querySelector('meta[name="api-base"]')?.content?.replace(/\/$/, '') ?? '';
export const API_BASE = meta;

export const apiUrl = (path) => `${API_BASE}${path}`;

export function wsUrl(path) {
  const base = API_BASE ? new URL(API_BASE) : globalThis.location;
  return `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}${path}`;
}

/** Mensaje claro cuando el servidor (o el CDN) responde sin JSON: nunca una pantalla rota ni un «HTTP 429» a secas. */
export function httpMessage(status) {
  if (status === 429) return 'Demasiadas peticiones seguidas. Espera un minuto e inténtalo de nuevo.';
  if (status === 502 || status === 503 || status === 504) return 'El servicio no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.';
  return `Error del servidor (HTTP ${status}). Inténtalo de nuevo.`;
}

/** GET/POST/... con JSON. Lanza Error con el mensaje del servidor y `status`. */
export async function api(path, { method = 'GET', body, signal, credentials = 'same-origin' } = {}) {
  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      signal,
      credentials, // 'omit' para peticiones que no deben llevar cookies (p. ej. el contador de visitas)
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión.'); // el mensaje del navegador sale en inglés
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || httpMessage(res.status)), { status: res.status });
  return json;
}

export const getJson = (path, opts) => api(path, opts);
