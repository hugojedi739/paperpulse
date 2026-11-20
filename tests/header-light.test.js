// Cabecera ligera: accesibilidad del selector Demo / Mi cuenta y de la etiqueta, franja plegable y CSP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../frontend/js/main.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/css/app.css', import.meta.url), 'utf8');
const topbar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
const strip = html.slice(html.indexOf('id="statusbar"'), html.indexOf('id="ticker"'));

test('el selector Demo / Mi cuenta sigue siendo un grupo de radio y vive en la franja de estado', () => {
  assert.match(strip, /id="acct-switch" role="radiogroup"/);
  assert.doesNotMatch(topbar, /acct-switch/, 'ya no está en la cabecera');
});

test('la etiqueta de la cuenta sigue avisando al lector de pantalla (role=status) y tiene su «?»', () => {
  assert.match(strip, /id="acct-tag" role="status"/);
  assert.match(strip, /id="acct-help"[^>]*popovertarget="acct-info"/);
  assert.match(strip, /id="feed-status" role="status"/);
});

test('móvil: en la cabecera quedan buscador, saldo y perfil; tema y campana pasan al menú de perfil', () => {
  assert.match(topbar, /data-action="theme"[^>]*class|class="icon-btn hide-sm" data-action="theme"/);
  assert.match(topbar, /class="icon-btn hide-sm" popovertarget="notif-pop"/);
  assert.match(html, /<button type="button" class="only-sm" data-action="notifications">/);
  assert.match(html, /data-action="theme"><svg class="icon"><use href="\/img\/icons.svg#moon"/);
  assert.match(main, /notifications: \(\) =>/);
});

test('el perfil avisa de las notificaciones sin leer con un punto y con su etiqueta accesible', () => {
  assert.match(topbar, /id="avatar-badge"/);
  assert.match(main, /notificaciones sin leer/);
});

test('la franja se pliega con un botón accesible (aria-expanded) y se recuerda', () => {
  assert.match(strip, /id="strip-toggle" aria-expanded="false" aria-controls="hdr-status"/);
  assert.match(main, /paperpulse_strip_open/);
});

test('CSP y rendimiento: sin estilos ni eventos inline y sin backdrop-filter nuevo en la franja', () => {
  assert.doesNotMatch(topbar + strip, /\sstyle=|\son[a-z]+=/);
  const block = css.slice(css.indexOf('/* Franja de estado con la cuenta'), css.indexOf('/* Tarjetas */'));
  assert.doesNotMatch(block, /backdrop-filter/);
});
