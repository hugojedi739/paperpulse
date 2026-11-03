# PaperPulse

Simulador de trading (paper trading) con **cotizaciones reales**: criptomonedas de Binance y acciones de Wall Street e IBEX 35. El usuario practica con saldo virtual: compra y vende a precio de mercado, coloca órdenes límite y stop, crea alertas, analiza gráficos de velas con indicadores y apunta sus operaciones en un diario. Incluye un asistente con IA (Claude) y un panel de administración.

Nada de dinero real: no hay brokers ni órdenes reales. Todo el saldo y las operaciones son simulados.

## Arranque rápido

```bash
cp .env.example .env               # opcional: ANTHROPIC_API_KEY, ADMIN_EMAILS...
pip install -r requirements.txt
python -m backend.db demo          # usuarios de prueba (ver abajo)
python server.py                   # http://localhost:8000
```

Usuarios de prueba creados por `demo`:

| Email | Contraseña | Rol |
|---|---|---|
| `demo@paperpulse.local` | `demo1234` | usuario, con datos de ejemplo |
| `admin@paperpulse.local` | `admin1234` | administrador |

En VS Code: **F5 → «App completa (servidor + Chrome)»** arranca el servidor con depurador y abre el frontend depurable.

## Arquitectura

```
Navegador (frontend/)  ──HTTP /api/*──▶  Backend (backend/, Starlette)  ──▶  Binance REST + WebSocket
                       ──WS /ws/market─▶                                 ──▶  CoinGecko
                                                                         ──▶  Yahoo Finance / Finnhub
                                                                         ──▶  Frankfurter (divisas), RSS (noticias)
                                                                         ──▶  Anthropic (asistente)
                                                                         ──▶  Google / Okta (OIDC)
                                                                         ──▶  Turso / libSQL (local: data/paperpulse.db)
```

**Regla principal: el navegador solo habla con nuestro backend.** Toda llamada a un servicio de terceros (y toda clave de API) vive en `backend/`. La CSP lo impone: `connect-src 'self'`. Si añades una fuente de datos nueva, crea un endpoint en el backend y llámalo desde el frontend con `lib/api.js`.

- **Backend**: Python 3.13, Starlette + Uvicorn. Sin ORM: SQL directo con el cliente `libsql` (Turso en producción, fichero libSQL compatible con SQLite en local). `server.py` es solo el punto de entrada; el código está en `backend/`.
- **Frontend**: HTML + CSS + JavaScript con módulos ES nativos. **Sin framework y sin paso de build**: el navegador carga `frontend/js/main.js` directamente. Gráficos con TradingView Lightweight Charts 5.
- El backend sirve también el frontend estático (desactivable con `SERVE_FRONTEND=false` para servirlo desde un CDN/nginx; en ese caso pon un proxy para `/api` y `/ws` en el mismo dominio o usa `<meta name="api-base">`, ver `frontend/js/lib/api.js`).

## Estructura

