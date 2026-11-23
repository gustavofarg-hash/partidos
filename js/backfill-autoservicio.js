// Arreglo de una sola vez: altas de Autoservicio que quedaron sin organizador
// (addedByUid vacío y Agregó con el nombre del propio jugador). Puro: arma los
// cambios; quien lo corre los revisa y los escribe con permiso de administrador.
import { orphanSelfSignup, orphanSelfSignupOwner } from './ledger.js';

/**
 * [{ id, name, matchId, patch, from }] para cada huérfano con dueño conocido,
 * y skipped con los que no se pueden asignar solos.
 * tokens: Map o { token: { uid, name } } de shareTokens. staff: usuarios { uid, name }.
 */
export function selfSignupBackfillPlan({ players, matches, staff, tokens = null }) {
  const byMatch = new Map((matches || []).map((match) => [match.id, match]));
  const byUid = new Map((staff || []).filter((user) => user?.uid).map((user) => [user.uid, user]));
  const plan = [];
  const skipped = [];
  for (const player of players || []) {
    if (!orphanSelfSignup(player)) continue;
    const match = byMatch.get(player.matchId) || null;
    const owner = orphanSelfSignupOwner(player, match, tokens);
    const user = owner ? byUid.get(owner.uid) : null;
    const name = String(user?.name || owner?.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!owner || !name) {
      skipped.push({ id: player.id || '', name: player.name || '', matchId: player.matchId || '' });
      continue;
    }
    plan.push({
      id: player.id || '',
      name: player.name || '',
      matchId: player.matchId || '',
      from: owner.token ? 'token' : 'creador',
      patch: { addedByUid: owner.uid, addedBy: name, signedUpWith: owner.uid, signedUpWithName: name },
    });
  }
  return { plan, skipped };
}
