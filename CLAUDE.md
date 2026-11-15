# PaperPulse — guía para asistentes de IA

@README.md
@docs/arquitectura.md
@docs/flujo-git.md
@docs/referencia.md

**Ramas y pull requests**: cada cambio va en su propia rama (`feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…` o `style/…`, creada desde `main`) y llega a `main` solo mediante un pull request, que fusiona la persona tras revisarlo y ver la vista previa de Vercel; nunca hagas push a `main`, ni fusiones, ni uses `--force`, ni borres ramas remotas, ni cambies la visibilidad del repositorio. `.claude/settings.json` permite sin preguntar crear ramas, `git add`, `git commit`, `git push` de ramas con esos prefijos y `gh pr create`, y prohíbe lo demás (por eso una rama no puede llevar `main` en el nombre). El workflow `.github/workflows/tests.yml` ejecuta los tests en cada pull request y en cada push a `main`.

Antes de terminar un cambio:
- `python -m unittest discover -s tests` y `npm test` deben pasar.
- Si cambias algo en `frontend/`, ejecuta `npm run build:static` y versiona `public/` y `backend/templates/index.html` (un test lo comprueba).
- El navegador nunca llama a servicios de terceros: añade un endpoint en `backend/` y llámalo con `frontend/js/lib/api.js`.
- Respeta la CSP: sin scripts ni estilos inline en el frontend.
- Prueba siempre con la base local: `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` vacías (los tests ya usan una base temporal). No despliegues sin que lo pida la persona.
- Una migración nueva va en `backend/migrations/` con el siguiente número y un comentario sobre cada tabla; nunca edites una ya aplicada.
- Un ajuste o variable de entorno nuevos se documentan en `.env.example` y en `SCHEMA` de `backend/settings.py`.
- En producción nunca se devuelve una traza ni un email ajeno al cliente; toda ruta `/api/admin/*` usa `require_admin` (un test lo comprueba).
