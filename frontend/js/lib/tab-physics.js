// Física del «globo» de la barra inferior del móvil: muelle, estiramiento elástico y a qué pestaña se ajusta al soltar.
// Lógica sin DOM (se prueba con node --test). Unidades: píxeles y segundos.

/** Muelle suelto (un pequeño rebote al llegar) para ir a una pestaña; muelle tenso (sin rebote) para seguir al dedo. */
export const SPRING = { stiffness: 420, damping: 26 };
export const FOLLOW = { stiffness: 1400, damping: 75 };
export const MAX_DT = 1 / 30; // una pestaña en segundo plano puede dar saltos de tiempo enormes: se acotan para que el muelle no explote
export const DRAG_START = 8; // píxeles en horizontal antes de considerar que es un arrastre y no un toque
export const EDGE_GUARD = 20; // franja de los bordes de la pantalla reservada al gesto de «atrás» del sistema

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** Un paso del muelle (Euler semi-implícito, estable con estos valores a 60 fps y a 30 fps). Devuelve { x, v } nuevos. */
export function stepSpring({ x, v }, target, dt, { stiffness, damping } = SPRING) {
  const h = clamp(dt, 0, MAX_DT);
  const a = -stiffness * (x - target) - damping * v;
  const nv = v + a * h;
  return { x: x + nv * h, v: nv };
}

/** ¿Ha llegado? (posición y velocidad por debajo de lo que se ve) */
export const settled = ({ x, v }, target) => Math.abs(x - target) < 0.3 && Math.abs(v) < 4;

/** Estiramiento elástico según la velocidad: se alarga en el sentido del movimiento y se aplana un poco, conservando el «volumen». */
export function stretch(v) {
  const k = clamp(Math.abs(v) / 2600, 0, 0.22);
  return { sx: 1 + k, sy: 1 - k * 0.45 };
}

/** Índice de la pestaña cuyo centro queda más cerca de `x`. `centers` son los centros de cada pestaña. */
export function nearestIndex(x, centers) {
  let best = 0;
  for (let i = 1; i < centers.length; i++) if (Math.abs(centers[i] - x) < Math.abs(centers[best] - x)) best = i;
  return best;
}

/**
 * ¿El movimiento del dedo es un arrastre horizontal del globo?
 * 'drag' si avanza en horizontal más que el umbral y más que en vertical; 'scroll' si domina el vertical; 'pending' si aún no se sabe.
 */
export function gesture(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax >= DRAG_START && ax > ay) return 'drag';
  if (ay >= DRAG_START && ay >= ax) return 'scroll';
  return 'pending';
}

/** Un toque que empieza pegado al borde de la pantalla se deja al sistema (gesto de volver atrás): no inicia arrastre. */
export const nearScreenEdge = (clientX, viewportWidth) => clientX < EDGE_GUARD || clientX > viewportWidth - EDGE_GUARD;
