# PaperPulse

Simulador de trading (paper trading) con **cotizaciones reales**: criptomonedas de Binance y acciones de Wall Street e IBEX 35. El usuario practica con saldo virtual: compra y vende a precio de mercado, coloca órdenes límite y stop, crea alertas, analiza gráficos de velas con indicadores y apunta sus operaciones en un diario. Incluye un asistente con IA (Claude) y un panel de administración.

Nada de dinero real: no hay brokers ni órdenes reales. Todo el saldo y las operaciones son simulados.

## Arranque rápido

```bash
cp .env.example .env               # opcional: ANTHROPIC_API_KEY, ADMIN_EMAILS...
pip install -r requirements.txt
python -m backend.db demo          # SOLO desarrollo: usuarios de prueba (ver abajo)
python server.py                   # http://localhost:8000
```

Usuarios de prueba creados por `demo` (**solo para desarrollo**, con contraseñas públicas; el comando se niega a ejecutarse con `TURSO_DATABASE_URL` definida, `ENV=production` o en Vercel, y nunca deben existir en producción):

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
  contact.py                 Formulario de contacto: /api/contact (público) y bandeja en /api/admin/messages
  security.py                IP real del cliente (proxies de confianza), límites por minuto en memoria (por IP y por usuario)
  ai_usage.py                Uso y límites del asistente IA en la base de datos (válidos con varias instancias)
  community/                 Comunidad: text (validación), common (errores, cuotas), profiles, forum, ranking,
                             moderation y api (/api/community, /api/forum, moderación en /api/admin)
  trading/                   Cuenta de práctica del servidor: rules (cálculo en enteros), prices (precios del servidor),
                             ledger (transacciones, idempotencia, resolución de límite/stop), api (/api/portfolio, /api/orders)
  chat.py                    /api/chat: asistente con Claude (SSE), desafío anti-bot, límites de gasto
  chat_fixed.py              Respuestas fijas (sin IA) para el texto exacto de los botones de sugerencia del chat
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
  js/views/                  dashboard, trade (Operar), markets, news, journal (Diario), community (Comunidad),
                             admin y moderation (sección Moderación del panel)
  js/lib/el.js               Construcción de DOM con nodos de texto: TODO texto de usuarios de la comunidad pasa por aquí
  js/lib/community.js        Cliente de /api/community y /api/forum con caché en memoria y mensajes de error
  js/ui/                     Diálogos, paleta de comandos (Ctrl+K), asistente, visita guiada
  vendor/                    Generado por `npm run vendor` (Lightweight Charts, fuentes). No editar a mano
  img/icons.svg              Sprite de iconos Lucide, generado por `npm run vendor`
scripts/vendor.mjs           Copia dependencias de node_modules y genera el sprite (lista ICONS)
scripts/screenshots.mjs      Capturas de todas las vistas con Playwright (requiere el servidor)
tests/                       frontend.test.js (node --test) y test_*.py (unittest)
data/                        Base de datos local sin Turso (se crea sola; ignorada por git). Ver «Base local y dev containers»
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

