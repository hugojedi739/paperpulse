// Formulario de contacto (#/contact). Solo texto: motivo y mensaje. No usa correo ni servicios externos: lo guarda
// nuestro backend (POST /api/contact) y lo lee la administración en Administración → Mensajes.
import { api } from '../lib/api.c22010e9.js';
import { h, svgIcon, mount as put } from '../lib/el.71f9edc9.js';
import * as auth from '../lib/auth.cea835fb.js';

export const title = 'Contacto';
export const LIMITS = { reason: 100, message: 2000 };
/** Campo trampa: las personas no lo ven; los bots suelen rellenarlo y el servidor descarta el mensaje. */
export const HONEYPOT = 'website';

let root;

export function mount(el) {
  root = el;
  auth.onAuth(() => { if (!root.hidden && root.querySelector('form')) drawHint(); });
}

export function show() {
  document.title = 'Contacto — PaperPulse';
  drawForm();
}

const hint = () => (auth.currentUser()
  ? 'Estás con la sesión iniciada: el mensaje quedará asociado a tu cuenta.'
  : 'Puedes escribir sin cuenta. Si tu consulta trata de tus datos o de tu cuenta, inicia sesión antes de enviarla para que podamos identificarla.');

function drawHint() {
  const el = root.querySelector('[data-hint]');
  if (el) el.textContent = hint();
}

function drawForm() {
  const error = h('span', { class: 'cm-form-error', role: 'alert' });
  const count = h('small', { class: 'muted' }, `0 / ${LIMITS.message}`);
  const send = h('button', { type: 'submit', class: 'btn btn-primary' }, svgIcon('send', 'sm'), ' Enviar mensaje');
  const message = h('textarea', { id: 'ct-message', name: 'message', maxlength: String(LIMITS.message), rows: '7', required: true });
  message.addEventListener('input', () => { count.textContent = `${message.value.length} / ${LIMITS.message}`; });
  const form = h('form', { class: 'cm-form', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'ct-reason' }, 'Motivo'),
      h('input', { id: 'ct-reason', name: 'reason', type: 'text', maxlength: String(LIMITS.reason), required: true, autocomplete: 'off' })),
    h('div', { class: 'field' }, h('label', { for: 'ct-message' }, 'Mensaje'), message, count),
    // Honeypot: fuera de pantalla (clase .hp), sin foco y oculto a lectores de pantalla
    h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', { for: 'ct-web' }, 'No rellenar este campo'),
      h('input', { id: 'ct-web', name: HONEYPOT, type: 'text', tabindex: '-1', autocomplete: 'off' })),
    h('div', { class: 'cm-form-foot' }, error, send));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const reason = String(f.get('reason') ?? '').trim();
    const text = String(f.get('message') ?? '').trim();
    error.textContent = '';
    if (reason.length < 3) { error.textContent = 'Escribe un motivo (mínimo 3 caracteres).'; return; }
    if (text.length < 10) { error.textContent = 'El mensaje es demasiado corto (mínimo 10 caracteres).'; return; }
    send.disabled = true;
    try {
      await api('/api/contact', { method: 'POST', body: { reason, message: text, [HONEYPOT]: String(f.get(HONEYPOT) ?? '') } });
      drawSent();
    } catch (err) {
      error.textContent = err.message;
      send.disabled = false;
    }
  });
  put(root, h('div', { class: 'stack' },
    h('section', { class: 'card legal-page' },
      h('h2', { class: 'cm-thread-h' }, 'Contacto'),
      h('p', { class: 'learn-p' }, 'Este formulario es la vía de contacto de PaperPulse. No hay una dirección de correo publicada: el mensaje llega directamente a la administración de la aplicación.'),
      h('p', { class: 'hint', 'data-hint': '' }, hint()),
      form,
      h('p', { class: 'hint' }, 'No incluyas contraseñas ni datos que no sean necesarios. Más información en la ',
        h('a', { href: '#/legal/privacidad' }, 'política de privacidad'), '.'))));
}

function drawSent() {
  const again = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Escribir otro mensaje');
  again.addEventListener('click', drawForm);
  put(root, h('div', { class: 'stack' }, h('section', { class: 'card legal-page' },
    h('div', { class: 'empty' }, svgIcon('circle-check'), h('strong', {}, 'Mensaje enviado'),
      h('p', {}, 'Gracias. La administración lo revisará. Esta aplicación no envía correos de confirmación.'), again))));
}
