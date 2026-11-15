// Diálogos de la aplicación. Todos se pintan en el <dialog id="dlg"> compartido.
import * as store from '../lib/store.d46470b9.js';
import { priceOf } from '../lib/feed.11bf2d56.js';
import { ASSETS, findAsset } from '../lib/catalog.f1b2b586.js';
import { html, icon, raw, render, openDialog, toast, confirmDialog, download, $ } from '../lib/dom.a575914e.js';
import { money, price, units, pct, currency, trendClass, timeAgo, setCurrencyPreference } from '../lib/format.df74909c.js';
import * as trading from '../lib/trading.b8f37fa3.js';
import * as account from '../lib/account.1d8defd0.js';
import * as auth from '../lib/auth.740770c1.js';
import { safeUrl } from '../lib/marketdata.9debd77d.js';
import { assetIcon, seg, pressSeg } from '../lib/ui.718834d3.js';
import { go } from '../lib/router.de30a562.js';
import { openWelcome } from './welcome.bbd5ca49.js';
import { startedWith, startedAmount, whatIfParts } from '../lib/starting-balance.4c6d23aa.js';

const dlg = () => document.getElementById('dlg');

function show(content, size = '') {
  const d = dlg();
  d.className = `dlg ${size}`;
  render($('#dlg-content', d), content);
  openDialog(d);
  return d;
}

const head = (title, sub) => html`<header class="dlg-head"><div><h2>${title}</h2>${sub ? html`<p>${sub}</p>` : ''}</div>
  <button class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></header>`;

export const SETUPS = ['Ruptura de resistencia', 'Rebote en soporte', 'Cruce de medias', 'Retroceso de Fibonacci', 'Sobreventa (RSI)', 'Noticia / fundamental', 'Prueba rápida'];
export const EMOTIONS = ['Disciplinado', 'Confiado', 'Dudoso', 'Impaciente', 'FOMO', 'Venganza'];
const options = (list, current) => list.map((x) => html`<option ${x === current ? 'selected' : ''}>${x}</option>`);

/* ---------- Cuenta de práctica ---------- */
/** «Si hubieras invertido tus X € de verdad…» (solo si se eligió el saldo; sin operaciones aún no dice nada aquí). */
function whatIfHint(p) {
  const w = whatIfParts(store.initialInput(), p.returnPct, p.rows.length > 0 || store.trades().length > 0);
  if (!w || w.intro) return '';
  return html`<p class="whatif">${icon('wallet', 'sm')} ${w.lead} <span class="money">${w.start}</span> ${w.mid} <strong class="money">${w.now}</strong>
    <span class="money delta ${trendClass(w.trend)}">(${w.diff})</span>.</p>`;
}
/** Con sesión la cuenta vive en el servidor: no se puede reiniciar ni cambiar el capital (sería trampa en las clasificaciones). */
function serverAccountDialog() {
  const p = trading.portfolio();
  const cfg = account.config();
  show(html`
    ${head('Tu cuenta de práctica', 'Guardada en el servidor y ligada a tu usuario.')}
    <div class="dlg-body">
      <dl class="summary">
        <div><dt>Patrimonio</dt><dd class="money">${money(p.equityUsd)}</dd></div>
        <div><dt>Efectivo libre</dt><dd class="money">${money(p.cashUsd)}</dd></div>
        <div><dt>Reservado en órdenes</dt><dd class="money">${money(p.reservedUsd)}</dd></div>
        <div><dt>Capital inicial</dt><dd class="money">${startedAmount(store.initialInput()) || money(store.initialCapital())}</dd></div>
        <div><dt>Rentabilidad</dt><dd class="delta ${trendClass(p.returnPct)}">${pct(p.returnPct)}</dd></div></dl>
      ${whatIfHint(p)}
      ${startedWith(store.initialInput()) ? html`<p class="hint">${icon('wallet', 'sm')} ${startedWith(store.initialInput())}. Tu saldo es privado; tu rentabilidad puede aparecer en la clasificación si tu perfil es público.</p>` : ''}
      <p class="hint">${icon('info', 'sm')} Los precios de ejecución los decide el servidor con cotizaciones reales.
        Comisión: ${(cfg.feeBps / 100).toLocaleString('es-ES', { useGrouping: 'always' })} % por operación; las órdenes a mercado y stop tienen además un deslizamiento de ${(cfg.slippageBps / 100).toLocaleString('es-ES')} %.</p>
      <p class="hint">${icon('shield-check', 'sm')} Esta cuenta no se puede reiniciar. Sin sesión puedes seguir practicando en modo local con el capital que quieras.</p>
    </div>
    <footer class="dlg-foot"><button class="btn btn-primary" data-close>Entendido</button></footer>`, 'dlg-sm');
}

