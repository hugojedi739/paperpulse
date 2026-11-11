// Barra inferior del móvil: un «globo» de cristal bajo la pestaña activa que se puede arrastrar con el dedo.
// - Al soltarlo se ajusta a la pestaña más cercana y cambia de pantalla; tocar una pestaña sigue funcionando (el globo va hasta ella).
// - Se mueve con un muelle y solo con `transform` (sin desenfoques nuevos): lo compone la GPU.
// - Las pestañas siguen siendo enlaces normales: teclado y lector de pantalla no cambian (aria-current lo pone main.js).
// - Con «reducir movimiento» el globo salta directamente a su sitio, sin muelle ni estiramiento.
import { reducedMotion } from '../lib/motion.d917c017.js';
import { SPRING, FOLLOW, clamp, stepSpring, settled, stretch, nearestIndex, gesture, nearScreenEdge } from '../lib/tab-physics.10858b98.js';

const LENS = 1.14; // aumento del globo mientras se arrastra (efecto lupa)

export function initTabbar(bar = document.querySelector('.tabbar')) {
  if (!bar) return;
  const tabs = [...bar.querySelectorAll('a[data-route]')];
  const blob = document.createElement('span');
  blob.className = 'tabbar-blob';
  blob.setAttribute('aria-hidden', 'true');
  blob.hidden = true;
  bar.prepend(blob);
  bar.classList.add('has-blob');

  let pos = { x: 0, v: 0 }, lens = { x: 1, v: 0 };
  let target = 0, frame = 0, last = 0, placed = false;
  let drag = null; // { id, startX, startY, grab, active }
  let swallowClick = false;

  const activeIndex = () => tabs.findIndex((a) => a.getAttribute('aria-current') === 'page');
  const visible = () => getComputedStyle(bar).display !== 'none'; // en escritorio la barra no existe
  const centers = () => tabs.map((a) => a.offsetLeft + a.offsetWidth / 2);
  const limits = () => [tabs[0].offsetLeft, tabs.at(-1).offsetLeft];

  function paint() {
    const s = reducedMotion() ? { sx: 1, sy: 1 } : stretch(pos.v);
    blob.style.transform = `translate3d(${pos.x.toFixed(2)}px, 0, 0) scale(${(lens.x * s.sx).toFixed(4)}, ${(lens.x * s.sy).toFixed(4)})`;
  }

  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    pos = stepSpring(pos, target, dt, drag?.active ? FOLLOW : SPRING);
    lens = stepSpring(lens, drag?.active ? LENS : 1, dt, SPRING);
    const done = !drag?.active && settled(pos, target) && Math.abs(lens.x - 1) < 0.004 && Math.abs(lens.v) < 0.05;
    if (done) { pos = { x: target, v: 0 }; lens = { x: 1, v: 0 }; }
    paint();
    frame = done ? 0 : requestAnimationFrame(tick);
  }
  function run() {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
  function jump(x) { // sin animación
    cancelAnimationFrame(frame);
    frame = 0;
    target = x;
    pos = { x, v: 0 };
    lens = { x: 1, v: 0 };
    paint();
  }

  /** Coloca el globo bajo la pestaña activa (animado si ya estaba en pantalla) o lo esconde si la vista no está en la barra. */
  function sync({ animate = true } = {}) {
    if (drag?.active || !visible()) return;
    const i = activeIndex();
    if (i < 0) { blob.hidden = true; placed = false; return; }
    const a = tabs[i];
    blob.style.width = `${a.offsetWidth}px`;
    blob.hidden = false;
    if (!placed || !animate || reducedMotion()) jump(a.offsetLeft);
    else { target = a.offsetLeft; run(); }
    placed = true;
  }

  function markOver(index) {
    tabs.forEach((a, i) => a.classList.toggle('over', i === index));
  }

  /* ---------- Arrastre ---------- */
  bar.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (nearScreenEdge(e.clientX, innerWidth)) return; // se deja al gesto de «atrás» del sistema; el toque normal sigue funcionando
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    // Si el dedo cae sobre el globo se conserva el punto de agarre; si cae en otra pestaña, el globo acudirá centrado bajo el dedo
    const onBlob = !blob.hidden && x >= pos.x && x <= pos.x + blob.offsetWidth;
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, grab: onBlob ? x - pos.x : null, active: false };
  });

  bar.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      const kind = gesture(e.clientX - drag.startX, e.clientY - drag.startY);
      if (kind === 'scroll') { drag = null; return; }
      if (kind !== 'drag') return;
      drag.active = true;
      bar.setPointerCapture?.(e.pointerId);
      bar.classList.add('dragging');
      if (blob.hidden) { blob.style.width = `${tabs[0].offsetWidth}px`; blob.hidden = false; placed = true; }
    }
    const rect = bar.getBoundingClientRect();
    const [min, max] = limits();
    const w = blob.offsetWidth;
    target = clamp(e.clientX - rect.left - (drag.grab ?? w / 2), min, max);
    markOver(nearestIndex(target + w / 2, centers()));
    if (reducedMotion()) { pos = { x: target, v: 0 }; paint(); } else run();
  });

  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const wasActive = drag.active;
    drag = null;
    bar.classList.remove('dragging');
    markOver(-1);
    if (!wasActive) return; // fue un toque: lo resuelve el enlace
    if (bar.hasPointerCapture?.(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    swallowClick = true; // el «click» que sigue a soltar no debe activar la pestaña que quedó bajo el dedo
    setTimeout(() => { swallowClick = false; }, 400);
    if (cancelled) { placed = true; sync(); return; } // el sistema se quedó el gesto: el globo vuelve a su pestaña
    const i = nearestIndex(target + blob.offsetWidth / 2, centers());
    const a = tabs[i];
    target = a.offsetLeft;
    if (reducedMotion()) jump(target); else run();
    if (a.getAttribute('aria-current') !== 'page') location.hash = a.getAttribute('href').slice(1);
  }
  bar.addEventListener('pointerup', (e) => endDrag(e, false));
  bar.addEventListener('pointercancel', (e) => endDrag(e, true));
  bar.addEventListener('click', (e) => { if (swallowClick) { e.preventDefault(); e.stopPropagation(); swallowClick = false; } }, true);

  /* ---------- Teclado: flechas para moverse entre pestañas (Intro las abre, como cualquier enlace) ---------- */
  bar.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    tabs[clamp(next, 0, tabs.length - 1)].focus();
  });

  /* ---------- Sincronía con la ruta y con el tamaño ---------- */
  new MutationObserver(() => sync()).observe(bar, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  new ResizeObserver(() => { placed = false; sync({ animate: false }); }).observe(bar);
  sync({ animate: false });
  return { sync };
}
