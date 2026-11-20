// Service worker de PaperPulse. Objetivo: que la app sea instalable y que, sin conexión, abra el último «armazón»
// conocido. NUNCA se guardan respuestas de /api ni del WebSocket (datos de mercado, sesión, cuenta): siempre red.
// Estrategia para ficheros estáticos propios: red primero y, si no hay red, la copia guardada (así un despliegue
// nuevo se ve al instante y no se mezclan módulos de versiones distintas).
const CACHE = 'paperpulse-shell-3db7a581';
const SHELL = ['/', '/manifest.json', '/css/app.7abd957d.css', '/js/main.0c5016bd.js', '/img/icons.svg', '/img/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return; // siempre red, sin caché
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || /\.(js|mjs|css|svg|png|woff2|json)$/.test(url.pathname) || url.pathname === '/')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
      }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((hit) => hit || Response.error())),
  );
});
