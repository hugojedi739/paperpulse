// Estado de la cabecera: hora de la última cotización recibida y distintivo Abierto/Cerrado de las bolsas (/api/markets).
import * as store from '../lib/store.f9db7346.js';
import { html, render, $ } from '../lib/dom.700bdea1.js';

const MARKETS = [['us', 'Wall St'], ['es', 'Madrid']];
let lastAt = 0;

function ago() {
  if (!lastAt) return 'sin datos todavía';
  const s = Math.max(0, Math.round((Date.now() - lastAt) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}

function draw() {
  const known = new Map(store.markets().map((m) => [m.id, m.open]));
  const badges = MARKETS.map(([id, label]) => {
    const open = known.get(id);
    const state = open == null ? 'Sin datos' : open ? 'Abierto' : 'Cerrado';
    return html`<span class="mkt-badge" data-open="${open === true}" title="Bolsa de ${label}"><i aria-hidden="true"></i>${label} <b>${state}</b></span>`;
  });
  render($('#hdr-status'), html`<span class="last-update"><span class="hide-sm">Última actualización: </span>${ago()}</span>${badges}`);
}

store.on('prices', () => { lastAt = Date.now(); });
store.on('markets', draw);
setInterval(draw, 1000);
draw();
