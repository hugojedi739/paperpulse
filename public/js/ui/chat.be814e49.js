// Asistente IA: panel lateral con respuestas en streaming (SSE) desde /api/chat.
import * as store from '../lib/store.a368de54.js';
import { tick } from '../lib/feed.14272b63.js';
import { findAsset, displayPair } from '../lib/catalog.847c7742.js';
import { html, escape, render, $ } from '../lib/dom.a575914e.js';
import { money, price, pct, currency, locale, approx } from '../lib/format.df8faa5e.js';
import { portfolio } from '../lib/trading.cd85fc1b.js';
import { INTERVALS, normalizeInterval } from '../lib/marketdata.96e24305.js';
import { markdown } from '../lib/markdown.70f08f7e.js';
import { apiUrl } from '../lib/api.fadcc3a8.js';
import { current } from '../lib/router.de30a562.js';

// Deben coincidir con SUGGESTIONS de backend/chat_fixed.py (se responden sin IA; lo comprueba un test)
export const SUGGESTIONS = ['¿Cómo está el mercado hoy?', '¿Cómo leo las velas?', 'Explícame el RSI', '¿Cómo gestiono el riesgo?', '¿Qué es una orden límite?'];
const history = [];
let busy = false;
let currentAsset = () => findAsset('BTC');

/**
 * Sugerencias según la pantalla. Las de SUGGESTIONS (arriba) se responden al momento sin IA; el resto van a la IA,
 * que recibe en el contexto el activo y la temporalidad abiertos (por eso entiende «este gráfico»).
 */
export function suggestionsFor(route, asset) {
  if (route === 'trade' && asset) return ['Explícame este gráfico', '¿Qué significa el RSI?', 'Cómo calculo el riesgo de esta orden', '¿Qué es una orden límite?'];
  if (route === 'markets') return ['¿Qué se mueve hoy?', '¿Cómo está el mercado hoy?', '¿Cómo leo las velas?'];
  if (route === 'learn') return ['¿Cómo leo las velas?', '¿Cómo gestiono el riesgo?', '¿Qué es una orden límite?'];
  return SUGGESTIONS.slice(0, 3);
}

/** Línea gris de la cabecera: dónde está la persona (en Operar, el par y la temporalidad). */
function contextLine() {
  const { route } = current();
  const a = currentAsset();
  if (route === 'trade' && a) return `${displayPair(a)} · ${INTERVALS[normalizeInterval(store.settings().interval)].label}`;
  return { markets: 'Mercados', learn: 'Aprender', dashboard: 'Resumen' }[route] ?? '';
}

/** Sugerencias en filas finas con «›»; solo mientras la conversación no ha empezado. */
function renderSuggestions() {
  const box = $('#chat-suggest');
  const started = history.length > 0 || busy;
  box.hidden = started;
  if (started) return;
  render(box, suggestionsFor(current().route, currentAsset()).map((q) => html`<button type="button" class="chat-sug" data-q="${q}"><span>${q}</span><span aria-hidden="true">›</span></button>`));
}

function refreshContext() {
  $('#chat-ctx').textContent = contextLine();
  renderSuggestions();
}