### Comunidad (`backend/community/`)
- **Perfiles**: alias único (3-20 caracteres: letras, números y `_`; sin distinguir mayúsculas; hay alias reservados), bio de hasta 280 caracteres y perfil privado opcional. Sin perfil no se participa. Ninguna respuesta incluye emails. De un perfil privado solo se confirma que existe: no sale en la clasificación ni en las búsquedas y no se le puede seguir, aunque sus mensajes del foro siguen siendo públicos.
- **Foro**: categorías generales (estrategias, novatos, análisis técnico, noticias), «Operaciones compartidas» y un hilo automático por cada activo del catálogo (`forum.ensure_asset_threads`). Votos +1/-1, uno por usuario y mensaje, que se pueden cambiar o quitar; no se votan los mensajes propios. Orden `top` o `recent` y páginas de 20.
- **Compartir una operación**: `POST /api/forum/share {fillId, comment}`. El servidor comprueba que el fill es del usuario y toma de `fills` activo, lado, precio y resultado. Cada fill se comparte una sola vez.
- **Interfaz** (`#/community/...`): pestañas Clasificación, Foro, Siguiendo y Mi perfil; rutas `ranking`, `forum`, `forum:<categoría>`, `thread:<id>`, `user:<alias>`, `feed` y `me`. Sin sesión se puede leer todo y, al publicar, votar o seguir, se invita a iniciar sesión. La primera visita con sesión y sin perfil pide el alias. «Compartir en el foro» aparece en las ventas del diario y del historial de Operar (solo con la cuenta del servidor; si ya se compartió, enlaza al hilo). La sección Moderación del panel muestra las denuncias con la copia del texto, permite ocultar o restaurar, suspender o reactivar, y enseña el registro.
- **Seguir** y **feed** con los mensajes y operaciones compartidas de los perfiles seguidos.
- **Moderación**: denuncias (una por usuario y mensaje), ocultar y restaurar (borrado lógico: el texto se conserva para los admins), suspensión temporal o indefinida (no impide entrar ni operar, solo participar) y registro en `moderation_log`. El autor puede borrar lo suyo; después nadie ve ese texto en el foro, pero cada denuncia guarda una copia del mensaje y del alias del autor en el momento de denunciar (`reports.post_body`), así que el moderador siempre ve lo denunciado.
- **Texto de usuario**: se guarda tal cual (NFC, sin caracteres de control ni marcas de dirección) y se rechaza si supera el límite (`community/text.py`). No se escapa en el servidor: el frontend lo pinta siempre con `textContent`. No hay imágenes ni subida de ficheros, y los enlaces se muestran como texto.
- **Límites**: por minuto, por IP y por usuario, en tres niveles: leer (180/120), actuar (60/30) y publicar (20/5). Además hay cuotas diarias guardadas en la base de datos: 10 mensajes y 3 hilos en las primeras 24 h de una cuenta; después, 100 y 20. Borrar no devuelve cupo, y un mensaje idéntico en 10 minutos se rechaza.

### Retención (`backend/retention/`)
- **Notificaciones**: respuesta a tu hilo, nuevo seguidor, mensaje ocultado, orden límite/stop ejecutada (o rechazada), alerta de precio y logro conseguido. Se crean en la misma transacción del evento (`notifications.notify`) y se borran a los 60 días (máx. 200 por usuario). La campana las consulta al abrir la app y al abrir el menú; no hay sondeo. Cada usuario solo ve y modifica las suyas. Las alertas de precio viven en el navegador (localStorage): al dispararse, el cliente avisa a `POST /api/notifications/alert` (solo símbolo del catálogo y números validados), así que solo se registran con la app abierta.
- **Logros**: catálogo en `achievements.py` (primera operación, 10 operaciones, primera ganancia, racha de 5 ganadoras, primera orden stop, semana operando, primer hilo, primer seguidor, resistencia a una caída del 10 %, reto, primeros pasos). Concesión idempotente dentro de la transacción del evento; visibles en el perfil público (no en perfiles privados).
- **Racha** de días operando por fecha de **Madrid** (`trading_days`). La racha vigente no se pierde hasta que pasa un día entero sin operar.
- **Reto mensual** (`challenges.py`, `#/community/challenge`): mes natural en hora de Madrid, cuenta aparte con el mismo saldo inicial para todos (ajuste `challenge_initial_balance_usd`) y clasificación propia. No se duplica la lógica de trading: cada participante tiene un *usuario sombra* (`users.owner_id`, desactivado y oculto en listados) titular de la cuenta del reto, y `/api/challenge/*` llama a las mismas funciones de `trading/ledger.py`. Al terminar el mes la clasificación se congela en el siguiente recálculo (el cron diario).
- **Onboarding**: tarjeta en el Resumen con 3 pasos (primera compra, primera orden stop, visita al foro) comprobados con datos del servidor; se puede saltar y retomar.
- **Aprender** (`#/learn`): 10 mini-lecciones y un glosario (`frontend/js/lib/learn-content.js`), neutrales y sin recomendar activos; el foro enlaza al glosario.
- **Cron diario** (`vercel.json`, 04:00 UTC, plan gratuito): `GET /api/cron/daily` recalcula clasificaciones y retos, y limpia notificaciones, sesiones y estados OAuth caducados. Exige `ADMIN_API_KEY` (cabecera `X-Admin-Key`) o `CRON_SECRET` (cabecera `Authorization: Bearer`, que es lo que envía Vercel Cron). **Define `CRON_SECRET` con el mismo valor que `ADMIN_API_KEY`.** Sin ninguna de las dos claves el endpoint rechaza siempre.
- **PWA**: `manifest.json` (iconos 192/512 *any* y *maskable* por separado, accesos directos) y `sw.js` (solo estáticos propios con red primero; nunca guarda `/api` ni `/ws`). La CSP permite únicamente `worker-src 'self'`.

