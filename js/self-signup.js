// Anotarse solo desde la ficha. Puro: no escribe en Firestore.
// Un pendiente no ocupa cupo ni suma plata hasta que el organizador confirma.
// La espera entra directo. Sacarse de un pendiente o de la espera no resta puntos.
// v248: un confirmado que anula solo el día del partido resta 0,5 (selfDropPenalty).
import { toEpoch, todayISO } from './dates.js';
import { personKey, rosterHolderIds } from './roster.js';
import { organizerFirstName, pendingConfirmLabel } from './share.js';

export const DROP_LOCK_MS = 4 * 60 * 60 * 1000;
export const RATE_WINDOW_MS = 30 * 60 * 1000;
export const RATE_MAX = 5;
export const RATE_WINDOW_MIN = 30;
export const RATE_MAX_LIMIT = 100;
export const RATE_WINDOW_MIN_LIMIT = 1440;

/** El mismo pendiente de confirmación que usa el organizador: tentative, y lo anotó él. */
export function isSelfPending(player) {
  return player?.selfSignup === true && player?.tentative === true && player?.waiting !== true;
}

/** Ocupa un lugar del partido. El pendiente de confirmación también. La espera no. */
export function occupiesSpot(player) {
  return !!player && player.waiting !== true && player.noPlay !== true;
}

/**
 * El partido es de un organizador que tiene esta ficha.
 * Si no hay dueño ni lista de anotadores, se muestra igual (partido abierto viejo).
 */
export function matchOpenToRoster(match, person) {
  const holders = rosterHolderIds(person);
  if (!holders.length || !match || match.cancelled === true) return false;
  const created = String(match.createdByUid || '').trim();
  if (created && holders.includes(created)) return true;
  const adders = Array.isArray(match.adders) ? match.adders.map((id) => String(id || '')) : null;
  if (adders && adders.some((id) => id && id !== '*' && holders.includes(id))) return true;
  const open = !adders || adders.length === 0 || adders.includes('*');
  return open && !created;
}

/** 5 y 30 si el documento no está o los números no entran en el rango. */
export function signupLimitFrom(raw) {
  const max = Number(raw?.maxMoves);
  const minutes = Number(raw?.windowMinutes);
  return {
    maxMoves: Number.isInteger(max) && max >= 1 && max <= RATE_MAX_LIMIT ? max : RATE_MAX,
    windowMinutes: Number.isInteger(minutes) && minutes >= 1 && minutes <= RATE_WINDOW_MIN_LIMIT ? minutes : RATE_WINDOW_MIN,
  };
}

export function signupLimitRecord(input) {
  const max = Number(String(input?.maxMoves ?? '').trim());
  const minutes = Number(String(input?.windowMinutes ?? '').trim());
  if (!Number.isInteger(max) || max < 1 || max > RATE_MAX_LIMIT) {
    return { ok: false, error: 'Los movimientos tienen que ser entre 1 y 100.' };
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > RATE_WINDOW_MIN_LIMIT) {
    return { ok: false, error: 'Los minutos tienen que ser entre 1 y 1440.' };
  }
  return { ok: true, patch: { maxMoves: max, windowMinutes: minutes } };
}

export function signupRateDecision(prev, now = Date.now(), max = RATE_MAX, windowMs = RATE_WINDOW_MS) {
  const start = Number(prev?.windowStart) || 0;
  const count = Number(prev?.count) || 0;
  if (!start || now - start >= windowMs) return { ok: true, windowStart: now, count: 1 };
  if (count >= max) return { ok: false, windowStart: start, count, error: 'Esperá un rato para volver a anotarte.' };
  return { ok: true, windowStart: start, count: count + 1 };
}

/**
 * v235: «Confirmado (por Gustavo)». En el Autoservicio, el organizador que
 * aceptó la anotación. Si lo anotó un organizador, ese organizador.
 * v259: si la fila no guarda quién la aceptó, el organizador del link con el que
 * se anotó (signedUpWithName, si no addedBy). Al pasar de la lista de espera se
 * guarda quién lo pasó (promotedByPatch en js/store.js).
 */
