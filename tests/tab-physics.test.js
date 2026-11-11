// Física del globo de la barra inferior: muelle, estiramiento, ajuste a la pestaña más cercana y reconocimiento del gesto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPRING, FOLLOW, MAX_DT, DRAG_START, EDGE_GUARD, clamp, stepSpring, settled, stretch, nearestIndex, gesture, nearScreenEdge } from '../frontend/js/lib/tab-physics.js';

/** Simula el muelle hasta que se asienta o pasan `seconds`. Devuelve el recorrido. */
function simulate(from, to, config, fps = 60, seconds = 3) {
  let s = { x: from, v: 0 };
  const path = [];
  for (let i = 0; i < fps * seconds; i++) {
    s = stepSpring(s, to, 1 / fps, config);
    path.push(s.x);
    if (settled(s, to)) break;
  }
  return { path, end: s, frames: path.length };
}

test('el muelle llega a la pestaña y se asienta en menos de un segundo', () => {
  const { end, frames } = simulate(0, 320, SPRING);
  assert.ok(settled(end, 320), 'se asienta');
  assert.ok(frames < 60, `tarda ${frames} fotogramas`);
});

test('efecto elástico: se pasa un poco del destino, pero poco', () => {
  const { path } = simulate(0, 320, SPRING);
  const overshoot = Math.max(...path) - 320;
  assert.ok(overshoot > 1, 'rebasa el destino');
  assert.ok(overshoot < 320 * 0.12, `rebote contenido (${overshoot.toFixed(1)} px)`);
});

test('siguiendo al dedo no hay rebote (el globo no se adelanta al dedo)', () => {
  const { path, end } = simulate(0, 200, FOLLOW);
  assert.ok(Math.max(...path) - 200 < 1.5);
  assert.ok(settled(end, 200));
});

test('funciona igual hacia la izquierda y a 30 fps', () => {
  const left = simulate(320, 0, SPRING);
  assert.ok(settled(left.end, 0));
  assert.ok(Math.min(...left.path) < -1, 'también rebota hacia el otro lado');
  const slow = simulate(0, 320, SPRING, 30);
  assert.ok(settled(slow.end, 320), 'estable a 30 fps');
});

test('un salto de tiempo enorme (pestaña en segundo plano) no hace explotar el muelle', () => {
  let s = { x: 0, v: 0 };
  for (let i = 0; i < 200; i++) s = stepSpring(s, 320, i % 7 === 0 ? 5 : 1 / 60, SPRING);
  assert.ok(Number.isFinite(s.x) && Math.abs(s.x - 320) < 1, `acaba en ${s.x}`);
  assert.deepEqual(stepSpring({ x: 10, v: 0 }, 10, 5, SPRING), { x: 10, v: 0 }, 'en reposo sigue en reposo');
  assert.ok(MAX_DT <= 1 / 30);
  assert.deepEqual(stepSpring({ x: 0, v: 0 }, 100, -1, SPRING), { x: 0, v: 0 }, 'un dt negativo no mueve nada');
});

test('estiramiento: en reposo no deforma; con velocidad se alarga y se aplana, con tope', () => {
  assert.deepEqual(stretch(0), { sx: 1, sy: 1 });
  const fast = stretch(1500), faster = stretch(99999), back = stretch(-1500);
  assert.ok(fast.sx > 1 && fast.sy < 1);
  assert.deepEqual(back, fast, 'igual en los dos sentidos');
  assert.ok(faster.sx <= 1.22 + 1e-9 && faster.sy >= 0.9, 'nunca se deforma de más');
});

test('al soltar se ajusta a la pestaña más cercana', () => {
  const centers = [32, 96, 160, 224, 288, 352]; // seis pestañas de 64 px
  assert.equal(nearestIndex(0, centers), 0);
  assert.equal(nearestIndex(63, centers), 0);
  assert.equal(nearestIndex(65, centers), 1);
  assert.equal(nearestIndex(200, centers), 3);
  assert.equal(nearestIndex(9999, centers), 5);
  assert.equal(nearestIndex(-50, centers), 0);
  assert.equal(nearestIndex(64, centers), 0, 'en el punto medio exacto gana la de la izquierda (determinista)');
});

test('gesto: arrastre horizontal, desplazamiento vertical o todavía indeciso', () => {
  assert.equal(gesture(3, 2), 'pending');
  assert.equal(gesture(DRAG_START, 0), 'drag');
  assert.equal(gesture(-20, 5), 'drag');
  assert.equal(gesture(4, 30), 'scroll', 'un gesto vertical no mueve el globo');
  assert.equal(gesture(12, 12), 'scroll', 'en diagonal exacta no se arrastra');
  assert.equal(gesture(0, 0), 'pending');
});

test('los toques pegados al borde de la pantalla se dejan al gesto de volver atrás', () => {
  assert.equal(nearScreenEdge(5, 390), true);
  assert.equal(nearScreenEdge(389, 390), true);
  assert.equal(nearScreenEdge(EDGE_GUARD, 390), false);
  assert.equal(nearScreenEdge(195, 390), false);
});

test('clamp', () => {
  assert.deepEqual([clamp(5, 0, 10), clamp(-1, 0, 10), clamp(11, 0, 10)], [5, 0, 10]);
});
