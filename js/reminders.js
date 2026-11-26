// Recordatorios y links de confirmación. Puro: lo usan la app, la página
// confirmar.html y las pruebas. No abre WhatsApp ni escribe en Firestore.
import { attendanceWhen, clockTime, confirmScheduleText, confirmSlotLabel, labelDate, todayISO, toEpoch } from './dates.js';
import { sameOrganizer } from './organizers.js';
import { givenName, nickOf, ownRosterEntry, personKey, rosterBase, rosterHolderIds, rosterNameFor, visibleRosterPhone } from './roster.js';
import { playerAccess } from './access.js';
import { waSendUrl } from './phone.js';
import { PRODUCTION_ORIGIN, publicAppOrigin } from './trial.js';
import { courtLabel, footballPhrase } from './venues.js';

export const CONFIRM_ORIGIN = PRODUCTION_ORIGIN;

/** Token opaco (base64url, 18 bytes). No se puede adivinar. */
export function newConfirmToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function confirmPageUrl({ matchId, playerId, token, origin = publicAppOrigin() }) {
  const base = origin.endsWith('/') ? origin : `${origin}/`;
  const url = new URL('confirmar.html', base);
  url.searchParams.set('m', matchId);
  url.searchParams.set('p', playerId);
  url.searchParams.set('t', token);
  return url.href;
}

/** WhatsApp para confirmar asistencia. El link es el de esa persona, siempre completo. */
export function attendanceMessage({ player, roster, when, time, confirmUrl, slots, now }) {
  const first = givenName(player, roster);
  const hello = first ? `¡Hola ${first}!` : '¡Hola!';
  const many = Array.isArray(slots) && slots.length >= 2 ? confirmScheduleText(slots, now) : '';
  const slot = many || [String(when || '').trim(), clockTime(time)].filter(Boolean).join(' ');
  const ask = slot ? `¿Confirmás que jugás ${slot}?` : '¿Confirmás que jugás?';
  const link = String(confirmUrl || '').trim();
  return link ? `${hello} ${ask}\n\nRespondé en este link: ${link}` : `${hello} ${ask}`;
}

export function reminderMessage({ player, match, confirmUrl, roster, now, slots }) {
  return attendanceMessage({
    player,
    roster,
    when: attendanceWhen(match?.date, now),
    time: match?.time,
    confirmUrl,
    slots,
    now,
  });
}

export function waReminderUrl(phone, text, opts = {}) {
  return waSendUrl({ phone, text, ...opts });
}

/**
 * Documento público de confirmación. No lleva teléfono: la página anónima
 * solo puede leer este documento, y el id es el token del link.
 */
export function confirmationRecord({ playerId, player, match, roster, senderUid = '' }) {
  const confirmed = player?.confirmed === 'si' || player?.confirmed === 'no' ? player.confirmed : null;
  return {
    ...confirmationIdentity({ playerId, player, match, roster, senderUid }),
    confirmed,
    confirmedAt: typeof player?.confirmedAt === 'number' ? player.confirmedAt : null,
  };
}

/**
 * Lo que escribe un organizador. Sin `confirmed` ni `confirmedAt`: un merge
 * no puede borrar el «Sí, juego» que guardó la página anónima.
 */
/**
 * v249: la página de confirmar saluda con la agenda del organizador que MANDÓ
 * ese link (recordatorio, aviso de que subió, WhatsApp del jugador): senderUid,
 * guardado en la tarjeta como sentByUid. Si lo tiene agendado, su nombre y su
 * apodo (los propios o, sin entrada propia, los de la ficha). Si no se sabe
 * quién lo mandó o no lo tiene agendado, lo de siempre (el partido y la ficha),
 * sin depender de qué organizador reescribió la tarjeta.
 */
export function confirmCardName(player, roster, senderUid = '') {
  const list = (roster || []).map((row) => rosterBase(row));
  const id = String(player?.rosterId || '').trim();
  const person = id ? list.find((row) => row?.id === id) : null;
  const uid = String(senderUid || '').trim();
  if (person && uid && (ownRosterEntry(person, uid) || rosterHolderIds(person).includes(uid))) {
    const seen = rosterNameFor(person, uid);
    if (seen.name) return { name: seen.name, shortName: seen.shortName };
  }
  return { name: player?.name || '', shortName: nickOf(player, list) };
}

