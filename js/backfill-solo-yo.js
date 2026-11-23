// Arreglo de una sola vez del punto 10: jugadores que anotó un organizador en un
// partido «solo yo» antes de f7c-v230 no tienen shareToken, y su enlace no los ve.
// Puro: arma los cambios. Los escribe un administrador, después de revisarlos.
import { playerLinkKey } from './profile.js';

function isOpen(match) {
  return !Array.isArray(match?.viewers) || !match.viewers.length || match.viewers.includes('*');
}

/**
 * Solo partidos de today en adelante (la ficha mira esa ventana), privados,
 * visibles para jugadores, y jugadores con ficha, sin shareToken y que no son Autoservicio.
 * El token: playerKey del partido, si no el del creador (tokensByUid: { uid: token }).
 */
export function linkTokenBackfillPlan({ players, matches, today, tokensByUid = {} }) {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const day = String(today || '');
  const plan = [];
  const skipped = [];
  for (const player of players || []) {
    const match = byId.get(player?.matchId);
    if (!match || !day || String(match.date || '') < day) continue;
    if (isOpen(match) || match.playerVisible === false || match.cancelled === true) continue;
    if (!String(player?.rosterId || '').trim() || player?.selfSignup === true) continue;
    if (String(player?.shareToken || '').trim()) continue;
    const fromMatch = playerLinkKey(match, match.playerKey);
    const creator = String(match.createdByUid || '').trim();
    const token = fromMatch || playerLinkKey(match, tokensByUid?.[creator]);
    if (!token) {
      skipped.push({ id: player.id || '', matchId: match.id });
      continue;
    }
    plan.push({ id: player.id || '', matchId: match.id, from: fromMatch ? 'partido' : 'creador', patch: { shareToken: token } });
  }
  return { plan, skipped };
}
