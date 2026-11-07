// Pruebas de la lógica de moderación del panel (motivos rápidos y ficha del autor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, OTHER, MAX_REASON, defaultPreset, buildReason, accountAgeLabel, isRepeatOffender } from '../frontend/js/lib/mod-helpers.js';

test('todas las acciones tienen motivos rápidos y terminan en «Otro motivo»', () => {
  for (const action of ['hide', 'restore', 'dismiss', 'suspend', 'unsuspend']) {
    assert.ok(PRESETS[action].length >= 3, action);
    assert.equal(PRESETS[action].at(-1), OTHER, action);
    assert.equal(new Set(PRESETS[action]).size, PRESETS[action].length, `sin duplicados en ${action}`);
  }
});

test('el motivo preseleccionado sigue lo que denunció la gente, solo al ocultar y suspender', () => {
  assert.equal(defaultPreset('hide', ['otro', 'estafa']), 'Estafa o promesas de beneficios');
  assert.equal(defaultPreset('suspend', ['abuso']), 'Insultos o acoso');
  assert.equal(defaultPreset('hide', ['otro']), 'Spam o promoción'); // sin equivalente: el primero
  assert.equal(defaultPreset('hide'), 'Spam o promoción');
  assert.equal(defaultPreset('dismiss', ['spam']), 'No incumple las normas');
  assert.equal(defaultPreset('inexistente'), OTHER);
});

test('el motivo se compone con el rápido y el detalle opcional', () => {
  assert.deepEqual(buildReason('Insultos o acoso', ''), { reason: 'Insultos o acoso' });
  assert.deepEqual(buildReason('Insultos o acoso', '  llama  tramposo\n a otro  '), { reason: 'Insultos o acoso: llama tramposo a otro' });
  assert.deepEqual(buildReason(OTHER, 'Datos personales de terceros'), { reason: 'Datos personales de terceros' });
});

test('sin motivo, o «Otro» sin detalle, es un error; no se recorta en silencio', () => {
  assert.match(buildReason('', 'x').error, /Elige/);
  assert.match(buildReason(null, '').error, /Elige/);
  assert.match(buildReason(OTHER, '   ').error, /motivo/);
  const long = buildReason('Spam o promoción', 'x'.repeat(MAX_REASON));
  assert.match(long.error, /demasiado largo/);
  assert.equal(buildReason('Spam o promoción', 'x'.repeat(MAX_REASON - 'Spam o promoción: '.length)).reason.length, MAX_REASON);
});

test('antigüedad de la cuenta legible', () => {
  const now = Date.UTC(2026, 5, 1);
  const ago = (d) => now / 1000 - d * 86400;
  assert.equal(accountAgeLabel(ago(0), now), 'cuenta de hoy');
  assert.equal(accountAgeLabel(ago(1), now), 'cuenta de 1 día');
  assert.equal(accountAgeLabel(ago(40), now), 'cuenta de 40 días');
  assert.equal(accountAgeLabel(ago(200), now), 'cuenta de 6 meses');
  assert.equal(accountAgeLabel(ago(1000), now), 'cuenta de 2 años');
  assert.equal(accountAgeLabel(undefined, now), 'cuenta de hoy');
});

test('reincidente: dos ocultados o una suspensión previa', () => {
  assert.equal(isRepeatOffender({ hiddenPosts: 1, suspensions: 0 }), false);
  assert.equal(isRepeatOffender({ hiddenPosts: 2, suspensions: 0 }), true);
  assert.equal(isRepeatOffender({ hiddenPosts: 0, suspensions: 1 }), true);
  assert.equal(isRepeatOffender({}), false);
  assert.equal(isRepeatOffender(undefined), false);
});
