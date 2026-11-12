# PaperPulse

Simulador de trading (*paper trading*) con **cotizaciones reales** de criptomonedas (Binance) y de acciones de Wall Street e IBEX 35. Se practica con saldo virtual: comprar y vender a precio de mercado, colocar órdenes límite y stop, crear alertas, analizar gráficos de velas con indicadores y llevar un diario de operaciones. Incluye comunidad, retos, un asistente con IA (Claude) y un panel de administración.

**Nada de dinero real**: no hay brókeres ni órdenes reales. Es un proyecto educativo; no es asesoramiento financiero.

**Documentación:** [Arquitectura](docs/arquitectura.md) · [Flujo de trabajo con git](docs/flujo-git.md) · [Referencia detallada (funcionamiento, API, producción)](docs/referencia.md)

## Funciones

- **Mercados en vivo**: cripto y bolsa con precios en tiempo real, libro de órdenes, búsqueda (Ctrl+K), noticias financieras y estado de las bolsas (horarios y festivos).
- **Operar**: órdenes a mercado, límite y stop, con comisión y deslizamiento configurables. Gráfico de velas de 1 minuto a 1 mes, con histórico infinito e indicadores (medias, Bollinger, RSI).
- **Dos modos de cuenta**: sin sesión, todo vive en el navegador; con sesión, la cuenta está en el servidor, que decide siempre el precio. El saldo inicial lo elige cada persona (de 50 a 1.000.000 €).
- **Diario y estadísticas**: notas por operación, calendario de resultados, tasa de aciertos, pérdida máxima y resultado por semanas.
- **Comunidad**: perfiles con alias, foro con votos, operaciones compartidas, seguidores, clasificación por rentabilidad y moderación.
- **Retención**: notificaciones, logros, racha de días, reto mensual con clasificación propia, retos personales de la semana y una sección para aprender (lecciones y glosario).
- **Asistente IA**: chat con Claude en streaming, con límites de gasto y un modo de demostración si no hay clave.
- **Cuentas**: email y contraseña, Google u Okta (OpenID Connect con PKCE), descarga de datos y borrado de la cuenta (RGPD).
- **Administración**: métricas, usuarios, moderación, mensajes de contacto, auditoría y ajustes (inicio de sesión, IA, proveedor de bolsa, simulación).
- **PWA instalable** con temas claro y oscuro y una barra inferior táctil en el móvil.

## Tecnologías

