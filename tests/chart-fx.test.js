// Luz de los gráficos: geometría de las velas y garantías de rendimiento (qué se dibuja, cuánto y con qué operaciones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alpha, candleWidth, sheenTones, drawCandleSheen, drawHalo, drawGlowLine,
  SHEEN_MIN_CSS_WIDTH, SHEEN_MAX_BARS, EDGE_MIN_CSS_WIDTH, GLOW_MAX_POINTS,
} from '../frontend/js/lib/chart-fx.js';

/** Contexto 2D falso que apunta las llamadas. Asignar `shadowBlur` o `filter` (lo caro) hace fallar el test. */
function fakeScope(ratio = 2, size = { width: 780, height: 600 }) {
  const calls = [];
  const gradient = () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]); } });
  const context = new Proxy({}, {
    get: (_, name) => (...args) => {
      calls.push([name, ...args]);
      return name === 'createLinearGradient' || name === 'createRadialGradient' ? gradient() : undefined;
    },
    set: (_, name, value) => {
      assert.ok(name !== 'shadowBlur' && name !== 'filter', `no se usa ${String(name)}: es lo más caro en móviles`);
      calls.push([`set ${String(name)}`, value]);
      return true;
    },
  });
  const count = (name) => calls.filter((c) => c[0] === name).length;
  return { scope: { context, bitmapSize: size, horizontalPixelRatio: ratio, verticalPixelRatio: ratio }, calls, count };
}
const bars = (n, spacing, height = 40) => Array.from({ length: n }, (_, i) => ({ x: 10 + i * spacing, openY: 100, closeY: 100 + (i % 2 ? height : -height) }));

test('alpha convierte #rrggbb en rgba', () => {
  assert.equal(alpha('#3ee6a8', 0.5), 'rgba(62, 230, 168, 0.5)');
  assert.equal(alpha('#000000', 0), 'rgba(0, 0, 0, 0)');
});

test('candleWidth reproduce el ancho con el que la librería pinta las velas', () => {
  assert.equal(candleWidth(3, 1), 3); // caso especial entre 2,5 y 4
  assert.equal(candleWidth(3, 2), 6);
  assert.equal(candleWidth(6, 1), 5); // floor(6 × 0,859) = 5, impar como la mecha
  assert.equal(candleWidth(10, 1), 7); // 8 → 7 para quedar centrada en la mecha de 1 px
  assert.equal(candleWidth(10, 2), 16);
  assert.equal(candleWidth(0.5, 1), 1); // nunca menos de un píxel
  for (const s of [1, 2, 3, 5, 8, 13, 21, 40]) for (const r of [1, 2, 3]) {
    const w = candleWidth(s, r);
    assert.ok(w >= 1 && w <= Math.max(Math.floor(r), Math.floor(s * r)), `ancho ${w} con separación ${s} y ratio ${r}`);
  }
});

test('las velas finas no reciben brillo: no se vería y sería trabajo en balde', () => {
  const { scope, calls } = fakeScope(2);
  assert.equal(drawCandleSheen(scope, bars(200, 1.5), 1.5, sheenTones(false)), 0);
  assert.equal(calls.length, 0, 'ni siquiera toca el canvas');
  assert.ok(candleWidth(1.5, 2) < SHEEN_MIN_CSS_WIDTH * 2);
});

test('demasiadas velas en pantalla: sin brillo', () => {
  const { scope, calls } = fakeScope(1);
  assert.equal(drawCandleSheen(scope, bars(SHEEN_MAX_BARS + 1, 8), 8, sheenTones(false)), 0);
  assert.equal(calls.length, 0);
});

test('el brillo usa UN degradado para todas las velas y una sola pasada para el filo', () => {
  const { scope, calls, count } = fakeScope(2);
  const n = 60;
  assert.equal(drawCandleSheen(scope, bars(n, 8), 8, sheenTones(false)), n);
  assert.equal(count('createLinearGradient'), 1);
  assert.equal(count('createRadialGradient'), 0);
  assert.equal(count('fillRect'), n, 'un rectángulo por vela');
  assert.equal(count('fill'), 1, 'el filo de luz de todas las velas en un único fill');
  assert.equal(count('save'), 1);
  assert.equal(count('restore'), 1, 'deja el canvas como estaba');
  // El degradado de altura 1 se estira a cada cuerpo con la transformación: escala vertical = alto del cuerpo
  const first = calls.find((c) => c[0] === 'setTransform');
  assert.deepEqual(first.slice(1, 5), [1, 0, 0, 81]); // cuerpo de 40 px CSS × 2 + 1
  const width = candleWidth(8, 2);
  assert.equal(first[5], Math.round(10 * 2) - Math.floor(width / 2), 'centrada en la x de la vela');
  assert.deepEqual(calls.find((c) => c[0] === 'fillRect').slice(1), [0, 0, width, 1]);
});