### Formulario de contacto (`backend/contact.py`, `#/contact`)
- Público, sin sesión obligatoria. Solo texto: motivo (3-100 caracteres) y mensaje (10-2000). Se guarda en `contact_messages` con fecha y, si hay sesión, el usuario. **No envía correos, no usa APIs externas ni variables de entorno nuevas** y ninguna respuesta de la API incluye correos (de quien escribe con sesión, el panel solo muestra el alias).
- Anti-spam: mismo origen y JSON, 3 mensajes por minuto y por IP (`IP_CONTACT_CALLS` en `security.py`), tope global de 60 por hora guardado en la base de datos y un campo trampa (*honeypot*, `website`): si llega relleno, el servidor responde 201 pero descarta el mensaje.
- Administración → **Mensajes**: lista con filtro (todos, sin leer, leídos), marca de leído y borrado; el Resumen cuenta los no leídos. Solo admins (`require_admin`).
- Se incluye en «Descargar mis datos» y se borra al eliminar la cuenta (los enviados sin sesión no se pueden asociar a nadie). Está enlazado desde el pie, el aviso legal, la política de privacidad y los términos.
- Limitación: como no hay correo, la administración **no puede responder** a quien escribe sin más; para una consulta sobre su cuenta debe enviarla con la sesión iniciada.

### Cumplimiento legal (España / UE) — borrador pendiente de revisión legal
- **Páginas** (`#/legal/<id>`, texto en `frontend/js/lib/legal-content.js`): aviso legal (LSSI), política de privacidad (RGPD/LOPDGDD, nombra a Vercel, Turso, Google, Anthropic y explica las transferencias a EE. UU.), términos de uso, política de cookies y normas de la comunidad. El titular es «PaperPulse (proyecto personal sin ánimo de lucro)», sin NIF, y el dominio es `https://paperpulse-delta.vercel.app`; **la única vía de contacto es el formulario de la aplicación (`#/contact`): no se publica ningún correo**. La base de datos de Turso está en Dublín (UE/EEE) y las funciones de Vercel se ejecutan en París (`cdg1`, visto en los logs de producción; no está fijada en `vercel.json`). La política de privacidad lo refleja, así que **si cambias la región de las funciones, actualiza los apartados 4 y 5 de `legal-content.js`**. Ya no queda ningún `[PENDIENTE]`, pero **hay que pasar los textos por un profesional del Derecho antes de publicar**. Enlazadas en el pie y en el registro. El aviso «simulador educativo con dinero virtual, no es asesoramiento financiero» está siempre visible en el foro y en el pie.
- **Aceptación**: el registro con email exige marcar *términos + privacidad* y *tengo 14 años*; se guardan versión y fecha (`users.terms_version`, `terms_accepted_at`, `age_confirmed_at`). Las altas con Google quedan sin aceptar y un diálogo **no cerrable** lo pide al entrar; hasta entonces el servidor rechaza publicar y operar. Las cuentas anteriores a los textos quedan como `legacy`: no se bloquean, solo ven un aviso cerrable. Al cambiar `LEGAL_VERSION` (`backend/account.py` y `legal-content.js`, un test comprueba que coinciden) se pide aceptar de nuevo.
- **Descargar mis datos** (`GET /api/account/export`, menú de la cuenta): JSON con todo lo propio (sin hashes ni datos de otras personas). **Eliminar cuenta**: anonimiza (`backend/account.py`): borra email, nombre, contraseña, perfil, cuenta de práctica, retos, notificaciones y sesiones; vacía sus mensajes y marca sus hilos como eliminados; la fila queda como «Usuario eliminado» para que no se rompan las respuestas de otras personas. El email y el alias quedan libres.
- **Moderación y promoción**: las normas prohíben señales de pago, cursos, grupos, brókeres y afiliados; se aplican ocultando mensajes (motivo «Spam o promoción…») y suspendiendo cuentas; las cuentas sin verificar no pueden publicar enlaces en sus primeras 24 h.
- **Cookies**: solo hay cookies y almacenamiento técnicos (sesión, `pp_oauth`, `localStorage` `paperpulse_*`, `sessionStorage` y la caché del service worker); no hay analítica, publicidad ni cookies de terceros, por lo que **no hay banner** (art. 22.2 LSSI-CE). Si se añade algo no necesario, habrá que pedir consentimiento. Las imágenes de noticias se cargan desde los servidores de los medios (ven la IP): está dicho en la política de privacidad.