```
server.py                    Punto de entrada (python server.py / uvicorn server:app / Vercel)
backend/
  app.py                     App Starlette: rutas, CSP y cabeceras de seguridad, ciclo de vida
  config.py                  Variables de entorno estáticas (.env)
  settings.py                Ajustes editables en el panel de admin (BD > .env > valor por defecto)
  db.py                      libSQL/Turso: migraciones, usuarios, sesiones, identidades OAuth, ajustes. CLI
  migrations/                Migraciones SQL numeradas (0001_inicial.sql, 0002_...). Se aplican al arrancar
  http.py                    Utilidades HTTP: CSRF (Origin), JSON, límites, cookie de sesión, require_admin
  auth.py                    /api/auth/*: email+contraseña, Google y Okta (OIDC + PKCE), copia de datos /api/data
  admin.py                   /api/admin/*: métricas, usuarios, ajustes, prueba de proveedores OAuth
  security.py                IP real del cliente (proxies de confianza), límites por IP y por usuario, contadores de uso de IA
  trading/                   Cuenta de práctica del servidor: rules (cálculo en enteros), prices (precios del servidor),
                             ledger (transacciones, idempotencia, resolución de límite/stop), api (/api/portfolio, /api/orders)
  chat.py                    /api/chat: asistente con Claude (SSE), desafío anti-bot, límites de gasto
  news.py                    /api/news: RSS financieros con filtro positivo de temas
  market/
    candles.py               /api/candles: histórico de velas paginado (cripto y bolsa), agregación 3m/2h/4h
    crypto.py                Binance REST (con host alternativo) y CoinGecko; tickers y libro (respaldo REST)
    stream.py                /ws/market: relay WebSocket de Binance + cotizaciones de bolsa en vivo
    stocks.py                Cotizaciones de bolsa; proveedor yfinance o Finnhub (según ajustes)
    hours.py                 Horarios y festivos de las bolsas, /api/markets
    search.py                /api/search: pares USDT de Binance + acciones de Yahoo
    fx.py                    /api/rates: tipos de cambio (BCE)
frontend/
  index.html                 Shell de la app (sin scripts ni estilos inline: CSP estricta)
  css/app.css                Sistema de diseño con @layer y temas claro/oscuro (variables CSS)
  js/main.js                 Arranque, enrutado por hash (#/vista/param), cabecera, atajos, errores de OAuth
  js/lib/                    Lógica sin UI: api (cliente HTTP), feed (en vivo), marketdata, store (localStorage),
                             trading (órdenes simuladas), auth, charts, catalog (activos), format, dom
  js/views/                  dashboard, trade (Operar), markets, news, journal (Diario), admin
  js/ui/                     Diálogos, paleta de comandos (Ctrl+K), asistente, visita guiada
  vendor/                    Generado por `npm run vendor` (Lightweight Charts, fuentes). No editar a mano
  img/icons.svg              Sprite de iconos Lucide, generado por `npm run vendor`
scripts/vendor.mjs           Copia dependencias de node_modules y genera el sprite (lista ICONS)
scripts/screenshots.mjs      Capturas de todas las vistas con Playwright (requiere el servidor)
tests/                       frontend.test.js (node --test) y test_*.py (unittest)
data/                        Base de datos local sin Turso (se crea sola; ignorada por git)
```

## Cómo funciona

### Cuenta de práctica y datos del usuario
Hay dos modos:

- **Modo local (sin sesión)**: todo (saldo, posiciones, órdenes, diario, alertas, favoritos, ajustes) vive en `localStorage` (`frontend/js/lib/store.js`, claves `paperpulse_*`). Las órdenes se ejecutan en el navegador (`lib/trading.js`, `checkTriggers`), sin comisiones. El usuario elige su capital y puede reiniciar. No cuenta para clasificaciones.
- **Cuenta del servidor (con sesión)**: saldo, posiciones, órdenes y operaciones cerradas viven en la base de datos (`backend/trading/`) y el navegador solo guarda una copia para pintar (`lib/account.js` → `store.applyServer`). La cuenta empieza limpia con el saldo inicial del panel (no se importa nada de `localStorage`) y no se puede reiniciar.
- Con sesión, `lib/auth.js` sigue subiendo a `/api/data` la copia de alertas, favoritos y ajustes (debounce de 2 s). Esa copia no afecta a la cuenta del servidor.

### Cuenta del servidor: cómo se ejecutan las órdenes
- **El servidor decide siempre el precio** (`backend/trading/prices.py`): Binance para cripto y Yahoo/Finnhub para bolsa, con el tipo de cambio del BCE para los activos en euros. El cliente solo envía `{clientOrderId, symbol, side, type, quantity, triggerPrice?}`; cualquier otro campo se ignora.
- **Unidades**: importes en céntimos de USD y cantidades/precios en 1e-8, siempre enteros (`backend/trading/rules.py`). Las compras redondean hacia arriba y las ventas hacia abajo.
- **Comisión y deslizamiento** configurables en Administración → Integraciones → Simulación (por defecto 0,10 % y 0,05 %). El deslizamiento se aplica a las órdenes a mercado y stop, no a las límite.
- **Transacción única**: saldo, posición, ejecución (`fills`) y estado de la orden se escriben en una transacción `BEGIN IMMEDIATE` (`ledger.execute`).
- **Idempotencia**: `UNIQUE(user_id, client_order_id)`. Un reintento con la misma clave devuelve la orden original (HTTP 200 con `replayed: true`); con otros datos, HTTP 409. El frontend reutiliza la clave al reintentar tras un fallo de red.
- **Mercado cerrado**: las órdenes a mercado de bolsa se rechazan; las límite y stop se aceptan y esperan a la próxima sesión.
- **Límite y stop, a demanda**: no hay ningún proceso en segundo plano. Cada `GET /api/portfolio` (como mucho cada 15 s por usuario) y cada orden nueva revisan las velas **cerradas** desde la última revisión (`orders.checked_until`) con la temporalidad más fina que quepa en una descarga: 1m (hasta ~16 h), 5m, 15m o 1h. Las ejecuciones se aplican en orden cronológico y con la hora de la vela, así que el resultado no depende de cuándo se consulte.
  - Si la orden se colocó a mitad de vela, esa vela se revisa con una temporalidad más fina; el primer minuto parcial se descarta (al colocarla ya se comparó con la cotización en vivo).
  - **Huecos de precio**: si una vela abre al otro lado del nivel, se ejecuta a la apertura. Una límite de compra a 100 que abre a 95 compra a 95; un stop de venta a 100 que abre a 90 vende a 90 (más el deslizamiento).
  - Una compra stop reserva qty × stop × (1 + deslizamiento) + comisión. Si un hueco la deja corta y no hay efectivo libre, la orden se **rechaza** al ejecutarse.
  - Las órdenes caducan a los 30 días. Como mucho hay 50 pendientes por usuario.
