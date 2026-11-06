// Construcción de DOM sin innerHTML, para todo lo que muestre texto de usuarios (comunidad, moderación).
//
//   h('p', { class: 'muted', dataset: { id: 7 } }, 'Hola ', h('strong', {}, alias))
//
// Las cadenas hijas se insertan como nodos de texto (createTextNode): un «<script>» se ve como texto y nunca se
// interpreta. No se admiten atributos on* (eventos inline) ni style (la CSP los bloquearía): los eventos van por
// delegación con on() de dom.js y los estilos con clases.

const SVG_NS = 'http://www.w3.org/2000/svg';
const BLOCKED = /^(on|style$|srcdoc$|innerhtml$|outerhtml$)/i;
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);

function append(parent, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) { for (const c of child) append(parent, c); return; }
  parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
}

/** Crea un elemento. `props`: class, dataset, aria-*, y cualquier atributo salvo on* y style. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (BLOCKED.test(key)) throw new Error(`Atributo no permitido: ${key}`);
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'text') el.textContent = String(value);
    else if (URL_ATTRS.has(key.toLowerCase()) && !/^(#|\/(?!\/))/.test(String(value))) {
      throw new Error(`Solo se permiten enlaces internos en ${key}`); // nunca URLs escritas por usuarios
    } else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

/** Icono del sprite (mismo resultado que icon() de dom.js, pero como nodo). */
export function svgIcon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/img/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** Sustituye el contenido de `el` por los nodos dados. */
export function mount(el, ...children) {
  if (!el) return;
  el.replaceChildren();
  append(el, children);
}

/**
 * Texto multilínea de un usuario: cada línea es un nodo de texto y los saltos son <br>.
 * Los enlaces se quedan como texto plano (no se convierten en <a>).
 */
export function userText(text, cls = 'user-text') {
  const p = h('p', { class: cls });
  String(text ?? '').split('\n').forEach((line, i) => {
    if (i) p.append(document.createElement('br'));
    p.append(document.createTextNode(line));
  });
  return p;
}

/* ---------- Piezas comunes con el aspecto de la app ---------- */
export const emptyState = (iconName, title, text, action) =>
  h('div', { class: 'empty' }, svgIcon(iconName), h('strong', {}, title), text ? h('p', {}, text) : null, action ?? null);

export const loading = (label = 'Cargando…') =>
  h('div', { class: 'sk-rows', role: 'status' },
    [0, 1, 2, 3].map(() => h('span', { class: 'skeleton sk-line' })), h('span', { class: 'sk-caption' }, label));

export const button = (label, props = {}, iconName) =>
  h('button', { type: 'button', class: 'btn btn-sm btn-ghost', ...props }, iconName ? svgIcon(iconName, 'sm') : null, label);