export function confirmedLabel(player) {
  let name = '';
  // v259: sin acceptedBy (aceptado antes de v235 o lugar soltado por un «Sí» antes
  // de v259), el organizador del link con el que se anotó.
  if (player?.selfSignup === true) name = String(player?.acceptedBy || player?.signedUpWithName || player?.addedBy || '');
  else if (player?.guestAuto !== true) name = String(player?.signedUpWithName || player?.addedBy || '');
  const first = organizerFirstName(name);
  return first ? `Confirmado (por ${first})` : 'Confirmado';
}

/** Sufijo « (auto)» si el jugador se anotó por Autoservicio (`selfSignup`). */
export function signedUpAutoMark(player) {
  return player?.selfSignup === true ? ' (auto)' : '';
}

/** Tag y aviso del menú: «Se anotó con: Gus (auto)». Vacío si no hay nombre. */
export function signedUpWithLine(player) {
  const name = String(player?.signedUpWithName || '').trim();
  if (!name) return '';
  return `Se anotó con: ${name}${signedUpAutoMark(player)}`;
}

/** Etiqueta del campo «Se anotó con»; el sufijo no entra en las opciones del select. */
export function signedUpWithFieldLabel(player) {
  return `Se anotó con:${signedUpAutoMark(player)}`;
}


/**
 * Qué muestra la fila. join = Anotarme, wait = Lista de espera,
 * cancel = Anular, locked = ya no se puede bajar solo.
 */
export function selfRowAction({ player, full, kickoff, now = Date.now(), organizerName = '' } = {}) {
  if (isSelfPending(player)) return { action: 'cancel', status: 'pending', note: pendingConfirmLabel(organizerName) };
  if (player?.waiting === true) return { action: 'cancel', status: 'wait', note: 'En lista de espera' };
  if (occupiesSpot(player)) {
    const left = Number(kickoff) - Number(now);
    const note = confirmedLabel(player);
    if (left > DROP_LOCK_MS) return { action: 'cancel', status: 'confirmed', note };
    return { action: 'locked', status: 'confirmed', note, lock: 'Avisale al organizador para bajarte' };
  }
  if (full) return { action: 'wait', note: '' };
  return { action: 'join', note: '' };
}

/** Sin el campo, el partido se muestra. Destildado, no aparece en la página del jugador. */
export function visibleToPlayers(match) {
  return match?.playerVisible !== false;
}

/**
 * Partido de este organizador en su enlace. Manda el uid, no el nombre:
 * en producción se muestra Gus y en la prueba Gustavo, y es la misma cuenta.
 * «Solo yo» no lo esconde: eso solo saca a los otros organizadores.
 */
export function guestMatchForOrganizer(match, { uid = '' } = {}) {
  if (!match || match.cancelled === true || !visibleToPlayers(match)) return false;
  const owner = String(uid || '').trim();
  if (!owner) return false;
  const created = String(match.createdByUid || '').trim();
  if (created === owner) return true;
  // Los compartidos con todos (viewers *) entran en el enlace de cualquier organizador.
  const viewers = Array.isArray(match.viewers) ? match.viewers.map((id) => String(id || '')) : [];
  if (viewers.includes('*')) return true;
  const adders = Array.isArray(match.adders) ? match.adders.map((id) => String(id || '')) : [];
  return adders.includes(owner);
}

/** Partido de este organizador: lo creó él, o está en quienes anotan (no el comodín *). */
/** v261: un snapshot del token del link. La caché que dice «no está» no es definitiva. */
export function shareTokenSnapshotState({ exists = false, fromCache = false, uid = '' } = {}) {
  if (String(uid || '').trim()) return 'ready';
  if (fromCache === true) return 'pending';
  return 'missing';
}

