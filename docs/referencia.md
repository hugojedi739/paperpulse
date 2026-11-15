# PaperPulse — referencia detallada

Cómo funciona cada parte por dentro, la API completa y los detalles de producción. Para empezar, lee antes el [README](../README.md) y la [arquitectura](arquitectura.md).

**Índice:** [Funcionamiento](#cuenta-de-práctica-y-datos-del-usuario) · [API](#api) · [Diseño: Aurora](#diseño-aurora) · [Migraciones](#migraciones) · [Producción](#producción-docker-y-vercel) · [Base local y dev containers](#base-local-y-dev-containers) · [Despliegue a producción sin riesgo](#despliegue-a-producción-sin-riesgo) · [Turso y Vercel](#turso-y-vercel)

## Cuenta de práctica y datos del usuario
Hay dos modos:

- **Modo local (sin sesión)**: todo (saldo, posiciones, órdenes, diario, alertas, favoritos, ajustes) vive en `localStorage` (`frontend/js/lib/store.js`, claves `paperpulse_*`). Las órdenes se ejecutan en el navegador (`lib/trading.js`, `checkTriggers`), sin comisiones. El usuario elige su capital y puede reiniciar. No cuenta para clasificaciones.
- **Cuenta del servidor (con sesión)**: saldo, posiciones, órdenes y operaciones cerradas viven en la base de datos (`backend/trading/`) y el navegador solo guarda una copia para pintar (`lib/account.js` → `store.applyServer`). La cuenta empieza limpia (no se importa nada de `localStorage`) y no se puede reiniciar. **El saldo inicial lo elige la persona** en un paso de bienvenida (`ui/welcome.js`, `lib/starting-balance.js`) que se abre tras iniciar sesión y aceptar los términos: de 50 a 1.000.000 €, siempre en euros, con importes rápidos de 100 a 25.000 € y «Otra cantidad» (desde 50 €). El Resumen y el diálogo de la cuenta muestran «Si hubieras invertido tus X € de verdad con estas mismas operaciones, hoy tendrías Y» (`whatIf` en `lib/starting-balance.js`): es la rentabilidad de la cuenta aplicada a los euros elegidos, así que solo aparece en las cuentas que eligieron su saldo. `GET /api/portfolio` devuelve `needsSetup: true` mientras no exista la cuenta; `POST /api/portfolio/start {amount, currency: "EUR"}` la crea (validación en servidor, 409 si ya existe: el saldo no se puede cambiar) y las órdenes se rechazan con 409 hasta entonces. El servidor convierte a USD **una vez**, con el tipo del BCE de ese momento: `initial_cents` (USD) es la base de la rentabilidad y `initial_input_cents` + `initial_currency` (migración `0013`) guardan lo elegido solo para mostrar «Empezaste con X €». Las cuentas anteriores (saldo del panel, sin importe elegido) no se tocan. El ajuste `trading_initial_balance_usd` queda como saldo de respaldo del camino interno (tests, usuarios sombra). Con saldos pequeños la orden mínima (5 USD) deja pocas posiciones a la vez: el formulario avisa por debajo de 100 €. Los retos no se ven afectados: usan cuentas sombra con el saldo del reto, igual para todos.
- Con sesión, `lib/auth.js` sigue subiendo a `/api/data` la copia de alertas, favoritos y ajustes (debounce de 2 s). Esa copia no afecta a la cuenta del servidor.

## Cuenta del servidor: cómo se ejecutan las órdenes
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
  - **No se abonan dividendos**: ninguna posición cobra dividendos (ni en la cuenta del servidor, ni en el modo local, ni en los retos) y las velas de Yahoo no se ajustan por ellos (`auto_adjust=False`), así que en la fecha ex-dividendo el precio baja sin compensación. La ficha y el Resumen solo informan de las fechas ([Próximos dividendos](#próximos-dividendos-y-luz-roja-de-mercado)).

## Comunidad (`backend/community/`)
- **Perfiles**: alias único (3-20 caracteres: letras, números y `_`; sin distinguir mayúsculas; hay alias reservados), bio de hasta 280 caracteres y perfil privado opcional. Sin perfil no se participa. Ninguna respuesta incluye emails. De un perfil privado solo se confirma que existe: no sale en la clasificación ni en las búsquedas y no se le puede seguir, aunque sus mensajes del foro siguen siendo públicos.
- **Foro**: categorías generales (estrategias, novatos, análisis técnico, noticias), «Operaciones compartidas» y un hilo automático por cada activo del catálogo (`forum.ensure_asset_threads`). Votos +1/-1, uno por usuario y mensaje, que se pueden cambiar o quitar; no se votan los mensajes propios. Orden `top` o `recent` y páginas de 20.
- **Compartir una operación**: `POST /api/forum/share {fillId, comment}`. El servidor comprueba que el fill es del usuario y toma de `fills` activo, lado, precio y resultado. Cada fill se comparte una sola vez.
- **Interfaz** (`#/community/...`): pestañas Clasificación, Foro, Siguiendo y Mi perfil; rutas `ranking`, `forum`, `forum:<categoría>`, `thread:<id>`, `user:<alias>`, `feed` y `me`. Sin sesión se puede leer todo y, al publicar, votar o seguir, se invita a iniciar sesión. La primera visita con sesión y sin perfil pide el alias. «Compartir en el foro» aparece en las ventas del diario y del historial de Operar (solo con la cuenta del servidor; si ya se compartió, enlaza al hilo). La sección Moderación del panel muestra las denuncias con la copia del texto y la ficha del autor (antigüedad, mensajes, ocultados y suspensiones previas). Ocultar, restaurar, descartar y suspender piden un motivo rápido (preseleccionado según las denuncias) y un detalle opcional, y resuelven la tarjeta en línea, sin recargar la lista. Suspender o reactivar a cualquier usuario también se hace desde la pestaña Usuarios; el registro está en Auditoría. Las pestañas Moderación y Mensajes muestran cuántos pendientes hay (`GET /api/admin/badges`).
- **Seguir** y **feed** con los mensajes y operaciones compartidas de los perfiles seguidos.
- **Moderación**: denuncias (una por usuario y mensaje), ocultar y restaurar (borrado lógico: el texto se conserva para los admins), suspensión temporal o indefinida (no impide entrar ni operar, solo participar) y registro en `moderation_log`. El autor puede borrar lo suyo; después nadie ve ese texto en el foro, pero cada denuncia guarda una copia del mensaje y del alias del autor en el momento de denunciar (`reports.post_body`), así que el moderador siempre ve lo denunciado.
- **Texto de usuario**: se guarda tal cual (NFC, sin caracteres de control ni marcas de dirección) y se rechaza si supera el límite (`community/text.py`). No se escapa en el servidor: el frontend lo pinta siempre con `textContent`. No hay imágenes ni subida de ficheros, y los enlaces se muestran como texto.
- **Límites**: por minuto, por IP y por usuario, en tres niveles: leer (180/120), actuar (60/30) y publicar (20/5). Además hay cuotas diarias guardadas en la base de datos: 10 mensajes y 3 hilos en las primeras 24 h de una cuenta; después, 100 y 20. Borrar no devuelve cupo, y un mensaje idéntico en 10 minutos se rechaza.

## Retención (`backend/retention/`)
- **Notificaciones**: respuesta a tu hilo, nuevo seguidor, mensaje ocultado, orden límite/stop ejecutada (o rechazada), alerta de precio y logro conseguido. Se crean en la misma transacción del evento (`notifications.notify`) y se borran a los 60 días (máx. 200 por usuario). La campana las consulta al abrir la app y al abrir el menú; no hay sondeo. Cada usuario solo ve y modifica las suyas. Las alertas de precio viven en el navegador (localStorage): al dispararse, el cliente avisa a `POST /api/notifications/alert` (solo símbolo del catálogo y números validados), así que solo se registran con la app abierta.
- **Logros**: catálogo en `achievements.py` (primera operación, 10 operaciones, primera ganancia, racha de 5 ganadoras, primera orden stop, semana operando, primer hilo, primer seguidor, resistencia a una caída del 10 %, reto, primeros pasos). Concesión idempotente dentro de la transacción del evento; visibles en el perfil público (no en perfiles privados).
- **Racha** de días operando por fecha de **Madrid** (`trading_days`). La racha vigente no se pierde hasta que pasa un día entero sin operar.
- **Reto mensual** (`challenges.py`, `#/community/challenge`): mes natural en hora de Madrid, cuenta aparte con el mismo saldo inicial para todos (ajuste `challenge_initial_balance_usd`) y clasificación propia. No se duplica la lógica de trading: cada participante tiene un *usuario sombra* (`users.owner_id`, desactivado y oculto en listados) titular de la cuenta del reto, y `/api/challenge/*` llama a las mismas funciones de `trading/ledger.py`. Al terminar el mes la clasificación se congela en el siguiente recálculo (el cron diario).
- **Onboarding**: tarjeta en el Resumen con 3 pasos (primera compra, primera orden stop, visita al foro) comprobados con datos del servidor; se puede saltar y retomar.
- **Estadísticas** (`#/stats`, `views/stats.js` con la lógica en `lib/stats.js`; carga diferida): aciertos (tasa, ganancia y pérdida medias), pérdida máxima (peor operación y mayor caída acumulada desde un máximo) y resultado de las últimas 8 semanas (lunes a domingo, hora local, en porcentaje sobre el saldo inicial). Se calcula en el navegador con las operaciones cerradas, así que vale igual en modo local y con la cuenta del servidor (que envía las últimas 500); las posiciones abiertas no cuentan. Se entra desde el menú lateral, el botón «Estadísticas» del Diario o la paleta.
- **Retos de la semana** (`lib/goals.js`, tarjeta `ui/goals-card.js` en el Resumen y en Estadísticas): cuatro metas personales de buenos hábitos, de lunes a domingo: no perder más del 5 % en la semana, que ninguna operación pierda más del 2 % del saldo, operar 3 días distintos y anotar 3 operaciones en el diario. **Sin clasificación y sin guardar nada**: se calculan en el navegador con las operaciones cerradas de la semana (por eso valen en modo local y con sesión, y no hay migración). Un límite respetado solo pasa a «Cumplido» al acabar la semana; lo no conseguido se muestra como «Esta vez no», sin penalización. No confundir con el reto mensual, que sí compite.
- **Aprender** (`#/learn`): 10 mini-lecciones y un glosario (`frontend/js/lib/learn-content.js`), neutrales y sin recomendar activos; el foro enlaza al glosario.
- **Cron diario** (`vercel.json`, 04:00 UTC, plan gratuito): `GET /api/cron/daily` recalcula clasificaciones y retos, y limpia notificaciones, sesiones y estados OAuth caducados, los contadores del asistente y, del contador de visitas, los hashes de días pasados y los agregados de más de 90 días. Exige `ADMIN_API_KEY` (cabecera `X-Admin-Key`) o `CRON_SECRET` (cabecera `Authorization: Bearer`, que es lo que envía Vercel Cron). **Define `CRON_SECRET` con el mismo valor que `ADMIN_API_KEY`.** Sin ninguna de las dos claves el endpoint rechaza siempre.
- **PWA**: `manifest.json` (iconos 192/512 *any* y *maskable* por separado, accesos directos) y `sw.js` (solo estáticos propios con red primero; nunca guarda `/api` ni `/ws`). La CSP permite únicamente `worker-src 'self'`.

## Formulario de contacto (`backend/contact.py`, `#/contact`)
- Público, sin sesión obligatoria. Solo texto: motivo (3-100 caracteres) y mensaje (10-2000). Se guarda en `contact_messages` con fecha y, si hay sesión, el usuario. **No envía correos, no usa APIs externas ni variables de entorno nuevas** y ninguna respuesta de la API incluye correos (de quien escribe con sesión, el panel solo muestra el alias).
- Anti-spam: mismo origen y JSON, 3 mensajes por minuto y por IP (`IP_CONTACT_CALLS` en `security.py`), tope global de 60 por hora guardado en la base de datos y un campo trampa (*honeypot*, `website`): si llega relleno, el servidor responde 201 pero descarta el mensaje.
- Administración → **Mensajes**: lista con filtro (todos, sin leer, leídos), marca de leído y borrado; el Resumen cuenta los no leídos. Solo admins (`require_admin`).
- Se incluye en «Descargar mis datos» y se borra al eliminar la cuenta (los enviados sin sesión no se pueden asociar a nadie). Está enlazado desde el pie, el aviso legal, la política de privacidad y los términos.
- Limitación: como no hay correo, la administración **no puede responder** a quien escribe sin más; para una consulta sobre su cuenta debe enviarla con la sesión iniciada.

## Cumplimiento legal (España / UE) — borrador pendiente de revisión legal
- **Páginas** (`#/legal/<id>`, texto en `frontend/js/lib/legal-content.js`): aviso legal (LSSI), política de privacidad (RGPD/LOPDGDD, nombra a Vercel, Turso, Google, Anthropic y explica las transferencias a EE. UU.), términos de uso, política de cookies y normas de la comunidad. El titular es «PaperPulse (proyecto personal sin ánimo de lucro)», sin NIF, y el dominio es `https://paperpulse-delta.vercel.app`; **la única vía de contacto es el formulario de la aplicación (`#/contact`): no se publica ningún correo**. La base de datos de Turso está en Dublín (UE/EEE) y las funciones de Vercel se ejecutan en París (`cdg1`, visto en los logs de producción; no está fijada en `vercel.json`). La política de privacidad lo refleja, así que **si cambias la región de las funciones, actualiza los apartados 4 y 5 de `legal-content.js`**. Ya no queda ningún `[PENDIENTE]`, pero **hay que pasar los textos por un profesional del Derecho antes de publicar**. Enlazadas en el pie y en el registro. El aviso «simulador educativo con dinero virtual, no es asesoramiento financiero» está siempre visible en el foro y en el pie.
- **Aceptación**: el registro con email exige marcar *términos + privacidad* y *tengo 14 años*; se guardan versión y fecha (`users.terms_version`, `terms_accepted_at`, `age_confirmed_at`). Las altas con Google quedan sin aceptar y un diálogo **no cerrable** lo pide al entrar; hasta entonces el servidor rechaza publicar y operar. Las cuentas anteriores a los textos quedan como `legacy`: no se bloquean, solo ven un aviso cerrable. Al cambiar `LEGAL_VERSION` (`backend/account.py` y `legal-content.js`, un test comprueba que coinciden) se pide aceptar de nuevo.
- **Descargar mis datos** (`GET /api/account/export`, menú de la cuenta): JSON con todo lo propio (sin hashes ni datos de otras personas). **Eliminar cuenta**: anonimiza (`backend/account.py`): borra email, nombre, contraseña, perfil, cuenta de práctica, retos, notificaciones y sesiones; vacía sus mensajes y marca sus hilos como eliminados; la fila queda como «Usuario eliminado» para que no se rompan las respuestas de otras personas. El email y el alias quedan libres.
- **Moderación y promoción**: las normas prohíben señales de pago, cursos, grupos, brókeres y afiliados; se aplican ocultando mensajes (motivo «Spam o promoción…») y suspendiendo cuentas; las cuentas sin verificar no pueden publicar enlaces en sus primeras 24 h.
- **Cookies**: solo hay cookies y almacenamiento técnicos (sesión, `pp_oauth`, `localStorage` `paperpulse_*`, `sessionStorage` y la caché del service worker); no hay cookies de analítica, publicidad ni de terceros, por lo que **no hay banner** (art. 22.2 LSSI-CE). El [contador de visitas](#contador-de-visitas-de-la-portada) es del servidor, sin cookies ni almacenamiento en el navegador: no le aplica el art. 22.2, pero sí el RGPD (interés legítimo), y está descrito en la privacidad (apartados 2, 3 y 6) y en el apartado 3 de cookies. Si se añade algo no necesario, habrá que pedir consentimiento. Las imágenes de noticias se cargan desde los servidores de los medios (ven la IP): está dicho en la política de privacidad.

## Home (Resumen) según la sesión
- **Visitante sin cuenta**: hero con el titular «Practica con precios y costes reales. Averigua si de verdad te compensa operar.» y un subtítulo honesto (saldo virtual, cotizaciones reales, comisión y deslizamiento con la cuenta gratuita —el modo local no cobra comisiones—, sin dinero real), el aviso «Simulador educativo con dinero virtual. No es asesoramiento financiero.» y los botones («Empezar gratis», «Probar demo»), las tres tarjetas diferenciales y, debajo, **actividad real de la comunidad** (`GET /api/community/pulse`): top 5 de la semana (alias y rentabilidad), los 3 últimos hilos del foro (título y categoría) y cuántos traders han operado esta semana. Cada bloque solo se pinta si tiene datos y la sección entera solo si hay top o hilos: con la comunidad vacía no aparece nada (ni ceros ni esqueleto), y si la petición falla tampoco. Hasta saber si hay sesión (`auth.ready`) no se pide nada, así que quien ya ha entrado no la descarga.
- **Visitante con cuenta local** (sin sesión): su panel personal de siempre y, debajo de los KPI, el mismo bloque público con una invitación a registrarse para guardar la cuenta.
- **Con sesión**: sin hero ni tarjetas diferenciales ni bloque público. Saludo con el alias del perfil (o el nombre si aún no hay), patrimonio y rentabilidad, contador de notificaciones sin leer (abre la campana) y tres accesos rápidos (Operar, Comunidad, Reto del mes), seguidos del gráfico de patrimonio y los KPI. Si aún no hay cuenta de práctica, una tarjeta invita a elegir el saldo.
- **Comparador «¿Te ha compensado operar?»** (solo con la cuenta del servidor; `renderCompare` en `views/dashboard.js`, lógica en `lib/benchmark.js`): desde el día en que se abrió la cuenta (`account.createdAt` de `/api/portfolio`, sin migración), compara su rentabilidad (en USD, ya con comisiones y deslizamiento) con no invertir (0 %) y con el S&P 500. El dato lo da `GET /api/benchmark/sp500` (`backend/market/benchmark.py`) con el proveedor de bolsa configurado: `^GSPC` con yfinance y el ETF `SPY` con Finnhub, que no ofrece índices; en ambos casos es rentabilidad de precio, sin dividendos. La base es el último cierre de una sesión terminada antes de abrir la cuenta y el final, la última vela. **Caché acotada**: una sola serie de cierres diarios en memoria (como mucho ~2.500 puntos desde 2020) que caduca a la hora; las fechas distintas se calculan sobre ella, solo se amplía si se pide una anterior a su inicio, y si el proveedor no da datos no se reintenta en 5 minutos. Sin dato, la tarjeta no se pinta. El texto es neutral («va X puntos por encima/por debajo») y recuerda que el rendimiento pasado no garantiza resultados futuros.
- **`/api/community/pulse`** (público, sin sesión): caché de 5 minutos en memoria y `Cache-Control: public, s-maxage=300, stale-while-revalidate` para el CDN. El top solo incluye cuentas que empezaron con **al menos 500 €** (lo elegido, o el saldo en USD convertido en las anteriores) y respeta privacidad y suspensiones; los hilos excluyen los automáticos por activo y incluyen las operaciones compartidas; `activeTraders7d` solo se publica a partir de 3 (si no, `null`). No lleva emails, ids de usuario ni saldos.

## Contador de visitas de la portada
Para que Administración → Resumen muestre cuánta gente entra, también sin sesión (`backend/visits.py`, migración `0014_visitas.sql`).
- **Qué cuenta**: solo `GET /` (la portada que sirve `serve_index`). No cuenta `/api`, los estáticos, `HEAD`, `/index.html` ni las precargas especulativas del navegador (`Sec-Purpose`/`Purpose: prefetch`).
- **Sin cookies y sin datos reconocibles**: identificador = HMAC-SHA256(secreto `visits` de `server_secrets`, día UTC | IP | user-agent), recortado a 32 caracteres, igual que `ai_usage`. La IP y el user-agent solo se usan en memoria para calcularlo; **no se guardan** (un test lo comprueba). Como el día entra en el cálculo, el identificador cambia cada día.
- **Tipos**: `bot` (user-agent vacío o de robot evidente: buscadores, previsualizaciones de enlaces, monitores, `curl`, librerías HTTP… no es perfecto y lo no reconocido cuenta como persona), `user` (cookie de sesión válida; una consulta de solo lectura a `sessions`) y `anon` (el resto). Quien entra sin sesión y luego con sesión el mismo día cuenta en los dos grupos.
- **Tablas**: `visit_days` (agregados por día y tipo: visitantes únicos y cargas; solo números) y `visit_seen` (hashes del día, solo para deduplicar). El cron diario borra los hashes de días anteriores y los agregados de más de 90 días.
- **No frena ni rompe la portada**: el registro va en un hilo con un tope de 300 ms (`visits.TIMEOUT`) y cualquier error (base caída, migración pendiente) se ignora sin registrar datos: la portada se sirve igual.
- **Ajuste** `visits_enabled` (`VISITS_ENABLED`, por defecto `true`; Administración → Integraciones → Contador de visitas).
- **Panel**: `GET /api/admin/overview` devuelve `visits: {today: {anon, user, bot, views, signups}, history: [{day, anon, user, bot, views}] (14 días), enabled}`, con `require_admin`. `views` no cuenta bots. Los registros del día son las cuentas creadas desde las 00:00 UTC.

## Clasificación
- **Patrimonio** = efectivo (incluido el reservado en órdenes) + posiciones abiertas valoradas al último precio (una sola consulta de precios para todos los activos: `prices.valuation_prices`). Un activo sin precio se valora a su coste y el resultado se marca como «aproximado».
- **Rentabilidad total** = patrimonio / saldo inicial − 1. Como no hay ingresos ni retiradas, es la rentabilidad real. **7 y 30 días** = patrimonio / patrimonio al inicio del periodo − 1, con las instantáneas diarias de `equity_snapshots`; si la cuenta se abrió dentro del periodo, la base es el saldo inicial.
- **Coste en serverless**: el cálculo se hace como mucho cada 5 minutos, al consultar la clasificación o un perfil. Rellena la tabla `leaderboard` y guarda la instantánea del día, y las lecturas solo consultan esa tabla. Privacidad, suspensión y mínimo de operaciones (`community_min_trades`, en el panel) se aplican al leer, así que tienen efecto inmediato. Para tener instantáneas aunque nadie consulte, un cron puede llamar a `POST /api/community/leaderboard/refresh` con la cabecera `X-Admin-Key`.
- **Limitaciones**:
  - Las instantáneas solo existen los días en que alguien recalcula; si falta la del inicio del periodo, se usa la más cercana y se marca como aproximada.
  - Se valora a último precio, sin descontar la comisión de una venta futura.
  - Los activos en euros usan el tipo de cambio actual.
  - El cálculo recorre todas las cuentas con operaciones; para miles de usuarios habría que repartirlo en lotes.

## Datos de mercado en vivo
## Próximos dividendos y luz roja de mercado
- **Próximos dividendos** (`GET /api/dividends`, `backend/market/dividends.py`; frontend `lib/dividends.js`): fecha ex-dividendo e importe por acción de las acciones del catálogo (los índices no reparten y no se piden). Usa `fetch_dividends` del proveedor de bolsa: con **yfinance**, `Ticker.info` (`exDividendDate`, `lastDividendValue`, `lastDividendDate`), una petición por acción, 4 en paralelo; el importe solo se da si ya está anunciado (`lastDividendDate` = fecha ex-dividendo) y si no se muestra «por confirmar» con el último pagado. Con **Finnhub** no hay datos (su plan gratuito no ofrece el calendario de dividendos) y no se pinta nada. Solo salen fechas de hoy en adelante. **Caché acotada**: una entrada con, como mucho, las 13 acciones del catálogo, durante 6 h; si el proveedor falla se reintenta a los 15 min y mientras tanto se sirve lo último bueno (máximo 24 h). 60 peticiones/min por IP.
  - **Ficha de Operar** (solo acciones): «Próximo dividendo: ex-dividendo el … · importe», con la nota de que cuenta la fecha ex-dividendo (hay que tener la acción antes de ese día) y de que la simulación no los abona.
  - **Resumen** (solo con la cuenta del servidor): tarjeta «Próximos dividendos» con las posiciones abiertas que tienen uno, de la fecha más cercana a la más lejana, y cuántos días faltan. Sin ninguna, no aparece. Es informativo: no es una recomendación y el saldo no cambia (ver *No se abonan dividendos* en las limitaciones de la cuenta del servidor).
- **Luz roja de mercado** (cabecera; `lib/market-alert.js` y `ui/market-alert.js`): un botón rojo que **solo aparece** cuando se cumple una regla objetiva sobre las cotizaciones en vivo que ya recibe el navegador. Sin IA y sin predicciones. Reglas (`backend/market/alert.py`, umbrales en el panel → Integraciones → Luz roja de mercado):
  - **BTC**: variación de 24 h ≤ −`market_alert_btc_drop_bps` (por defecto 1000 = −10 %).
  - **IBEX 35**: variación de la sesión frente al cierre anterior ≤ −`market_alert_index_drop_bps` (por defecto 400 = −4 %), **solo con la bolsa abierta** (fuera de horario la variación de la última sesión se queda fija).
  - Un umbral 0 desactiva la regla. Los umbrales viajan en `alertRules` de `/api/markets` (que el navegador consulta cada minuto), así que un cambio en el panel llega en un minuto.
  - Nunca cuenta con precios sembrados desde la caché local (`seeded`), que pueden tener horas: solo con datos en vivo. Se revisa cada 5 s con la pestaña visible.
  - Al pulsarlo, un popover con «Qué ha pasado» (activo, caída y umbral), una explicación neutral (reglas fijas, más volatilidad, no es una recomendación) y un enlace a Aprender. En móvil solo se ve el icono (el texto va en `aria-label`).

- El navegador abre **un único WebSocket** con el backend (`/ws/market`) usando el protocolo de Binance: `{"method":"SUBSCRIBE","params":["btcusdt@ticker","btcusdt@kline_1h","btcusdt@depth20@100ms","stocks"]}`. Recibe `{"stream": ..., "data": ...}`.
- `backend/market/stream.py` mantiene **una sola conexión con Binance** para todos los clientes, con recuento de referencias por stream y suscripciones agrupadas (límite de Binance: 5 mensajes/s). El stream `stocks` recibe las cotizaciones de bolsa cada 5 s.
- **Arranque sin esperar al relay**: el relay abre su conexión con Binance al primer suscriptor y el primer ticker tarda de 2 a 4 s (más con la función en frío). Por eso `lib/feed.js`, a la vez que abre el WebSocket, pide **una vez** `/api/crypto/tickers` por REST (responde en menos de 1 s) y pinta antes los últimos precios conocidos de la **caché local** (`paperpulse_crypto_cache`, caduca a los 10 min; la de bolsa, a las 6 h). Los precios sembrados llevan `seeded: true` hasta el primer dato real: se muestran, pero no cuentan como «en vivo» (no entran en el historial de patrimonio) ni emiten eventos de precios (no pueden disparar órdenes ni alertas locales). Un dato del WebSocket más reciente no lo pisa la respuesta REST, y la REST no cuenta para el estado «En vivo».
- **`realtime` en `/api/health`** dice si al navegador le conviene usar el WebSocket: falso con `REALTIME=false` o si el relay no consigue conectar con Binance (3 fallos seguidos, visibles como `upstreamFailures` en las métricas de administración); verdadero en el resto de casos, **también en Vercel** (el WebSocket funciona allí; se midió el 07/11/2026). Si es falso, o el WebSocket se cae, `lib/feed.js` cae a **REST cada 5 s**: `/api/crypto/tickers`, `/api/crypto/depth`, `/api/candles` y `/api/stocks/quotes`. El indicador de la cabecera muestra «Actualizando».

## Velas e histórico
- Temporalidades: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1D, 1S, 1M (`INTERVALS` en `lib/marketdata.js` y `backend/market/candles.py`, mismas claves que Binance).
- Rangos tipo web de bolsa: 1D, 5D, 1M, 3M, 6M, YTD, 1A, 5A, Todo (`RANGES`): eligen temporalidad y cargan histórico hasta cubrir el rango.
- **Histórico infinito**: `/api/candles?symbol&type&interval&limit&end` devuelve las velas anteriores a `end` y `hasMore`. Al desplazar el gráfico hacia la izquierda se piden páginas más antiguas (`chart.onReachStart` → `loadOlder` en `views/trade.js`). También hay «Ir a una fecha» (icono de calendario).
- Cripto: Binance (`data-api.binance.vision`, con `api.binance.com` de respaldo) tiene todo el histórico desde el listado del par.
- Bolsa: Yahoo Finance tiene límites de antigüedad intradía (1m: 30 días; 5m–30m: 60 días; 1h: 2 años; diario/semanal/mensual: completo). 3m/2h/4h se construyen agregando velas dentro de cada sesión.

## Usuarios, sesiones y roles
- Contraseñas con scrypt. La sesión es una cookie HttpOnly SameSite=Strict (`__Host-` y Secure en producción); en la BD solo se guarda el hash SHA-256 del token. Sesiones de 30 días.
- CSRF: todas las escrituras comprueban `Origin` y exigen JSON.
- Roles: `user` y `admin` (columna `users.role`). Un usuario desactivado pierde sus sesiones y no puede entrar.
- **Email verificado**: solo lo están las cuentas que entran con Google (u Okta) y el proveedor devuelve `email_verified=true`. Las de email y contraseña son «sin verificar»: tienen los límites de comunidad de las cuentas nuevas (10 mensajes y 3 hilos en sus primeras 24 h, sin enlaces) y nunca reciben el rol de administrador. Los administradores y las cuentas verificadas están exentos de esos límites.
- **Rol de administrador** (`ADMIN_EMAILS` solo aplica a cuentas verificadas): registrarse con email y contraseña **nunca** da el rol, ni siquiera con un email de la lista. Si alguien registró antes ese email con contraseña, al entrar el dueño con Google esa cuenta pierde la contraseña y las sesiones (ataque de pre-registro) y queda verificada. El panel tampoco permite hacer admin a una cuenta sin verificar. Comandos: `python -m backend.db admin <email>` (cuenta existente y verificada; `--force` solo en desarrollo) y `python -m backend.db admins` (lista los administradores).
- **Procedimiento en producción** (administrador único `<correo-del-administrador>`): 1) con `ADMIN_EMAILS` vacío, entra en la web con **Google** con ese correo (se crea la cuenta verificada); 2) con las variables de Turso cargadas, `python -m backend.db admin <correo-del-administrador>`; 3) `python -m backend.db admins` debe listar solo ese correo, «verificado»; 4) comprueba en Administración → Usuarios que no hay otros administradores y que no hay usuarios `@paperpulse.local`.

