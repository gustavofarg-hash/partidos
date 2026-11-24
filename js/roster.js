// Plantel guardado y búsqueda rápida. Puro: no escribe en Firestore.
// La búsqueda no distingue mayúsculas ni acentos. El teléfono compara solo dígitos.
// Sin WhatsApp, la misma persona se reconoce por el id del plantel y, si no hay, por el nombre.
import { normalizePhone } from './phone.js';
import { phoneKey } from './privacy.js';

export const SUSPENDED_TEXT = 'Está suspendido.';
export const SUSPENSION_NOTE_MAX = 300;

export function cleanSuspensionNote(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, SUSPENSION_NOTE_MAX);
}

function suspensionDay(value) {
  const day = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

/** Suspensiones ya levantadas que siguen en el documento viejo. La más nueva primero. */
export function cleanSuspensionHistory(list) {
  const rows = [];
  for (const item of Array.isArray(list) ? list : []) {
    const date = suspensionDay(item?.date);
    const note = cleanSuspensionNote(item?.note);
    const lifted = suspensionDay(item?.lifted);
    if (!date || !note || !lifted) continue;
    rows.push({ date, note, lifted });
  }
  return rows;
}

/** La suspensión de ahora, lista para guardarse aparte al sacar el tilde. */
export function liftedSuspensionEvent(current, liftedOn, liftNote) {
  if (current?.suspended !== true) return null;
  const date = suspensionDay(current?.suspensionDate);
  const note = cleanSuspensionNote(current?.suspensionNote);
  const lifted = suspensionDay(liftedOn);
  if (!date || !note || !lifted) return null;
  const reason = cleanSuspensionNote(liftNote);
  return reason ? { date, note, lifted, liftNote: reason } : { date, note, lifted };
}

/** Historial completo: cada levantada nueva y las que ya estaban en el documento. La más nueva primero. */
export function suspensionHistoryOf(record, events) {
  const rosterId = String(record?.rosterId || '');
  const ownerUid = String(record?.ownerUid || '');
  const extra = [];
  for (const item of Array.isArray(events) ? events : []) {
    if (String(item?.rosterId || '') !== rosterId || String(item?.ownerUid || '') !== ownerUid) continue;
    const row = liftedSuspensionEvent({ suspended: true, suspensionDate: item?.date, suspensionNote: item?.note }, item?.lifted, item?.liftNote);
    if (!row) continue;
    extra.push({ ...row, at: Number(item.at) || 0 });
  }
  extra.sort((a, b) => b.at - a.at || b.lifted.localeCompare(a.lifted) || b.date.localeCompare(a.date));
  return [...extra.map(({ date, note, lifted, liftNote }) => (liftNote ? { date, note, lifted, liftNote } : { date, note, lifted })), ...cleanSuspensionHistory(record?.history)];
}
export const ROSTER_DENIED_READ = 'No se pueden leer los jugadores guardados. Gustavo tiene que republicar las reglas de Firestore para la colección roster.';
export const ROSTER_DENIED_WRITE = 'No se pudo guardar en Jugadores. Gustavo tiene que republicar las reglas de Firestore para la colección roster.';

export function isRosterDenied(error) {
  return error?.code === 'permission-denied';
}

export function foldText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Primera letra de cada palabra en mayúscula. El resto de la palabra no se toca. */
export function capitalizeWords(value) {
  return String(value || '').replace(/(^|[^\S\r\n]+)(\p{L})/gu, (_all, lead, letter) => lead + letter.toLocaleUpperCase('es-AR'));
}

export function cleanShortName(value) {
  return capitalizeWords(String(value || '').trim().replace(/\s+/g, ' ')).slice(0, 40);
}

/**
 * v249: cada organizador agenda al jugador con su propio nombre y apodo.
 * La ficha sigue siendo una sola (mismo id, mismo WhatsApp). En la ficha:
 *   names: { [uid]: { name, shortName } }  (shortName '' = sin apodo)
 * Sin entrada para ese uid, valen name y shortName de la ficha (los de
 * siempre): los datos viejos no cambian hasta que alguien edita.
 */
export const ROSTER_NAME_MAX = 60;

export function ownRosterEntry(person, uid) {
  const id = String(uid || '').trim();
  const map = person?.names;
  if (!id || !map || typeof map !== 'object' || Array.isArray(map)) return null;
  const row = map[id];
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name || '').trim().replace(/\s+/g, ' ').slice(0, ROSTER_NAME_MAX);
  if (!name) return null;
  return { name, shortName: cleanShortName(row.shortName) };
}