/** v261: con token en el link, no se muestra la lista hasta saber el organizador. */
export function guestLinkSignupState({ token = '', organizer = null, shareError = '' } = {}) {
  if (!String(token || '').trim()) return 'ready';
  if (organizer?.uid) return 'ready';
  if (shareError) return 'error';
  return 'loading';
}

export const SHARE_TOKEN_WAIT_MS = 12_000;
export const SHARE_TOKEN_LOAD_ERROR = 'No se pudieron cargar los partidos.';

/** Tope para el getDoc al servidor y para el REST, después de esperar el Listen. */
export const SHARE_TOKEN_LOOKUP_MS = 5_000;

export function shareTokenFromFields(data) {
  const uid = String(data?.uid || '').trim();
  if (!uid) return null;
  return { uid, name: String(data?.name || '').trim() };
}

/** Respuesta de getDoc: un uid es listo; un miss solo de caché no cierra. */
export function shareTokenFromServerSnap(snap) {
  if (!snap) return { status: 'error' };
  const exists = typeof snap.exists === 'function' ? snap.exists() : !!snap.exists;
  const data = exists && typeof snap.data === 'function' ? snap.data() : null;
  const found = shareTokenFromFields(data);
  if (found) return { status: 'ready', data: found };
  if (snap.metadata?.fromCache === true) return { status: 'pending' };
  return { status: 'missing' };
}

export function shareTokenFromRestDocument(body) {
  const fields = body?.fields || {};
  return shareTokenFromFields({
    uid: fields.uid?.stringValue || '',
    name: fields.name?.stringValue || '',
  });
}

export function shareTokenRestUrl({ host, ssl = true, projectId, database = '(default)', token, apiKey = '' } = {}) {
  const h = String(host || '').trim();
  const project = String(projectId || '').trim();
  const tok = String(token || '').trim();
  if (!h || !project || !tok) return '';
  const scheme = ssl === false ? 'http' : 'https';
  const db = String(database || '(default)');
  const path = `${scheme}://${h}/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(db)}/documents/shareTokens/${encodeURIComponent(tok)}`;
  if (!apiKey) return path;
  return `${path}?key=${encodeURIComponent(apiKey)}`;
}

export async function fetchShareTokenRest(opts = {}) {
  const url = shareTokenRestUrl(opts);
  if (!url) return { status: 'error' };
  const run = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!run) return { status: 'error' };
  const res = await run(url, { method: 'GET', signal: opts.signal });
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'error', code: res.status };
  let body = null;
  try { body = await res.json(); } catch { return { status: 'error' }; }
  const data = shareTokenFromRestDocument(body);
  if (!data) return { status: 'missing' };
  return { status: 'ready', data };
}

/**
 * Después de los 12 s sin snapshot del servidor: getDoc al servidor,
 * si no REST. Se falla solo si el servidor dice que no está, o si ambos fallan.
 */
export async function resolveShareTokenAfterWait({ getFromServer, getFromRest } = {}) {
  if (typeof getFromServer === 'function') {
    try {
      const server = await getFromServer();
      if (server?.status === 'ready' || server?.status === 'missing') return server;
    } catch { /* se prueba REST */ }
  }
  if (typeof getFromRest === 'function') {
    try {
      const rest = await getFromRest();
      if (rest?.status === 'ready' || rest?.status === 'missing') return rest;
    } catch { /* también falló */ }
  }
  return { status: 'error' };
}


export function restValueToPlain(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue === true;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(restValueToPlain);
  if ('mapValue' in value) return restFieldsToPlain(value.mapValue.fields || {});
  return null;
}

export function restFieldsToPlain(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = restValueToPlain(value);
  return out;
}

export function restDocumentToRow(doc) {
  const name = String(doc?.name || '');
  const id = name.split('/').filter(Boolean).pop() || '';
  return { id, ...restFieldsToPlain(doc?.fields) };
}

