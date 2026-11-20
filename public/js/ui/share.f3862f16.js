// «Compartir en el foro»: publica una operación de la cuenta del servidor.
// Solo se envía el id de la ejecución y el comentario: activo, lado, precio y resultado los pone el servidor.
import * as C from '../lib/community.31779df3.js';
import * as account from '../lib/account.0b4bd9a1.js';
import { isServerMode } from '../lib/store.45a22d92.js';
import { h, svgIcon, mount } from '../lib/el.71f9edc9.js';
import { openDialog, toast } from '../lib/dom.a575914e.js';
import { price, pct, money } from '../lib/format.df74909c.js';
import { go } from '../lib/router.de30a562.js';

/** Id de la ejecución del servidor a partir del id de una operación del diario («f123»), o null si es local. */
export const fillIdOf = (trade) => (isServerMode() && /^f\d+$/.test(String(trade?.id ?? '')) ? Number(String(trade.id).slice(1)) : null);

/** Botón para filas del diario/historial (solo operaciones del servidor). Si ya se compartió, enlaza al hilo. */
export const shareButton = (trade) => (fillIdOf(trade) && Number.isInteger(trade.sharedThreadId)
  ? `<a class="btn btn-ghost btn-sm" href="#/community/thread:${trade.sharedThreadId}" title="Ya compartida: ver en el foro"><svg class="icon sm" aria-hidden="true"><use href="/img/icons.svg#message-square"></use></svg><span class="hide-sm"> En el foro</span></a>`
  : fillIdOf(trade)
  ? `<button type="button" class="btn btn-ghost btn-sm" data-share="${fillIdOf(trade)}" title="Compartir en el foro"><svg class="icon sm" aria-hidden="true"><use href="/img/icons.svg#share-2"></use></svg><span class="hide-sm"> Compartir</span></button>`
  : '');

export function shareDialog(trade) {
  const fillId = fillIdOf(trade);
  if (!fillId) return toast('Solo se pueden compartir operaciones de tu cuenta del servidor (con sesión iniciada).', 'info');
  const d = document.getElementById('dlg');
  d.className = 'dlg dlg-sm';
  const sell = trade.exitPrice != null;
  mount(d.querySelector('#dlg-content'),
    h('header', { class: 'dlg-head' },
      h('div', {}, h('h2', {}, 'Compartir en el foro'), h('p', {}, 'Se publicará en «Operaciones compartidas» con tu alias.')),
      h('button', { type: 'button', class: 'icon-btn', 'data-close': '', 'aria-label': 'Cerrar' }, svgIcon('x'))),
    h('form', { class: 'dlg-body cm-form', novalidate: true },
      h('dl', { class: 'summary' },
        h('div', {}, h('dt', {}, 'Activo'), h('dd', {}, `${trade.symbol} · ${trade.name ?? ''}`)),
        h('div', {}, h('dt', {}, 'Lado'), h('dd', {}, sell ? 'Venta' : 'Compra')),
        h('div', {}, h('dt', {}, 'Precio'), h('dd', {}, price(sell ? trade.exitPrice : trade.entryPrice, trade.quote))),
        sell ? h('div', {}, h('dt', {}, 'Resultado'), h('dd', { class: trade.pnl >= 0 ? 'up' : 'down' }, `${money(trade.pnl, { signed: true })} (${pct(trade.pnlPct)})`)) : null),
      h('p', { class: 'hint' }, svgIcon('info', 'sm'), ' Estos datos los toma el servidor de tu operación real; no se pueden editar.'),
      h('div', { class: 'field' }, h('label', { for: 'sh-comment' }, 'Comentario (opcional)'),
        h('textarea', { id: 'sh-comment', name: 'comment', maxlength: '2000', rows: '4', placeholder: '¿Por qué entraste o saliste? ¿Qué aprendiste?' })),
      h('div', { class: 'cm-form-foot' }, h('span', { class: 'cm-form-error', role: 'alert' }),
        h('button', { type: 'submit', class: 'btn btn-primary' }, svgIcon('share-2', 'sm'), ' Publicar'))));
  openDialog(d);
  const form = d.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const err = form.querySelector('.cm-form-error');
    btn.disabled = true;
    err.textContent = '';
    try {
      const r = await C.shareTrade(fillId, form.querySelector('textarea').value.trim());
      d.close();
      account.refresh().catch(() => {}); // el diario pasa a mostrar «En el foro»
      toast('Operación compartida en el foro.', 'success');
      go(`/community/thread:${r.threadId}`);
    } catch (ex) {
      err.textContent = C.needsProfile(ex) ? 'Primero crea tu alias en Comunidad → Mi perfil.' : C.errorMessage(ex);
    } finally {
      btn.disabled = false;
    }
  });
}