/** Nombre y apodo de la ficha según la agenda de ese organizador. */
export function rosterNameFor(person, uid) {
  const baseName = String((person && 'baseName' in person ? person.baseName : person?.name) || '');
  const baseShort = cleanShortName(person && 'baseShortName' in person ? person.baseShortName : person?.shortName);
  const own = ownRosterEntry(person, uid);
  return own ? { name: own.name, shortName: own.shortName, own: true } : { name: baseName, shortName: baseShort, own: false };
}

/**
 * La ficha como la ve ese organizador: name y shortName pasan a ser los suyos.
 * Guarda baseName/baseShortName (los de la ficha) para volver a calcular.
 * ownView: la tiene en su agenda.
 */
export function rosterSeenBy(person, actor) {
  if (!person || typeof person !== 'object') return person;
  const baseName = String(('baseName' in person ? person.baseName : person.name) || '');
  const baseShortName = cleanShortName('baseShortName' in person ? person.baseShortName : person.shortName);
  const uid = String(actor?.uid || '').trim();
  const seen = rosterNameFor({ ...person, baseName, baseShortName }, uid);
  const out = { ...person, baseName, baseShortName, name: seen.name, ownView: !!uid && rosterHeldBy(person, actor) };
  if (seen.shortName) out.shortName = seen.shortName;
  else delete out.shortName;
  return out;
}

/** Saca los campos calculados antes de copiar la ficha a otro lado. */
export function rosterBase(person) {
  if (!person || typeof person !== 'object') return person;
  const { baseName, baseShortName, ownView: _own, ...rest } = person;
  const out = { ...rest };
  if ('baseName' in person) out.name = baseName;
  if ('baseShortName' in person) {
    if (baseShortName) out.shortName = baseShortName;
    else delete out.shortName;
  }
  return out;
}

/**
 * Dónde guarda el nombre/apodo que edita este organizador.
 * - 'base': es el único que la tiene (o no la tiene: el admin con el apodo,
 *   las fichas viejas sin dueño). Se escribe name/shortName como siempre y se
 *   borra su entrada en names si había.
 * - 'own': la ficha la tiene otro organizador más. Se escribe names[uid] y la
 *   agenda del otro no cambia.
 * change: { name?, shortName? }. Lo que falta queda como lo ve él ahora.
 */
export function rosterNamePlan(person, uid, change = {}) {
  const id = String(uid || '').trim();
  const holders = rosterHolderIds(rosterBase(person) || {});
  const current = rosterNameFor(person, id);
  const name = 'name' in change && change.name != null && String(change.name).trim()
    ? String(change.name).trim().replace(/\s+/g, ' ').slice(0, ROSTER_NAME_MAX)
    : current.name;
  const shortName = 'shortName' in change ? cleanShortName(change.shortName) : current.shortName;
  const hasEntry = !!(id && person?.names && typeof person.names === 'object' && person.names[id]);
  const shared = !!id && holders.includes(id) && holders.length > 1;
  if (shared) return { mode: 'own', uid: id, entry: { name, shortName } };
  return { mode: 'base', uid: id, name, shortName, dropOwn: hasEntry };
}

