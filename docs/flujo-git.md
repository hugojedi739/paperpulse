# Flujo de trabajo con git

## Ramas

| Rama | Para qué | Despliegue en Vercel |
|---|---|---|
| `main` | Lo que está en producción. Solo recibe cambios por pull request. | **Producción** |
| `feat/…`, `fix/…`, `docs/…`, `chore/…`, `refactor/…`, `test/…`, `style/…` | Un cambio concreto, creado desde `main`. | **Vista previa** con su propia URL |

`main` está protegida por un ruleset de GitHub: solo recibe cambios por pull request. Comprueba una vez en Vercel → Settings → Git que la *Production Branch* es `main`, y en GitHub → Settings que la rama por defecto también es `main`.

## Paso a paso

```bash
git switch main && git pull                    # partir siempre de main al día
git switch -c feat/mi-cambio                   # rama nueva
# ...cambios...
python -m unittest discover -s tests && npm test
npm run build:static                           # solo si has tocado frontend/
git add -A && git commit -m "feat(zona): qué cambia y por qué"
git push -u origin feat/mi-cambio              # Vercel crea la vista previa
```

1. Abre un pull request contra `main`. Vercel comenta en él el enlace de la vista previa.
2. Prueba la vista previa y revisa el diff.
3. Fusiona el pull request: Vercel despliega `main` en producción.
4. Borra la rama, en GitHub y en local (`git branch -d feat/mi-cambio`).

## Mensajes de commit

Formato `tipo(zona): resumen en español`, por ejemplo `fix(db): …` o `feat(móvil): …`. Los tipos son `feat`, `fix`, `docs`, `style`, `refactor`, `test` y `chore`.

## Antes de fusionar

- `python -m unittest discover -s tests` y `npm test` pasan.
- Si se tocó `frontend/`, `public/` y `backend/templates/index.html` están regenerados y versionados.
- Una migración nueva va en un fichero nuevo; ninguna aplicada se edita.
- Un ajuste nuevo está en `.env.example` y en `SCHEMA` de `backend/settings.py`.
- No se versiona nada de `.env*` (salvo `.env.example`), `data/` ni `screenshots/`.

## Commits

Los commits llevan el email `noreply` de GitHub (`<id>+<usuario>@users.noreply.github.com`), nunca el personal. Los pull requests de funciones los fusiona solo la persona, tras revisarlos; ni la IA ni nadie los fusiona por su cuenta.

## Cuidado con la base de datos en las vistas previas

**Preview y Production usan bases de Turso distintas**, así que probar en una vista previa no toca los datos reales. Esto solo es así mientras las variables de Turso de `preview` apunten a la base aparte; si se dieran las de producción también a `preview`, **la vista previa usaría la base de producción**: lo que hagas en ella (registrarte, operar, publicar) queda en los datos reales, y una migración de la rama se aplica en producción al arrancar la vista previa. Para cambios con migraciones, usa una base aparte para `preview` (ver [Turso y Vercel](referencia.md#turso-y-vercel)).