export function firestoreRestDocUrl({ host, ssl = true, projectId, database = '(default)', segments = [], apiKey = '' } = {}) {
  const h = String(host || '').trim();
  const project = String(projectId || '').trim();
  const parts = (segments || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!h || !project || !parts.length) return '';
  const scheme = ssl === false ? 'http' : 'https';
  const db = String(database || '(default)');
  const path = `${scheme}://${h}/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(db)}/documents/${parts.map(encodeURIComponent).join('/')}`;
  if (!apiKey) return path;
  return `${path}?key=${encodeURIComponent(apiKey)}`;
}

export function firestoreRunQueryUrl({ host, ssl = true, projectId, database = '(default)', apiKey = '' } = {}) {
  const h = String(host || '').trim();
  const project = String(projectId || '').trim();
  if (!h || !project) return '';
  const scheme = ssl === false ? 'http' : 'https';
  const db = String(database || '(default)');
  const path = `${scheme}://${h}/v1/projects/${encodeURIComponent(project)}/databases/${encodeURIComponent(db)}/documents:runQuery`;
  if (!apiKey) return path;
  return `${path}?key=${encodeURIComponent(apiKey)}`;
}

const REST_OPS = {
  '==': 'EQUAL',
  '>=': 'GREATER_THAN_OR_EQUAL',
  '<=': 'LESS_THAN_OR_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
};

function restFilter(filter) {
  const op = REST_OPS[filter?.op];
  const field = String(filter?.field || '');
  if (!op || !field) return null;
  const value = filter?.value;
  const raw = Array.isArray(value)
    ? { arrayValue: { values: value.map((item) => ({ stringValue: String(item) })) } }
    : typeof value === 'boolean'
      ? { booleanValue: value }
      : typeof value === 'number'
        ? { integerValue: String(value) }
        : { stringValue: String(value ?? '') };
  return { fieldFilter: { field: { fieldPath: field }, op, value: raw } };
}

export function guestPlanToStructuredQuery(plan) {
  const collection = String(plan?.collection || '').trim();
  if (!collection) return null;
  const filters = (plan.filters || []).map(restFilter).filter(Boolean);
  const query = { from: [{ collectionId: collection }] };
  if (filters.length === 1) query.where = filters[0];
  else if (filters.length > 1) query.where = { compositeFilter: { op: 'AND', filters } };
  const order = Array.isArray(plan.orderBy) ? plan.orderBy : [];
  if (order.length >= 1 && order[0]) {
    query.orderBy = [{
      field: { fieldPath: String(order[0]) },
      direction: String(order[1] || 'asc').toLowerCase() === 'desc' ? 'DESCENDING' : 'ASCENDING',
    }];
  }
  const limit = Number(plan.limit);
  if (Number.isInteger(limit) && limit > 0) query.limit = limit;
  return query;
}

export async function fetchFirestoreRestDocument(opts = {}) {
  const url = firestoreRestDocUrl(opts);
  if (!url) return { status: 'error' };
  const run = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!run) return { status: 'error' };
  const res = await run(url, { method: 'GET', signal: opts.signal });
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'error', code: res.status };
  let body = null;
  try { body = await res.json(); } catch { return { status: 'error' }; }
  const row = restDocumentToRow(body);
  if (!row.id) return { status: 'missing' };
  return { status: 'ready', data: row };
}

export async function fetchFirestoreRestQuery(opts = {}) {
  const url = firestoreRunQueryUrl(opts);
  const structuredQuery = guestPlanToStructuredQuery(opts.plan);
  if (!url || !structuredQuery) return { status: 'error' };
  const run = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!run) return { status: 'error' };
  const res = await run(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
    signal: opts.signal,
  });
  if (!res.ok) return { status: 'error', code: res.status };
  let body = null;
  try { body = await res.json(); } catch { return { status: 'error' }; }
  const rows = (Array.isArray(body) ? body : []).map((item) => item?.document).filter(Boolean).map(restDocumentToRow);
  return { status: 'ready', data: rows };
}

