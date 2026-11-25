// Secciones que se enseñan en la navegación (menú lateral, barra inferior, paleta, atajos y enlaces de la portada).
// Las demás siguen en el código y funcionan igual; solo dejan de enlazarse. Para volver a mostrar una, añádela aquí.
export const VISIBLE_SECTIONS = ['trade', 'markets', 'learn'];

// Rutas que no están en el menú pero se abren por URL: la portada, Administración (con sus permisos de siempre,
// require_admin en el servidor) y las páginas legales y de contacto (enlazadas desde el pie).
const URL_ONLY = ['dashboard', 'admin', 'legal', 'contact'];

/** ¿Se enlaza esta sección en la navegación? */
export const isVisible = (route) => VISIBLE_SECTIONS.includes(route);

/** ¿Se puede abrir esta ruta? Si no, el enrutado redirige a Operar. */
export const isReachable = (route) => isVisible(route) || URL_ONLY.includes(route);
