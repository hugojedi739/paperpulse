# PaperPulse — guía para asistentes de IA

@README.md

Antes de terminar un cambio:
- `python -m unittest discover -s tests` y `npm test` deben pasar.
- Si cambias algo en `frontend/`, ejecuta `npm run build:static` y versiona `public/` y `backend/templates/index.html` (un test lo comprueba).
- El navegador nunca llama a servicios de terceros: añade un endpoint en `backend/` y llámalo con `frontend/js/lib/api.js`.
- Respeta la CSP: sin scripts ni estilos inline en el frontend.