export function withLookupTimeout(promise, ms = SHARE_TOKEN_LOOKUP_MS) {
  const wait = Number(ms) > 0 ? Number(ms) : SHARE_TOKEN_LOOKUP_MS;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), wait);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(t); resolve(value); },
      (error) => { clearTimeout(t); reject(error); },
    );
  });
}


export function matchOwnedBy(match, uid) {
  const id = String(uid || '').trim();
  if (!id || !match) return false;
  if (String(match.createdByUid || '').trim() === id) return true;
  const adders = Array.isArray(match.adders) ? match.adders.map((item) => String(item || '')) : [];
  return adders.includes(id);
}

export function playerOnMatch(person, match, players) {
  const id = String(person?.id || '');
  const key = personKey({ ...person, id }, players);
  return (players || []).find((player) => {
    if (!player || player.matchId !== match?.id) return false;
    if (id && player.rosterId === id) return true;
    return !!(key && personKey(player, players) === key);
  }) || null;
}

export function selfSignupRows({ person, matches, players, now = Date.now(), organizerUid = '', organizerName = '', scoped = false } = {}) {
  const owner = String(organizerUid || '').trim();
  const label = String(organizerName || '').trim();
  return (matches || [])
    .filter((match) => {
      if (!match || match.cancelled === true || !visibleToPlayers(match)) return false;
      if (scoped) return guestMatchForOrganizer(match, { uid: owner, name: label });
      return matchOpenToRoster(match, person);
    })
    .filter((match) => {
      const today = new Date(now);
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(today);
      return String(match.date || '') >= iso && toEpoch(match.date, match.time || '00:00') > now - 2 * 3600e3;
    })
    .sort((a, b) => toEpoch(a.date, a.time) - toEpoch(b.date, b.time) || String(a.id).localeCompare(String(b.id)))
    .map((match) => {
      const player = playerOnMatch(person, match, players);
      const cap = Number(match.capacity) > 0 ? Number(match.capacity) : 14;
      const listed = (players || []).filter((item) => item?.matchId === match.id && occupiesSpot(item)).length;
      const stored = Number(match.playerCount);
      const taken = Number.isFinite(stored) ? Math.max(listed, Math.trunc(stored)) : listed;
      const kickoff = toEpoch(match.date, match.time);
      const action = selfRowAction({ player, full: taken >= cap, kickoff, now, organizerName: label });
      return { match, player, taken, cap, ...action };
    });
}

/**
 * v260: el organizador del link de Autoservicio con el que se anotó (el que
 * recibe el aviso). Vacío si la fila no lo guarda.
 */
export function linkOrganizerUid(player) {
  return String(player?.addedByUid || player?.signedUpWith || '').trim();
}

/**
 * v260: «Confirmar lugar». Una anotación pendiente del Autoservicio la confirma
 * solo el organizador del link (el admin también, solo las suyas). Un lugar
 * reservado por un organizador, o una fila sin organizador del link, como antes.
 */
export function canConfirmSpot(player, uid) {
  if (!isSelfPending(player)) return true;
  const link = linkOrganizerUid(player);
  return !link || link === String(uid || '');
}

/**
 * Pendientes de este organizador, el más nuevo primero. Sin dueño, lo ve cualquiera.
 * v260: las del link de otro organizador no las ve nadie más, tampoco el admin.
 */
export function pendingSelfSignups({ players, matches, uid, admin = false } = {}) {
  const byId = new Map((matches || []).filter((match) => match?.id).map((match) => [match.id, match]));
  return (players || [])
    .filter((player) => isSelfPending(player))
    .map((player) => ({ player, match: byId.get(player.matchId) || null }))
    .filter(({ player, match }) => {
      if (!match || match.cancelled === true) return false;
      const forUid = String(player.addedByUid || '').trim();
      if (forUid) return forUid === String(uid || '');
      const owners = [];
      if (match.createdByUid) owners.push(String(match.createdByUid));
      for (const id of match.adders || []) if (id && id !== '*') owners.push(String(id));
      return !owners.length || owners.includes(String(uid || ''));
    })
    .sort((a, b) => (Number(b.player.createdAt) || 0) - (Number(a.player.createdAt) || 0) || String(b.player.id).localeCompare(String(a.player.id)));
}

