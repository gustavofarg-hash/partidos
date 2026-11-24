// Registro. Puro: arma las líneas y dice quién puede verlas.
// Cada línea se escribe una vez. No se edita. El acceso queda copiado
// del partido en ese momento, porque un partido borrado ya no existe.
import { addDays, capitalize, labelDate, toEpoch, todayISO } from './dates.js';
import { formatARS, hasPaymentDirection, paymentParts } from './payments.js';
import { venueLabel } from './venues.js';
import { canView, isRestricted } from './access.js';

export const LOG_LIMIT = 200;
/** Días hacia atrás, sin contar hoy. El rango es ese día inclusive hasta hoy. */
export const LOG_DAYS = 20;

const METHODS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  credito: 'Crédito',
};

function clean(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function unique(ids) {
  const out = [];
  for (const id of ids || []) {
    const item = String(id || '').trim();
    if (item && !out.includes(item)) out.push(item);
  }
  return out;
}

/** Staff activo (admin u organizador) como uids, para resolver `*` al escribir. */
export function logStaffIds(staff = []) {
  const raw = Array.isArray(staff)
    ? staff
    : Object.entries(staff || {}).map(([uid, row]) => ({ uid: row?.uid || uid, ...row }));
  const ids = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const id = clean(item, 128);
      if (id && id !== '*') ids.push(id);
      continue;
    }
    if (!item || item.active === false) continue;
    const role = item.role;
    if (role && role !== 'admin' && role !== 'organizer') continue;
    const id = clean(item.uid, 128);
    if (id && id !== '*') ids.push(id);
  }
  return unique(ids);
}

let defaultLogStaff = [];

/** Lo llama el store cuando carga la lista de organizadores activos. */
export function setDefaultLogStaff(staff = []) {
  defaultLogStaff = logStaffIds(staff);
}

/**
 * Quién puede ver la línea: el creador, el staff explícito en viewers o
 * adders, quien anotó el evento, y —si el partido es abierto (`*` o
 * viewers vacío)— los organizadores activos de ese momento. No se escribe
 * `*`: cada uid queda copiado. Las líneas viejas no se reescriben solas.
 */
export function editorsOf(match, actorUid = '', staff = defaultLogStaff) {
  const me = clean(actorUid, 128);
  const team = logStaffIds(staff);
  if (!match) return me ? [me] : [];
  const creator = clean(match.createdByUid, 128);
  const viewers = (Array.isArray(match.viewers) ? match.viewers : []).filter((id) => id && id !== '*');
  const adders = (Array.isArray(match.adders) ? match.adders : []).filter((id) => id && id !== '*');
  const ids = [...viewers, ...adders, creator, me];
  if (!isRestricted(match)) ids.push(...team);
  return unique(ids).slice(0, 31);
}

/** Puede ver el partido: creador, uid explícito, o partido abierto (`*`). */
export function isLogStaff(match, uid) {
  const id = clean(uid, 128);
  if (!match || !id) return false;
  return canView(match, id);
}

/**
 * Registro: los movimientos del partido si el organizador lo tiene a
 * la vista (lo organiza o es un partido abierto). `editors: ['*']` de
 * líneas viejas no abre el registro de un partido ajeno. También ve lo
 * que él mismo registró o si su uid está en editors.
 */
export function canSeeLog(entry, uid, matches = []) {
  const id = String(uid || '').trim();
  if (!id) return false;
  if (String(entry?.actorUid || '').trim() === id) return true;
  const editors = Array.isArray(entry?.editors) ? entry.editors : [];
  if (editors.includes(id)) return true;
  const mid = String(entry?.matchId || '').trim();
  if (!mid) return false;
  const list = Array.isArray(matches) ? matches : [];
  const match = list.find((row) => row && row.id === mid) || null;
  return isLogStaff(match, id);
}