test('el filo de luz solo se dibuja en velas anchas', () => {
  const narrow = fakeScope(1);
  drawCandleSheen(narrow.scope, bars(40, 4), 4, sheenTones(false)); // 3 px
  assert.ok(candleWidth(4, 1) < EDGE_MIN_CSS_WIDTH);
  assert.equal(narrow.count('fillRect'), 40);
  assert.equal(narrow.count('fill'), 0);
  const wide = fakeScope(1);
  drawCandleSheen(wide.scope, bars(40, 10), 10, sheenTones(false)); // 7 px
  assert.equal(wide.count('fill'), 1);
});

test('las velas casi planas (doji) se saltan', () => {
  const { scope, count } = fakeScope(1);
  const list = [{ x: 10, openY: 100, closeY: 100.4 }, { x: 20, openY: 100, closeY: 140 }];
  assert.equal(drawCandleSheen(scope, list, 10, sheenTones(false)), 1);
  assert.equal(count('fillRect'), 1);
});

test('tonos: lo que resta contraste con el fondo es lo más suave en cada tema', () => {
  const dark = sheenTones(false), light = sheenTones(true);
  assert.ok(dark.bottom < dark.top, 'en oscuro manda la luz: la sombra acercaría la vela al fondo');
  assert.ok(light.top < light.bottom, 'en claro manda la sombra: el brillo acercaría la vela al fondo blanco');
  for (const t of [dark, light]) for (const v of Object.values(t)) assert.ok(v > 0 && v <= 0.3);
});

test('el halo es un único degradado radial y se salta si el punto no está en pantalla', () => {
  const { scope, count, calls } = fakeScope(2);
  assert.equal(drawHalo(scope, null, 50, '#3ee6a8'), false);
  assert.equal(drawHalo(scope, 100, NaN, '#3ee6a8'), false);
  assert.equal(calls.length, 0);
  assert.equal(drawHalo(scope, 100, 50, '#3ee6a8', 20), true);
  assert.equal(count('createRadialGradient'), 1);
  assert.deepEqual(calls.find((c) => c[0] === 'createRadialGradient').slice(1), [200, 100, 0, 200, 100, 40]);
  assert.deepEqual(calls.find((c) => c[0] === 'fillRect').slice(1), [160, 60, 80, 80], 'solo pinta el cuadrado del halo');
});

test('el resplandor de la línea son trazos anchos (sin desenfoque) y tiene tope de puntos', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: 150 + Math.sin(i / 9) * 80 }));
  const { scope, count } = fakeScope(2);
  assert.equal(drawGlowLine(scope, pts, 150, '#3ee6a8', '#ff5c7c'), true);
  assert.equal(count('stroke'), 4, 'dos trazos por encima de la línea base y dos por debajo');
  assert.equal(count('clip'), 2);
  assert.equal(count('save'), count('restore'));
  const none = fakeScope(2);
  assert.equal(drawGlowLine(none.scope, pts.slice(0, 1), 150, '#3ee6a8', '#ff5c7c'), false);
  const many = Array.from({ length: GLOW_MAX_POINTS + 1 }, (_, i) => ({ x: i, y: 10 }));
  assert.equal(drawGlowLine(none.scope, many, 150, '#3ee6a8', '#ff5c7c'), false);
  assert.equal(none.calls.length, 0);
});

test('si toda la línea está por encima de la base, solo se dibuja esa zona', () => {
  const pts = [{ x: 0, y: 50 }, { x: 100, y: 20 }];
  const { scope, count } = fakeScope(1, { width: 300, height: 200 });
  drawGlowLine(scope, pts, 400, '#3ee6a8', '#ff5c7c'); // base por debajo del lienzo
  assert.equal(count('stroke'), 2);
});