export function accountDialog() {
  if (account.isActive()) return account.needsSetup() ? openWelcome() : serverAccountDialog();
  if (!store.hasPractice()) return openWelcome();
  const p = trading.portfolio();
  const d = show(html`
    ${head('Tu cuenta de práctica', 'Saldo virtual con cotizaciones reales.')}
    <div class="dlg-body">
      <dl class="summary">
        <div><dt>Patrimonio</dt><dd class="money">${money(p.equityUsd)}</dd></div>
        <div><dt>Efectivo</dt><dd class="money">${money(p.cashUsd)}</dd></div>
        <div><dt>Capital inicial</dt><dd class="money">${startedAmount(store.initialInput()) || money(store.initialCapital())}</dd></div>
        <div><dt>Rentabilidad</dt><dd class="delta ${trendClass(p.returnPct)}">${pct(p.returnPct)}</dd></div></dl>
      ${whatIfHint(p)}
      <p class="hint">${icon('info', 'sm')} Reiniciar cierra posiciones y órdenes y te deja elegir otro saldo. Tu diario, favoritos y alertas se conservan.</p>
    </div>
    <footer class="dlg-foot">
      <button class="btn btn-danger" data-act="close-account">Cerrar cuenta</button>
      <button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-primary" data-act="restart">${icon('rotate-ccw')} Reiniciar</button>
    </footer>`, 'dlg-sm');

  d.querySelector('[data-act="restart"]').onclick = () => openWelcome({ reset: true });
  d.querySelector('[data-act="close-account"]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '¿Cerrar la cuenta de práctica?', body: 'Volverás al modo consulta: se borran saldo, posiciones y órdenes. El diario y tus favoritos se mantienen.', confirm: 'Cerrar cuenta', danger: true }))) return;
    store.closeAccount();
    d.close();
    toast('Cuenta cerrada. Estás en modo consulta.', 'info');
  });
}

/* ---------- Cierre de posición con notas para el diario ---------- */
export function closePositionDialog(id, amount) {
  const pos = store.positions().find((p) => p.id === id);
  if (!pos) return;
  const qty = Math.min(amount ?? pos.amount, pos.amount);
  const v = trading.valuePosition({ ...pos, amount: qty });
  const fee = account.isActive() ? account.estimateFeeUsd(v.valueUsd) : 0; // con sesión el servidor cobra comisión
  const pnl = v.valueUsd - fee - pos.investedUsd * (qty / pos.amount);
  const d = show(html`
    ${head(`Vender ${pos.symbol}`, qty < pos.amount ? `Venta parcial de ${units(qty, pos.symbol)} de ${units(pos.amount, pos.symbol)}` : 'Cierre completo de la posición')}
    <div class="dlg-body">
      <dl class="summary">
        <div><dt>Precio de entrada</dt><dd>${price(pos.entryPrice, pos.quote)}</dd></div>
        <div><dt>Precio actual</dt><dd>${price(v.price, pos.quote)}</dd></div>
        <div><dt>Recibirás${fee ? ' aprox.' : ''}</dt><dd class="money">${money(v.valueUsd - fee)}</dd></div>
        ${fee ? html`<div><dt>Comisión estimada</dt><dd class="money">${money(fee)}</dd></div>` : ''}
        <div><dt>Resultado</dt><dd class="money delta ${trendClass(pnl)}">${money(pnl, { signed: true })}</dd></div>
      </dl>
      <div class="field"><label for="cp-setup">Estrategia</label><select id="cp-setup">${options(SETUPS)}</select></div>
      <div class="field"><label for="cp-emotion">¿Cómo te sentiste?</label><select id="cp-emotion">${options(EMOTIONS)}</select></div>
      <div class="field"><label for="cp-notes">Lección aprendida <span class="muted">(opcional)</span></label>
        <textarea id="cp-notes" maxlength="1000" placeholder="¿Respetaste tu plan? ¿Qué harías distinto?"></textarea></div>
    </div>
    <footer class="dlg-foot"><button class="btn btn-ghost" data-close>Cancelar</button>
      <button class="btn btn-down" data-act="sell">Confirmar venta</button></footer>`);
  d.querySelector('[data-act="sell"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const t = await trading.closePosition(id, {
        amount: qty, setup: d.querySelector('#cp-setup').value, emotion: d.querySelector('#cp-emotion').value, notes: d.querySelector('#cp-notes').value.trim(),
      });
      d.close();
      toast(`Venta registrada en tu diario: ${money(t.pnl, { signed: true })}`, t.pnl >= 0 ? 'success' : 'info');
    } catch (err) {
      toast(err.message, 'error');
      e.currentTarget.disabled = false;
    }
  };
}

