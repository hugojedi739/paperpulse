// Aceptación de términos y privacidad para cuentas que aún no la han dado.
//  · Cuenta nueva sin aceptar (alta con Google): diálogo que NO se puede cerrar hasta aceptar o cerrar sesión.
//  · Cuenta anterior a los textos legales («legacy») o con una versión antigua: aviso que se puede cerrar (una vez por sesión).
import { api } from '../lib/api.d1db7328.js';
import { LEGAL_VERSION } from '../lib/legal-content.dde43b20.js';
import { h, svgIcon, mount as put } from '../lib/el.71f9edc9.js';
import { openDialog, toast } from '../lib/dom.a575914e.js';
import * as auth from '../lib/auth.740770c1.js';

const SEEN = 'paperpulse_terms_prompted';
export const needsTerms = (user) => Boolean(user) && user.termsVersion !== LEGAL_VERSION;

/** Casillas de aceptación (también las usa el formulario de registro). */
export const consentFields = (idPrefix = 'tc') => [
  h('label', { class: 'cm-radio' }, h('input', { type: 'checkbox', name: 'acceptTerms', required: true, id: `${idPrefix}-terms` }),
    h('span', {}, ' He leído y acepto los ', h('a', { href: '#/legal/terminos', target: '_blank', rel: 'noopener' }, 'Términos de uso'), ' y la ',
      h('a', { href: '#/legal/privacidad', target: '_blank', rel: 'noopener' }, 'Política de privacidad'), '.')),
  h('label', { class: 'cm-radio' }, h('input', { type: 'checkbox', name: 'ageConfirmed', required: true, id: `${idPrefix}-age` }),
    h('span', {}, ' Declaro tener al menos 14 años.')),
];

export function maybeAskTerms(user) {
  if (!needsTerms(user)) return;
  const blocking = user.termsVersion == null;
  if (!blocking) { try { if (sessionStorage.getItem(SEEN)) return; sessionStorage.setItem(SEEN, '1'); } catch { /* sin almacenamiento */ } }
  const d = document.getElementById('dlg');
  d.className = 'dlg dlg-sm';
  const error = h('p', { class: 'cm-form-error', role: 'alert' });
  const form = h('form', { class: 'dlg-body cm-form', novalidate: true },
    h('p', {}, blocking ? 'Para usar PaperPulse tienes que aceptar los términos y la política de privacidad.' : 'Hemos añadido los textos legales de PaperPulse. Léelos y acéptalos para seguir participando en la comunidad.'),
    ...consentFields('tc'), error,
    h('div', { class: 'cm-form-foot' },
      h('button', { type: 'button', class: 'btn btn-ghost', dataset: { act: blocking ? 'logout' : 'later' } }, blocking ? 'Cerrar sesión' : 'Ahora no'),
      h('button', { type: 'submit', class: 'btn btn-primary' }, svgIcon('circle-check', 'sm'), ' Aceptar y continuar')));
  put(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' }, h('div', {}, h('h2', {}, 'Términos y privacidad'), h('p', {}, 'Simulador educativo con dinero virtual. No es asesoramiento financiero.')),
      blocking ? null : h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))), form);
  if (blocking) d.addEventListener('cancel', (e) => e.preventDefault(), { once: true }); // Escape no lo cierra
  openDialog(d);
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'logout') { d.close(); await auth.logout(); } else d.close();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    if (f.get('acceptTerms') !== 'on' || f.get('ageConfirmed') !== 'on') { error.textContent = 'Marca las dos casillas para continuar.'; return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      await api('/api/account/terms', { method: 'POST', body: { acceptTerms: true, ageConfirmed: true } });
      await auth.refreshUser();
      d.close();
      toast('Gracias. Ya puedes participar.', 'success', 2500);
    } catch (ex) { error.textContent = ex.message; } finally { btn.disabled = false; }
  });
}
