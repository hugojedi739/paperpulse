// Explicación de «dinero virtual»: la etiqueta de la barra de estado la abre y cuenta qué son Demo y Mi cuenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/css/app.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../frontend/js/ui/account-switch.js', import.meta.url), 'utf8');

test('la etiqueta sigue anunciando el modo y un botón a su lado abre la explicación', () => {
  assert.match(html, /<span class="acct-tag" id="acct-tag" role="status"><\/span>\s*<button type="button" class="acct-help" id="acct-help" popovertarget="acct-info"/);
  assert.match(html, /<div popover id="acct-info" class="menu menu-wide acct-info" role="dialog" aria-labelledby="acct-info-title">/);
});

test('explica el dinero virtual y las dos cuentas, sin prometer nada y enlazando a Aprender', () => {
  const box = html.slice(html.indexOf('id="acct-info"'), html.indexOf('id="market-alert-pop"'));
  assert.match(box, /No hay dinero real/);
  assert.match(box, /data-for="demo"[\s\S]*no cobra comisiones[\s\S]*no cuenta para la clasificación/);
  assert.match(box, /data-for="server"[\s\S]*comisión y deslizamiento[\s\S]*cuenta para la clasificación/);
  assert.match(box, /no es asesoramiento financiero/);
  assert.match(box, /href="#\/learn\/que-es-paper-trading"/);
  assert.doesNotMatch(box, /style=|on[a-z]+=/, 'CSP: sin estilos ni eventos inline');
});

test('marca la cuenta en uso y no se ve cerrada (el display solo con :popover-open)', () => {
  assert.match(sw, /info\.dataset\.mode = current/);
  assert.match(css, /\.acct-info:popover-open \{ display: grid; \}/);
  assert.doesNotMatch(css, /\.acct-info \{[^}]*display:/);
});
