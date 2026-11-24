// v237: «Resetear link» del menú ⋮ de un jugador.
// Solo las fichas reseteadas tienen clave. Las demás siguen como siempre.

export const LINK_INVALID_TEXT = 'Este link ya no es válido. Pedí uno nuevo al organizador.';

const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;

/** Clave nueva: 24 bytes al azar en base64url (32 caracteres). */
export function newLinkKey() {
  const bytes = new Uint8Array(24);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Sin generador seguro de números al azar.');
  globalThis.crypto.getRandomValues(bytes);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isLinkKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

export function linkResetQuestion(name) {
  const who = String(name || '').trim() || 'este jugador';
  return `¿Resetear el link de ${who}? Los links anteriores dejan de funcionar.`;
}

/** Lo que la página del jugador lee de su ficha cuando el link está reseteado. */
export function rosterMirror(person) {
  const p = person || {};
  const holders = Array.isArray(p.holders) ? p.holders.filter((uid) => typeof uid === 'string' && uid).slice(0, 30) : [];
  // v249: la ficha tal cual (no el nombre con que la ve el organizador que la copia)
  // y el nombre/apodo propio de cada organizador, para el saludo de la página.
  const out = {
    name: String(('baseName' in p ? p.baseName : p.name) || '').slice(0, 60),
    shortName: String(('baseShortName' in p ? p.baseShortName : p.shortName) || '').slice(0, 40),
    holders,
    createdByUid: String(p.createdByUid || ''),
    phoneKey: String(p.phoneKey || ''),
    hasPhone: p.hasPhone === true,
  };
  const names = mirrorNames(p.names);
  if (names) out.names = names;
  return out;
}

function mirrorNames(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const out = {};
  for (const uid of Object.keys(map).sort()) {
    const row = map[uid];
    const name = String(row?.name || '').trim().slice(0, 60);
    if (!uid || !name) continue;
    out[uid] = { name, shortName: String(row?.shortName || '').slice(0, 40) };
  }
  return Object.keys(out).length ? out : null;
}

export function sameMirror(a, b) {
  return JSON.stringify(rosterMirror(a)) === JSON.stringify(rosterMirror(b));
}

/** Filas de esa ficha, desde hoy, que todavía no llevan la clave vigente. */
export function linkKeyTargets(players, rosterId, key, today) {
  const id = String(rosterId || '');
  const day = String(today || '');
  if (!id || !key) return [];
  return (players || []).filter((row) => row && row.rosterId === id
    && (!day || String(row.matchDate || '') >= day)
    && row.linkKey !== key).map((row) => row.id);
}

/** El menú ⋮ ofrece resetear a quien tiene la ficha a cargo, o al admin. */
export function canResetLink(person, actor) {
  if (!person?.id || !actor?.uid) return false;
  if (actor.role === 'admin') return true;
  const holders = Array.isArray(person.holders) && person.holders.length ? person.holders : (person.createdByUid ? [person.createdByUid] : []);
  return holders.includes(actor.uid);
}
