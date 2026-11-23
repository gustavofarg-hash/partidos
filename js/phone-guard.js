// v233: un teléfono, una persona por partido, también sin sesión.
// phoneGuards/{matchId}__{phoneKey} dice qué jugador tiene ese número en ese
// partido. Nadie sin cuenta de organizador lo lee ni lo lista. El alta escribe
// el jugador y su guardia en el mismo lote; las reglas exigen la guardia y no
// dejan pisar la de otro jugador que sigue anotado con ese número.

export const GUARD_COLLECTION = 'phoneGuards';
const HEX64 = /^[0-9a-f]{64}$/;

export function isPhoneKey(value) {
  return HEX64.test(String(value || ''));
}

/** Id de la guardia. Vacío si falta el partido o la huella. */
export function phoneGuardId(matchId, key) {
  const match = String(matchId || '').trim();
  const k = String(key || '').trim();
  if (!match || match.includes('/') || !isPhoneKey(k)) return '';
  return `${match}__${k}`;
}

/**
 * La huella que cuenta para la guardia, igual que en las reglas:
 * la del jugador; si no tiene, la de su ficha (el alta del enlace no trae teléfono).
 */
export function guardKeyFor(player, rosterPhoneKey = '') {
  const own = String(player?.phoneKey || '').trim();
  if (isPhoneKey(own)) return own;
  const fromRoster = String(rosterPhoneKey || '').trim();
  return String(player?.rosterId || '').trim() && isPhoneKey(fromRoster) ? fromRoster : '';
}

/** El documento de la guardia: nombre y quién lo anotó, para el mensaje del organizador. */
export function phoneGuardDoc(playerId, player, key, now = Date.now()) {
  return {
    matchId: String(player?.matchId || ''),
    phoneKey: String(key || ''),
    playerId: String(playerId || ''),
    name: String(player?.name || '').slice(0, 60),
    addedBy: String(player?.signedUpWithName || player?.addedBy || '').slice(0, 40),
    createdAt: now,
  };
}

/**
 * Qué guardias tocar cuando cambia la huella de un jugador.
 * set: la nueva (si hay). drop: la vieja (si había y es otra).
 */
export function guardMoves(playerId, before, after, rosterPhoneKey = '') {
  const oldKey = guardKeyFor(before, rosterPhoneKey);
  const newKey = guardKeyFor(after, rosterPhoneKey);
  const matchId = String(after?.matchId || before?.matchId || '');
  const moves = { set: null, drop: '' };
  const ownChanged = String(after?.phoneKey || '') !== String(before?.phoneKey || '');
  // Huella propia nueva aunque sea la de la ficha: las reglas piden la guardia igual.
  if (newKey && (newKey !== oldKey || ownChanged)) {
    moves.set = { id: phoneGuardId(matchId, newKey), data: phoneGuardDoc(playerId, { ...before, ...after }, newKey) };
  }
  if (oldKey && oldKey !== newKey) moves.drop = phoneGuardId(String(before?.matchId || matchId), oldKey);
  return moves;
}

/** Id nuevo de jugador, del largo de los de Firestore. */
export function newPlayerDocId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(20);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += abc[b % abc.length];
  return out;
}

export function permissionDenied(error) {
  return String(error?.code || '').replace(/^firestore\//, '') === 'permission-denied';
}
