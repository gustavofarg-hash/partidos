// Qué aviso mandar cuando un jugador se anota solo. Lo usa la Cloud Function.
// No importa Firebase: las pruebas lo pueden cargar directo.

function classifySelfSignup(before, after) {
  if (!before && after?.selfSignup === true && after?.tentative === true && after?.waiting !== true) return 'alta';
  if (!before && after?.selfSignup === true && after?.waiting === true) return 'espera';
  return '';
}

function dayLabel(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  return `${Number(match[3])}/${match[2]}`;
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function weekdayName(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!match) return '';
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const name = DAYS[utc.getUTCDay()] || '';
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}

const PRODUCTION_PROJECT = 'futbol-partidos';
const TRIAL_PROJECT = 'mis-partidos-prueba';
const PRODUCTION_BASE = 'https://gustavofarg-hash.github.io/partidos/';
const TRIAL_BASE = 'https://gustavofarg-hash.github.io/partidos/prueba/';

function appBase(project) {
  return String(project || '') === TRIAL_PROJECT ? TRIAL_BASE : PRODUCTION_BASE;
}

function decideUrlFor(project) {
  const id = String(project || '') === TRIAL_PROJECT ? TRIAL_PROJECT : PRODUCTION_PROJECT;
  return `https://southamerica-east1-${id}.cloudfunctions.net/decideSignup`;
}

// v239: igual que courtLabel de js/venues.js (acá es CommonJS y no se puede importar).
function courtLabel(match) {
  const raw = String(match?.court || '').trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const rest = raw.replace(/^cancha\b/i, '').trim();
  if (/^cancha\b/i.test(raw)) return rest ? `Cancha ${rest}` : 'Cancha';
  return `Cancha ${raw}`;
}

function pushCopy(kind, player, match, project) {
  const name = String(player?.name || '').trim() || 'Un jugador';
  const venue = String(match?.venueName || 'Polideportivo Colegiales').trim() || 'Polideportivo Colegiales';
  // v239: la cancha va en el aviso, como en el WhatsApp de «se hizo un lugar».
  const court = courtLabel(match);
  const place = court ? `${venue} (${court})` : venue;
  const base = appBase(project);
  if (kind === 'confirmado') {
    const day = [weekdayName(match?.date), dayLabel(match?.date)].filter(Boolean).join(' ');
    const when = [day, match?.time || ''].filter(Boolean).join(' ');
    const rosterId = encodeURIComponent(String(player?.rosterId || ''));
    return {
      title: 'Mis Partidos',
      body: `¡Te confirmaron para el ${when} en ${place}!`,
      url: `${base}#/jugador/${rosterId}`,
    };
  }
  const when = [dayLabel(match?.date), match?.time || '', place].filter(Boolean).join(' · ');
  const verb = kind === 'alta'
    ? 'se anotó y espera confirmación'
    : kind === 'espera'
      ? 'entró en la lista de espera'
      : 'se bajó';
  const id = encodeURIComponent(String(match?.id || ''));
  const hash = kind === 'alta' ? '#/a-confirmar' : `#/partido/${id}`;
  return {
    title: 'Mis Partidos',
    body: `${name} ${verb}. ${when}`,
    url: `${base}${hash}`,
  };
}

function organizerUids(match, holders, onlyUid) {
  const only = String(onlyUid || '').trim();
  if (only) return [only];
  const ids = [];
  const created = String(match?.createdByUid || '').trim();
  if (created) ids.push(created);
  for (const id of match?.adders || []) {
    const uid = String(id || '').trim();
    if (uid && uid !== '*') ids.push(uid);
  }
  if (!ids.length) {
    for (const id of holders || []) {
      const uid = String(id || '').trim();
      if (uid) ids.push(uid);
    }
  }
  return [...new Set(ids)];
}

/**
 * v260: los celulares de cada organizador, agrupados por uid, en el orden de uids.
 * Cada organizador recibe su propio token de Aceptar/Rechazar: así se sabe quién
 * tocó. Un organizador sin celulares registrados no recibe nada (ni token).
 */
