// Al iniciar sesión se juntan los datos de este navegador con la copia guardada en la cuenta (/api/data):
// Demo, favoritos, alertas y ajustes. «Mi cuenta» no entra aquí: vive en el servidor y es la misma en todas partes.
// Reglas: favoritos y alertas se combinan (unión); los ajustes y la Demo, gana lo más reciente; solo si las dos Demos
// tienen operaciones y no coinciden hay un conflicto real, que decide la persona. Sin DOM: se prueba en tests/.

export const MAX_WATCHLIST = 50;
const DEMO_KEYS = ['account', 'positions', 'pendingOrders', 'trades', 'equityHistory'];

const list = (v) => (Array.isArray(v) ? v : []);
const ids = (items) => list(items).map((x) => String(x?.id ?? '')).sort().join('|');

/** ¿La Demo de esta copia tiene operaciones (cerradas o abiertas)? */
export const demoHasOps = (d) => list(d?.trades).length + list(d?.positions).length > 0;

/** Misma Demo: mismas operaciones, posiciones y órdenes, y el mismo efectivo. */
export const sameDemo = (a, b) => ids(a?.trades) === ids(b?.trades) && ids(a?.positions) === ids(b?.positions)
  && ids(a?.pendingOrders) === ids(b?.pendingOrders) && Number(a?.account?.balanceUsd) === Number(b?.account?.balanceUsd);

/** Solo la Demo de una copia (para sustituirla en otra). */
export const demoOf = (d) => Object.fromEntries(DEMO_KEYS.map((k) => [k, d?.[k]]));

/** Favoritos de las dos copias, sin repetir y con los de este navegador primero; como mucho 50. */
export const mergeWatchlist = (local, remote) => [...new Set([...list(local), ...list(remote)].filter((s) => typeof s === 'string'))].slice(0, MAX_WATCHLIST);

/** Alertas de las dos copias sin repetir (mismo id, o mismo activo, sentido y precio). */
export function mergeAlerts(local, remote) {
  const out = [];
  const seen = new Set();
  for (const a of [...list(local), ...list(remote)]) {
    if (!a || typeof a !== 'object') continue;
    const keys = [`id:${a.id}`, `${String(a.symbol).toUpperCase()}|${a.condition}|${Number(a.target)}`];
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push(a);
  }
  return out;
}

/**
 * Junta la copia local y la de la cuenta al iniciar sesión. `localNewer`: el último cambio local es posterior a la
 * copia de la cuenta. Devuelve `{ data, conflict }`; con `conflict` la Demo de `data` es la local y hay que preguntar.
 */
export function mergeAtLogin(local, remote, { localNewer }) {
  const [newer, older] = localNewer ? [local, remote] : [remote, local];
  const settings = { ...(older?.settings ?? {}), ...(newer?.settings ?? {}) };
  if (local?.settings?.tourDone === true || remote?.settings?.tourDone === true) settings.tourDone = true; // la visita ya vista no vuelve
  const lOps = demoHasOps(local);
  const rOps = demoHasOps(remote);
  const conflict = lOps && rOps && !sameDemo(local, remote);
  const demoFrom = conflict || (lOps && !rOps) ? local : rOps && !lOps ? remote : newer;
  return {
    conflict,
    data: {
      ...local,
      ...demoOf(demoFrom),
      watchlist: mergeWatchlist(local?.watchlist, remote?.watchlist),
      alerts: mergeAlerts(local?.alerts, remote?.alerts),
      settings,
    },
  };
}

/** Resumen de una Demo para el aviso de conflicto: operaciones cerradas y posiciones abiertas. */
export const demoSummary = (d) => ({ trades: list(d?.trades).length, positions: list(d?.positions).length });
