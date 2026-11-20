// Pruebas del frontend de la comunidad: renderizado seguro del texto de usuarios y estado sin sesión.
// Node no trae DOM, así que se usa un DOM mínimo (lo justo para lib/el.js) que serializa como un navegador:
// el texto se escapa y solo los elementos creados con createElement son etiquetas.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- DOM mínimo ---------- */
const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; }
  append(...nodes) {
    for (const n of nodes) {
      const node = n instanceof Node ? n : new Text(String(n));
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = []; this.append(new Text(String(v))); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
}
class Text extends Node {
  constructor(data) { super(); this.data = data; }
  get textContent() { return this.data; }
  get outerHTML() { return escText(this.data); }
}
class Element extends Node {
  constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.attributes = new Map(); this.dataset = {}; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return k === 'class' ? this.className ?? null : this.attributes.get(k) ?? null; }
  get innerHTML() { return this.childNodes.map((c) => c.outerHTML).join(''); }
  set innerHTML(_) { throw new Error('innerHTML no debe usarse en la comunidad'); }
  get outerHTML() {
    const attrs = [...(this.className ? [['class', this.className]] : []), ...this.attributes,
      ...Object.entries(this.dataset).map(([k, v]) => [`data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, v])];
    const tag = this.tagName.toLowerCase();
    return `<${tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(String(v))}"`).join('')}>${this.innerHTML}</${tag}>`;
  }
  querySelectorAll(sel) {
    const tag = sel.toUpperCase();
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.tagName === tag) out.push(c); walk(c); });
    walk(this);
    return out;
  }
}
globalThis.Node = Node;
globalThis.document = {
  createElement: (t) => new Element(t),
  createElementNS: (_, t) => new Element(t),
  createTextNode: (s) => new Text(s),
  querySelector: () => null,
  getElementById: () => null,
  addEventListener: () => {},
};
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k), key: () => null, length: 0 };
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, method: opts?.method ?? 'GET' });
  return { ok: false, status: 401, json: async () => ({ error: 'Inicia sesión.' }) };
};

const { h, userText, svgIcon } = await import('../frontend/js/lib/el.js');
const C = await import('../frontend/js/lib/community.js');
const { fillIdOf, shareButton } = await import('../frontend/js/ui/share.js');
const store = await import('../frontend/js/lib/store.js');

beforeEach(() => { calls.length = 0; });

const XSS = '<script>alert("x")</script><img src=x onerror=alert(1)>';

/* ---------- Renderizado seguro ---------- */
test('un título con <script> o HTML sale como texto, no como etiquetas', () => {
  const el = h('h2', { class: 'cm-thread-h' }, XSS);
  assert.equal(el.children.length, 0); // ningún elemento hijo: solo un nodo de texto
  assert.equal(el.textContent, XSS); // el usuario ve exactamente lo que se escribió
  assert.equal(el.outerHTML, '<h2 class="cm-thread-h">&lt;script&gt;alert("x")&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</h2>');
  assert.equal(el.querySelectorAll('script').length, 0);
  assert.equal(el.querySelectorAll('img').length, 0);
});

test('los mensajes multilínea solo crean <br> y los enlaces quedan como texto', () => {
  const p = userText(`Hola <b>mundo</b>\nVisita https://estafa.example/?a=<i>\n${XSS}`);
  assert.deepEqual(p.children.map((c) => c.tagName), ['BR', 'BR']); // nada de <a>, <b>, <i>, <script> ni <img>
  assert.equal(p.querySelectorAll('a').length, 0);
  assert.match(p.innerHTML, /https:\/\/estafa\.example\/\?a=&lt;i&gt;/);
});

