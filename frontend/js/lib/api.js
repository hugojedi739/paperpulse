// Cliente del backend. El frontend solo habla con nuestra API (/api/*, /ws/market): nunca con servicios de terceros.
// Por defecto la API está en el mismo origen; <meta name="api-base" content="https://api.ejemplo.com"> la cambia.
const meta = globalThis.document?.querySelector('meta[name="api-base"]')?.content?.replace(/\/$/, '') ?? '';
export const API_BASE = meta;

export const apiUrl = (path) => `${API_BASE}${path}`;

export function wsUrl(path) {
  const base = API_BASE ? new URL(API_BASE) : globalThis.location;
  return `${base.protocol === 'https:' ? 'wss:' : 'ws:'}//${base.host}${path}`;
}

/** GET/POST/... con JSON. Lanza Error con el mensaje del servidor y `status`. */
export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    signal,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `No se pudo conectar con el servidor (HTTP ${res.status}).`), { status: res.status });
  return json;
}

export const getJson = (path, opts) => api(path, opts);
