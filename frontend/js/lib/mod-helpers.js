// Lógica sin UI de la moderación: motivos rápidos, composición del motivo que se guarda en el registro y datos de la ficha del autor.
// Sin DOM, para poder probarla con node --test.

export const OTHER = 'Otro motivo';
export const MAX_REASON = 300; // igual que el límite de «reason» en backend/community/text.py
export const MAX_DETAIL = 200;

const SPAM = 'Spam o promoción';
const ABUSE = 'Insultos o acoso';
const SCAM = 'Estafa o promesas de beneficios';

/** Motivos rápidos por acción (el primero se preselecciona salvo que las denuncias sugieran otro). */
export const PRESETS = {
  hide: [SPAM, ABUSE, SCAM, 'Fuera de tema', OTHER],
  restore: ['Ocultado por error', 'Tras revisarlo, cumple las normas', OTHER],
  dismiss: ['No incumple las normas', 'Denuncia infundada', OTHER],
  suspend: [SPAM, ABUSE, SCAM, 'Incumplimiento reiterado de las normas', OTHER],
  unsuspend: ['Sanción cumplida', 'Suspendido por error', OTHER],
};

// Motivo con el que denunció la gente → motivo rápido equivalente
const FROM_REPORT = { spam: SPAM, abuso: ABUSE, estafa: SCAM };

/** Motivo preseleccionado: en ocultar y suspender, el de las denuncias recibidas (si lo hay); si no, el primero. */
export function defaultPreset(action, reportReasons = []) {
  const list = PRESETS[action] ?? [];
  if (action === 'hide' || action === 'suspend') {
    const hit = reportReasons.map((r) => FROM_REPORT[r]).find((p) => p && list.includes(p));
    if (hit) return hit;
  }
  return list[0] ?? OTHER;
}

/** Une motivo rápido y detalle opcional. Devuelve { reason } o { error }. Nunca recorta en silencio. */
export function buildReason(preset, detail) {
  const p = String(preset ?? '').trim();
  const d = String(detail ?? '').replace(/\s+/g, ' ').trim();
  if (!p) return { error: 'Elige un motivo.' };
  if (p === OTHER && !d) return { error: 'Cuenta brevemente el motivo.' };
  const reason = p === OTHER ? d : (d ? `${p}: ${d}` : p);
  if (reason.length > MAX_REASON) return { error: `El motivo es demasiado largo (máximo ${MAX_REASON} caracteres; tiene ${reason.length}).` };
  return { reason };
}

/** «cuenta de hoy», «cuenta de 1 día», «cuenta de 40 días», «cuenta de 3 meses»… */
export function accountAgeLabel(createdAtSeconds, nowMs = Date.now()) {
  const days = Math.floor((nowMs / 1000 - createdAtSeconds) / 86400);
  if (!Number.isFinite(days) || days < 1) return 'cuenta de hoy';
  if (days === 1) return 'cuenta de 1 día';
  if (days < 90) return `cuenta de ${days} días`;
  const months = Math.floor(days / 30);
  return months < 24 ? `cuenta de ${months} meses` : `cuenta de ${Math.floor(months / 12)} años`;
}

/** Autor con antecedentes: dos o más mensajes ocultados o alguna suspensión previa. */
export const isRepeatOffender = (a) => (a?.hiddenPosts ?? 0) >= 2 || (a?.suspensions ?? 0) >= 1;
