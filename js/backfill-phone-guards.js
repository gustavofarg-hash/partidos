// Arreglo de una sola vez de v233: los jugadores anotados antes no tienen
// guardia de teléfono. Sin guardia no se bloquea nada (las reglas solo la
// exigen al anotar o al cambiar el número), así que el alta legítima nunca
// falla por un jugador viejo; lo que falta es que el viejo bloquee al nuevo.
// Puro: arma las guardias de los partidos de today en adelante. Las escribe
// un administrador, después de revisarlas. No se corre solo.
import { guardKeyFor, phoneGuardDoc, phoneGuardId } from './phone-guard.js';

/**
 * players: [{ id, ...datos }]; matches: [{ id, date, cancelled }];
 * rosterKeys: { rosterId: phoneKey }; existing: ids de guardias que ya están.
 * Si dos jugadores del mismo partido comparten número (de antes de v230),
 * la guardia va al primero que se anotó y el resto queda en conflicts para revisar.
 */
export function phoneGuardBackfillPlan({ players, matches, today, rosterKeys = {}, existing = [], now = Date.now() }) {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const have = new Set(existing || []);
  const day = String(today || '');
  const groups = new Map();
  for (const player of players || []) {
    const match = byId.get(player?.matchId);
    if (!match || !day || String(match.date || '') < day || match.cancelled === true) continue;
    const key = guardKeyFor(player, rosterKeys?.[String(player?.rosterId || '')] || '');
    const id = phoneGuardId(match.id, key);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, { key, rows: [] });
    groups.get(id).rows.push(player);
  }
  const plan = [];
  const conflicts = [];
  const skipped = [];
  for (const [id, { key, rows }] of groups) {
    const sorted = [...rows].sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || String(a.id).localeCompare(String(b.id)));
    const keep = sorted[0];
    if (sorted.length > 1) conflicts.push({ id, matchId: keep.matchId, players: sorted.map((row) => ({ id: row.id, name: row.name || '' })) });
    if (have.has(id)) {
      skipped.push({ id, reason: 'ya-existe' });
      continue;
    }
    plan.push({ id, data: phoneGuardDoc(keep.id, keep, key, now) });
  }
  return { plan, conflicts, skipped };
}

/**
 * Escribe el plan en lotes (las guardias de los jugadores de antes). Solo un
 * administrador: la regla general del admin deja escribir sin pasar por las de
 * phoneGuards. Sin dryRun: false no escribe nada, solo cuenta.
 */
export async function applyPhoneGuardPlan({ fs, db, plan, dryRun = true, batchSize = 400 }) {
  const rows = plan || [];
  if (dryRun) return { written: 0, planned: rows.length };
  let written = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = fs.writeBatch(db);
    for (const row of rows.slice(i, i + batchSize)) batch.set(fs.doc(db, 'phoneGuards', row.id), row.data);
    await batch.commit();
    written += Math.min(batchSize, rows.length - i);
  }
  return { written, planned: rows.length };
}
