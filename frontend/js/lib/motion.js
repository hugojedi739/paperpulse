// Movimiento con JS (lo que el CSS no puede hacer solo): cifras que cuentan hasta su nuevo valor.
// Todo respeta «reducir movimiento» del sistema: en ese caso el valor final se pinta directamente.

export const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;

/** Valor intermedio de la cuenta: desaceleración cúbica entre `from` y `to` para un avance `t` de 0 a 1. */
export const easeValue = (from, to, t) => from + (to - from) * (1 - (1 - Math.min(1, Math.max(0, t))) ** 3);

const running = new WeakMap();

/**
 * Lleva el texto de `el` de `from` a `to` en `ms` milisegundos, formateando cada paso con `format`.
 * Si no hay cambio, si falta `from` o si el sistema pide menos movimiento, pinta el valor final sin animar.
 */
export function countTo(el, from, to, format, ms = 600) {
  if (!el) return;
  cancelAnimationFrame(running.get(el));
  if (!Number.isFinite(from) || from === to || reducedMotion() || document.hidden) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = (now - start) / ms;
    el.textContent = format(t >= 1 ? to : easeValue(from, to, t));
    if (t < 1) running.set(el, requestAnimationFrame(step));
  };
  running.set(el, requestAnimationFrame(step));
}