### Clasificación
- **Patrimonio** = efectivo (incluido el reservado en órdenes) + posiciones abiertas valoradas al último precio (una sola consulta de precios para todos los activos: `prices.valuation_prices`). Un activo sin precio se valora a su coste y el resultado se marca como «aproximado».
- **Rentabilidad total** = patrimonio / saldo inicial − 1. Como no hay ingresos ni retiradas, es la rentabilidad real. **7 y 30 días** = patrimonio / patrimonio al inicio del periodo − 1, con las instantáneas diarias de `equity_snapshots`; si la cuenta se abrió dentro del periodo, la base es el saldo inicial.
- **Coste en serverless**: el cálculo se hace como mucho cada 5 minutos, al consultar la clasificación o un perfil. Rellena la tabla `leaderboard` y guarda la instantánea del día, y las lecturas solo consultan esa tabla. Privacidad, suspensión y mínimo de operaciones (`community_min_trades`, en el panel) se aplican al leer, así que tienen efecto inmediato. Para tener instantáneas aunque nadie consulte, un cron puede llamar a `POST /api/community/leaderboard/refresh` con la cabecera `X-Admin-Key`.
- **Limitaciones**:
  - Las instantáneas solo existen los días en que alguien recalcula; si falta la del inicio del periodo, se usa la más cercana y se marca como aproximada.
  - Se valora a último precio, sin descontar la comisión de una venta futura.
  - Los activos en euros usan el tipo de cambio actual.
  - El cálculo recorre todas las cuentas con operaciones; para miles de usuarios habría que repartirlo en lotes.

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
- **Email verificado**: solo lo están las cuentas que entran con Google (u Okta) y el proveedor devuelve `email_verified=true`. Las de email y contraseña son «sin verificar»: tienen los límites de comunidad de las cuentas nuevas (10 mensajes y 3 hilos en sus primeras 24 h, sin enlaces) y nunca reciben el rol de administrador. Los administradores y las cuentas verificadas están exentos de esos límites.
- **Rol de administrador** (`ADMIN_EMAILS` solo aplica a cuentas verificadas): registrarse con email y contraseña **nunca** da el rol, ni siquiera con un email de la lista. Si alguien registró antes ese email con contraseña, al entrar el dueño con Google esa cuenta pierde la contraseña y las sesiones (ataque de pre-registro) y queda verificada. El panel tampoco permite hacer admin a una cuenta sin verificar. Comandos: `python -m backend.db admin <email>` (cuenta existente y verificada; `--force` solo en desarrollo) y `python -m backend.db admins` (lista los administradores).
- **Procedimiento en producción** (administrador único `<correo-del-administrador>`): 1) con `ADMIN_EMAILS` vacío, entra en la web con **Google** con ese correo (se crea la cuenta verificada); 2) con las variables de Turso cargadas, `python -m backend.db admin <correo-del-administrador>`; 3) `python -m backend.db admins` debe listar solo ese correo, «verificado»; 4) comprueba en Administración → Usuarios que no hay otros administradores y que no hay usuarios `@paperpulse.local`.

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
- **Integraciones**: clave, modelo y esfuerzo de Anthropic (`anthropic_effort`, por defecto `low`: razona menos y gasta menos salida; «El del modelo» no envía el parámetro); proveedor de bolsa y clave de Finnhub.

