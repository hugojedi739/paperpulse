// Utilidades de DOM: plantillas con escape automático, delegación de eventos, diálogos y toasts.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class SafeHTML {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
/** Marca una cadena como HTML de confianza (solo para contenido generado por la propia app). */
export const raw = (s) => new SafeHTML(String(s));

const part = (v) => {
  if (v == null || v === false) return '';
  if (v instanceof SafeHTML) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return escape(v);
};
/** Plantilla etiquetada: todo valor interpolado se escapa salvo que venga de html`` o raw(). */
export const html = (strings, ...vals) =>
  new SafeHTML(strings.reduce((acc, s, i) => acc + s + (i < vals.length ? part(vals[i]) : ''), ''));

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Pinta una plantilla y aplica los anchos dinámicos (data-w) sin atributos style (CSP estricta). */
export function render(el, tpl) {
  if (!el) return;
  el.innerHTML = Array.isArray(tpl) ? tpl.join('') : String(tpl);
  applyVars(el);
}
export function applyVars(root) {
  for (const el of root.querySelectorAll('[data-w], [data-l]')) {
    if (el.dataset.w) el.style.setProperty('--w', `${el.dataset.w}%`);
    if (el.dataset.l) el.style.setProperty('--l', `${el.dataset.l}%`);
  }
}

export const icon = (name, cls = '') =>
  raw(`<svg class="icon ${escape(cls)}" aria-hidden="true"><use href="/img/icons.svg#${escape(name)}"></use></svg>`);

/** Delegación: on(root, 'click', '[data-action]', (e, el) => …) */
export function on(root, type, selector, fn, opts) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  }, opts);
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/** Coloca un popover junto al botón que lo abre (alternativa a CSS anchor positioning). */
export function anchorPopover(pop) {
  pop.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const btn = document.querySelector(`[popovertarget="${pop.id}"]`);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8, innerWidth - 260))}px`;
    pop.style.right = 'auto';
  });
}

/* ---------- Diálogos nativos <dialog> ---------- */
export function openDialog(id) {
  const d = typeof id === 'string' ? document.getElementById(id) : id;
  if (d && !d.open) d.showModal();
  return d;
}
export const closeDialog = (id) => document.getElementById(id)?.close();

// Cierre por botones [data-close] y por clic en el fondo
globalThis.document?.addEventListener('click', (e) => {
  const closer = e.target.closest('[data-close]');
  if (closer) return closer.closest('dialog')?.close();
  if (e.target instanceof HTMLDialogElement) {
    const r = e.target.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.target.close();
  }
});

/** Diálogo de confirmación reutilizable. Devuelve una promesa booleana. */
export function confirmDialog({ title, body, confirm = 'Confirmar', danger = false, requireText = '' }) {
  const d = document.getElementById('confirm-dialog');
  render(d.querySelector('.dlg-body'), html`<h2>${title}</h2><p class="muted">${body}</p>`);
  const ok = d.querySelector('[data-confirm]');
  ok.textContent = confirm;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  ok.disabled = false;
  if (requireText) { // acciones irreversibles: el botón sigue desactivado hasta escribir el texto exacto (sin distinguir mayúsculas)
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = requireText;
    input.setAttribute('aria-label', `Escribe ${requireText} para confirmar`);
    const matches = () => input.value.trim().toLowerCase() === requireText.toLowerCase();
    ok.disabled = true;
    input.addEventListener('input', () => { ok.disabled = !matches(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && matches()) { e.preventDefault(); ok.click(); } });
    d.querySelector('.dlg-body').append(input);
  }
  openDialog(d);
  return new Promise((resolve) => {
    const done = (v) => { ok.onclick = null; d.onclose = null; resolve(v); };
    ok.onclick = () => { done(true); d.close(); };
    d.onclose = () => done(false);
  });
}

/* ---------- Toasts ---------- */
const TOAST_ICONS = { success: 'circle-check', error: 'triangle-alert', warning: 'triangle-alert', info: 'info' };
export function toast(message, type = 'info', ms = 4000) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  render(el, html`${icon(TOAST_ICONS[type] || 'info')}<span></span>
    <button class="icon-btn sm" aria-label="Cerrar">${icon('x')}</button>`);
  el.querySelector('span').textContent = String(message ?? ''); // puede incluir texto de usuarios (alias, motivos)
  box.append(el);
  let timer;
  const dismiss = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  const start = () => { timer = setTimeout(dismiss, ms); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  el.querySelector('button').addEventListener('click', dismiss);
  start();
}

/** Anuncia cambios a lectores de pantalla. */
export function announce(msg) {
  const live = document.getElementById('sr-live');
  if (live) live.textContent = msg;
}

/** Descarga un archivo generado en el navegador. */
export function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
