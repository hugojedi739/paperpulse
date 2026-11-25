// Cálculos del libro de órdenes compacto (sin interfaz): presión compradora/vendedora y niveles.

/** Un nivel con más de esta parte del volumen visible de su lado es un «muro». */
export const BOOK_WALL = 0.3;

/**
 * Reparto del volumen (cantidad × precio) entre compra y venta, con etiqueta. Equilibrado entre el 45 % y el 55 %.
 * Los muros (un nivel con más del 30 % del volumen de su lado) no cuentan: un solo nivel enorme no debe decidir la barra.
 * `walls` dice cuántos se han quitado, para avisar en la interfaz.
 */
export function bookPressure(bids, asks) {
  const notional = (rows) => rows.map(([p, q]) => p * q);
  const withoutWalls = (vals) => {
    const total = vals.reduce((n, v) => n + v, 0);
    const kept = vals.filter((v) => !(total > 0 && v / total > BOOK_WALL));
    return { sum: kept.reduce((n, v) => n + v, 0), walls: vals.length - kept.length };
  };
  const b = withoutWalls(notional(bids)), a = withoutWalls(notional(asks));
  const buyPct = b.sum + a.sum > 0 ? Math.round((b.sum / (b.sum + a.sum)) * 100) : 50;
  const label = buyPct > 55 ? 'Más presión compradora' : buyPct < 45 ? 'Más presión vendedora' : 'Equilibrado';
  return { buyPct, sellPct: 100 - buyPct, label, walls: b.walls + a.walls };
}

/** Niveles de un lado: parte del volumen visible (`share`), profundidad acumulada (`depth`, 0-1) y si es un muro. */
export function bookLevels(rows) {
  const total = rows.reduce((n, [, q]) => n + q, 0);
  let acc = 0;
  return rows.map(([p, q]) => {
    acc += q;
    const share = total ? q / total : 0;
    return { p, q, share, depth: total ? acc / total : 0, wall: share > BOOK_WALL };
  });
}
