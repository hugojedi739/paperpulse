// Qué va primero en el Resumen según el estado de la cuenta. Solo decide el orden y qué se enseña: no toca datos.
//   · Con sesión y sin cuenta del servidor: elegir el saldo, primero y casi lo único (sin mercados ni noticias).
//   · Con órdenes pendientes: arriba, para no olvidarlas.
//   · Sin posiciones: una invitación a la primera compra.

export function dashboardFocus({ signedIn, practice, positions = 0, orders = 0 }) {
  const setupFirst = Boolean(signedIn && !practice);
  return {
    setupFirst,
    minimal: setupFirst,
    orders: Boolean(practice) && orders > 0,
    firstBuy: Boolean(practice) && positions === 0,
  };
}

/** «Compra límite», «Venta stop»… (cuenta del servidor) o «Límite» / «Stop-límite» (Demo). */
export const orderLabel = (o) => (o.side
  ? `${o.side === 'buy' ? 'Compra' : 'Venta'} ${o.type === 'limit' ? 'límite' : 'stop'}`
  : o.type === 'limit' ? 'Límite' : 'Stop-límite');