- **Limitaciones** de este enfoque:
  - Dentro de una vela no se sabe en qué orden ocurrieron máximo y mínimo; cuanto más tiempo pase sin consultar, más gruesas son las velas (hasta 1h).
  - Tocar el nivel cuenta como ejecución (en un mercado real la orden podría quedarse en la cola) y se supone liquidez infinita: la orden se ejecuta entera.
  - El tipo de cambio de las ejecuciones por vela es el actual, no el del momento de la vela.
  - Yahoo puede dar las cotizaciones de algunas bolsas (p. ej. BME) con unos 15 minutos de retraso.
  - Solo se pueden operar los activos del catálogo (los encontrados con la búsqueda, solo en modo local). No hay ventas en corto.

### Datos de mercado en vivo
- El navegador abre **un único WebSocket** con el backend (`/ws/market`) usando el protocolo de Binance: `{"method":"SUBSCRIBE","params":["btcusdt@ticker","btcusdt@kline_1h","btcusdt@depth20@100ms","stocks"]}`. Recibe `{"stream": ..., "data": ...}`.
- `backend/market/stream.py` mantiene **una sola conexión con Binance** para todos los clientes, con recuento de referencias por stream y suscripciones agrupadas (límite de Binance: 5 mensajes/s). El stream `stocks` recibe las cotizaciones de bolsa cada 5 s.
- Si el WebSocket no está disponible (p. ej. Vercel), `lib/feed.js` cae a **REST cada 5 s**: `/api/crypto/tickers`, `/api/crypto/depth`, `/api/candles` y `/api/stocks/quotes`. El indicador de la cabecera muestra «Actualizando».

### Velas e histórico
- Temporalidades: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1S, 1M (`INTERVALS` en `lib/marketdata.js` y `backend/market/candles.py`, mismas claves que Binance).
- Rangos tipo web de bolsa: 1D, 5D, 1M, 3M, 6M, YTD, 1A, 5A, Todo (`RANGES`): eligen temporalidad y cargan histórico hasta cubrir el rango.
- **Histórico infinito**: `/api/candles?symbol&type&interval&limit&end` devuelve las velas anteriores a `end` y `hasMore`. Al desplazar el gráfico hacia la izquierda se piden páginas más antiguas (`chart.onReachStart` → `loadOlder` en `views/trade.js`). También hay «Ir a una fecha» (icono de calendario).
- Cripto: Binance (`data-api.binance.vision`, con `api.binance.com` de respaldo) tiene todo el histórico desde el listado del par.
- Bolsa: Yahoo Finance tiene límites de antigüedad intradía (1m: 30 días; 5m–30m: 60 días; 1h: 2 años; diario/semanal/mensual: completo). 3m/2h/4h se construyen agregando velas dentro de cada sesión.

### Usuarios, sesiones y roles
- Contraseñas con scrypt. La sesión es una cookie HttpOnly SameSite=Strict (`__Host-` y Secure en producción); en la BD solo se guarda el hash SHA-256 del token. Sesiones de 30 días.
- CSRF: todas las escrituras comprueban `Origin` y exigen JSON.
- Roles: `user` y `admin` (columna `users.role`). Un usuario desactivado pierde sus sesiones y no puede entrar.
- Cómo crear el primer administrador: `ADMIN_EMAILS=tu@email.com` en `.env` (se aplica al registrarse o entrar) o `python -m backend.db admin tu@email.com`.