export function matchLogFields(match, venues, staff = defaultLogStaff) {
  const date = clean(match?.date, 10);
  const time = clean(match?.time, 5);
  const place = match ? venueLabel(match, venues) : '';
  const when = date ? `${capitalize(labelDate(date))} · ${time || '--:--'}` : 'Partido';
  return {
    matchId: clean(match?.id, 80),
    matchDate: date,
    matchTime: time,
    matchLabel: clean(place ? `${when} · ${place}` : when, 160),
    editors: editorsOf(match, '', staff),
  };
}

export function playerLogFields(player, mates) {
  const playerName = clean(player?.name, 80) || 'Sin nombre';
  const invitedBy = clean(player?.invitedBy, 80);
  if (!invitedBy) return { playerName, hostName: '' };
  const host = (mates || []).find((item) => item?.id === invitedBy);
  const hostName = clean(player?.invitedByName || host?.name, 80);
  return { playerName, hostName };
}

export function blankLog(partial, actor, staff = defaultLogStaff) {
  const editors = editorsOf(partial?.match, actor?.uid, staff);
  const base = {
    at: Date.now(),
    actorUid: clean(actor?.uid, 128),
    actorName: clean(actor?.name, 40) || 'Organizador',
    section: 'partidos',
    type: '',
    matchId: '',
    matchDate: '',
    matchTime: '',
    matchLabel: '',
    editors,
    playerName: '',
    hostName: '',
    detail: '',
    amount: 0,
    method: '',
  };
  const next = { ...base, ...partial };
  delete next.match;
  next.editors = unique(next.editors).slice(0, 31);
  if (!next.editors.length && next.actorUid) next.editors = [next.actorUid];
  next.amount = Math.max(0, Math.round(Number(next.amount) * 100) / 100) || 0;
  next.detail = clean(next.detail, 200);
  next.playerName = clean(next.playerName, 80);
  next.hostName = clean(next.hostName, 80);
  next.matchLabel = clean(next.matchLabel, 160);
  next.type = clean(next.type, 40);
  next.actorName = clean(next.actorName, 40) || 'Organizador';
  return next;
}

export function weekRange(now = new Date()) {
  const today = todayISO(now);
  return { from: addDays(today, -LOG_DAYS), to: today };
}

export function rangeMillis(range) {
  const from = range?.from || '';
  const to = range?.to || '';
  const start = from ? toEpoch(from, '00:00') : 0;
  const end = to ? toEpoch(addDays(to, 1), '00:00') - 1 : Number.MAX_SAFE_INTEGER;
  return { start, end };
}

export function inLogRange(entry, range) {
  const at = Number(entry?.at);
  if (!Number.isFinite(at)) return false;
  const { start, end } = rangeMillis(range || {});
  return at >= start && at <= end;
}

function storedPrice(match) {
  if (!match || match.price == null || match.price === '') return null;
  const n = Number(match.price);
  return Number.isFinite(n) ? n : null;
}

function placeText(match) {
  return [clean(match?.venueName, 80), clean(match?.court, 20)].filter(Boolean).join(' ');
}

/** Cambios de día, hora, precio o sede. Vacío si no hubo ninguno. */
export function matchEditDetail(before, after) {
  const bits = [];
  if ((before?.date || '') !== (after?.date || '') || (before?.time || '') !== (after?.time || '')) {
    bits.push(`Horario ${before?.date || '—'} ${before?.time || ''} → ${after?.date || '—'} ${after?.time || ''}`);
  }
  if (storedPrice(before) !== storedPrice(after)) {
    const from = storedPrice(before) == null ? '—' : formatARS(storedPrice(before));
    const to = storedPrice(after) == null ? '—' : formatARS(storedPrice(after));
    bits.push(`Precio ${from} → ${to}`);
  }
  if ((before?.venueId || '') !== (after?.venueId || '') || placeText(before) !== placeText(after)) {
    bits.push(`Sede ${placeText(before) || '—'} → ${placeText(after) || '—'}`);
  }
  return bits.join(' · ').slice(0, 200);
}

const MONEY = [
  ['cash', 'efectivo'],
  ['transfer', 'transferencia'],
  ['credit', 'credito'],
];