/** Al vincular una ficha de otro organizador: lo que escribió queda como suyo. */
export function rosterLinkEntry(person, uid, data = {}) {
  const typed = String(data?.name || '').trim().replace(/\s+/g, ' ').slice(0, ROSTER_NAME_MAX);
  const seen = rosterNameFor(rosterBase(person), '');
  const name = typed || seen.name;
  const shortName = data && 'shortName' in data ? cleanShortName(data.shortName) : '';
  return { name, shortName };
}

/** La ficha que este organizador tiene en su agenda para ese jugador del partido. */
export function ownRosterOf(player, roster) {
  const list = roster || [];
  const id = String(player?.rosterId || '').trim();
  if (id) {
    const byId = list.find((item) => item?.id === id);
    if (byId) return byId.ownView === true ? byId : null;
  }
  const key = phoneIdentity(player);
  if (!key) return null;
  return list.find((item) => item?.id && item.ownView === true && phoneIdentity(item) === key) || null;
}

/**
 * v249: los jugadores de los partidos con el nombre y apodo de MI agenda
 * (si lo tengo agendado). docName/docShortName guardan lo que dice el partido.
 * Sin ficha mía, queda como está.
 */
export function playersSeenBy(players, roster) {
  const list = Array.isArray(players) ? players : [];
  const mine = (roster || []).filter((person) => person?.ownView === true);
  if (!mine.length) return list;
  return list.map((player) => {
    const own = player ? ownRosterOf(player, mine) : null;
    if (!own) return player;
    const name = String(own.name || '').trim();
    const short = cleanShortName(own.shortName);
    const docShort = cleanShortName(player.shortName);
    if ((!name || name === player.name) && short === docShort) return player;
    const out = { ...player, docName: player.name, docShortName: docShort };
    if (name) out.name = name;
    if (short) out.shortName = short;
    else delete out.shortName;
    return out;
  });
}

/**
 * En la lista del partido y en Equipos se ve el apodo.
 * Manda el apodo del jugador en ese partido (se carga en Editar jugador).
 * Si no tiene, el de su ficha de Jugadores (por rosterId o, sin ficha
 * vinculada, por el WhatsApp). Si nadie tiene apodo, el nombre.
 */
export function nickOf(player, roster) {
  // v249: si lo tengo en mi agenda, mi apodo (aunque el partido traiga el de otro).
  const mine = ownRosterOf(player, roster);
  if (mine) return cleanShortName(mine.shortName);
  const own = cleanShortName(player?.shortName);
  if (own) return own;
  const list = roster || [];
  const person = player?.rosterId ? list.find((item) => item?.id === player.rosterId) : null;
  if (person) return cleanShortName(person.shortName);
  const key = phoneIdentity(player);
  const same = key ? list.find((item) => item?.id && phoneIdentity(item) === key) : null;
  return cleanShortName(same?.shortName);
}

export function displayName(player, roster) {
  const mine = ownRosterOf(player, roster);
  return nickOf(player, roster) || mine?.name || player?.name || '';
}

/**
 * Cómo se lo saluda en los mensajes. v239: la primera palabra del Nombre corto
 * (el apodo de la lista, igual que nickOf). Sin apodo, el primer término del
 * nombre de la ficha, o el del partido si no hay ficha.
 */
export function givenName(player, roster) {
  const nick = nickOf(player, roster).split(' ').filter(Boolean)[0];
  if (nick) return nick;
  const list = roster || [];
  const id = String(player?.rosterId || '').trim();
  const person = ownRosterOf(player, list) || (id ? list.find((item) => item?.id === id) : null);
  const source = String(person?.name || player?.name || '').trim().replace(/\s+/g, ' ');
  return source.split(' ').filter(Boolean)[0] || '';
}

/** El nombre completo, solo si en la lista se ve el apodo en su lugar. */
export function fullNameBehind(player, roster) {
  const name = String(ownRosterOf(player, roster)?.name || player?.name || '').trim();
  if (!name) return '';
  return foldText(displayName(player, roster)) === foldText(name) ? '' : name;
}

