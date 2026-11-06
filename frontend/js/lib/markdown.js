// Markdown mínimo y seguro para las respuestas del asistente: se escapa todo y luego se aplican negritas, cursivas,
// código, listas y enlaces INTERNOS ([texto](#/ruta)). Un enlace a otra web se queda como texto.
import { escape } from './dom.js';

const INTERNAL_LINK = /\[([^\]\n]{1,120})\]\((#\/[a-z0-9/_:.-]{1,100})\)/gi;

const inline = (s) => escape(s)
  .replace(INTERNAL_LINK, '<a href="$2">$1</a>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|\s)\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');

export function markdown(text) {
  let out = '', list = null;
  for (const line of String(text ?? '').split('\n')) {
    const t = line.trim();
    const m = t.match(/^([-*•]|\d+\.)\s+(.*)/);
    if (m) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; }
      out += `<li>${inline(m[2])}</li>`;
      continue;
    }
    if (list) { out += `</${list}>`; list = null; }
    if (t) out += `<p>${inline(t)}</p>`;
  }
  return list ? `${out}</${list}>` : out;
}
