// Selector «Demo / Mi cuenta» de la cabecera (patrón de grupo de radio: Tab entra en la opción marcada, flechas,
// Inicio y Fin cambian de opción) y etiqueta «… · dinero virtual» siempre visible en la barra de estado.
// Sin sesión, «Mi cuenta» invita a iniciar sesión o registrarse. Texto con nodos (lib/el.js), sin innerHTML.
import * as store from '../lib/store.13ad261a.js';
import * as account from '../lib/account.200b05ac.js';
import { DEMO, SERVER, LABELS } from '../lib/account-mode.c78c079a.js';
import { h, mount, svgIcon } from '../lib/el.71f9edc9.js';

const OPTIONS = [
  { mode: DEMO, icon: 'graduation-cap' },
  { mode: SERVER, icon: 'wallet' },
];

let handlers = { login: () => {}, welcome: () => {} };

function select(mode) {
  const result = account.choose(mode);
  if (result === 'login') handlers.login(); // sin sesión: el selector no cambia hasta iniciar sesión
  else if (mode === SERVER && account.needsSetup()) handlers.welcome(); // con sesión pero sin cuenta del servidor
  draw();
}

/** Pinta el selector según la cuenta activa (la que se ve y con la que se opera). */
export function draw() {
  const box = document.getElementById('acct-switch');
  if (!box) return;
  const current = store.activeAccount();
  const session = account.hasSession();
  const focused = box.contains(document.activeElement);
  mount(box, OPTIONS.map(({ mode, icon }) => {
    const on = mode === current;
    const extra = mode === SERVER && !session ? ' Requiere iniciar sesión.' : '';
    return h('button', {
      type: 'button', role: 'radio', class: 'acct-opt', 'aria-checked': String(on), tabindex: on ? '0' : '-1',
      title: LABELS[mode].hint + extra, dataset: { mode },
    }, svgIcon(icon, 'sm'), h('span', { class: 'acct-opt-text' }, LABELS[mode].short),
    mode === SERVER && !session ? h('span', { class: 'sr-only' }, ' (inicia sesión)') : null);
  }));
  if (focused) box.querySelector('[aria-checked="true"]')?.focus();
  const tag = document.getElementById('acct-tag');
  if (tag) {
    mount(tag, svgIcon(current === DEMO ? 'graduation-cap' : 'wallet', 'sm'), h('span', {}, LABELS[current].tag));
    tag.dataset.mode = current;
    tag.title = LABELS[current].hint;
  }
}

function onKey(e) {
  const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: 'first', End: 'last' };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const i = OPTIONS.findIndex((o) => o.mode === store.activeAccount());
  const step = keys[e.key];
  const next = step === 'first' ? 0 : step === 'last' ? OPTIONS.length - 1 : (i + step + OPTIONS.length) % OPTIONS.length;
  select(OPTIONS[next].mode);
}

/** Se llama una vez al arrancar (main.js) con cómo abrir el inicio de sesión y el diálogo de saldo inicial. */
export function initAccountSwitch({ login, welcome }) {
  handlers = { login, welcome };
  const box = document.getElementById('acct-switch');
  box?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mode]');
    if (btn) select(btn.dataset.mode);
  });
  box?.addEventListener('keydown', onKey);
  store.on('account', draw);
  draw();
}