### Inicio de sesión con Google y Okta
- Se configuran en **Administración → Inicio de sesión** (o con las variables `OAUTH_*` de `.env`). El panel muestra la **URI de redirección** que hay que registrar en Google Cloud Console / Okta: `{APP_DOMAIN}/api/auth/oauth/{google|okta}/callback`.
- Flujo OpenID Connect *authorization code* con PKCE S256 (`backend/auth.py`): `/start` guarda `state`, `nonce` y `code_verifier` en la tabla `oauth_states` (un solo uso, 10 min) y liga el `state` al navegador con una cookie SameSite=Lax; `/callback` canjea el código en el servidor y valida `iss`, `aud`, `exp` y `nonce` del id_token.
- Se exige `email_verified`. Si ya existe una cuenta con ese email, se vincula (tabla `identities`). Si no existe y el registro está abierto, se crea una cuenta sin contraseña. Para borrar una cuenta sin contraseña el usuario escribe `ELIMINAR`.
- Al volver, el backend redirige a `/#/dashboard` (o `/?auth_error=código`; los textos están en `OAUTH_ERRORS` de `lib/auth.js`).

### Panel de administración (`#/admin`)
Visible solo para administradores (el backend lo comprueba en cada petición con `require_admin`).
- **Resumen**: usuarios, activos, sesiones, altas de 30 días, consumo de IA, estado del relay de Binance, integraciones y mercados.
- **Usuarios**: búsqueda, dar/quitar admin, desactivar/activar, eliminar. Siempre debe quedar al menos un admin activo y nadie puede degradarse a sí mismo.
- **Inicio de sesión**: activar email+contraseña y el registro; configurar Google y Okta, con botón «Probar conexión».
- **Integraciones**: clave y modelo de Anthropic; proveedor de bolsa y clave de Finnhub.

Precedencia de cada ajuste (`backend/settings.py`): valor guardado en el panel → variable de `.env` → valor por defecto. Los secretos nunca se devuelven al navegador (solo «configurado» y los 4 últimos caracteres). Están en claro en la base de datos: protege el token de Turso y, en local, `data/` (el archivo se crea con permisos 600).

### Asistente IA
`/api/chat` hace streaming SSE con Claude. Antes de cada mensaje el frontend pide `/api/chat/challenge` (HMAC de un solo uso). Límites por minuto y diarios por IP, tope diario global de tokens y alerta al 80 %. Sin clave de Anthropic responde un modo de demostración.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/candles?symbol=BTCUSDT&type=crypto\|stock&interval=1h&limit=500&end=` | Velas (página anterior a `end`) + `hasMore` |
| GET | `/api/crypto/markets?ids=bitcoin,ethereum` | Capitalización, volumen, 7d y sparkline (CoinGecko) |
| GET | `/api/crypto/tickers?symbols=BTCUSDT,ETHUSDT` | Tickers 24 h (formato del stream `@ticker`) |
| GET | `/api/crypto/depth?symbol=BTCUSDT` | Libro de órdenes (20 niveles) |
| GET | `/api/stocks/quotes` · `/api/stocks/sparks` | Cotizaciones de bolsa del catálogo · cierres de 1 mes |
| GET | `/api/search?q=` | Búsqueda de cripto y acciones |
| GET | `/api/markets` · `/api/rates` · `/api/news` | Estado de mercados · divisas · noticias |
| GET/POST | `/api/chat/challenge` · `/api/chat` | Asistente (SSE) |
| WS | `/ws/market` | Streams en vivo (protocolo de Binance + `stocks`) |
| GET | `/api/auth/providers` | Métodos de acceso activos |
| POST | `/api/auth/register` · `/login` · `/logout` | Sesión con email |
| GET/DELETE | `/api/auth/me` | Usuario actual (`role`, `hasPassword`) · borrar cuenta |
| GET | `/api/auth/oauth/{google\|okta}/start` · `/callback` | Inicio de sesión OIDC |
| GET/PUT | `/api/data` | Copia de los datos del modo local (alertas, favoritos, ajustes) |
| GET | `/api/portfolio` | Cuenta del servidor: saldo, posiciones, órdenes pendientes, operaciones cerradas y eventos (resuelve antes las pendientes) |
| GET/POST | `/api/orders?status=&limit=&before=` | Historial paginado · `{clientOrderId, symbol, side, type, quantity, triggerPrice?, journal?}` |
| DELETE/PATCH | `/api/orders/{id}` | Cancelar una orden pendiente · `{journal}` notas del diario |
| GET | `/api/admin/overview` · `/api/admin/users?q=&limit=&offset=` | Panel: métricas · usuarios |
| PATCH/DELETE | `/api/admin/users/{id}` | `{role, disabled}` · eliminar |
| GET/PUT | `/api/admin/settings` | Ajustes `{values: {clave: valor\|null}}` (`null` = volver a `.env`) |
| POST | `/api/admin/oauth/{provider}/test` | Comprueba el documento OpenID del proveedor |
| GET | `/api/health` | Estado; con sesión admin o `X-Admin-Key`, métricas |

## Convenciones del código

- **Idioma**: interfaz, comentarios y mensajes de error en español.
- **CSP estricta** (`backend/app.py`): nada de `<script>` ni `style="..."` inline, ni `onclick=` en HTML. Para anchos dinámicos usa `data-w`/`data-l` (los aplica `render()` de `lib/dom.js`).
- **Plantillas**: `html\`...\`` de `lib/dom.js` escapa todo lo interpolado; `raw()` solo para HTML propio de confianza. Eventos con delegación: `on(root, 'click', selector, fn)`.
- **Vistas**: cada módulo de `js/views/` exporta `title`, `mount(el)`, `show(param)` y opcionalmente `hide()` y `theme()`. Se registran en `VIEWS` de `main.js` y tienen su `<section class="view" data-view="...">` en `index.html`.
- **Iconos**: `icon('nombre')` usa el sprite. Para un icono nuevo añádelo a `ICONS` en `scripts/vendor.mjs` y ejecuta `npm run vendor`.
- **Backend**: cada endpoint es una función `async def (request)` registrada en `routes` de `backend/app.py` (o en `build_routes`/`routes` de `auth.py`/`admin.py`). Las llamadas bloqueantes (requests, libSQL, yfinance) van en hilo (`run_in_threadpool` o `run_in_executor`). Cachés en memoria con tamaño acotado.
- **Esquema de BD**: crea el siguiente fichero en `backend/migrations/` (`0003_descripcion.sql`, numeración consecutiva; sentencias separadas por `;`, comentarios con `--`, sin triggers). Se aplica al arrancar o con `python -m backend.db migrate`; la versión se guarda en `PRAGMA user_version` (local) o en la tabla `schema_version` (Turso). Nunca edites una migración ya aplicada.
- **Ajuste nuevo del panel**: añádelo a `SCHEMA` de `backend/settings.py` (variable de entorno, valor por defecto, tipo, secreto) y léelo con `settings.get(...)`.

