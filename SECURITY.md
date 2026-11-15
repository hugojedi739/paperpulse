# Política de seguridad

Gracias por ayudar a que PaperPulse sea más seguro. Este documento explica cómo avisar de una vulnerabilidad sin exponerla públicamente.

## Cómo reportar una vulnerabilidad

Usa **solo** el aviso privado de GitHub (*Private vulnerability reporting*):

1. Entra en la pestaña **Security** de este repositorio.
2. Pulsa **Report a vulnerability**.
3. Rellena el formulario. Solo lo verán quienes mantienen el proyecto.

**No abras una *issue*, un *pull request* ni un mensaje en el foro de la aplicación** para una vulnerabilidad: serían públicos antes de que haya un arreglo. Tampoco hay ningún correo para esto: el formulario de GitHub es la única vía.

Para que podamos reproducirlo, incluye si puedes:

- Qué parte está afectada (ruta de la API, vista, fichero o commit).
- Los pasos para reproducirlo y qué ocurre frente a lo que debería ocurrir.
- El impacto que crees que tiene (por ejemplo, acceso a datos de otra cuenta o saltarse `require_admin`).
- Si lo has probado en tu propia instalación local o en el despliegue público.

No incluyas en el reporte contraseñas, tokens ni datos personales reales, tuyos ni de nadie.

## Qué pasa después

- Confirmaremos que lo hemos recibido en cuanto podamos. Es un proyecto personal sin ánimo de lucro, así que no hay plazos garantizados.
- Lo evaluaremos y, si se confirma, prepararemos el arreglo en privado.
- Cuando esté publicado, podremos difundir un aviso de seguridad (*security advisory*) en GitHub y, si quieres, mencionarte.

## Versiones con soporte

Solo recibe arreglos de seguridad la rama **`main`**, que es la que está desplegada. No hay versiones antiguas mantenidas: si usas una copia propia, actualízala desde `main`.

| Versión | Recibe arreglos |
|---|---|
| `main` | Sí |
| Cualquier otra rama, etiqueta o copia | No |

## Pruebas responsables

- Prueba en **tu propia instalación local** (ver el [README](README.md)), con la base local y los usuarios de demostración. No hace falta tocar el despliegue público para demostrar un fallo.
- No accedas, modifiques ni borres datos de otras personas, no hagas pruebas de denegación de servicio ni envíes spam, y no intentes ingeniería social contra nadie.

## Qué NO se reporta por esta vía

El formulario de seguridad es solo para vulnerabilidades. Para lo demás:

- **Spam, abuso o contenido de otras personas en la comunidad** (mensajes, alias, perfiles): usa el botón de denunciar de la aplicación, que llega a moderación.
- **Preguntas de uso, dudas o propuestas**: abre una *issue* en GitHub o usa el formulario de contacto de la aplicación.
- **Datos de la comunidad o de tu cuenta** (descargar o borrar tus datos, por ejemplo): se gestionan desde el menú de tu cuenta en la aplicación o, si necesitas ayuda, con el formulario de contacto con la sesión iniciada.
- **Errores que no afectan a la seguridad** (algo que no se pinta bien, un precio que tarda): una *issue* normal.
- **Resultados de escáneres automáticos sin una prueba de impacto**, o ausencia de cabeceras que no tenga consecuencias reales.

Recuerda que PaperPulse es un simulador educativo con dinero virtual: no hay dinero real, brókeres ni órdenes reales.
