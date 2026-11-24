// v245: un jugador suspendido por un organizador no ve los partidos de ese
// organizador en Autoservicio. Con el link de ese organizador ve «NO TENÉS
// ACCESO». La página del jugador no tiene sesión y no puede leer las
// suspensiones (tienen el motivo); solo pregunta si existe la marca
// suspendFlags/{ficha}_{organizador}, que no guarda nada más.

/** Id de la marca: el mismo formato que rosterSuspensions. */
export function suspendFlagId(rosterId, uid) {
  const id = String(rosterId || '').trim();
  const owner = String(uid || '').trim();
  return id && owner ? `${id}_${owner}` : '';
}

/** Organizadores de un partido que se pueden saber sin sesión: quien lo creó y los anotadores con nombre. */
export function matchOrganizerUids(match) {
  const out = [];
  const add = (uid) => {
    const clean = String(uid || '').trim();
    if (clean && clean !== '*' && !out.includes(clean)) out.push(clean);
  };
  add(match?.createdByUid);
  for (const uid of Array.isArray(match?.adders) ? match.adders : []) add(uid);
  return out;
}

/** Saca los partidos de quien lo suspendió. */
export function guestMatchesAllowed(matches, blockedUids) {
  const blocked = new Set((blockedUids || []).map((uid) => String(uid || '')).filter(Boolean));
  if (!blocked.size) return Array.isArray(matches) ? matches : [];
  return (matches || []).filter((match) => !matchOrganizerUids(match).some((uid) => blocked.has(uid)));
}

/** El link es de un organizador que lo suspendió. */
export function guestLinkBlocked(organizer, blockedUids) {
  const uid = String(organizer?.uid || '').trim();
  return !!uid && (blockedUids || []).map(String).includes(uid);
}

/** Uids que lo tienen suspendido hoy, de una lista de rosterSuspensions. */
export function activeSuspenderUids(suspensions, rosterId) {
  const id = String(rosterId || '').trim();
  if (!id) return [];
  const out = [];
  for (const row of suspensions || []) {
    if (row?.rosterId !== id || row.suspended !== true) continue;
    const uid = String(row.ownerUid || '').trim();
    if (uid && !out.includes(uid)) out.push(uid);
  }
  return out;
}