/** El campo crece con el texto hasta 4 líneas (después, se desplaza). */
function autosize(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, input.dataset.max ? Number(input.dataset.max) : 112)}px`;
}

export function initChat({ getAsset }) {
  currentAsset = getAsset;
  const input = $('#chat-input');
  $('#chat-suggest').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) send(b.dataset.q); });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy || !input.value.trim()) return; // mientras responde, el texto se queda en el campo (antes se perdía)
    send(input.value);
    input.value = '';
    autosize(input);
  });
  // Enter envía; Mayús+Enter hace un salto de línea (y nada mientras se compone un carácter con el IME)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-form').requestSubmit(); }
  });
  input.addEventListener('input', () => autosize(input));
  // Asa de la hoja del móvil: tocarla cierra; arrastrarla hacia abajo, también
  const handle = $('#chat-handle');
  let startY = null;
  handle.addEventListener('click', () => toggleChat(false));
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    $('#chat').style.translate = `0 ${Math.max(0, e.clientY - startY)}px`;
  });
  const release = (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    $('#chat').style.translate = '';
    if (dy > 80) toggleChat(false);
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);
  addEventListener('hashchange', () => { if (!$('#chat').hidden) refreshContext(); });
  addMessage('bot', 'Hola, soy el asistente de PaperPulse. Te explico conceptos (velas, indicadores, tipos de orden), la gestión del riesgo o cómo cotiza un activo.');
  refreshContext();
}

// En el móvil el asistente es una hoja inferior sobre un fondo oscurecido: se cierra con su botón, tocando el fondo,
// con Escape (main.js), con el gesto o botón de «atrás» (una entrada propia en el historial) y al cambiar de vista.
const MOBILE = '(max-width: 767px)';
let inHistory = false; // hay una entrada del historial que representa «asistente abierto»
let opener = null;

export function toggleChat(force) {
  const panel = $('#chat');
  const open = force ?? panel.hidden;
  if (open === !panel.hidden) return;
  if (open) opener = document.activeElement;
  panel.hidden = !open;
  $('#chat-scrim').hidden = !open;
  const fab = document.querySelector('.chat-open'); // botón de la cabecera
  fab?.setAttribute('aria-expanded', String(open));
  document.documentElement.classList.toggle('chat-docked', open); // escritorio: panel lateral que empuja el contenido
  if (open) {
    refreshContext();
    if (matchMedia(MOBILE).matches) {
      globalThis.history.pushState({ ppChat: true }, '');
      inHistory = true;
      panel.focus(); // sin abrir el teclado en pantalla nada más empezar
    } else $('#chat-input').focus();
    return;
  }
  if (inHistory) { inHistory = false; if (globalThis.history.state?.ppChat) globalThis.history.back(); }
  const visible = (e) => e?.isConnected && e.getClientRects().length > 0; // offsetParent no sirve con elementos fijos
  const back = visible(opener) ? opener : visible(fab) ? fab : null;
  back?.focus?.();
  opener = null;
}

// «Atrás» con el asistente abierto: lo cierra sin salir de la vista
addEventListener('popstate', () => { if (inHistory && !globalThis.history.state?.ppChat) { inHistory = false; toggleChat(false); } });
// Ir a otra vista (barra inferior, enlace de una respuesta…) lo cierra en el móvil
addEventListener('hashchange', () => { if (!$('#chat').hidden && matchMedia(MOBILE).matches) { inHistory = false; toggleChat(false); } });

function addMessage(role, text) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.innerHTML = role === 'user' ? `<p>${escape(text)}</p>` : markdown(text);
  $('#chat-log').append(el);
  el.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return el;
}

function context() {
  const practice = store.hasPractice();
  const p = practice ? portfolio() : null;
  const asset = currentAsset();
  const symbols = [...new Set([asset?.symbol, 'BTC', 'ETH', 'SOL', 'SAN', 'NVDA'].filter(Boolean))].slice(0, 6);
  const trades = store.trades();
  return {
    hasPracticeAccount: practice,
    balanceFormatted: practice ? money(p.cashUsd) : '',
    equityFormatted: practice ? money(p.equityUsd) : '',
    currency: currency(),
    locale: locale(),
    positions: practice ? p.rows.slice(0, 10).map((r) => ({
      symbol: r.symbol, amount: r.amount, entryPriceFormatted: price(r.entryPrice, r.quote), pnlFormatted: money(r.pnlUsd, { signed: true }),
    })) : [],
    journalSummary: trades.length ? `${trades.length} operaciones cerradas, ${trades.filter((t) => t.pnl > 0).length} ganadoras` : 'Sin operaciones',
    activeSymbol: asset?.symbol ?? 'BTC',
    timeframe: INTERVALS[normalizeInterval(store.settings().interval)].label,
    tradeMode: 'Modo Fácil',
    market: symbols.map(findAsset).filter(Boolean).map((a) => {
      const t = tick(a.symbol);
      const ok = t?.price > 0;
      const closed = a.type === 'stock' && t?.marketOpen === false;
      return {
        symbol: a.symbol, pair: displayPair(a),
        priceNativeFormatted: ok ? price(t.price, a.quote) : 'No disponible',
        priceDisplayFormatted: ok ? approx(t.price, a.quote) : '',
        change24h: ok ? pct(t.change24h) : 'No disponible',
        lastUpdate: ok ? new Date(t.time).toLocaleTimeString('es-ES') : 'No disponible',
        status: !ok ? 'No disponible' : a.type === 'crypto' ? 'en vivo' : closed ? 'cierre de ayer' : 'retrasado',
      };
    }),
  };
}

/** Abre el asistente y le envía una pregunta (p. ej. «Explícame esta operación»). */
export function ask(question) {
  toggleChat(true);
  return send(question);
}

async function send(raw) {
  const message = raw.trim().slice(0, 2000);
  if (!message || busy) return;
  busy = true;
  $('#chat-log').setAttribute('aria-busy', 'true');
  renderSuggestions();
  addMessage('user', message);
  const bot = addMessage('bot', '');
  bot.innerHTML = '<span class="typing" role="status"><span class="sr-only">El asistente está escribiendo…</span><i></i><i></i><i></i></span>';
  let answer = '';
  try {
    const challenge = (await (await fetch(apiUrl('/api/chat/challenge'))).json()).challenge ?? '';
    const res = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Chat-Challenge': challenge },
      body: JSON.stringify({ message, history: history.slice(-8), context: context() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'El asistente no está disponible ahora mismo.');
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const ev of events) {
        const data = ev.replace(/^data: /, '').trim();
        if (!data || data === '[DONE]') continue;
        const msg = JSON.parse(data);
        if (msg.error) throw new Error(msg.error);
        if (msg.text) {
          answer += msg.text;
          bot.innerHTML = markdown(answer);
          bot.scrollIntoView({ block: 'end' });
        }
        if (msg.truncated) answer += '\n\n*(Respuesta recortada por longitud. Pide «continúa» para seguir.)*';
      }
    }
    bot.innerHTML = markdown(answer || 'No he recibido respuesta. Inténtalo de nuevo.');
    history.push({ role: 'user', content: message }, { role: 'assistant', content: answer });
  } catch (err) {
    bot.classList.add('error');
    bot.innerHTML = `<p>${escape(err.message === 'Failed to fetch' ? 'No hay conexión con el servidor.' : err.message)}</p>`;
  } finally {
    busy = false;
    $('#chat-log').setAttribute('aria-busy', 'false');
  }
}
