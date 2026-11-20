// Cierre uniforme de los menús (popover) en todos los dispositivos:
//   · al elegir una opción (enlace o botón del menú), salvo casillas y lo marcado con data-keep-open;
//   · al tocar fuera, también donde el navegador no lo hace solo; en pantallas táctiles ese toque solo cierra
//     (no «atraviesa» el menú y pulsa lo de debajo), excepto en la barra inferior, que navega a la primera;
//   · al cambiar de vista. Escape lo resuelve el propio popover nativo.

const CHECKBOX = '[role="menuitemcheckbox"], [role="menuitemradio"]';

/** ¿Este clic dentro de un menú es «elegir una opción» que debe cerrarlo? */
export function closesMenu(item) {
  if (!item?.closest?.('[popover]')) return false;
  if (item.closest('[data-keep-open], form')) return false; // listas con acciones propias y formularios dentro del menú
  if (item.matches(`${CHECKBOX}, [popovertarget], [aria-disabled="true"], :disabled`)) return false;
  return true;
}

const openMenus = () => [...document.querySelectorAll(':popover-open')].filter((p) => p.popover === 'auto');

export function initDismiss() {
  document.addEventListener('click', (e) => {
    const item = e.target.closest?.('[popover] :is(a[href], button, [role="menuitem"])');
    if (closesMenu(item)) item.closest('[popover]').hidePopover?.();
  });

  let swallowUntil = 0;
  document.addEventListener('pointerdown', (e) => {
    const menus = openMenus();
    if (!menus.length || menus.some((p) => p.contains(e.target))) return;
    if (e.target.closest?.('[popovertarget]')) return; // su botón (u otro menú): lo resuelve el navegador
    menus.forEach((p) => p.hidePopover());
    if (e.pointerType === 'touch' && !e.target.closest?.('.tabbar')) swallowUntil = e.timeStamp + 700;
  }, true);
  document.addEventListener('click', (e) => {
    if (!swallowUntil) return;
    const swallow = e.timeStamp <= swallowUntil;
    swallowUntil = 0;
    if (swallow) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  addEventListener('hashchange', () => openMenus().forEach((p) => p.hidePopover()));
}