export function confirmationIdentity({ playerId, player, match, roster, senderUid = '' }) {
  const card = confirmCardName(player, roster, senderUid);
  const sender = String(senderUid || '').trim();
  return {
    ...(sender ? { sentByUid: sender } : {}),
    playerId,
    matchId: player?.matchId || match?.id || '',
    name: card.name,
    // v239: la página de confirmar saluda con el Nombre corto. Vacío si no hay.
    shortName: card.shortName,
    date: match?.date || player?.matchDate || '',
    time: match?.time || '',
    note: match?.note || '',
    notes: String(match?.notes || '').slice(0, 2000),
    venue: String(match?.venueName || '').trim().slice(0, 80) || 'Polideportivo Colegiales',
    cancelled: match?.cancelled === true,
    viewers: playerAccess(match).viewers,
  };
}

/**
 * La lista muestra la ficha del token. Si esa ficha ya tiene sí o no, gana.
 * Si todavía no tiene respuesta, se deja lo que hubiera en el jugador.
 * Una ficha de otro token, aunque repita el playerId, no cuenta.
 */
export function overlayConfirmations(players, cards) {
  const byToken = new Map();
  for (const card of cards || []) if (card?.id) byToken.set(card.id, card);
  return (players || []).map((player) => {
    const card = player?.confirmToken ? byToken.get(player.confirmToken) : null;
    if (!card) return player;
    if (card.confirmed !== 'si' && card.confirmed !== 'no') return player;
    return {
      ...player,
      confirmed: card.confirmed,
      confirmedAt: typeof card.confirmedAt === 'number' ? card.confirmedAt : (player.confirmedAt ?? null),
    };
  });
}

const CONFIRM_ALSO_MAX = 12;

/**
 * Partidos de la misma fecha que el que se confirma, en los que esta persona
 * está anotada. Otro día no entra. La espera tampoco.
 */
export function upcomingConfirmSlots({ players, matches, player, now = new Date() } = {}) {
  const today = todayISO(now);
  const key = personKey(player, players);
  if (!key) return [];
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const anchor = byId.get(player?.matchId);
  const day = String(anchor?.date || player?.matchDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < today) return [];
  const rows = [];
  for (const other of players || []) {
    const token = String(other?.confirmToken || '');
    if (token.length < 16 || !other?.id) continue;
    if (other.waiting === true || other.noPlay === true) continue;
    if (personKey(other, players) !== key) continue;
    const match = byId.get(other.matchId);
    if (!match || match.cancelled === true) continue;
    if (match.date !== day) continue;
    const time = clockTime(match.time);
    if (!time) continue;
    rows.push({ token, playerId: other.id, date: match.date, time });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.playerId.localeCompare(b.playerId));
  return rows.slice(0, CONFIRM_ALSO_MAX);
}

/** Lo que la página puede mostrar: el día del link, de hoy en adelante, sin repetir el token. */
export function visibleConfirmSlots(list, now = new Date(), day = '') {
  const today = todayISO(now);
  const only = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : '';
  const out = [];
  const seen = new Set();
  for (const row of list || []) {
    const token = String(row?.token || '');
    const playerId = String(row?.playerId || '');
    const date = String(row?.date || '');
    const time = clockTime(row?.time);
    if (token.length < 16 || token.length > 80 || !playerId || playerId.length > 80) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || !time) continue;
    if (only && date !== only) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    const confirmed = row?.confirmed === 'si' || row?.confirmed === 'no' ? row.confirmed : null;
    out.push({ token, playerId, date, time, confirmed });
  }
  return out;
}

export function confirmSlotText(slot, now = new Date()) {
  return confirmSlotLabel(slot?.date, slot?.time, now);
}

/** Si todos contestaron lo mismo, esa respuesta. Si falta alguna, null. */
export function sharedConfirmAnswer(slots) {
  if (!slots?.length) return null;
  const first = slots[0]?.confirmed;
  if (first !== 'si' && first !== 'no') return null;
  return slots.every((slot) => slot?.confirmed === first) ? first : null;
}

/** El link solo vale si el token del jugador coincide y es de ese partido. */
export function confirmationAllowed(player, matchId, token) {
  return !!player
    && player.matchId === matchId
    && typeof token === 'string'
    && token.length >= 16
    && player.confirmToken === token;
}

export function confirmStatus(player) {
  // En la lista de espera no confirman si juegan: no hay estado hasta que suben.
  if (player?.waiting === true) return null;
  if (player?.tentative === true) {
    if (player.confirmed === 'no') {
      return { cls: 'reserved', text: 'Reservado · a confirmar', note: 'No juega · se puede liberar el lugar' };
    }
    return { cls: 'reserved', text: 'Reservado · a confirmar' };
  }
  if (player?.confirmed === 'si') return { cls: 'ok', text: '✅ Confirmó' };
  if (player?.confirmed === 'no') return { cls: 'no', text: '❌ No juega' };
  return { cls: 'pending', text: '⏳ Sin respuesta' };
}