/**
 * Después de elegir, la lista muestra solo esa ficha.
 * Si no está entre los resultados de la búsqueda, no se inventa otra fila.
 */
export function visibleRosterHits(found, pickedId, collapsed) {
  const list = Array.isArray(found) ? found : [];
  const id = String(pickedId || '').trim();
  if (!collapsed || !id) return list;
  const chosen = list.find((person) => person?.id === id);
  return chosen ? [chosen] : [];
}

/** true si el texto es el comienzo del nombre, del apodo, del apellido (cualquier palabra) o un tramo del teléfono. */
export function rosterHit(person, query) {
  const raw = String(query || '').trim();
  if (!raw) return true;
  const q = foldText(raw);
  const words = `${foldText(person?.name)} ${foldText(person?.shortName)}`.split(/\s+/).filter(Boolean);
  if (q && words.some((word) => word.startsWith(q))) return true;
  const phone = phoneDigits(person?.phone);
  const digits = phoneDigits(raw);
  if (digits && phone.includes(digits)) return true;
  // v239: varias palabras, en cualquier orden. Cada una tiene que ser el
  // comienzo de una palabra del nombre o del apodo («per juan» encuentra a
  // Juan Pérez). Una palabra de solo números puede ser parte del teléfono.
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => {
    if (words.some((word) => word.startsWith(part))) return true;
    const partDigits = /^[\d+()-]+$/.test(part) ? phoneDigits(part) : '';
    return !!partDigits && phone.includes(partDigits);
  });
}

/**
 * La agenda de cada organizador. Sin createdBy ni createdByUid es un jugador
 * de antes: sigue visible para todos, porque no se sabe de quién era.
 */
/** Uids que tienen esta ficha. Sin lista, el creador. Sin creador, nadie (la ficha vieja sigue por el nombre). */
export function rosterHolderIds(person) {
  const listed = Array.isArray(person?.holders)
    ? [...new Set(person.holders.map((id) => String(id || '').trim()).filter(Boolean))]
    : [];
  if (listed.length) return listed;
  const uid = String(person?.createdByUid || '').trim();
  return uid ? [uid] : [];
}

export function rosterHeldBy(person, actor) {
  if (!person) return false;
  const uid = String(actor?.uid || '').trim();
  const holders = rosterHolderIds(person);
  if (uid && holders.includes(uid)) return true;
  if (holders.length) return false;
  const ownerUid = String(person?.createdByUid || '').trim();
  const ownerName = String(person?.createdBy || '').trim();
  if (!ownerUid && !ownerName) return true;
  if (uid && ownerUid === uid) return true;
  const owner = foldText(ownerName);
  return owner !== '' && owner === foldText(actor?.name);
}

/** create, duplicate (el mismo organizador) o link (otro organizador, la misma ficha). */
export function rosterPhoneAction(existing, actor) {
  if (!existing) return 'create';
  if (!String(actor?.uid || '').trim()) return 'duplicate';
  return rosterHeldBy(existing, actor) ? 'duplicate' : 'link';
}

/** Notas viejas sin autor: solo el creador de la ficha. Si no hay uid, el único titular. */
export function legacyNoteOwnerUid(person) {
  const created = String(person?.createdByUid || '').trim();
  if (created) return created;
  const holders = rosterHolderIds(person);
  return holders.length === 1 ? holders[0] : '';
}

export function rosterNoteDocId(rosterId, uid) {
  const id = String(rosterId || '').trim();
  const owner = String(uid || '').trim();
  if (!id || !owner) return '';
  return `${id}_${owner}`;
}

export function withHolder(person, uid) {
  const id = String(uid || '').trim();
  const holders = rosterHolderIds(person);
  if (!id || holders.includes(id)) return holders;
  return [...holders, id];
}