function collectorNames(player, method) {
  if (!player) return [];
  const one = (value) => {
    const name = clean(value, 40);
    return name ? [name] : [];
  };
  if (method === 'efectivo') {
    return one(hasPaymentDirection(player) ? player.cashTo : player.receivedBy);
  }
  if (method === 'transferencia') {
    const parts = Array.isArray(player.transferParts) ? player.transferParts : [];
    if (parts.length > 1) {
      const names = [];
      for (const part of parts) {
        const name = clean(part?.to, 40);
        if (name && !names.some((have) => have.toLowerCase() === name.toLowerCase())) names.push(name);
      }
      return names;
    }
    return one(hasPaymentDirection(player) ? player.transferTo : player.receivedBy);
  }
  if (method === 'credito') return one(player.creditTo);
  return [];
}

function joinCollectors(names) {
  return names.filter(Boolean).join(' · ').slice(0, 80);
}

/** Antes y después. Si se borró, el después es «nadie». Si no cambió, un solo nombre. */
function collectorShift(beforeNames, afterNames, removed) {
  const before = joinCollectors(beforeNames);
  const after = joinCollectors(afterNames);
  if (removed) return before ? `${before} → nadie` : '';
  if (!before || before === after) return after;
  if (!after) return `${before} → nadie`;
  return `${before} → ${after}`;
}

/**
 * Una línea por medio cuyo monto cambió, o cuyo cobrador cambió.
 * Subir un monto es un pago por la diferencia. Bajarlo es una edición o un borrado.
 * En una edición o un borrado, paidTo dice quién cobraba y quién cobra ahora.
 * Una transferencia repartida es una sola línea con todos los que cobraron.
 */
export function paymentLines(before, after) {
  const prev = paymentParts(before);
  const next = paymentParts(after);
  const lines = [];
  for (const [key, method] of MONEY) {
    const oldAmount = prev[key] || 0;
    const newAmount = next[key] || 0;
    const beforeNames = collectorNames(before, method);
    const afterNames = collectorNames(after, method);
    const sameWho = joinCollectors(beforeNames) === joinCollectors(afterNames);
    if (oldAmount === newAmount && sameWho) continue;
    if (key === 'credit' && after?.autoCredit === true && newAmount > oldAmount) {
      lines.push({
        type: 'crédito automático',
        method,
        amount: Math.round((newAmount - oldAmount) * 100) / 100,
        detail: 'Del saldo a favor',
        paidTo: joinCollectors(afterNames),
      });
      continue;
    }
    if (key === 'credit' && before?.autoCredit === true && newAmount < oldAmount) {
      lines.push({
        type: 'crédito devuelto',
        method,
        amount: Math.round((oldAmount - newAmount) * 100) / 100,
        detail: 'Vuelve al saldo a favor',
        paidTo: joinCollectors(beforeNames),
      });
      continue;
    }
    if (newAmount === 0) {
      lines.push({
        type: 'pago borrado',
        method,
        amount: oldAmount,
        detail: '',
        paidTo: collectorShift(beforeNames, [], true),
      });
    } else if (oldAmount === 0 || (newAmount > oldAmount && sameWho)) {
      lines.push({
        type: 'pago',
        method,
        amount: Math.round((newAmount - oldAmount) * 100) / 100,
        detail: '',
        paidTo: joinCollectors(afterNames),
      });
    } else {
      lines.push({
        type: 'pago editado',
        method,
        amount: newAmount || oldAmount,
        detail: oldAmount !== newAmount ? `antes ${formatARS(oldAmount)}` : '',
        paidTo: collectorShift(beforeNames, afterNames, false),
      });
    }
  }
  return lines;
}

function datedMatch(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return `${capitalize(labelDate(date))} · ${time || '--:--'}`;
}

/**
 * Partido guardado en la línea. No busca el partido vivo: si lo borraron,
 * queda la copia. Una línea vieja sin esa copia arma la fecha y la hora,
 * o un texto corto si no hay nada más.
 */