test('los atributos con texto de usuario se escapan y no se admiten eventos ni estilos en línea', () => {
  const b = h('button', { dataset: { alias: '"><script>x</script>' }, title: '" onmouseover="alert(1)' }, 'ok');
  assert.ok(!b.outerHTML.includes('"><script>'));
  assert.ok(b.outerHTML.includes('&quot; onmouseover=&quot;alert(1)'));
  for (const bad of ['onclick', 'onerror', 'style', 'srcdoc', 'innerHTML']) {
    assert.throws(() => h('div', { [bad]: 'alert(1)' }), /no permitido/, bad);
  }
});

test('solo se permiten enlaces internos (nunca una URL escrita por un usuario)', () => {
  assert.throws(() => h('a', { href: 'javascript:alert(1)' }), /internos/);
  assert.throws(() => h('a', { href: 'https://evil.example' }), /internos/);
  assert.throws(() => h('a', { href: '//evil.example' }), /internos/);
  assert.equal(h('a', { href: '#/community/forum' }).getAttribute('href'), '#/community/forum');
  assert.equal(svgIcon('flag').children.length, 1);
});

test('el contenido nunca se escribe con innerHTML', () => {
  // El DOM de prueba lanza si alguien asigna innerHTML: construir una vista de ejemplo no debe hacerlo
  assert.doesNotThrow(() => h('li', {}, h('strong', {}, XSS), userText(XSS), h('p', { text: XSS })));
});

/* ---------- Estado sin sesión ---------- */
test('sin sesión no se pide el perfil propio ni se hace ninguna petición', async () => {
  assert.equal(C.loggedIn(), false);
  assert.equal(await C.me(), null);
  assert.equal(calls.length, 0);
});

test('mensajes claros para 401, 403, 409 y 429', () => {
  assert.match(C.errorMessage({ status: 401 }), /Inicia sesión/);
  assert.match(C.errorMessage({ status: 403, message: 'Tu cuenta está suspendida en la comunidad hasta…' }), /suspendida/);
  assert.match(C.errorMessage({ status: 409, message: 'Ese alias ya está en uso. Elige otro.' }), /alias ya está en uso/);
  assert.match(C.errorMessage({ status: 429 }), /demasiado rápido/);
  assert.match(C.errorMessage({}), /No se pudo conectar/);
  assert.equal(C.needsProfile({ status: 403, message: 'Crea tu perfil público (alias) antes de participar' }), true);
  assert.equal(C.needsProfile({ status: 403, message: 'Tu cuenta está suspendida' }), false);
});

test('la clasificación se pide una vez y se reutiliza al volver a la pestaña', async () => {
  globalThis.fetch = async (url) => { calls.push({ url }); return { ok: true, status: 200, json: async () => ({ entries: [], total: 0 }) }; };
  await C.leaderboard('7d');
  await C.leaderboard('7d');
  await C.leaderboard('7d');
  assert.equal(calls.filter((c) => c.url.includes('leaderboard?period=7d')).length, 1);
  await C.leaderboard('total');
  assert.equal(calls.length, 2);
});

test('sin sesión no hay botón de compartir: solo operaciones del servidor', () => {
  const trade = { id: 'f42', symbol: 'BTC' };
  assert.equal(fillIdOf(trade), null); // modo local
  assert.equal(shareButton(trade), '');
  store.useAccount('server'); // «Mi cuenta» elegida en el selector
  store.applyServer({ capital: 10000, cash: 10000, positions: [], orders: [], trades: [] });
  assert.equal(fillIdOf(trade), 42);
  assert.match(shareButton(trade), /data-share="42"/);
  assert.equal(fillIdOf({ id: 'f42"><script>' }), null); // un id raro nunca llega al HTML
  assert.equal(fillIdOf({ id: 'abc-local-uuid' }), null);
  assert.match(shareButton({ ...trade, sharedThreadId: 7 }), /href="#\/community\/thread:7"/); // ya compartida: enlace al hilo
  assert.doesNotMatch(shareButton({ ...trade, sharedThreadId: '7"><script>' }), /script/); // solo enteros
  store.leaveServerMode();
});