export function rosterForOrganizer(roster, actor) {
  return (roster || []).filter((person) => rosterHeldBy(person, actor));
}

/**
 * El alta de Firestore devuelve el id antes de que el snapshot traiga la ficha.
 * Hasta que ese id llega, la lista sigue mostrando la ficha nueva. Cuando el
 * snapshot ya la tiene, se suelta. Si el plazo se vence, también.
 */
export function withPendingRoster(roster, pending, now) {
  const list = roster || [];
  const id = String(pending?.id || '').trim();
  if (!id || !pending?.person) return { roster: list, pending: null };
  if ((Number(now) || 0) >= (Number(pending.until) || 0)) return { roster: list, pending: null };
  if (list.some((person) => person.id === id)) return { roster: list, pending: null };
  return { roster: list.concat(pending.person), pending };
}

export function searchRoster(roster, query) {
  const list = [...(roster || [])].sort((a, b) => foldText(a.name).localeCompare(foldText(b.name), 'es') || String(a.id).localeCompare(String(b.id)));
  const q = String(query || '').trim();
  if (!q) return list;
  return list.filter((person) => rosterHit(person, q));
}

/** Teléfono listo para wa.me. Si no se puede normalizar, quedan los dígitos. Vacío si no hay número. */
export function canonicalPhone(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return '';
  const parsed = normalizePhone(raw);
  return parsed.ok ? parsed.wa : phoneDigits(raw);
}

/** Hash guardado, o el hash del teléfono visible. Vacío si no hay número. */
export function phoneIdentity(entity) {
  const explicit = String(entity?.phoneKey || '').trim();
  if (/^[0-9a-f]{64}$/.test(explicit)) return explicit;
  const phone = canonicalPhone(entity?.phone);
  return phone ? phoneKey(phone) : '';
}

export function suspensionDocId(rosterId, uid) {
  const id = String(rosterId || '').trim();
  const owner = String(uid || '').trim();
  if (!id || !owner) return '';
  return `${id}_${owner}`;
}

/** Id de la ficha: el que viene, o el de la misma persona por teléfono. */
export function rosterIdForSuspension(roster, source) {
  const listed = String(source?.rosterId || '').trim();
  if (listed && (roster || []).some((item) => item?.id === listed)) return listed;
  if (!source?.matchId && source?.id && (roster || []).some((item) => item?.id === source.id)) return source.id;
  const key = phoneIdentity(source);
  if (!key) return listed;
  return (roster || []).find((item) => phoneIdentity(item) === key)?.id || listed;
}

export function activeSuspensions(suspensions, rosterId) {
  const id = String(rosterId || '').trim();
  if (!id) return [];
  return (suspensions || []).filter((row) => row?.suspended === true && row.rosterId === id);
}

/** `*` = el partido es de todos los organizadores. Si no, solo esos uid. */
export function matchOrganizerUids(match) {
  const adders = Array.isArray(match?.adders) ? match.adders.map((uid) => String(uid || '').trim()).filter(Boolean) : [];
  if (!adders.length || adders.includes('*')) return ['*'];
  const ids = [...adders];
  const creator = String(match?.createdByUid || '').trim();
  if (creator && !ids.includes(creator)) ids.push(creator);
  return ids;
}

/** Suspensiones activas de organizadores de este partido. */
export function blockingSuspensions(suspensions, match, rosterId) {
  const rows = activeSuspensions(suspensions, rosterId);
  const orgs = matchOrganizerUids(match);
  if (orgs.includes('*')) return rows;
  const allowed = new Set(orgs);
  return rows.filter((row) => allowed.has(row.ownerUid));
}

export function rosterByPhone(roster, phone) {
  const key = phoneIdentity({ phone });
  if (!key) return null;
  return (roster || []).find((person) => phoneIdentity(person) === key) || null;
}