function recipientGroups(uids, rows) {
  const byUid = new Map();
  for (const uid of uids || []) {
    const id = String(uid || '').trim();
    if (id && !byUid.has(id)) byUid.set(id, []);
  }
  for (const row of rows || []) {
    const id = String(row?.uid || '').trim();
    if (!byUid.has(id) || !row?.token) continue;
    byUid.get(id).push(row);
  }
  return [...byUid.entries()].filter(([, list]) => list.length).map(([uid, list]) => ({ uid, rows: list }));
}

/** v260: nombre del organizador para acceptedBy y el Registro (como acceptedByPatch de la app). */
function organizerLabel(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

/**
 * v260: qué se escribe al decidir desde el aviso. Con el uid del organizador que
 * recibió el aviso (y su nombre), Aceptar guarda acceptedBy y el Registro lo nombra.
 * Un token viejo sin uid (de antes de v260) sigue como antes: «Desde el aviso».
 */
function decisionWrites(action, decision, organizerName, now) {
  const uid = String(action?.uid || '').trim();
  const name = uid ? organizerLabel(organizerName) : '';
  const playerPatch = decision === 'aceptar'
    ? { tentative: null, tentativeAt: null, updatedAt: now, ...(name ? { acceptedBy: name } : {}) }
    : null;
  return {
    playerPatch,
    actorUid: uid && name ? uid : 'aviso',
    actorName: name || 'Desde el aviso',
  };
}

const DECIDE_URL = decideUrlFor(PRODUCTION_PROJECT);
const ACTION_TTL_MS = 12 * 60 * 60 * 1000;

/** Datos del push. El alta lleva el token para Aceptar o Rechazar sin abrir la app. */
function pushFields(kind, copy, extra = {}) {
  const data = {
    title: copy.title,
    body: copy.body,
    url: copy.url,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-mono.png',
    kind: String(kind || ''),
    tag: String(extra.tag || ''),
  };
  if (kind === 'alta' && extra.actionToken && extra.playerId) {
    data.actionToken = String(extra.actionToken);
    data.playerId = String(extra.playerId);
    data.decideUrl = decideUrlFor(extra.project);
  }
  return data;
}

/** Botones del aviso. Vacío si no es un alta o si no hay token: el toque abre la pestaña. */
function noticeActions(data) {
  if (data?.kind !== 'alta' || !data.actionToken || !data.decideUrl) return [];
  return [
    { action: 'aceptar', title: 'Aceptar' },
    { action: 'rechazar', title: 'Rechazar' },
  ];
}

/**
 * Si el token de un solo uso puede aceptar o rechazar ese pendiente.
 * spotsLeft es cuántos lugares quedan en la lista.
 */
function actionDecision(doc, player, decision, now, spotsLeft) {
  if (!doc) return { ok: false, status: 404, error: 'no existe' };
  if (doc.used === true) return { ok: false, status: 410, error: 'ya se usó' };
  if (!(Number(doc.expiresAt) > Number(now))) return { ok: false, status: 410, error: 'venció' };
  if (decision !== 'aceptar' && decision !== 'rechazar') return { ok: false, status: 400, error: 'decisión' };
  if (!player || player.tentative !== true || String(player.id || '') !== String(doc.playerId || '')) {
    return { ok: false, status: 409, error: 'ya no está pendiente' };
  }
  if (decision === 'rechazar') return { ok: true, op: 'delete' };
  return { ok: true, op: 'confirm' };
}

module.exports = {
  classifySelfSignup, pushCopy, organizerUids, dayLabel,
  pushFields, noticeActions, actionDecision, DECIDE_URL, ACTION_TTL_MS,
  recipientGroups, organizerLabel, decisionWrites,
  appBase, decideUrlFor, PRODUCTION_PROJECT, TRIAL_PROJECT,
};