/* ---------- Nota del diario ---------- */
export function noteDialog(tradeId) {
  const t = store.trades().find((x) => x.id === tradeId);
  if (!t) return;
  const d = show(html`${head(`Notas · ${t.symbol}`, new Date(t.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }))}
    <div class="dlg-body">
      <div class="field"><label for="n-setup">Estrategia</label><select id="n-setup">${options([...new Set([t.setup, ...SETUPS].filter(Boolean))], t.setup)}</select></div>
      <div class="field"><label for="n-emotion">Emoción</label><select id="n-emotion">${options([...new Set([t.emotion, ...EMOTIONS].filter(Boolean))], t.emotion)}</select></div>
      <div class="field"><label for="n-notes">Reflexión</label><textarea id="n-notes" maxlength="1000">${t.notes}</textarea></div>
    </div>
    <footer class="dlg-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-primary" data-act="save">Guardar</button></footer>`, 'dlg-sm');
  d.querySelector('[data-act="save"]').onclick = async () => {
    const journal = { setup: d.querySelector('#n-setup').value, emotion: d.querySelector('#n-emotion').value, notes: d.querySelector('#n-notes').value.trim() };
    try {
      if (account.isActive() && t.orderId) await account.saveJournal(t.orderId, journal); // operación del servidor
      else store.updateTrade(tradeId, journal);
      d.close();
      toast('Notas guardadas', 'success', 2000);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Alertas de precio ---------- */
export function alertsDialog(preset) {
  let asset = preset ?? findAsset('BTC');
  let condition = 'above';
  const d = show(html`${head('Alertas de precio', 'Te avisamos cuando un activo cruce el nivel que elijas mientras la app esté abierta.')}
    <div class="dlg-body">
      <div class="field"><label for="al-asset">Activo</label><select id="al-asset">
        ${[...new Set([asset, ...ASSETS])].map((a) => html`<option value="${a.symbol}" ${a === asset ? 'selected' : ''}>${a.name} (${a.symbol})</option>`)}</select></div>
      ${seg('cond', [['above', 'Sube por encima de'], ['below', 'Baja por debajo de']], condition)}
      <div class="field"><label for="al-target">Precio objetivo</label>
        <div class="input-group"><input id="al-target" type="number" inputmode="decimal" step="any" min="0"><span id="al-quote"></span></div>
        <span class="hint" id="al-now"></span></div>
      <button class="btn btn-primary" data-act="add">${icon('plus')} Crear alerta</button>
      <div class="rows" id="al-list"></div>
    </div>`, 'dlg-sm');

  const sync = () => {
    const px = priceOf(asset.symbol);
    d.querySelector('#al-quote').textContent = asset.quote;
    d.querySelector('#al-now').textContent = px ? `Precio actual: ${price(px, asset.quote)}` : 'Sin cotización ahora mismo';
    d.querySelector('#al-target').placeholder = px ? String(+px.toPrecision(6)) : '';
  };
  const list = () => {
    const items = store.alerts();
    render(d.querySelector('#al-list'), items.length ? items.map((a) => html`<div class="row">
      ${assetIcon(a.symbol, 'sm')}<div><strong>${a.symbol}</strong> <span class="muted">${a.condition === 'above' ? '≥' : '≤'} ${price(a.target, findAsset(a.symbol)?.quote)}</span>
      ${a.triggered ? html` <span class="chip warn">Disparada</span>` : ''}</div>
      <button class="icon-btn sm" data-del="${a.id}" aria-label="Eliminar alerta">${icon('trash-2', 'sm')}</button></div>`)
      : html`<p class="hint">No tienes alertas configuradas.</p>`);
  };
  sync(); list();
  const off = store.on('alerts', list);
  d.addEventListener('close', off, { once: true });
  d.querySelector('#al-asset').onchange = (e) => { asset = findAsset(e.target.value) ?? asset; sync(); };
  d.querySelector('[data-seg="cond"]').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { condition = b.dataset.value; pressSeg(d, 'cond', condition); }
  };
  d.querySelector('#al-list').onclick = (e) => { const b = e.target.closest('[data-del]'); if (b) store.removeAlert(b.dataset.del); };
  d.querySelector('[data-act="add"]').onclick = () => {
    const target = parseFloat(d.querySelector('#al-target').value);
    if (!(target > 0)) return toast('Introduce un precio objetivo válido.', 'warning');
    store.addAlert({ symbol: asset.symbol, condition, target });
    d.querySelector('#al-target').value = '';
    toast(`Alerta creada para ${asset.symbol}`, 'success', 2500);
  };
}

/* ---------- Ajustes y datos ---------- */
export function settingsDialog() {
  const s = store.settings();
  const d = show(html`${head('Ajustes', 'Preferencias y datos guardados en este navegador.')}
    <div class="dlg-body">
      <div class="field"><span class="label">Tema</span>${seg('theme', [['dark', 'Oscuro'], ['light', 'Claro']], document.documentElement.dataset.theme)}</div>
      <div class="field"><span class="label">Divisa de la cuenta</span>${seg('currency', [['auto', 'Auto'], ['EUR', 'EUR €'], ['USD', 'USD $'], ['GBP', 'GBP £']], s.currency)}</div>
      <hr>
      <span class="label">Tus datos</span>
      <div class="gap-8">
        <button class="btn btn-ghost btn-sm" data-act="export">${icon('download', 'sm')} Exportar copia (JSON)</button>
        <label class="btn btn-ghost btn-sm">${icon('upload', 'sm')} Importar copia<input type="file" accept="application/json,.json" hidden id="imp-file"></label>
      </div>
      <p class="hint">${auth.currentUser() ? `Sesión iniciada como ${auth.currentUser().email}: tus datos se guardan también en el servidor.` : 'Sin sesión, todo se guarda solo en este navegador. Inicia sesión para guardarlo en el servidor.'}</p>
      <div class="gap-8">
        <button class="btn btn-danger btn-sm" data-act="wipe">${icon('trash-2', 'sm')} Borrar datos de este navegador</button>
        ${auth.currentUser() ? html`<button class="btn btn-danger btn-sm" data-act="delete-account">${icon('trash-2', 'sm')} Eliminar mi cuenta</button>` : ''}
      </div>
    </div>`, 'dlg-sm');
  d.querySelector('[data-seg="theme"]').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pressSeg(d, 'theme', b.dataset.value);
    store.setSetting('theme', b.dataset.value);
  };
  d.querySelector('[data-seg="currency"]').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pressSeg(d, 'currency', b.dataset.value);
    setCurrencyPreference(b.dataset.value);
    store.setSetting('currency', b.dataset.value);
  };
  d.querySelector('[data-act="export"]').onclick = () => {
    download(`paperpulse_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportData(), null, 2), 'application/json');
  };
  d.querySelector('#imp-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5_000_000) return toast('El archivo es demasiado grande (máx. 5 MB).', 'error');
    try {
      const r = store.importData(await file.text());
      toast(`Copia restaurada: ${r.trades} operaciones y ${r.positions} posiciones.`, 'success');
      d.close();
    } catch (err) { toast(err.message, 'error'); }
  };
  d.querySelector('[data-act="wipe"]').onclick = async () => {
    if (!(await confirmDialog({ title: '¿Borrar todos tus datos?', body: 'Se eliminarán diario, posiciones, alertas, favoritos y ajustes de este navegador. No se puede deshacer. Si quieres conservarlos, exporta antes una copia.', confirm: 'Borrar definitivamente', danger: true }))) return;
    store.clearAll();
    d.close();
    toast('Datos eliminados.', 'info');
  };
  const del = d.querySelector('[data-act="delete-account"]');
  if (del) del.onclick = () => deleteAccountDialog();
}

/* ---------- Sesión ---------- */
const PROVIDER_LOGOS = {
  google: raw('<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>'),
  okta: raw('<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="#2f6fe4" stroke-width="4"/></svg>'),
};

export async function authDialog(mode = 'login') {
  let opts = { password: true, registration: true, providers: [] };
  try { opts = await auth.providers(); } catch { /* sin servidor: solo el formulario */ }
  const reg = mode === 'register' && opts.password && opts.registration;
  const sso = opts.providers.length ? html`<div class="oauth-list">
      ${opts.providers.map((p) => html`<button type="button" class="btn btn-ghost btn-oauth" data-provider="${p.id}">${PROVIDER_LOGOS[p.id] ?? icon('log-in', 'sm')} Continuar con ${p.name}</button>`)}
    </div>${opts.password ? html`<div class="divider">o con tu email</div>` : ''}` : '';
  const form = opts.password ? html`
      ${reg ? html`<div class="field"><label for="a-name">Nombre</label><input id="a-name" name="name" autocomplete="nickname" maxlength="40"></div>` : ''}
      <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="username" required maxlength="254"></div>
      <div class="field"><label for="a-pass">Contraseña</label><input id="a-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 8 : 1}" maxlength="128">
        ${reg ? html`<small class="hint">Mínimo 8 caracteres.</small>` : ''}</div>
      ${reg ? html`<label class="cm-radio"><input type="checkbox" name="acceptTerms" required> <span>He leído y acepto los <a href="#/legal/terminos" target="_blank" rel="noopener">Términos de uso</a> y la <a href="#/legal/privacidad" target="_blank" rel="noopener">Política de privacidad</a>.</span></label>
        <label class="cm-radio"><input type="checkbox" name="ageConfirmed" required> <span>Declaro tener al menos 14 años.</span></label>` : ''}
      <p class="hint down" id="a-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">${icon(reg ? 'user' : 'log-in', 'sm')} ${reg ? 'Crear cuenta' : 'Entrar'}</button>
      ${opts.registration ? html`<p class="hint">${reg ? '¿Ya tienes cuenta?' : '¿Aún no tienes cuenta?'} <button type="button" class="link" data-act="switch">${reg ? 'Inicia sesión' : 'Crea una gratis'}</button></p>` : ''}`
    : opts.providers.length ? '' : html`<p class="hint">El inicio de sesión no está disponible ahora mismo.</p>`;
  const d = show(html`${head(reg ? 'Crear cuenta' : 'Iniciar sesión', 'Guarda tu cuenta de práctica y tu diario en el servidor y recupéralos en cualquier dispositivo.')}
    <form class="dlg-body" id="auth-form" novalidate>${sso}${form}
      <p class="hint">PaperPulse es un simulador educativo con dinero virtual. ${reg ? 'Si entras con Google, te pediremos aceptar los términos al terminar.' : ''}
        <a href="#/legal/aviso-legal" target="_blank" rel="noopener">Aviso legal</a> · <a href="#/legal/privacidad" target="_blank" rel="noopener">Privacidad</a> · <a href="#/legal/terminos" target="_blank" rel="noopener">Términos</a> · <a href="#/legal/cookies" target="_blank" rel="noopener">Cookies</a> · <a href="#/legal/normas" target="_blank" rel="noopener">Normas</a></p></form>`, 'dlg-sm');
  d.querySelectorAll('[data-provider]').forEach((b) => { b.onclick = () => auth.loginWith(b.dataset.provider); });
  const sw = d.querySelector('[data-act="switch"]');
  if (sw) sw.onclick = () => authDialog(reg ? 'login' : 'register');
  if (!opts.password) return;
  const formEl = d.querySelector('#auth-form');
  const err = d.querySelector('#a-error');
  formEl.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(formEl));
    const btn = formEl.querySelector('[type="submit"]');
    btn.disabled = true;
    err.hidden = true;
    try {
      if (reg && (f.acceptTerms !== 'on' || f.ageConfirmed !== 'on')) throw new Error('Para crear la cuenta acepta los términos y la política de privacidad y confirma que tienes al menos 14 años.');
      if (reg) await auth.register(f.name, f.email, f.password, { acceptTerms: true, ageConfirmed: true });
      else await auth.login(f.email, f.password, chooseCloudData);
      d.close();
      toast(reg ? 'Cuenta creada. Tus datos se guardan en el servidor.' : `Hola de nuevo, ${auth.currentUser().name}.`, 'success');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  };
  d.querySelector(reg ? '#a-name' : '#a-email').focus();
}

/** Pregunta qué datos conservar si la cuenta y el navegador tienen datos distintos. */
export function chooseCloudData(remote) {
  // La alternativa no es «cancelar»: rechazar sustituye los datos de la cuenta por los del navegador
  const alt = $('#confirm-dialog [data-close]');
  alt.textContent = 'Usar los de este navegador';
  return confirmDialog({
    title: 'Hay datos guardados en tu cuenta',
    body: `Tu cuenta tiene datos guardados el ${new Date(remote.updatedAt * 1000).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}. ¿Los cargas aquí o los sustituyes por los de este navegador?`,
    confirm: 'Cargar los de mi cuenta',
  }).finally(() => { alt.textContent = 'Cancelar'; });
}

function deleteAccountDialog() {
  const withPassword = auth.currentUser()?.hasPassword;
  const d = show(html`${head('Eliminar cuenta', 'Se borrarán o anonimizarán tus datos personales, tu cuenta de práctica y tu perfil. Tus mensajes del foro se vacían. No se puede deshacer.')}
    <form class="dlg-body" id="del-form">
      ${withPassword
        ? html`<div class="field"><label for="del-pass">Confirma con tu contraseña</label><input id="del-pass" type="password" autocomplete="current-password" required maxlength="128"></div>`
        : html`<div class="field"><label for="del-pass">Escribe ELIMINAR para confirmar</label><input id="del-pass" autocomplete="off" required maxlength="20"></div>`}
      <p class="hint down" id="del-error" role="alert" hidden></p>
      <p class="hint"><button type="button" class="link" data-act="export">Descargar mis datos (JSON)</button> antes de eliminar.</p>
    </form>
    <footer class="dlg-foot"><button class="btn btn-ghost" data-close>Cancelar</button><button class="btn btn-danger" type="submit" form="del-form">Eliminar definitivamente</button></footer>`, 'dlg-sm');
  d.querySelector('[data-act="export"]').onclick = () => auth.downloadMyData().then(() => toast('Datos descargados.', 'success', 2500)).catch((ex) => toast(ex.message, 'error'));
  d.querySelector('#del-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await auth.deleteAccount(d.querySelector('#del-pass').value);
      d.close();
      toast('Cuenta eliminada. Tus datos personales se han borrado del servidor; los de este navegador siguen aquí.', 'info');
    } catch (ex) {
      const el = d.querySelector('#del-error');
      el.textContent = ex.message;
      el.hidden = false;
    }
  };
}

/* ---------- Lector de noticias ---------- */
export function newsDialog(article) {
  const img = safeUrl(article.imageUrl);
  const url = safeUrl(article.url);
  const related = ASSETS.find((a) => new RegExp(`\\b(${a.symbol}|${a.name.split(' ')[0]})\\b`, 'i').test(article.title) && a.name.length > 3);
  const d = show(html`${head(article.source, `${article.author && article.author !== article.source ? `${article.author} · ` : ''}${timeAgo(article.date)}`)}
    <div class="dlg-body">
      ${img ? html`<img class="reader-img" src="${img}" alt="" referrerpolicy="no-referrer" loading="lazy">` : ''}
      <h2>${article.title}</h2>
      ${article.excerpt ? html`<p class="muted">${article.excerpt}</p>` : ''}
      <p class="hint">Mostramos el titular y el resumen del medio original. Para leer la noticia completa, abre la fuente.</p>
    </div>
    <footer class="dlg-foot">
      ${related ? html`<button class="btn btn-ghost" data-act="trade">${icon('chart-candlestick', 'sm')} Ver ${related.symbol}</button>` : ''}
      ${url ? html`<a class="btn btn-primary" href="${url}" target="_blank" rel="noopener noreferrer">Leer en ${article.source} ${icon('external-link', 'sm')}</a>` : ''}
    </footer>`, 'dlg-lg');
  d.querySelector('[data-act="trade"]')?.addEventListener('click', () => { d.close(); go(`/trade/${related.symbol}`); });
}

/* ---------- Manual de operativa ---------- */
export function guideDialog() {
  const d = show(html`${head('Manual de operativa', 'Lo esencial para practicar con cabeza.')}
    <div class="dlg-body guide">
      <section><h3>${icon('coins')} 1. Elige el mercado</h3>
        <ul><li><strong>Cripto:</strong> abierto 24/7, movimientos diarios del 3 al 10 %.</li>
        <li><strong>Acciones:</strong> horario de cada bolsa (Madrid 9:00–17:30, Nueva York 15:30–22:00 hora peninsular), variaciones más moderadas.</li></ul></section>
      <section><h3>${icon('chart-candlestick')} 2. Lee las velas</h3>
        <p>Cada vela resume un periodo: el cuerpo va de la apertura al cierre y las mechas marcan el máximo y el mínimo. <span class="up">Verde</span> si cerró más arriba de lo que abrió, <span class="down">roja</span> si cerró más abajo.</p></section>
      <section><h3>${icon('zap')} 3. Escoge el tipo de orden</h3>
        <ul><li><strong>Mercado:</strong> se ejecuta al instante al precio actual.</li>
        <li><strong>Límite:</strong> compra solo si el precio baja hasta tu nivel. Reserva el saldo mientras espera.</li>
        <li><strong>Stop-límite:</strong> se activa cuando el precio sube hasta el stop y compra como máximo al límite. Útil para entrar en rupturas.</li></ul></section>
      <section><h3>${icon('shield-check')} 4. Controla el riesgo</h3>
        <p>Regla del 1–2 %: no arriesgues más de ese porcentaje de tu capital en una sola operación.</p>
        <div class="gap-8">
          <div class="field"><label for="g-cap">Capital</label><div class="input-group"><input id="g-cap" type="number" value="1000"><span>${currency()}</span></div></div>
          <div class="field"><label for="g-risk">Riesgo %</label><div class="input-group"><input id="g-risk" type="number" value="1" step="0.5"><span>%</span></div></div>
          <div class="field"><label for="g-stop">Stop a</label><div class="input-group"><input id="g-stop" type="number" value="5" step="0.5"><span>% del precio</span></div></div>
        </div>
        <p id="g-out"></p></section>
    </div>`, 'dlg-lg');
  const calc = () => {
    const cap = +d.querySelector('#g-cap').value, risk = +d.querySelector('#g-risk').value, stop = +d.querySelector('#g-stop').value;
    const loss = cap * (risk / 100);
    const size = stop > 0 ? loss / (stop / 100) : 0;
    render(d.querySelector('#g-out'), html`Pérdida máxima: <strong>${money(loss, { from: currency() })}</strong> · Tamaño de posición: <strong>${money(size, { from: currency() })}</strong>
      ${size > cap ? html` <span class="chip warn">Supera tu capital</span>` : ''}`);
  };
  d.querySelector('.guide').addEventListener('input', calc);
  calc();
}

export function shortcutsDialog() {
  const k = (keys, label) => html`<div><span>${label}</span><span class="gap-8">${keys.map((x) => html`<kbd>${x}</kbd>`)}</span></div>`;
  show(html`${head('Atajos de teclado')}
    <div class="dlg-body shortcuts">
      ${k(['Ctrl', 'K'], 'Buscar activos y comandos')} ${k(['/'], 'Buscar')}
      ${k(['1'], 'Resumen')} ${k(['2'], 'Operar')} ${k(['3'], 'Mercados')} ${k(['4'], 'Noticias')} ${k(['5'], 'Diario')}
      ${k(['B'], 'Comprar el activo actual')} ${k(['S'], 'Vender el activo actual')} ${k(['T'], 'Cambiar tema')} ${k(['?'], 'Esta ayuda')}
    </div>`, 'dlg-sm');
}
