// Luz de los gráficos (estilo Aurora): brillo de las velas, halo del último precio y resplandor de la línea de patrimonio.
// Se dibuja en el mismo canvas de Lightweight Charts (como «primitivas»), después de cada pintado de la librería.
// Rendimiento en móviles modestos: sin shadowBlur, sin filtros, sin lienzos extra y sin animaciones propias (nada
// se mueve solo, así que no hay nada que parar con «reducir movimiento»). Cada efecto crea como mucho un degradado
// por fotograma y se desactiva solo cuando no se vería (velas finas) o costaría demasiado (muchos puntos).
// Sin imports: la geometría se prueba en tests/chart-fx.test.js.

/** Color `#rrggbb` con transparencia. */
export const alpha = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Ancho (px de bitmap) con el que la librería pinta el cuerpo de una vela. Misma fórmula que su renderer de velas. */
export function candleWidth(barSpacing, pixelRatio) {
  let w;
  if (barSpacing >= 2.5 && barSpacing <= 4) w = Math.floor(3 * pixelRatio);
  else {
    const coeff = 1 - (0.2 * Math.atan(Math.max(4, barSpacing) - 4)) / (Math.PI * 0.5);
    w = Math.max(Math.floor(pixelRatio), Math.min(Math.floor(barSpacing * coeff * pixelRatio), Math.floor(barSpacing * pixelRatio)));
  }
  if (w >= 2 && Math.floor(pixelRatio) % 2 !== w % 2) w--;
  return w;
}

/** Por debajo de estos px de pantalla (CSS) el brillo no se distingue: no se dibuja. */
export const SHEEN_MIN_CSS_WIDTH = 3;
export const SHEEN_MIN_CSS_HEIGHT = 3;
/** El filo de luz lateral solo cabe en velas de este ancho (px CSS) o más. */
export const EDGE_MIN_CSS_WIDTH = 5;
/** Tope de velas con brillo por fotograma (con velas de 3 px o más, en un móvil caben unas 130). */
export const SHEEN_MAX_BARS = 320;
/** Tope de puntos de la línea con resplandor. */
export const GLOW_MAX_POINTS = 1500;

/**
 * Intensidad de la luz según el tema. Lo que quita contraste con el fondo se queda corto a propósito: en oscuro, la
 * sombra; en claro, el brillo. Así la punta menos contrastada de una vela sigue por encima de 3:1 (medido sobre el fondo real).
 */
export const sheenTones = (light) => (light
  ? { top: 0.1, bottom: 0.2, edge: 0.12 }
  : { top: 0.3, bottom: 0.13, edge: 0.24 });

/**
 * Brillo de las velas: sobre cada cuerpo, un degradado vertical (luz arriba, sombra abajo) y un filo de luz a la izquierda.
 * `bars`: [{x, openY, closeY}] en px CSS de las velas visibles. Usa UN degradado de altura 1 que se estira a cada
 * cuerpo con la transformación del canvas, así que no crea objetos por vela. Devuelve cuántas velas ha iluminado.
 */
export function drawCandleSheen({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }, bars, barSpacing, tones) {
  const width = candleWidth(barSpacing, hpr);
  if (width < SHEEN_MIN_CSS_WIDTH * hpr || bars.length > SHEEN_MAX_BARS) return 0;
  const half = Math.floor(width * 0.5);
  const minHeight = SHEEN_MIN_CSS_HEIGHT * vpr;
  const rects = [];
  for (const b of bars) {
    const top = Math.round(Math.min(b.openY, b.closeY) * vpr);
    const height = Math.round(Math.max(b.openY, b.closeY) * vpr) - top + 1;
    if (height >= minHeight) rects.push(Math.round(b.x * hpr) - half, top, height);
  }
  if (!rects.length) return 0;

  ctx.save();
  const shade = ctx.createLinearGradient(0, 0, 0, 1);
  shade.addColorStop(0, `rgba(255, 255, 255, ${tones.top})`);
  shade.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  shade.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  shade.addColorStop(1, `rgba(0, 0, 0, ${tones.bottom})`);
  ctx.fillStyle = shade;
  for (let i = 0; i < rects.length; i += 3) {
    ctx.setTransform(1, 0, 0, rects[i + 2], rects[i], rects[i + 1]);
    ctx.fillRect(0, 0, width, 1);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (width >= EDGE_MIN_CSS_WIDTH * hpr) {
    // Filo de luz: una sola pasada para todas las velas
    const edge = Math.max(1, Math.round(hpr));
    ctx.fillStyle = `rgba(255, 255, 255, ${tones.edge})`;
    ctx.beginPath();
    for (let i = 0; i < rects.length; i += 3) ctx.rect(rects[i], rects[i + 1], edge, rects[i + 2]);
    ctx.fill();
  }
  ctx.restore();
  return rects.length / 3;
}

/** Halo de luz en un punto (el último precio). `x`, `y` y `radius` en px CSS. */
export function drawHalo({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }, x, y, color, radius = 22, strength = 0.36) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const cx = x * hpr, cy = y * vpr, r = radius * hpr;
  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  glow.addColorStop(0, alpha(color, strength));
  glow.addColorStop(0.4, alpha(color, strength * 0.35));
  glow.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  return true;
}

/**
 * Resplandor bajo una línea: dos trazos anchos y translúcidos con su mismo recorrido (más barato que un desenfoque).
 * Por encima de `baseY` usa `upColor` y por debajo `downColor`, como la serie de línea base. `points`: [{x, y}] en px CSS.
 */
export function drawGlowLine({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }, points, baseY, upColor, downColor, strength = 1) {
  if (points.length < 2 || points.length > GLOW_MAX_POINTS) return false;
  const split = Number.isFinite(baseY) ? Math.min(Math.max(Math.round(baseY * vpr), 0), bitmapSize.height) : bitmapSize.height;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x * hpr, points[0].y * vpr);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x * hpr, points[i].y * vpr);
  };
  const zone = (top, height, color) => {
    if (height <= 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, bitmapSize.width, height);
    ctx.clip();
    for (const [w, a] of [[12, 0.07], [6, 0.13]]) {
      path();
      ctx.lineWidth = w * hpr;
      ctx.strokeStyle = alpha(color, a * strength);
      ctx.stroke();
    }
    ctx.restore();
  };
  zone(0, split, upColor);
  zone(split, bitmapSize.height - split, downColor);
  ctx.restore();
  return true;
}
