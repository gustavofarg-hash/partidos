// v239: atajo del ícono de arriba a la izquierda.
// Un toque abre el partido que se está jugando; dos toques seguidos, sus Equipos.
import { matchStartsAt } from './reminders.js';

/** Un partido «se está jugando» desde el saque hasta una hora después. */
export const SHORTCUT_PLAYING_MS = 60 * 60 * 1000;
/** Dos toques dentro de este plazo cuentan como doble toque. */
export const SHORTCUT_DOUBLE_MS = 350;

/**
 * El partido del atajo: el que empezó hace menos de una hora (si hay dos, el
 * que empezó último; a las 18:15 abre el de las 17:30). Si no hay ninguno en
 * juego, el próximo que empieza. Los cancelados no cuentan. Sin partido, null.
 */
export function shortcutMatch(matches, now = Date.now()) {
  const at = Number(now);
  let playing = null;
  let playingStart = -Infinity;
  let next = null;
  let nextStart = Infinity;
  for (const match of matches || []) {
    if (!match?.id || match.cancelled === true) continue;
    const start = matchStartsAt(match);
    if (!Number.isFinite(start)) continue;
    if (start <= at && at - start < SHORTCUT_PLAYING_MS) {
      if (start > playingStart) { playing = match; playingStart = start; }
    } else if (start > at && start < nextStart) {
      next = match;
      nextStart = start;
    }
  }
  return playing || next;
}

/** El hash al que lleva el atajo. Sin partido, el inicio. */
export function shortcutHash(match, teams = false) {
  if (!match?.id) return '#/';
  const base = `#/partido/${encodeURIComponent(match.id)}`;
  return teams ? `${base}/equipos` : base;
}
