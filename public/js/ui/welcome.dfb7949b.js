// Bienvenida: elegir con cuánto dinero virtual se empieza. La usan la cuenta del servidor (primer acceso con sesión, antes de
// operar) y el modo local (empezar y reiniciar). Todo el texto es fijo; la validación se repite en el servidor.
import { h, svgIcon, mount } from '../lib/el.71f9edc9.js';
import { openDialog, toast, confirmDialog } from '../lib/dom.a575914e.js';
import { convert } from '../lib/format.df74909c.js';
import * as store from '../lib/store.13ad261a.js';
import * as account from '../lib/account.200b05ac.js';
import { PRESETS, DEFAULT_AMOUNT, START_MIN, START_MAX, formatEuro, parseAmount, smallBalanceNote, summaryLine } from '../lib/starting-balance.4c6d23aa.js';

/** @param {{ reset?: boolean }} options reset: ya hay una cuenta local y se reinicia con otro saldo */
export function openWelcome({ reset = false } = {}) {
  const server = account.isActive();
  const d = document.getElementById('dlg');
  d.className = 'dlg dlg-sm';
  let chosen = DEFAULT_AMOUNT; // un importe rápido o 'other'

  const chips = PRESETS.map((v) => h('button', { type: 'button', class: 'option', dataset: { v: String(v) }, 'aria-pressed': String(v === chosen) }, h('strong', {}, formatEuro(v))));
  const other = h('button', { type: 'button', class: 'option', dataset: { v: 'other' }, 'aria-pressed': 'false' }, h('strong', {}, 'Otra cantidad'));
  const input = h('input', { id: 'sb-custom', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: `${START_MIN} a ${START_MAX.toLocaleString('es-ES')}`, 'aria-describedby': 'sb-error sb-note' });
  const customRow = h('div', { class: 'field', hidden: true }, h('label', { for: 'sb-custom' }, 'Importe en euros'), h('div', { class: 'input-group' }, input, h('span', {}, '€')));
  const note = h('p', { id: 'sb-note', class: 'hint', role: 'status' });
  const error = h('p', { id: 'sb-error', class: 'cm-form-error', role: 'alert' });
  const summary = h('p', { class: 'hint' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, svgIcon('play', 'sm'), ' Crear mi cuenta de práctica');

  const current = () => parseAmount(chosen === 'other' ? input.value : chosen);
  const update = () => {
    const r = current();
    customRow.hidden = chosen !== 'other';
    for (const b of [...chips, other]) b.setAttribute('aria-pressed', String(b.dataset.v === String(chosen)));
    error.textContent = chosen === 'other' && input.value.trim() && !r.ok ? r.error : '';
    note.textContent = r.ok ? smallBalanceNote(r.value) : '';
    summary.textContent = r.ok ? summaryLine(r.value) : '';
    submit.disabled = !r.ok;
  };

  const form = h('form', { class: 'dlg-body cm-form', novalidate: true },
    h('p', {}, 'Los precios son reales y el dinero es virtual. Elige una cantidad parecida a la tuya y verás cómo te habría salido.'),
    h('div', { class: 'options', id: 'sb-options', role: 'group', 'aria-label': 'Saldo inicial' }, ...chips, other),
    customRow, note, summary, error,
    h('div', { class: 'cm-form-foot' }, submit));
  mount(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' }, h('div', {}, h('h2', {}, '¿Con cuánto dinero podrías invertir de verdad?')),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))), form);
  update();
  openDialog(d);

  form.addEventListener('click', (e) => {
    const b = e.target.closest('#sb-options [data-v]');
    if (!b) return;
    chosen = b.dataset.v === 'other' ? 'other' : Number(b.dataset.v);
    update();
    if (chosen === 'other') input.focus();
  });
  input.addEventListener('input', update);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = current();
    if (!r.ok) { error.textContent = r.error; return; }
    if (!server && reset && !(await confirmDialog({ title: '¿Reiniciar la cuenta?', body: 'Se cerrarán tus posiciones y órdenes pendientes sin registrarlas en el diario.', confirm: 'Reiniciar', danger: true }))) return;
    submit.disabled = true;
    try {
      if (server) await account.startAccount(r.value);
      else store.activate(convert(r.value, 'EUR', 'USD'), { amount: r.value, currency: 'EUR' });
      d.close();
      toast(`Cuenta de práctica lista con ${formatEuro(r.value)}.`, 'success');
    } catch (ex) {
      if (ex.status === 409) { await account.refresh().catch(() => {}); d.close(); toast(ex.message, 'info'); return; } // ya existía: no se puede cambiar
      error.textContent = ex.message;
      submit.disabled = false;
    }
  });
}