export function rosterByIdentity(roster, key) {
  const id = String(key || '').trim();
  if (!id) return null;
  return (roster || []).find((person) => phoneIdentity(person) === id) || null;
}

/**
 * Teléfono visible de la ficha que este organizador ya tiene.
 * Primero la ficha del partido, si está en su agenda. Si no, el mismo teléfono.
 * Vacío si no está en su agenda o esa ficha no muestra número.
 */
export function visibleRosterPhone(player, roster, actor) {
  const mine = rosterForOrganizer(roster, actor);
  const id = String(player?.rosterId || '').trim();
  if (id) {
    const byId = mine.find((person) => person.id === id);
    if (byId) return String(byId.phone || '').trim();
  }
  const key = phoneIdentity(player);
  if (!key) return '';
  const byPhone = mine.find((person) => phoneIdentity(person) === key);
  return String(byPhone?.phone || '').trim();
}

/** Partidos distintos en los que esta ficha está anotada, titular o en espera. */
export function rosterMatchCount(players, person) {
  const id = String(person?.id || '');
  const matches = new Set();
  for (const player of players || []) {
    if (!player?.matchId) continue;
    if ((id && player.rosterId === id) || playerMatchesPerson(player, person)) matches.add(player.matchId);
  }
  return matches.size;
}

export function rosterInMatchMessage(name, count) {
  const n = Number(count) || 0;
  const partidos = n === 1 ? 'partido' : 'partidos';
  return `${name} está anotado en ${n} ${partidos}. Quitalo de esos partidos antes de borrarlo de Jugadores.`;
}

/**
 * El jugador es esta ficha del plantel.
 * Manda el teléfono (el hash, aunque el número esté oculto). Si ninguno tiene, manda el id del plantel.
 * Si el jugador no tiene teléfono ni id, alcanza el mismo nombre.
 */
/**
 * La misma persona en distintos partidos: teléfono, si no la ficha de
 * Jugadores. Un invitado sin teléfono ni ficha es «quien lo invita + su
 * nombre»: el Invitado 1 de Vinicio y el Invitado 1 de Ernesto son dos
 * personas distintas. Al que invita se lo busca en players (invitedBy es el
 * id del jugador en ese partido) y se usa su propia identidad. El resto, el nombre.
 */
export function personKey(player, players, depth = 0) {
  const phone = phoneIdentity(player);
  if (phone) return `p:${phone}`;
  const rosterId = String(player?.rosterId || '').trim();
  if (rosterId) return `r:${rosterId}`;
  const name = foldText(player?.name);
  if (!name) return '';
  if (isNamedGuest(player)) return `g:${guestHostKey(player, players, depth)}|${name}`;
  return `n:${name}`;
}

/** Invitado que solo se conoce por el nombre (sin teléfono ni ficha). */
export function isNamedGuest(player) {
  return !!String(player?.invitedBy || '').trim() && !phoneIdentity(player) && !String(player?.rosterId || '').trim();
}

/** Identidad de quien invita. Si no está en la lista, el id del jugador que invita (solo vale en ese partido). */
export function guestHostKey(player, players, depth = 0) {
  const hostId = String(player?.invitedBy || '').trim();
  const host = depth < 2 ? (players || []).find((item) => item?.id === hostId) : null;
  return (host && personKey(host, players, depth + 1)) || `id:${hostId}`;
}

export function playerMatchesPerson(player, person) {
  if (!player || !person) return false;
  const phoneP = phoneIdentity(player);
  const phoneR = phoneIdentity(person);
  if (phoneP && phoneR && phoneP === phoneR) return true;
  if (player.rosterId && person.id && player.rosterId === person.id) return true;
  if (phoneP || player.rosterId || phoneR) return false;
  // Un invitado sin teléfono ni ficha no es nadie de Jugadores por tener el mismo nombre.
  if (isNamedGuest(player)) return false;
  const left = foldText(player.name);
  const right = foldText(person.name);
  return !!left && left === right;
}
