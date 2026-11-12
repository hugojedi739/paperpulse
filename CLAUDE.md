# PaperPulse — guía para asistentes de IA

@README.md
@docs/arquitectura.md
@docs/flujo-git.md
@docs/referencia.md

Antes de terminar un cambio:
- `python -m unittest discover -s tests` y `npm test` deben pasar.
- Si cambias algo en `frontend/`, ejecuta `npm run build:static` y versiona `public/` y `backend/templates/index.html` (un test lo comprueba).
- El navegador nunca llama a servicios de terceros: añade un endpoint en `backend/` y llámalo con `frontend/js/lib/api.js`.
- Respeta la CSP: sin scripts ni estilos inline en el frontend.
- Prueba siempre con la base local: `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` vacías (los tests ya usan una base temporal). No despliegues sin que lo pida la persona.
- Una migración nueva va en `backend/migrations/` con el siguiente número y un comentario sobre cada tabla; nunca edites una ya aplicada.
- Un ajuste o variable de entorno nuevos se documentan en `.env.example` y en `SCHEMA` de `backend/settings.py`.
- En producción nunca se devuelve una traza ni un email ajeno al cliente; toda ruta `/api/admin/*` usa `require_admin` (un test lo comprueba).