| Parte | Tecnología |
|---|---|
| Backend | Python 3.13, [Starlette](https://www.starlette.io/) + Uvicorn, `requests`, `websockets`, `yfinance`, SDK de Anthropic |
| Base de datos | [libSQL](https://github.com/tursodatabase/libsql): Turso en producción, fichero compatible con SQLite en local. SQL directo, sin ORM |
| Frontend | HTML, CSS (`@layer`, variables) y JavaScript con módulos ES nativos, sin framework |
| Gráficos e iconos | TradingView Lightweight Charts 5, iconos Lucide (sprite SVG), fuentes Inter, Sora y JetBrains Mono |
| Tests | `unittest` (Python) y `node --test` (JavaScript) |
| Despliegue | Vercel (función Python + CDN para `public/`) o Docker |

## Estructura

```
server.py                 Punto de entrada: expone backend.app:app (python server.py, uvicorn o Vercel)
backend/                  API y lógica del servidor (Starlette)
  app.py                  Rutas, CSP, cabeceras de seguridad y ciclo de vida
  config.py               Variables de entorno estáticas (.env)
  settings.py             Ajustes editables en el panel (BD > .env > valor por defecto); SCHEMA de cada ajuste
  db.py                   Conexión libSQL/Turso, migraciones, usuarios, sesiones y CLI (python -m backend.db)
  http.py                 CSRF, JSON, límites, cookie de sesión y require_admin
  security.py             IP real del cliente y límites por minuto en memoria
  auth.py                 /api/auth/*: email y contraseña, Google y Okta; copia de datos /api/data
  account.py              Términos, descarga de mis datos y borrado de la cuenta
  admin.py                /api/admin/*: métricas, usuarios, ajustes y prueba de OAuth
  admin_log.py            Registro de auditoría del panel
  admin_stats.py          Actividad de hoy para el Resumen del panel
  ai_usage.py             Uso y límites del asistente IA (en la base de datos)
  chat.py                 /api/chat: asistente con Claude (SSE) y desafío anti-bot
  chat_fixed.py           Respuestas fijas para los botones de sugerencia del chat
  contact.py              Formulario de contacto y bandeja del panel
  news.py                 /api/news: noticias RSS filtradas
  market/                 Velas, cripto (Binance, CoinGecko), bolsa (Yahoo/Finnhub), divisas, horarios, búsqueda y relay /ws/market
  trading/                Cuenta de práctica del servidor: reglas en enteros, precios, libro contable y API
  community/              Perfiles, foro, clasificación, pulso público y moderación
  retention/              Notificaciones, logros, racha, reto mensual, onboarding y cron diario
  migrations/             Migraciones SQL numeradas (0001_… a 0013_…); se aplican al arrancar
  templates/index.html    index.html para Vercel, generado por npm run build:static (no editar)
frontend/                 La aplicación web que se sirve en local y con Docker (sin build)
  index.html              Shell de la app, sin scripts ni estilos inline
  css/app.css             Sistema de diseño (capas, temas claro y oscuro) y estilo Aurora
  js/main.js              Arranque, enrutado por hash, cabecera y atajos
  js/theme-init.js        Aplica el tema guardado antes del primer pintado
  js/lib/                 Lógica sin interfaz: cliente de la API, datos en vivo, cuenta, trading, formato, DOM seguro...
  js/ui/                  Piezas compartidas: diálogos, chat, paleta de comandos, barra inferior, bienvenida, visita guiada...
  js/views/               Una vista por pantalla: dashboard, trade, markets, news, journal, stats, community, challenge,
                          learn, legal, contact y admin (con audit, messages y moderation)
  img/                    Iconos de la PWA, imagen de Open Graph y sprite icons.svg (generado)
  vendor/                 Lightweight Charts y fuentes, generados por npm run vendor (no editar)
  manifest.json · sw.js   PWA: manifiesto y service worker
public/                   Copia de frontend/ con hash en los nombres para el CDN de Vercel (generada; no editar)
scripts/
  build-static.mjs        Genera public/ y backend/templates/index.html
  vendor.mjs              Copia dependencias de node_modules y genera el sprite de iconos
  screenshots.mjs         Capturas de todas las vistas con Playwright (servidor en marcha)
tests/                    test_*.py (unittest, con base temporal) y *.test.js (node --test)
docs/                     Arquitectura, flujo de trabajo con git y referencia detallada
.devcontainer/ · .vscode/ Dev container (Python 3.13 + Node 22) y depuración con F5
Dockerfile · docker-compose.yml   Imagen y despliegue con Docker
vercel.json               Función, cron diario y cabeceras de seguridad del CDN
.env.example              Plantilla comentada de variables de entorno
```

`data/` (base local), `node_modules/` y `screenshots/` se crean solos y están en `.gitignore`.

## Arranque en local

Requisitos: Python 3.13 y Node 22 (Node solo para los tests y los scripts). El dev container ya los trae.

```bash
cp .env.example .env               # opcional: ANTHROPIC_API_KEY, Google...
pip install -r requirements.txt
npm install                        # solo para npm run vendor y npm run screenshots
python -m backend.db demo          # SOLO desarrollo: crea usuarios de prueba
python server.py                   # http://localhost:8000
```

En local se sirve `frontend/` tal cual: basta con recargar el navegador para ver los cambios. Con las variables de Turso vacías, la base es un fichero local que se crea solo (`data/paperpulse.db`, o `~/.local/share/paperpulse/` si `data/` está en una carpeta compartida con el anfitrión; ver [base local](docs/referencia.md#base-local-y-dev-containers)).

Usuarios de prueba que crea `demo` (contraseñas públicas, **solo para desarrollo**; el comando se niega a ejecutarse con Turso, con `ENV=production` o en Vercel):

| Email | Contraseña | Rol |
|---|---|---|
| `demo@paperpulse.local` | `demo1234` | usuario, con datos de ejemplo |
| `admin@paperpulse.local` | `admin1234` | administrador |

En VS Code, **F5 → «App completa (servidor + Chrome)»** arranca el servidor con depurador y abre el navegador.

## Variables de entorno

La plantilla completa y comentada está en [`.env.example`](.env.example). Todas son opcionales en local. Las marcadas con ⚙ también se editan en Administración, y lo guardado allí tiene prioridad sobre `.env`.

| Variable | Para qué | Por defecto |
|---|---|---|
| `PORT` · `DEBUG` | Puerto del servidor de desarrollo · modo depuración (en producción siempre falso) | `8000` · `False` |
| `ENV` | `production` activa HSTS, cookies `__Host-`/Secure y la CSP sin `localhost` | vacío |
| `APP_DOMAIN` | Dominio público (canonical, Open Graph y URIs de OAuth). **Obligatoria en producción** | vacío |
| `SERVE_FRONTEND` · `REALTIME` | Servir `frontend/` desde el backend · ofrecer el WebSocket en vivo | `true` · `true` |
| `ALLOWED_ORIGINS` · `TRUSTED_PROXIES` | CORS (solo con el frontend en otro dominio) · proxies de los que fiarse para la IP real | localhost |
| `TURSO_DATABASE_URL` · `TURSO_AUTH_TOKEN` | Base persistente en Turso. Vacías = fichero local | vacías |
| `DATABASE_PATH` | Ruta del fichero local (nunca en una carpeta compartida o de red) | `data/paperpulse.db` |
| `ADMIN_EMAILS` | Emails verificados (Google/Okta) que reciben el rol de admin. Vacía en producción | vacía |
| `ADMIN_API_KEY` · `CRON_SECRET` | Métricas de `/api/health` y cron diario. **Mismo valor en ambas** | vacías |
| `AUTH_PASSWORD_ENABLED` · `AUTH_REGISTRATION_ENABLED` ⚙ | Acceso con email y contraseña · registro abierto | `true` |
| `OAUTH_GOOGLE_*` · `OAUTH_OKTA_*` ⚙ | Inicio de sesión con Google y Okta (`_ENABLED`, `_CLIENT_ID`, `_CLIENT_SECRET`; Okta también `_ISSUER`) | desactivados |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` · `ANTHROPIC_EFFORT` ⚙ | Asistente IA. Sin clave responde en modo demostración | vacía · `claude-haiku-5-5` · `low` |
| `ANTHROPIC_MAX_TOKENS` | Tokens máximos por respuesta del asistente | 1800 |
| `DAILY_GLOBAL_TOKEN_LIMIT` · `DAILY_USER_TOKEN_LIMIT` · `DAILY_USER_CHAT_REQUESTS` | Límites diarios de gasto de la IA (global, por cliente y preguntas por cliente) | 1 000 000 · 100 000 · 100 |
| `TRADING_INITIAL_BALANCE_USD` · `TRADING_FEE_BPS` · `TRADING_SLIPPAGE_BPS` ⚙ | Saldo de respaldo, comisión y deslizamiento (en puntos básicos) | 10 000 · 10 · 5 |
| `CHALLENGE_INITIAL_BALANCE_USD` · `COMMUNITY_MIN_TRADES` ⚙ | Saldo del reto mensual · operaciones mínimas para la clasificación | 10 000 · 5 |
| `STOCK_DATA_PROVIDER` · `FINNHUB_API_KEY` ⚙ | Proveedor de bolsa: `yfinance` (sin clave) o `finnhub` | `yfinance` |

Para probar siempre con la base local, deja vacías `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. Una variable nueva se documenta en `.env.example` y en `SCHEMA` de `backend/settings.py`.

## Tests

```bash
python -m unittest discover -s tests   # backend: usa siempre una base temporal, nunca Turso
npm test                               # frontend: lógica de lib/ y comprobación de public/
```

Si cambias algo en `frontend/`, ejecuta `npm run build:static` y versiona `public/` y `backend/templates/index.html`: un test falla si no coinciden con `frontend/`.

## Despliegue

El proyecto se despliega en **Vercel**, conectado al repositorio de GitHub:

- **Cada rama** que se sube obtiene una **vista previa** con su propia URL, que Vercel enlaza en el pull request.
- **`main` es producción**: al fusionar un pull request en `main`, Vercel publica la nueva versión.

En Vercel no se compila nada: los estáticos salen de `public/` (versionado) y la función Python (`server.py`) sirve `/` y `/api`. Las migraciones se aplican solas al arrancar la función. El cron diario (`vercel.json`, 04:00 UTC) llama a `/api/cron/daily`.

Producción necesita al menos `ENV=production`, `APP_DOMAIN`, las variables de Turso y `ADMIN_API_KEY` = `CRON_SECRET`. El procedimiento completo (copia de seguridad, migraciones, primer administrador) está en la [referencia](docs/referencia.md#despliegue-a-producción-sin-riesgo), y el día a día con ramas en el [flujo de trabajo con git](docs/flujo-git.md).

También funciona con Docker: `docker compose up --build`, con la base en el volumen `paperpulse-data`.

## Comandos

| Comando | Qué hace |
|---|---|
| `python server.py` | Servidor de desarrollo en `PORT` (8000) |
| `python -m unittest discover -s tests` · `npm test` | Tests del backend · del frontend |
| `npm run build:static` | Regenera `public/` y `backend/templates/index.html` (tras tocar `frontend/`) |
| `npm run vendor` | Actualiza Lightweight Charts, fuentes y el sprite de iconos |
| `npm run screenshots` | Capturas de todas las vistas (servidor en marcha y Chromium) |
| `python -m backend.db migrate` · `status` | Aplica las migraciones pendientes · versión del esquema e integridad |
| `python -m backend.db demo` · `users` · `admins` | Usuarios de prueba · listar usuarios · listar administradores |
| `python -m backend.db admin <email>` | Da el rol de administrador a una cuenta verificada |