/** El sí del link suelta el lugar reservado. El no lo deja reservado. */
export function reservationClearedByAnswer(player) {
  return player?.tentative === true && player?.confirmed === 'si';
}

export function confirmSummary(players) {
  let si = 0;
  let no = 0;
  let pending = 0;
  let hold = 0;
  for (const p of players || []) {
    if (p?.waiting === true) continue;
    if (p?.tentative === true) hold += 1;
    if (p?.confirmed === 'si' && p?.tentative !== true) si += 1;
    else if (p?.confirmed === 'no') no += 1;
    else if (p?.tentative !== true) pending += 1;
  }
  const holdText = hold > 0 ? ` · A confirmar: ${hold}` : '';
  return {
    si, no, pending, hold,
    text: `Confirmados: ${si}${holdText} · No juegan: ${no} · Sin respuesta: ${pending}`,
  };
}

/** Aviso para quien sube de la lista de espera. No manda el mensaje: solo lo arma. */
export function promotionMessage({ player, match, venue, confirmUrl, roster }) {
  // v239: el primer término del Nombre corto, como en el recordatorio.
  const name = givenName(player, roster) || 'hola';
  const when = labelDate(match?.date);
  const time = match?.time || '--:--';
  const court = courtLabel(match);
  const place = court ? `${venue} (${court})` : venue;
  return `¡Hola ${name}! Se hizo un lugar en el ${footballPhrase(match)} en ${place} el ${when} a las ${time} hs. ¿Confirmás tu presencia? ¿Querés que te deje anotado? Respondé en este link: ${confirmUrl}`;
}

/** El cartel aparece cuando el partido empieza en 2 horas o menos. */
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

export function matchStartsAt(match) {
  if (typeof match?.startsAt === 'number' && Number.isFinite(match.startsAt)) return match.startsAt;
  if (match?.date) return toEpoch(match.date, match.time);
  return NaN;
}

/** Falta el saque y está a 2 horas o menos. */
export function withinReminderWindow(match, now = Date.now()) {
  const start = matchStartsAt(match);
  if (!Number.isFinite(start)) return false;
  const left = start - now;
  return left >= 0 && left <= REMINDER_LEAD_MS;
}

export function reminderDueAt(match) {
  const start = matchStartsAt(match);
  if (!Number.isFinite(start)) return null;
  return start - REMINDER_LEAD_MS;
}

/**
 * Jugadores que anotó esta persona. «Gustavo» y «Martín» viejos coinciden
 * con la cuenta del mismo nombre, sin importar mayúsculas ni acentos.
 */
export function playersForOrganizer(players, organizer, { actor, roster } = {}) {
  if (!organizer) return [];
  const uid = String(actor?.uid || '').trim();
  const list = roster || [];
  return (players || []).filter((player) => {
    if (sameOrganizer(player?.addedBy, organizer)) return true;
    if (!uid) return false;
    // v239: anotado a nombre de esta cuenta aunque el nombre haya cambiado.
    if (String(player?.addedByUid || '').trim() === uid) return true;
    return selfLinkRowHeldBy(player, list, uid);
  });
}

/**
 * v239: alta por un link sin organizador (links viejos, sin token): la fila
 * queda «anotada por» el propio jugador. Cuenta para quien tiene su ficha en
 * Jugadores (titular explícito), para que salga en «Mis jugadores».
 */
function selfLinkRowHeldBy(player, roster, uid) {
  const rosterId = String(player?.rosterId || '').trim();
  if (!rosterId || String(player?.signedUpWith || '').trim()) return false;
  if (!sameOrganizer(player?.addedBy, player?.name)) return false;
  const person = roster.find((item) => item?.id === rosterId);
  return !!person && rosterHolderIds(person).includes(uid);
}

/**
 * v238: el WhatsApp que muestra la lista del partido. Si la fila no trae número
 * (alta por el link, o el número quedó solo en la ficha), usa el de la ficha de
 * Jugadores que este organizador ve, igual que la lista. Antes los recordatorios
 * miraban solo la fila y pedían «Cargar WhatsApp» con el número ya cargado.
 */
export function withAgendaPhones(players, roster, actor) {
  return (players || []).map((p) => {
    if (!p || String(p.phone || '').trim()) return p;
    const phone = visibleRosterPhone(p, roster, actor);
    return phone ? { ...p, phone, phonePrivate: false, hasPhone: true } : p;
  });
}

