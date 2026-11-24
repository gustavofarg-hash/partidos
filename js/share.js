import { PRODUCTION_ORIGIN, publicAppOrigin } from './trial.js';

export const APP_INSTALL_URL = `${PRODUCTION_ORIGIN}/`;

export function appInstallUrl() {
  const base = publicAppOrigin();
  return base.endsWith('/') ? base : `${base}/`;
}

/** Token opaco del organizador que comparte el enlace. No es el mail ni el uid. */
export function newShareToken() {
  const bytes = new Uint8Array(18);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Enlace de un jugador. Con token, es el de ese organizador.
 * Sin token, el enlace viejo: #/jugador/{id}.
 * v237: con el link reseteado va la clave al final: #/jugador/{id}/{token}/{clave}
 * (sin token, «-» en su lugar).
 */
export function playerLink(rosterId, organizerToken = '', linkKey = '') {
  const id = String(rosterId || '').trim();
  if (!id) return '';
  const token = String(organizerToken || '').trim();
  const key = String(linkKey || '').trim();
  const base = `${appInstallUrl()}#/jugador/${encodeURIComponent(id)}`;
  if (key) return `${base}/${token ? encodeURIComponent(token) : '-'}/${encodeURIComponent(key)}`;
  return token ? `${base}/${encodeURIComponent(token)}` : base;
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** { id, token, key } o null. El token falta en los enlaces de antes; la clave, en los no reseteados. */
export function playerLinkParts(hash) {
  const parts = String(hash || '').replace(/^#\/?/, '').split('/');
  if (parts[0] !== 'jugador' || !parts[1]) return null;
  const token = parts[2] && parts[2] !== '-' ? decodePart(parts[2]) : '';
  return { id: decodePart(parts[1]), token, key: parts[3] ? decodePart(parts[3]) : '' };
}

/** Hash de una ficha: #/jugador/{id} o #/jugador/{id}/{token}. Sin id no cuenta. */
export function isPlayerDeepLink(hash) {
  return !!playerLinkParts(hash);
}

/** Primer nombre, el mismo de «Próximos partidos de {nombre}». */
export function organizerFirstName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)[0] || '';
}

/** «Próximos partidos de Gustavo». Vacío si no hay nombre. */
export function organizerMatchesTitle(name) {
  const first = organizerFirstName(name);
  return first ? `Próximos partidos de ${first}` : '';
}

/** «Esperando la confirmación de Gustavo...». Sin nombre, sin el «de». */
export function pendingConfirmLabel(name) {
  const first = organizerFirstName(name);
  return first ? `Esperando la confirmación de ${first}...` : 'Esperando la confirmación...';
}

export function appShareMessage() {
  return `Anotate con Mis Partidos. Instalá la app desde acá.\n${appInstallUrl()}`;
}
