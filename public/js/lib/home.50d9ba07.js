// Lógica sin interfaz de la portada (Resumen): primeros pasos, siguiente lección, mayores movimientos, ticker de una
// noticia y colores del mapa de calor. Solo lee datos que ya existen; no guarda nada.

/** Lecciones leídas: la misma clave que usa la sección Aprender (views/learn.js). */
export const LESSONS_READ_KEY = 'paperpulse_lessons_read';
export function lessonsRead() {
  try { return new Set(JSON.parse(globalThis.localStorage?.getItem(LESSONS_READ_KEY) || '[]')); } catch { return new Set(); }
}

/** Siguiente lección sin leer (en el orden del curso) y el progreso. */
export function nextLesson(lessons, read) {
  const done = lessons.filter((l) => read.has(l.id)).length;
  return {
    lesson: lessons.find((l) => !read.has(l.id)) ?? null,
    done,
    total: lessons.length,
    pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
  };
}

/**
 * «Primeros pasos» de una cuenta de práctica: elegir saldo, primera operación y una lección.
 * La tarjeta desaparece cuando `complete` es true.
 */
export function firstSteps({ practice, trades = 0, positions = 0, orders = 0, lessonsDone = 0, nextLessonId = null }) {
  const steps = [
    { id: 'saldo', label: 'Elige tu saldo virtual', done: Boolean(practice), action: 'account', cta: 'Elegir saldo' },
    { id: 'operacion', label: 'Haz tu primera operación', done: trades + positions + orders > 0, href: '#/trade', cta: 'Ir a Operar' },
    { id: 'leccion', label: 'Completa una lección de Aprender', done: lessonsDone > 0, href: `#/learn${nextLessonId ? `/${nextLessonId}` : ''}`, cta: 'Empezar' },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100), complete: done === steps.length };
}

/**
 * Mayores movimientos: `items` = [{ a: activo, change }]. `dir`: 'gainers' (de más a menos) o 'losers'.
 * `kind`: 'all', 'crypto' o 'stock' (acciones e índices). Como mucho `limit`.
 */
export function moversList(items, { dir = 'gainers', kind = 'all', limit = 5 } = {}) {
  return items
    .filter((x) => Number.isFinite(x.change) && (kind === 'all' || (kind === 'crypto' ? x.a.type === 'crypto' : x.a.type !== 'crypto')))
    .sort((x, y) => (dir === 'gainers' ? y.change - x.change : x.change - y.change))
    .slice(0, limit);
}

const GENERIC = new Set(['banco', 'platforms', 'ibex']);
/**
 * Activo del catálogo que nombra un titular (para el chip de la noticia), o null. Busca el nombre completo y sus
 * palabras distintivas (Santander, Nvidia…); los símbolos solo en cripto (BTC, ETH), porque los de bolsa
 * (SAN, REP…) coinciden con palabras corrientes.
 */
export function tickerFor(title, assets) {
  const t = ` ${String(title).toLowerCase()} `;
  for (const a of assets) {
    const name = a.name.toLowerCase();
    const words = [name, ...name.split(/\s+/).filter((w) => w.length >= 5 && !GENERIC.has(w))];
    if (a.symbol === 'IBEX') words.push('ibex');
    if (a.type === 'crypto') words.push(a.symbol.toLowerCase());
    if (words.some((w) => new RegExp(`[^a-z0-9áéíóúñ]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9áéíóúñ]`).test(t))) return a;
  }
  return null;
}

/** Clase de color de una casilla del mapa de calor según la variación diaria (%): plano, o 3 intensidades. */
export function heatClass(change) {
  if (!Number.isFinite(change) || Math.abs(change) < 0.05) return 'heat-flat';
  const level = Math.abs(change) >= 3 ? 3 : Math.abs(change) >= 1 ? 2 : 1;
  return `heat-${change > 0 ? 'up' : 'down'}-${level}`;
}