Precedencia de cada ajuste (`backend/settings.py`): valor guardado en el panel → variable de `.env` → valor por defecto. Los secretos nunca se devuelven al navegador (solo «configurado» y los 4 últimos caracteres). Están en claro en la base de datos: protege el token de Turso y, en local, `data/` (el archivo se crea con permisos 600).

### Asistente IA
`/api/chat` hace streaming SSE con Claude. Antes de cada mensaje el frontend pide `/api/chat/challenge` (HMAC de un solo uso). Sin clave de Anthropic responde un modo de demostración.
- **Respuestas fijas**: el texto exacto de los botones de sugerencia (`SUGGESTIONS`, igual en `ui/chat.js` y `backend/chat_fixed.py`; un test lo comprueba) se responde sin llamar a la IA: el resumen del mercado con las cotizaciones que envía el navegador y las educativas con texto propio y enlaces a Aprender. Cualquier otra pregunta, aunque se parezca, va a la IA. El chat solo convierte en enlace las rutas internas `[texto](#/ruta)` (`lib/markdown.js`).
- **Uso y límites en la base de datos** (`backend/ai_usage.py`, migración `0010`), así que valen aunque Vercel reparta las peticiones entre instancias: 20 preguntas por minuto y cliente, `DAILY_USER_CHAT_REQUESTS` y `DAILY_USER_TOKEN_LIMIT` al día por cliente, tope global `DAILY_GLOBAL_TOKEN_LIMIT` y aviso en el log al 80 %. El cliente se identifica con un HMAC de su IP con sal diaria (la IP no se guarda) y el cron diario borra los contadores pasados.
- `ai_usage` guarda una fila por respuesta (tokens de entrada, salida, razonamiento y caché; sin IP, usuario ni texto) durante 90 días. El Resumen del panel y `/api/health` muestran el consumo del día y la media por pregunta.
- El desafío se firma con un secreto generado por la migración (`server_secrets`) y su uso único se guarda en `ai_challenges_used`: funciona aunque el desafío y la pregunta lleguen a instancias distintas.

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
| GET/PUT | `/api/community/me` | Mi perfil `{alias, bio, isPrivate}` y si estoy suspendido |
| GET | `/api/community/profiles?q=` · `/api/community/profiles/{alias}` | Buscar perfiles públicos · perfil público |
| POST/DELETE | `/api/community/profiles/{alias}/follow` | Seguir · dejar de seguir |
| GET | `/api/community/following` · `/api/community/feed?before=` | A quién sigo · feed |
| GET | `/api/community/leaderboard?period=7d\|30d\|total&page=` | Clasificación |
| POST | `/api/community/leaderboard/refresh` | Recalcular (admin o `X-Admin-Key`, para un cron) |
| GET | `/api/forum/categories` · `/api/forum/categories/{slug}?sort=top\|recent&page=` | Categorías · hilos |
| GET | `/api/forum/assets/{symbol}` · `/api/forum/threads/{id}?sort=&page=` | Hilo de un activo · hilo con respuestas |
| POST | `/api/forum/threads` · `/api/forum/threads/{id}/posts` · `/api/forum/share` | Abrir hilo · responder · compartir operación |
| DELETE · PUT · POST | `/api/forum/posts/{id}` · `/vote {value}` · `/report {reason, details}` | Borrar lo mío · votar (1, -1, 0) · denunciar |
| GET · POST | `/api/admin/reports?status=` · `/api/admin/posts/{id}/hide\|restore\|dismiss` | Moderación de mensajes |
| POST · GET | `/api/admin/users/{id}/suspend\|unsuspend` · `/api/admin/moderation-log` | Suspensiones · registro |
| GET | `/api/admin/overview` · `/api/admin/users?q=&limit=&offset=` | Panel: métricas · usuarios |
| PATCH/DELETE | `/api/admin/users/{id}` | `{role, disabled}` · eliminar |
| GET/PUT | `/api/admin/settings` | Ajustes `{values: {clave: valor\|null}}` (`null` = volver a `.env`) |
| POST | `/api/admin/oauth/{provider}/test` | Comprueba el documento OpenID del proveedor |
| POST | `/api/contact` | Formulario de contacto `{reason, message}` (el campo `website` es un honeypot) |
| GET · PATCH · DELETE | `/api/admin/messages?status=&page=` · `/api/admin/messages/{id}` | Bandeja de contacto · `{read}` · borrar |
| GET | `/api/health` | Estado; con sesión admin o `X-Admin-Key`, métricas |