/** Quien juega y tiene WhatsApp. La lista de espera no juega: no entra. */
export function reminderAudience(players) {
  return (players || []).filter((p) => p?.waiting !== true && String(p?.phone || '').trim());
}

/** Todavía no dijeron si juegan. Quien ya confirmó o avisó que no, no entra. */
export function unconfirmedForReminder(players) {
  return (players || []).filter((p) => p && p.waiting !== true && p.noPlay !== true && p.confirmed !== 'si' && p.confirmed !== 'no');
}

export function reminderProgress(players) {
  const audience = reminderAudience(players);
  const sent = audience.filter((p) => p.reminderSentAt).length;
  return {
    total: audience.length,
    sent,
    pending: audience.length - sent,
    done: audience.length > 0 && sent === audience.length,
  };
}

/** Cartel solo si el partido entra en la ventana y todavía falta avisar a alguien con WhatsApp. */
export function needsReminderBanner(match, players, now = Date.now()) {
  if (match?.cancelled === true) return false;
  if (!withinReminderWindow(match, now)) return false;
  const prog = reminderProgress(players);
  return prog.total > 0 && prog.pending > 0;
}

/** Partidos que cruzaron la marca de 2 horas entre dos instantes (la app estaba abierta). */
export function matchesCrossingReminderWindow(matches, previousNow, now) {
  return (matches || []).filter((m) => m?.cancelled !== true && !withinReminderWindow(m, previousNow) && withinReminderWindow(m, now));
}

/** Aviso de que el partido no se juega. Sin link para confirmar. */
export function cancelMessage({ player, match, venue, roster }) {
  const name = givenName(player, roster) || 'hola';
  const when = labelDate(match?.date);
  const time = match?.time || '--:--';
  const court = courtLabel(match);
  const place = `${venue || 'Polideportivo Colegiales'}${court ? ` (${court})` : ''}`;
  const reason = String(match?.notes || '').trim();
  const why = reason ? ` Motivo: ${reason}` : '';
  return `Hola ${name}, se canceló el partido de ${footballPhrase(match)} en ${place} del ${when} a las ${time} hs.${why}`;
}

/** Un link por jugador con teléfono. No abre WhatsApp. */
export function cancelLinks({ match, players, venue, choice, android, roster } = {}) {
  const out = [];
  for (const p of players || []) {
    const phone = String(p?.phone || '').trim();
    if (!phone || !p?.id) continue;
    const text = cancelMessage({ player: p, match, venue, roster });
    out.push({ id: p.id, name: p.name, phone, text, waUrl: waSendUrl({ phone, text, choice, android }) });
  }
  return out;
}

/**
 * Lista para mandar o para un script externo. Cada ítem: { name, waUrl, confirmUrl, alsoIds }.
 * alsoIds (v258): las filas de la misma persona en otros partidos del día donde juega.
 * allPlayers tiene que traer las filas como están guardadas (sin el WhatsApp de la ficha).
 * Omite a quien no tenga teléfono o confirmToken: el token tiene que estar ya
 * guardado en el jugador (se crea al anotarlo).
 */
export function reminderLinks({ match, players, venue, origin, choice, android, roster, now, allPlayers, matches } = {}) {
  const out = [];
  if (!match?.id) return out;
  const pool = allPlayers || players;
  const calendar = matches || [match];
  for (const p of players || []) {
    if (p?.waiting === true) continue;
    const phone = String(p?.phone || '').trim();
    const token = p?.confirmToken;
    if (!phone || !token || !p.id) continue;
    // v235: el link completo, sin link corto.
    const confirmUrl = confirmPageUrl({ matchId: match.id, playerId: p.id, token, origin });
    // v258: los otros horarios del día salen de la fila guardada (la de allPlayers), no de la
    // copia con el WhatsApp de la ficha: con ese número la persona dejaba de coincidir con su
    // fila del otro partido (anotada por Autoservicio, sin huella) y quedaba un solo horario.
    const stored = (pool || []).find((row) => row?.id === p.id);
    const who = stored ? { ...stored, confirmToken: token, waiting: p.waiting } : p;
    const slots = upcomingConfirmSlots({ players: pool, matches: calendar, player: who, now });
    const text = reminderMessage({ player: p, match, confirmUrl, roster, now, slots });
    // v258: las otras filas del día donde juega: también quedan «Enviado».
    const alsoIds = slots.map((slot) => slot.playerId).filter((id) => id && id !== p.id);
    out.push({ id: p.id, name: p.name, phone, text, waUrl: waSendUrl({ phone, text, choice, android }), confirmUrl, alsoIds });
  }
  return out;
}