## Comandos

| Comando | Qué hace |
|---|---|
| `python server.py` | Servidor de desarrollo en `PORT` (8000) |
| `npm test` | Tests de lógica del frontend |
| `python -m unittest discover -s tests` | Tests del backend (sesiones, OAuth, admin, velas, relay, noticias) |
| `python -m backend.db migrate` · `status` | Aplica las migraciones pendientes · muestra la versión del esquema |
| `python -m backend.db demo` · `users` · `admin <email>` | Usuarios de prueba · listar · dar rol de admin |
| `npm install && npm run vendor` | Actualiza Lightweight Charts, fuentes e iconos |
| `npm run screenshots` | Capturas de todas las vistas (servidor en marcha y Chromium) |

## Producción

```bash
docker compose up --build
```

- Define `ENV=production` y `APP_DOMAIN=https://tu-dominio` en `.env`: activa HSTS, cookies `__Host-`/Secure, `upgrade-insecure-requests`, quita `localhost` de la CSP y fija las URIs de redirección de OAuth.
- La base de datos vive en el volumen `paperpulse-data` (`/app/data`).
- Detrás de un proxy, añade su IP a `TRUSTED_PROXIES` y reenvía también las conexiones WebSocket de `/ws/market`.
- **Vercel** (`vercel.json`): funciona sin WebSockets (el frontend usa el respaldo REST). Necesita **Turso** para que los datos persistan; sin `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` usa `/tmp`, que es efímero.

### Turso y Vercel

Las variables de Turso solo las lee el backend; el navegador nunca las recibe.

```bash
turso auth login
turso db create paperpulse                 # región cercana a la de Vercel
turso db show paperpulse --url             # → TURSO_DATABASE_URL
turso db tokens create paperpulse          # → TURSO_AUTH_TOKEN

vercel link
vercel env add TURSO_DATABASE_URL production preview development
vercel env add TURSO_AUTH_TOKEN production preview development --sensitive
vercel env pull .env.local                 # copia local (ignorada por git)
```

Las migraciones se aplican solas al arrancar la función. Para aplicarlas a mano: `set -a; . ./.env.local; set +a; python -m backend.db migrate`.
