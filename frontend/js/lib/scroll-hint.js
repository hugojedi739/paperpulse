// Pista visual de «hay más contenido» en filas con scroll horizontal (rangos e intervalos del gráfico en móvil).
// El estado va en data-scroll y el CSS difumina el borde por el que aún se puede desplazar.

/** Dónde queda contenido oculto: 'none' (cabe todo), 'start' (a la derecha), 'middle' (a ambos lados) o 'end' (a la izquierda). */
export function scrollState(scrollLeft, clientWidth, scrollWidth, tolerance = 2) {
  if (!(scrollWidth > clientWidth + tolerance)) return 'none';
  const atStart = scrollLeft <= tolerance;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - tolerance;
  return atStart ? 'start' : atEnd ? 'end' : 'middle';
}

/**
 * Mantiene data-scroll al día (scroll, cambio de tamaño y de contenido) y, si se indica `reveal`, desplaza la fila para que el
 * botón que pasa a estar activo quede a la vista. Devuelve una función que lo desconecta.
 */
export function watchScroll(el, { reveal = '[aria-pressed="true"]' } = {}) {
  if (!el) return () => {};
  const update = () => { el.dataset.scroll = scrollState(el.scrollLeft, el.clientWidth, el.scrollWidth); };
  const show = (node) => {
    if (!node || !el.contains(node) || el.scrollWidth <= el.clientWidth) return;
    const box = el.getBoundingClientRect(), b = node.getBoundingClientRect();
    if (b.left < box.left + 24 || b.right > box.right - 24) el.scrollTo({ left: el.scrollLeft + (b.left + b.width / 2) - (box.left + box.width / 2), behavior: 'auto' });
  };
  el.addEventListener('scroll', update, { passive: true });
  const resize = new ResizeObserver(update);
  resize.observe(el);
  const mutations = new MutationObserver((list) => {
    update();
    for (const m of list) if (m.type === 'attributes' && m.target.getAttribute('aria-pressed') === 'true' && m.target.matches(reveal)) show(m.target);
  });
  mutations.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  update();
  requestAnimationFrame(() => { update(); show(el.querySelector(reveal)); });
  return () => { el.removeEventListener('scroll', update); resize.disconnect(); mutations.disconnect(); };
}