## Convenciones del código

- **Idioma**: interfaz, comentarios y mensajes de error en español.
- **CSP estricta** (`backend/app.py`): nada de `<script>` ni `style="..."` inline, ni `onclick=` en HTML. Para anchos dinámicos usa `data-w`/`data-l` (los aplica `render()` de `lib/dom.js`).
- **Plantillas**: `html\`...\`` de `lib/dom.js` escapa todo lo interpolado; `raw()` solo para HTML propio de confianza. Eventos con delegación: `on(root, 'click', selector, fn)`.
- **Texto de otros usuarios** (alias, bio, títulos, mensajes, motivos de moderación): nunca con `innerHTML` ni con `html\`\``. Se construye con `h()`/`userText()` de `lib/el.js` (nodos de texto; `h()` rechaza atributos `on*`, `style` y enlaces externos). Los enlaces escritos por usuarios se muestran como texto. Los toasts también usan `textContent`.
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

### Base local y dev containers
SQLite **no funciona en carpetas compartidas con el anfitrión, de red o de máquina virtual**. En un dev container sobre Windows o macOS, `/workspaces` es virtiofs: el número de inodo de un fichero cambia tras el primer `fsync`, y SQLite corrompe la base (modo WAL: «database disk image is malformed») o la trata como movida (modo DELETE: «attempt to write a readonly database»). Por eso:
- Sin `DATABASE_PATH`, si `data/` está en uno de esos sistemas de ficheros, la base se crea en el disco del contenedor: `~/.local/share/paperpulse/paperpulse.db`.
- Con un `DATABASE_PATH` en uno de ellos, el servidor no arranca y lo explica. Usa una ruta del contenedor, p. ej. `DATABASE_PATH=~/paperpulse/prueba.db`.
- `python -m backend.db status` muestra también la integridad de la base local.

### Despliegue a producción sin riesgo
1. **Copia de seguridad de Turso**: `turso db shell paperpulse .dump > backup-$(date +%F).sql` y, si quieres, una copia viva `turso db create paperpulse-copia --from-db paperpulse`. Guarda el `.sql` fuera del repositorio.
2. **Variables en Vercel** (producción): `ENV=production`, `APP_DOMAIN=https://tu-dominio`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_API_KEY` y `CRON_SECRET` (mismo valor, `openssl rand -hex 32`), y el inicio de sesión con Google (`OAUTH_GOOGLE_ENABLED=true`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, con la URI `https://tu-dominio/api/auth/oauth/google/callback` registrada en Google Cloud Console). No definas `DATABASE_PATH`; deja `ADMIN_EMAILS` vacío.
3. **Migraciones** antes de desplegar: `vercel env pull .env.production.local --environment=production`, cárgalo (`set -a; . ./.env.production.local; set +a`) y ejecuta `python -m backend.db status` (verás las pendientes) y `python -m backend.db migrate`. Son solo aditivas: no borran ni bloquean cuentas existentes.
4. **Desplegar** (`vercel --prod`). Comprueba `GET /api/health`, que el cron aparece en Vercel → Settings → Cron Jobs y que `curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/daily` devuelve 200.
5. **Tu administrador**: entra en la web con **Google** con `<correo-del-administrador>`, acepta los términos y, con las variables de producción cargadas, `python -m backend.db admin <correo-del-administrador>`. Comprueba con `python -m backend.db admins` (solo ese correo, «verificado») y `python -m backend.db users` (ningún `@paperpulse.local`).
6. **Antes de abrir al público**: comprueba que `frontend/js/lib/legal-content.js` no tiene `[PENDIENTE: …]` y pasa los textos por revisión legal; crea una cuenta de prueba por email, comprueba que no es admin y bórrala desde el menú.

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
