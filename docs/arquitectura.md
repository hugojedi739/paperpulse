# Arquitectura

Visión general de cómo encajan las piezas de PaperPulse. El detalle de cada función está en la [referencia](referencia.md).

## Esquema

```
Navegador (frontend/)  ──HTTP /api/*──▶  Backend (backend/, Starlette)  ──▶  Binance REST + WebSocket
                       ──WS /ws/market─▶                                 ──▶  CoinGecko
                                                                         ──▶  Yahoo Finance / Finnhub
                                                                         ──▶  Frankfurter (divisas), RSS (noticias)
                                                                         ──▶  Anthropic (asistente)
                                                                         ──▶  Google / Okta (OIDC)
                                                                         ──▶  Turso / libSQL (local: data/paperpulse.db)
```

**Regla principal: el navegador solo habla con nuestro backend.** Toda llamada a un servicio de terceros, y toda clave de API, vive en `backend/`. La CSP lo impone (`connect-src 'self'`). Si añades una fuente de datos, crea un endpoint en el backend y llámalo desde el frontend con `lib/api.js`.

## Piezas

| Pieza | Qué hace |
|---|---|
| **Backend** (`backend/`) | Python 3.13 con Starlette y Uvicorn. Sin ORM: SQL directo con el cliente `libsql`. `server.py` solo expone `backend.app:app`. Cada dominio tiene su módulo o paquete: `market/` (datos de mercado), `trading/` (cuenta de práctica), `community/`, `retention/`, más `auth`, `admin`, `chat`, `contact` y `account`. |
| **Base de datos** | Turso (libSQL) en producción; un fichero libSQL compatible con SQLite en local. Las migraciones numeradas de `backend/migrations/` se aplican al arrancar. |
| **Frontend** (`frontend/`) | HTML, CSS y JavaScript con módulos ES nativos, **sin framework ni build para desarrollar**. `js/lib/` es lógica sin interfaz, `js/ui/` son piezas compartidas (diálogos, chat, barra inferior) y `js/views/` una vista por pantalla. Gráficos con Lightweight Charts 5. |
| **Build estático** (`public/`) | Solo para Vercel: `npm run build:static` copia `frontend/` a `public/` con un hash en el nombre de cada JS y CSS, y genera `backend/templates/index.html`. Ambos se versionan; un test falla si están desactualizados. |
| **Quién sirve el frontend** | En local y con Docker, el propio backend sirve `frontend/`. Con `SERVE_FRONTEND=false` se sirve desde un CDN o nginx: pon un proxy para `/api` y `/ws` en el mismo dominio o usa `<meta name="api-base">` (ver `frontend/js/lib/api.js`). |
| **Tiempo real** | Un único WebSocket del navegador (`/ws/market`) y una única conexión del backend con Binance para todos los clientes. Si falla, el navegador pasa a REST cada 5 s. |

## Flujo de una orden con sesión

1. El navegador envía `{clientOrderId, symbol, side, type, quantity, triggerPrice?}` a `POST /api/orders`.
2. `trading/prices.py` obtiene el precio en el servidor; el cliente nunca lo aporta.
3. `trading/ledger.py` escribe saldo, posición, ejecución y estado en una sola transacción. `clientOrderId` hace la orden idempotente.
4. Las órdenes límite y stop se resuelven a demanda: en cada consulta de la cartera se revisan las velas cerradas desde la última revisión. No hay procesos en segundo plano, lo que encaja con Vercel.

Sin sesión, todo vive en `localStorage` y las órdenes se ejecutan en el navegador (`lib/trading.js`).

## Seguridad

- **CSP estricta** (`backend/app.py`): sin `<script>` ni `style="..."` inline ni `onclick=`.
- **Sesión**: cookie HttpOnly `SameSite=Strict` (`__Host-` y `Secure` en producción). En la base de datos solo se guarda el hash del token.
- **CSRF**: toda escritura comprueba `Origin` y exige JSON.
- **Admin**: toda ruta `/api/admin/*` pasa por `require_admin`; solo una cuenta con email verificado puede ser administradora.
- **Texto de usuarios**: se pinta siempre como nodos de texto (`lib/el.js`), nunca con `innerHTML`.

## Convenciones del código

- **Idioma**: interfaz, comentarios y mensajes de error en español.
- **CSP**: para anchos dinámicos usa `data-w`/`data-l` (los aplica `render()` de `lib/dom.js`).
- **Plantillas**: `html\`...\`` de `lib/dom.js` escapa todo lo interpolado; `raw()` solo para HTML propio de confianza. Eventos con delegación: `on(root, 'click', selector, fn)`.
- **Texto de otros usuarios** (alias, bio, títulos, mensajes, motivos de moderación): nunca con `innerHTML` ni con `html\`\``. Se construye con `h()`/`userText()` de `lib/el.js` (nodos de texto; `h()` rechaza atributos `on*`, `style` y enlaces externos). Los enlaces escritos por usuarios se muestran como texto. Los toasts también usan `textContent`.
- **Vistas**: cada módulo de `js/views/` exporta `title`, `mount(el)`, `show(param)` y, si los necesita, `hide()` y `theme()`. Se registran en `VIEWS` de `main.js` y tienen su `<section class="view" data-view="...">` en `index.html`.
- **Iconos**: `icon('nombre')` usa el sprite. Para un icono nuevo añádelo a `ICONS` en `scripts/vendor.mjs` y ejecuta `npm run vendor`.
- **Backend**: cada endpoint es una función `async def (request)` registrada en `routes` de `backend/app.py` (o en `build_routes`/`routes` de `auth.py`, `admin.py` y de cada paquete). Las llamadas bloqueantes (requests, libSQL, yfinance) van en un hilo (`run_in_threadpool` o `run_in_executor`). Las cachés en memoria tienen tamaño acotado.
- **Esquema de BD**: crea el siguiente fichero en `backend/migrations/` (`0015_descripcion.sql`, numeración consecutiva; sentencias separadas por `;`, comentarios con `--`, sin triggers) con un comentario encima de cada tabla. La versión se guarda en `PRAGMA user_version` (local) o en la tabla `schema_version` (Turso). Nunca edites una migración ya aplicada.
- **Ajuste nuevo del panel o variable de entorno**: añádelo a `SCHEMA` de `backend/settings.py` (variable, valor por defecto, tipo, si es secreto), léelo con `settings.get(...)` y documéntalo en `.env.example`.