export function canSelfCancel(player, match, now = Date.now()) {
  if (!player) return false;
  if (isSelfPending(player) || player.waiting === true) return true;
  if (!occupiesSpot(player)) return false;
  return toEpoch(match?.date, match?.time) - now > DROP_LOCK_MS;
}

// v248: anular solo el día del partido resta 0,5 de Comportamiento.
export const SELF_DROP_POINTS = -0.5;
export const SELF_DROP_REASON = 'Se bajó el día del partido (Autoservicio)';
/** Si se anotó hace 5 minutos o menos, se toma como que se anotó por error: no resta. */
export const SELF_DROP_GRACE_MS = 5 * 60 * 1000;

/**
 * v248: ¿esta baja del Autoservicio resta 0,5? Solo si se cumple todo:
 * - estaba confirmado: ocupaba lugar y no era un pendiente de confirmación,
 *   un «a confirmar» ni la lista de espera;
 * - anula desde las 0:00 del día del partido (hora de Buenos Aires);
 * - pasaron más de 5 minutos desde que se anotó (createdAt de la fila).
 * Sin hora de alta guardada, sin ficha o sin organizador, no resta: no se adivina.
 * El jugador no ve ningún aviso: esto solo decide si se escribe la entrada.
 */
export function selfDropPenalty({ player, match, now = Date.now() } = {}) {
  const no = (why) => ({ penalize: false, why });
  if (!player) return no('sin-jugador');
  if (isSelfPending(player)) return no('pendiente');
  if (player.waiting === true) return no('espera');
  if (!occupiesSpot(player) || player.tentative === true || player.selfPending === true) return no('sin-confirmar');
  const rosterId = String(player.rosterId || '').trim();
  if (!rosterId) return no('sin-ficha');
  const date = String(match?.date || player.matchDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return no('sin-fecha');
  const at = Number(now);
  if (!Number.isFinite(at) || todayISO(new Date(at)) !== date) return no('otro-dia');
  const signedAt = Number(player.createdAt);
  if (!Number.isInteger(signedAt) || signedAt <= 0) return no('sin-hora-de-alta');
  if (!(at - signedAt > SELF_DROP_GRACE_MS)) return no('recien-anotado');
  const viaLink = String(player.signedUpWith || '').trim();
  const organizerUid = viaLink || String(player.addedByUid || '').trim();
  if (!organizerUid) return no('sin-organizador');
  const rawName = viaLink ? (player.signedUpWithName || player.addedBy) : player.addedBy;
  const organizerName = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 40) || 'Organizador';
  return { penalize: true, why: 'mismo-dia', organizerUid, organizerName };
}

/**
 * v248: id y datos de la entrada de Comportamiento de esa baja. El id sale de la
 * fila y de su hora de alta: una baja escribe a lo sumo una entrada, y anotarse
 * de nuevo y volver a bajarse es otra baja. Va en el mismo lote que el borrado.
 */
export function selfDropEntry({ playerId, player, match, decision, now = Date.now() } = {}) {
  const id = String(playerId || '').trim();
  if (!decision?.penalize || !id || id.includes('/')) return null;
  return {
    docId: `auto_${id}_${Number(player.createdAt)}`,
    entry: {
      type: 'baja',
      points: SELF_DROP_POINTS,
      reason: SELF_DROP_REASON,
      comment: '',
      matchId: String(match?.id || player.matchId || ''),
      createdByUid: decision.organizerUid,
      createdByName: decision.organizerName,
      createdAt: Math.trunc(Number(now)),
      rosterId: String(player.rosterId || '').trim(),
      playerId: id,
    },
  };
}