## Inicio de sesión con Google y Okta
- Se configuran en **Administración → Inicio de sesión** (o con las variables `OAUTH_*` de `.env`). El panel muestra la **URI de redirección** que hay que registrar en Google Cloud Console / Okta: `{APP_DOMAIN}/api/auth/oauth/{google|okta}/callback`.
- Flujo OpenID Connect *authorization code* con PKCE S256 (`backend/auth.py`): `/start` guarda `state`, `nonce` y `code_verifier` en la tabla `oauth_states` (un solo uso, 10 min) y liga el `state` al navegador con una cookie SameSite=Lax; `/callback` canjea el código en el servidor y valida `iss`, `aud`, `exp` y `nonce` del id_token.
- Se exige `email_verified`. Si ya existe una cuenta con ese email, se vincula (tabla `identities`). Si no existe y el registro está abierto, se crea una cuenta sin contraseña. Para borrar una cuenta sin contraseña el usuario escribe `ELIMINAR`.
- Al volver, el backend redirige a `/#/dashboard` (o `/?auth_error=código`; los textos están en `OAUTH_ERRORS` de `lib/auth.js`).

## Panel de administración (`#/admin`)
Visible solo para administradores (el backend lo comprueba en cada petición con `require_admin`).
- **Resumen**: usuarios, activos, sesiones, altas de 30 días, actividad de hoy (operaciones, foro, denuncias abiertas, mensajes sin leer), consumo de IA de hoy y de los últimos 14 días, integraciones y mercados. Todo sale de la base de datos salvo el relay de Binance, que es de la instancia que responde; por eso no se muestran uptime ni errores, que eran contadores en memoria por instancia. **Visitas**: visitantes únicos de hoy (sin sesión y con sesión), cargas de la portada y bots, registros nuevos del día y la gráfica de los últimos 14 días ([contador de visitas](#contador-de-visitas-de-la-portada)).
- **Auditoría**: `admin_log` (migración `0012`) anota cambios de rol, activar/desactivar, eliminar cuentas y cambios de ajustes; se muestra junto con `moderation_log`. Guarda solo ids y **nombres** de ajustes, nunca valores (pueden ser secretos) ni emails. Eliminar una cuenta exige escribir su email, también en el servidor.
- **Usuarios**: búsqueda (nombre, alias, email), filtros por rol, estado (activo, desactivado, suspendido) y email verificado, y orden por alta o último acceso. Las acciones de cada fila están en un menú «⋯»: dar/quitar admin, desactivar/activar, suspender/reactivar en la comunidad y eliminar; las no disponibles se ven atenuadas con el motivo (p. ej. «Hacer administrador» exige el email verificado). Siempre debe quedar al menos un admin activo y nadie puede degradarse a sí mismo. En móvil la tabla solo muestra usuario, rol y estado.
- **Mensajes**: búsqueda en motivo y texto (`%` y `_` se buscan tal cual), filtro de leídos, «Marcar todo como leído» y tarjetas plegables: abrir un mensaje sin leer lo marca como leído.
- **Estado en la URL**: los filtros y subsecciones se guardan en el hash, p. ej. `#/admin/users:status=suspended&order=login_asc`, `#/admin/moderation:section=resolved`, `#/admin/messages:status=unread` (`lib/admin-url.js`; se escribe con `history.replaceState`, sin ensuciar el historial). Un valor desconocido en la URL se ignora.
- **Inicio de sesión**: activar email+contraseña y el registro; configurar Google y Okta, con botón «Probar conexión».
- **Integraciones**: clave, modelo y esfuerzo de Anthropic (`anthropic_effort`, por defecto `low`: razona menos y gasta menos salida; «El del modelo» no envía el parámetro); proveedor de bolsa y clave de Finnhub. **Luz roja de mercado**: caída de BTC en 24 h y del IBEX 35 en la sesión que la encienden (`market_alert_btc_drop_bps`, `market_alert_index_drop_bps`, en puntos básicos; 0 la desactiva).

Precedencia de cada ajuste (`backend/settings.py`): valor guardado en el panel → variable de `.env` → valor por defecto. Los secretos nunca se devuelven al navegador (solo «configurado» y los 4 últimos caracteres). Están en claro en la base de datos: protege el token de Turso y, en local, `data/` (el archivo se crea con permisos 600).

## Asistente IA
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
| GET | `/api/markets` → `alertRules` | Además del estado de las bolsas, las reglas activas de la luz roja: `[{symbol, name, window: "24h"\|"session", dropPct}]` |
| GET | `/api/dividends` | Próximos dividendos del catálogo: `{data: {SÍMBOLO: {exDate, amount\|null, lastAmount\|null, currency}}, updatedAt}`; `data` vacío sin datos. Público, 60/min por IP, caché de 6 h |
| GET | `/api/benchmark/sp500?since=` | Rentabilidad del S&P 500 desde `since` (epoch en segundos, desde 2020) para el comparador del Resumen: `{available, since, startDate, startClose, lastClose, asOf, returnPct, source}` o `{available: false}`. Público, 60/min por IP, caché de 1 h |
| GET/POST | `/api/chat/challenge` · `/api/chat` | Asistente (SSE) |
| WS | `/ws/market` | Streams en vivo (protocolo de Binance + `stocks`) |
| GET | `/api/auth/providers` | Métodos de acceso activos |
| POST | `/api/auth/register` · `/login` · `/logout` | Sesión con email |
| GET/DELETE | `/api/auth/me` | Usuario actual (`role`, `hasPassword`) · borrar cuenta |
| GET | `/api/auth/oauth/{google\|okta}/start` · `/callback` | Inicio de sesión OIDC |
| GET/PUT | `/api/data` | Copia de los datos del modo local (alertas, favoritos, ajustes) |
| GET | `/api/portfolio` | Cuenta del servidor: saldo, posiciones, órdenes pendientes, operaciones cerradas y eventos (resuelve antes las pendientes). Sin cuenta: `{needsSetup: true, config}` |
| POST | `/api/portfolio/start` | `{amount, currency: "EUR"}` crea la cuenta con el saldo elegido (50 a 1.000.000 €); 409 si ya existe |
| GET/POST | `/api/orders?status=&limit=&before=` | Historial paginado · `{clientOrderId, symbol, side, type, quantity, triggerPrice?, journal?}` |
| DELETE/PATCH | `/api/orders/{id}` | Cancelar una orden pendiente · `{journal}` notas del diario |
| GET/PUT | `/api/community/me` | Mi perfil `{alias, bio, isPrivate}` y si estoy suspendido |
| GET | `/api/community/profiles?q=` · `/api/community/profiles/{alias}` | Buscar perfiles públicos · perfil público |
| POST/DELETE | `/api/community/profiles/{alias}/follow` | Seguir · dejar de seguir |
| GET | `/api/community/following` · `/api/community/feed?before=` | A quién sigo · feed |
| GET | `/api/community/leaderboard?period=7d\|30d\|total&page=` | Clasificación |
| GET | `/api/community/pulse` | Pulso público para la home sin sesión: `{topWeek[≤5], latestThreads[≤3], activeTraders7d, empty}` (caché 5 min) |
| POST | `/api/community/leaderboard/refresh` | Recalcular (admin o `X-Admin-Key`, para un cron) |
| GET | `/api/forum/categories` · `/api/forum/categories/{slug}?sort=top\|recent&page=` | Categorías · hilos |
| GET | `/api/forum/assets/{symbol}` · `/api/forum/threads/{id}?sort=&page=` | Hilo de un activo · hilo con respuestas |
| POST | `/api/forum/threads` · `/api/forum/threads/{id}/posts` · `/api/forum/share` | Abrir hilo · responder · compartir operación |
| DELETE · PUT · POST | `/api/forum/posts/{id}` · `/vote {value}` · `/report {reason, details}` | Borrar lo mío · votar (1, -1, 0) · denunciar |
| GET · POST | `/api/admin/reports?status=` · `/api/admin/posts/{id}/hide\|restore\|dismiss` | Moderación de mensajes |
| POST · GET | `/api/admin/users/{id}/suspend\|unsuspend` · `/api/admin/moderation-log` | Suspensiones · registro |
| GET | `/api/admin/overview` · `/api/admin/users?q=&role=&status=&verified=&sort=&dir=&limit=&offset=` | Panel: métricas · usuarios (`role` admin\|user, `status` active\|disabled\|suspended, `verified` yes\|no, `sort` created\|login, `dir` asc\|desc; un valor no válido da 400) |
| PATCH/DELETE | `/api/admin/users/{id}` | `{role, disabled}` · eliminar `{confirmEmail}` (debe coincidir con el email de la cuenta) |
| GET | `/api/admin/badges` | Pendientes para los contadores de las pestañas: `{openReports, unreadMessages}` |
| GET | `/api/admin/audit?before=` | Auditoría (administración + moderación), páginas de 50 con cursor `tiempo.origen.id` |
| GET/PUT | `/api/admin/settings` | Ajustes `{values: {clave: valor\|null}}` (`null` = volver a `.env`) |
| POST | `/api/admin/oauth/{provider}/test` | Comprueba el documento OpenID del proveedor |
| POST | `/api/contact` | Formulario de contacto `{reason, message}` (el campo `website` es un honeypot) |
| GET · POST · PATCH · DELETE | `/api/admin/messages?status=&q=&page=` · `/api/admin/messages/read-all` · `/api/admin/messages/{id}` | Bandeja de contacto (con búsqueda) · marcar todo como leído · `{read}` · borrar |
| POST | `/api/account/terms` · GET `/api/account/export` | Aceptar términos y edad · descargar mis datos (JSON) |
| GET · POST · DELETE | `/api/notifications` · `/read` · `/clear` · `/alert` · `/{id}` | Notificaciones; `/alert` registra una alerta de precio disparada en el navegador |
| GET · POST | `/api/retention/summary` · `/api/retention/onboarding` | Logros, racha y onboarding |
| GET · POST | `/api/challenge` · `/leaderboard` · `/join` · `/portfolio` · `/orders` | Reto mensual (mismas reglas que la cuenta normal) |
| GET · POST | `/api/cron/daily` | Tareas diarias; exige `X-Admin-Key` o `Authorization: Bearer $CRON_SECRET` |
| GET | `/api/health` | Estado; con sesión admin o `X-Admin-Key`, métricas |

## Diseño: Aurora

La identidad visual está al final de `frontend/css/app.css`, en el bloque «AURORA», **sin capa** para que gane a las capas de arriba. Solo cambia color, forma, sombra y movimiento; la maquetación sigue en las capas.

- **Fondo**: una única capa fija (`body::before`) con tres degradados que se mueve despacio con `transform`. **Tarjetas**: translúcidas con borde de luz, **sin `backdrop-filter`** (detrás solo hay un degradado suave; desenfocarlo es lo más caro en móviles modestos). El desenfoque real queda para lo que flota sobre contenido: cabecera, barra inferior del móvil, diálogos, menús y avisos. Si añades una superficie nueva, sigue esa regla.
- **Colores**: acento violeta → cian (`--grad`); verde y rojo solo para subidas y bajadas. El rojo (`--down`) tira a frambuesa para no confundirse con el violeta ni con el ámbar de los avisos. Tema claro y oscuro con los mismos tokens.
- **Tipografía**: Sora (`--display`) en titulares y cifras grandes; Inter en el resto y en todo número que cambie en vivo (cifras tabulares).
- **Barra inferior del móvil** (`ui/tabbar.js`, física en `lib/tab-physics.js`): un globo de cristal bajo la pestaña activa que se arrastra con el dedo; al soltarlo se ajusta a la pestaña más cercana y cambia de pantalla. Se mueve con un muelle y **solo con `transform`** (sin desenfoques nuevos). Las pestañas siguen siendo enlaces: tocar, teclado (flechas, Inicio/Fin e Intro) y lector de pantalla funcionan igual, y sin JavaScript queda el estado activo normal. `touch-action: none` en la barra evita que el gesto desplace la página; un arrastre que empieza a menos de 20 px del borde de la pantalla se ignora para no chocar con el gesto de «atrás». Con «reducir movimiento» el globo salta directamente.
- **Gráficos** (`lib/chart-fx.js`, usado por `lib/charts.js`): las velas llevan un brillo en degradado (luz arriba, sombra abajo y un filo de luz en las anchas), el último precio y el último valor del patrimonio tienen un halo, la línea de patrimonio un resplandor, y los minigráficos y las sparklines un relleno en degradado. Detrás del lienzo hay un resplandor Aurora que es un fondo CSS del contenedor (estático). **Reglas de rendimiento**: nada de `shadowBlur`, filtros, lienzos extra ni animaciones propias; como mucho un degradado por efecto y fotograma; el brillo se apaga solo con velas de menos de 3 px o con más de 320 en pantalla. La intensidad cambia con el tema para que la punta menos contrastada de una vela siga por encima de 3:1 sobre el fondo. Con «reducir movimiento» el punto del último precio no late. Si añades un efecto, sigue esas reglas (un test las comprueba).
- **Botones táctiles**: tienen canto (`box-shadow: 0 3px 0 var(--btn-edge)`) y se hunden al pulsar.
- **Movimiento**: entrada de cada vista, cifra del patrimonio que cuenta hasta su valor (`lib/motion.js`), destello al cambiar un precio y celebración breve en la primera compra y al cumplir un reto de la semana (`ui/celebrate.js`: un aviso y un destello, sin monedas ni premios; solo salta si se acaba de operar). Todo respeta `prefers-reduced-motion`.

## Migraciones

Ficheros SQL numerados en `backend/migrations/` (`0001_inicial.sql`... `0014_visitas.sql`), solo aditivos. Se aplican al arrancar o con `python -m backend.db migrate`; `status` muestra la versión. Cada tabla lleva encima un comentario que explica para qué sirve. Nunca edites la parte SQL de una migración ya aplicada: crea la siguiente.

## Producción (Docker y Vercel)

```bash
docker compose up --build
```

- Define `ENV=production` y `APP_DOMAIN=https://tu-dominio` en `.env`: activa HSTS, cookies `__Host-`/Secure, `upgrade-insecure-requests`, quita `localhost` de la CSP y fija las URIs de redirección de OAuth. También rellena canonical, `og:url` y `og:image`: `frontend/index.html` lleva el marcador `https://app-domain.invalid` (un dominio que nunca existe) y `serve_index` lo sustituye por `APP_DOMAIN` al servir `/`, también en Vercel, donde la función sirve el index generado; un test comprueba que la salida de producción no contiene ni el marcador ni otros dominios.
- La base de datos vive en el volumen `paperpulse-data` (`/app/data`).
- Detrás de un proxy, añade su IP a `TRUSTED_PROXIES` y reenvía también las conexiones WebSocket de `/ws/market`.
- **Vercel** (`vercel.json`): los estáticos salen del CDN desde `public/` (generado por `npm run build:static`, con el hash en el nombre y `Cache-Control: immutable`); la función solo sirve `/` (con el dominio real) y `/api`. Como el CDN no pasa por el backend, `vercel.json` repite sus cabeceras de seguridad (`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; un test comprueba que coinciden con `SECURITY_HEADERS` de `backend/app.py`), limita JS, CSS y fuentes al mismo origen y pone una CSP con `sandbox` a `/img/`. La CSP de la app la sigue poniendo solo la función. En local y con Docker no se usa `public/`: se sirve `frontend/` tal cual, sin build. El relay WebSocket funciona en Vercel y, si se cae, el frontend usa el respaldo REST. Necesita **Turso** para que los datos persistan; sin `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` usa `/tmp`, que es efímero.

## Base local y dev containers

SQLite **no funciona en carpetas compartidas con el anfitrión, de red o de máquina virtual**. En un dev container sobre Windows o macOS, `/workspaces` es virtiofs: el número de inodo de un fichero cambia tras el primer `fsync`, y SQLite corrompe la base (modo WAL: «database disk image is malformed») o la trata como movida (modo DELETE: «attempt to write a readonly database»). Por eso:
- Sin `DATABASE_PATH`, si `data/` está en uno de esos sistemas de ficheros, la base se crea en el disco del contenedor: `~/.local/share/paperpulse/paperpulse.db`.
- **Un candado por proceso** (`_LOCAL_LOCK` en `backend/db.py`) serializa el acceso a la base local. El cliente libsql espera los bloqueos de SQLite sin soltar el GIL, así que dos hilos que escribían a la vez dejaban el servidor congelado 5 s y la petición acababa en 500 («database is locked»). Con Turso no se usa.
- Con un `DATABASE_PATH` en uno de ellos, el servidor no arranca y lo explica. Usa una ruta del contenedor, p. ej. `DATABASE_PATH=~/paperpulse/prueba.db`.
- `python -m backend.db status` muestra también la integridad de la base local.

## Despliegue a producción sin riesgo

1. **Copia de seguridad de Turso**: `turso db shell paperpulse .dump > backup-$(date +%F).sql` y, si quieres, una copia viva `turso db create paperpulse-copia --from-db paperpulse`. Guarda el `.sql` fuera del repositorio.
2. **Variables en Vercel** (producción): `ENV=production`, `APP_DOMAIN=https://tu-dominio`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_API_KEY` y `CRON_SECRET` (mismo valor, `openssl rand -hex 32`), y el inicio de sesión con Google (`OAUTH_GOOGLE_ENABLED=true`, `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`, con la URI `https://tu-dominio/api/auth/oauth/google/callback` registrada en Google Cloud Console). No definas `DATABASE_PATH`; deja `ADMIN_EMAILS` vacío.
3. **Migraciones** antes de desplegar: `vercel env pull .env.production.local --environment=production`, cárgalo (`set -a; . ./.env.production.local; set +a`) y ejecuta `python -m backend.db status` (verás las pendientes) y `python -m backend.db migrate`. Son solo aditivas: no borran ni bloquean cuentas existentes.
4. **Desplegar**: fusiona el pull request en `main` y Vercel despliega producción solo (ver [flujo de trabajo con git](flujo-git.md)); `vercel --prod` queda como alternativa manual. Comprueba `GET /api/health`, que el cron aparece en Vercel → Settings → Cron Jobs y que `curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/daily` devuelve 200.
5. **Tu administrador**: entra en la web con **Google** con `<correo-del-administrador>`, acepta los términos y, con las variables de producción cargadas, `python -m backend.db admin <correo-del-administrador>`. Comprueba con `python -m backend.db admins` (solo ese correo, «verificado») y `python -m backend.db users` (ningún `@paperpulse.local`).
6. **Antes de abrir al público**: comprueba que `frontend/js/lib/legal-content.js` no tiene `[PENDIENTE: …]` y pasa los textos por revisión legal; crea una cuenta de prueba por email, comprueba que no es admin y bórrala desde el menú.

## Turso y Vercel

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

Si das las variables de Turso también a `preview`, **las vistas previas usan la base de producción** y aplican en ella las migraciones de la rama al arrancar. Para probar una migración sin riesgo, crea una base aparte (`turso db create paperpulse-preview --from-db paperpulse`) y asígnala solo a `preview`.

Las migraciones se aplican solas al arrancar la función. Para aplicarlas a mano: `set -a; . ./.env.local; set +a; python -m backend.db migrate`.