export function pagoMatchText(entry) {
  const label = clean(entry?.matchLabel, 160);
  if (label && label !== 'Sin partido') return label;
  const fromParts = datedMatch(clean(entry?.matchDate, 10), clean(entry?.matchTime, 5));
  if (fromParts) return fromParts;
  if (entry?.type === 'crédito cargado') return 'Carga de crédito';
  if (entry?.type === 'devolución de crédito') return 'Devolución de crédito';
  if (clean(entry?.matchId, 80)) return 'Partido';
  return '';
}

export function logText(entry) {
  const player = entry?.playerName
    ? (entry.hostName ? `${entry.playerName} (invitado de ${entry.hostName})` : entry.playerName)
    : '';
  if (entry?.section === 'pagos') {
    const method = METHODS[entry.method] || entry.method || '';
    const money = formatARS(entry.amount || 0);
    const match = pagoMatchText(entry);
    if (entry.type === 'crédito cargado') return [match, player, `${method} ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'devolución de crédito') return [match, player, `${method} ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'crédito automático') return [match, player, `Crédito automático ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'crédito devuelto') return [match, player, `Crédito devuelto ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'Anulado') return [match, player, `${method} ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'pago borrado') return [match, player, `${method} borrado ${money}`].filter(Boolean).join(' · ');
    if (entry.type === 'pago editado') return [match, player, `${method} ${money}`, entry.detail].filter(Boolean).join(' · ');
    if (entry.type === 'compensación') return [match, entry.detail || `${method} ${money}`].filter(Boolean).join(' · ');
    return [match, player, `${method} ${money}`].filter(Boolean).join(' · ');
  }
  return [entry?.matchLabel, player, entry?.detail].filter(Boolean).join(' · ');
}

/** Movimiento de anotarse solo. El actor es el jugador o el organizador que aceptó o rechazó. */
export function selfMoveEntry(match, venues, player, move = {}) {
  return partidoEntry(
    { uid: move.actorUid || '', name: move.actorName || player?.name || '' },
    match?.id ? match : { ...(match || {}), id: match?.id || player?.matchId || '' },
    venues,
    {
      type: move.type || '',
      detail: move.detail || '',
      playerName: player?.name || '',
      ...(move.rosterId ? { rosterId: String(move.rosterId) } : {}),
      ...(move.guest ? { shareToken: String(move.shareToken || '') } : {}),
    },
  );
}

export function partidoEntry(actor, match, venues, extra = {}, staff = defaultLogStaff) {
  const fields = matchLogFields(match, venues, staff);
  fields.editors = editorsOf(match, actor?.uid, staff);
  return blankLog({ ...fields, section: 'partidos', ...extra }, actor, staff);
}

export function pagoEntry(actor, match, venues, player, mates, line, staff = defaultLogStaff) {
  const fields = matchLogFields(match || { id: player?.matchId || '' }, venues, staff);
  fields.editors = editorsOf(match, actor?.uid, staff);
  if (!match) fields.matchLabel = 'Sin partido';
  const entry = blankLog({
    ...fields,
    section: 'pagos',
    type: line?.type || 'pago',
    method: line?.method || '',
    amount: line?.amount || 0,
    detail: line?.detail || '',
    ...playerLogFields(player, mates),
  }, actor, staff);
  const fromLine = clean(line?.paidTo, 80);
  const fromPlayer = joinCollectors(collectorNames(player, entry.method));
  let paidTo = fromLine || fromPlayer;
  if (entry.method === 'credito' && !paidTo) paidTo = clean(actor?.name, 40);
  if (paidTo) entry.paidTo = paidTo;
  if (line?.solo === true) {
    const uid = clean(actor?.uid, 128);
    entry.editors = uid ? [uid] : entry.editors;
    entry.matchId = '';
    entry.matchDate = '';
    entry.matchTime = '';
    entry.matchLabel = '';
  }
  return entry;
}

export function logWhen(entry) {
  const at = Number(entry?.at);
  if (!Number.isFinite(at)) return '';
  const date = todayISO(new Date(at));
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at));
  return `${date.split('-').reverse().join('/')} · ${time}`;
}
