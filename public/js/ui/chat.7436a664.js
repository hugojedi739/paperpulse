// Asistente IA: panel lateral con respuestas en streaming (SSE) desde /api/chat.
import * as store from '../lib/store.03650d78.js';
import { tick } from '../lib/feed.e3c0058e.js';
import { findAsset, displayPair } from '../lib/catalog.f1b2b586.js';
import { html, escape, render, $ } from '../lib/dom.a575914e.js';
import { money, price, pct, currency, locale, approx } from '../lib/format.df74909c.js';
import { portfolio } from '../lib/trading.01a6aa14.js';
import { INTERVALS, normalizeInterval } from '../lib/marketdata.c6db1b1f.js';
import { markdown } from '../lib/markdown.70f08f7e.js';

// Deben coincidir con SUGGESTIONS de backend/chat_fixed.py (se responden sin IA; lo comprueba un test)
export const SUGGESTIONS = ['¿Cómo está el mercado hoy?', '¿Cómo leo las velas?', 'Explícame el RSI', '¿Cómo gestiono el riesgo?', '¿Qué es una orden límite?'];
const history = [];
let busy = false;
let currentAsset = () => findAsset('BTC');

export function initChat({ getAsset }) {
  currentAsset = getAsset;
  render($('#chat-suggest'), SUGGESTIONS.map((s) => html`<button type="button">${s}</button>`));
  $('#chat-suggest').addEventListener('click', (e) => { if (e.target.matches('button')) send(e.target.textContent); });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    send(input.value);
    input.value = '';
  });
  addMessage('bot', '¡Hola! Soy el asistente de PaperPulse. Puedo explicarte conceptos (velas, indicadores, tipos de orden), ayudarte con la gestión del riesgo o decirte cómo cotiza un activo. **No doy recomendaciones de inversión.**');
}

export function toggleChat(force) {
  const panel = $('#chat');
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  document.querySelector('.fab').setAttribute('aria-expanded', String(open));
  document.querySelector('.fab').hidden = open;
  if (open) $('#chat-input').focus();
}

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

async function send(raw) {
  const message = raw.trim().slice(0, 2000);
  if (!message || busy) return;
  busy = true;
  addMessage('user', message);
  const bot = addMessage('bot', '');
  bot.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  let answer = '';
  try {
    const challenge = (await (await fetch('/api/chat/challenge')).json()).challenge ?? '';
    const res = await fetch('/api/chat', {
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
  }
}
