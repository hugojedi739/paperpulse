// UX móvil: qué clics cierran un menú y piezas del asistente como hoja inferior (cierre con fondo, Escape y «atrás»).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closesMenu } from '../frontend/js/ui/dismiss.js';

// Elemento falso: `inPopover`, `ancestors` (selectores que «contienen» al elemento) y `is` (selectores que cumple)
const el = ({ inPopover = true, ancestors = [], is = [] } = {}) => ({
  closest: (sel) => (sel === '[popover]' ? (inPopover ? {} : null) : sel.split(',').some((s) => ancestors.includes(s.trim())) ? {} : null),
  matches: (sel) => sel.split(',').some((s) => is.includes(s.trim())),
});

test('elegir una opción de un menú lo cierra', () => {
  assert.equal(closesMenu(el()), true);
});

test('no cierran: casillas, botones que abren otro menú, opciones desactivadas, formularios y listas con acciones propias', () => {
  assert.equal(closesMenu(el({ is: ['[role="menuitemcheckbox"]'] })), false);
  assert.equal(closesMenu(el({ is: ['[popovertarget]'] })), false);
  assert.equal(closesMenu(el({ is: ['[aria-disabled="true"]'] })), false);
  assert.equal(closesMenu(el({ ancestors: ['form'] })), false);
  assert.equal(closesMenu(el({ ancestors: ['[data-keep-open]'] })), false);
  assert.equal(closesMenu(el({ inPopover: false })), false);
  assert.equal(closesMenu(null), false);
});

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../frontend/js/ui/chat.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/css/app.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../frontend/js/main.js', import.meta.url), 'utf8');

test('el asistente tiene fondo que lo cierra, botón de cerrar grande y no ocupa toda la pantalla en el móvil', () => {
  assert.match(html, /class="chat-scrim" id="chat-scrim" data-action="chat" hidden/);
  assert.match(html, /class="icon-btn chat-close"/);
  assert.match(css, /\.chat-close \{ width: 44px; height: 44px;/);
  assert.doesNotMatch(css, /\.chat \{ inset: 0;/, 'la hoja deja ver la cabecera y la barra inferior');
});

test('«atrás» cierra el asistente sin cambiar de vista (historial del navegador, no la lista de mensajes)', () => {
  assert.match(chat, /globalThis\.history\.pushState\(\{ ppChat: true \}/);
  assert.match(chat, /addEventListener\('popstate'/);
  assert.match(main, /initDismiss\(\)/);
});

test('ningún menú llena la pantalla en el móvil', () => {
  assert.match(css, /\[popover\]\.menu \{ right: 8px; left: 8px; width: auto; max-height: calc\(100dvh/);
});
