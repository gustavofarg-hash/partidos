// v240 (pedidos 5 y 15): avisos de la base. El detalle técnico es solo para el
// admin; un organizador ve un texto corto. El aviso de conexión se borra solo
// cuando vuelve la respuesta del servidor.

export const OFFLINE_SHORT = 'Sin conexión, reintentando…';
export const DB_GENERIC = 'Hubo un problema con la base de datos. Si sigue, avisale al administrador.';
export const WRITE_GENERIC = 'No se pudo guardar. Probá de nuevo.';
export const NO_SERVER_DETAIL = 'No hay conexión con la base de datos de Firebase: los cambios quedan solo en este teléfono. ¿Está creada la base Firestore del proyecto? (ver README)';
export const OFFLINE_DETAIL = 'Sin conexión a internet: los cambios quedan en este teléfono hasta que vuelva la conexión.';

const CONNECTION_CODES = new Set(['no-server', 'offline', 'unavailable', 'deadline-exceeded']);

function codeOf(error) {
  return String(error?.code || '').replace(/_/g, '-').replace(/^firestore\//, '');
}

export function isConnectionError(error) {
  return CONNECTION_CODES.has(codeOf(error));
}

/**
 * El cartel rojo para un error de la base. { text, connection }.
 * connection: true si se tiene que borrar solo al volver la conexión.
 */
export function storeErrorNotice(error, { admin = false, rulesMsg = '' } = {}) {
  const code = codeOf(error);
  if (CONNECTION_CODES.has(code)) {
    if (!admin) return { text: OFFLINE_SHORT, connection: true };
    if (code === 'offline') return { text: OFFLINE_DETAIL, connection: true };
    if (code === 'no-server') return { text: NO_SERVER_DETAIL, connection: true };
    return { text: `Problema de conexión con Firebase (${code}): ${error?.message || ''}`.trim(), connection: true };
  }
  if (!admin) return { text: DB_GENERIC, connection: false };
  if (code === 'permission-denied' && rulesMsg) return { text: rulesMsg, connection: false };
  return { text: 'Problema de conexión con Firebase: ' + (error?.message || error?.code || String(error || '')), connection: false };
}

/** Un texto de error de lectura: entero para el admin, genérico para el resto. */
export function adminOnlyDetail(text, admin) {
  if (!text) return text;
  return admin ? text : DB_GENERIC;
}

/**
 * El aviso de un guardado que falló. Los textos cortos (límite diario, la base
 * no respondió, permiso) quedan para todos; el código y el mensaje de Firebase,
 * solo para el admin.
 */
export function writeFailureFor(text, admin) {
  const value = String(text || '');
  if (admin) return value;
  if (/^No se pudo guardar: (se alcanzó el límite diario de Firebase|la base no respondió\.|Firebase rechazó el permiso)$/.test(value)) return value;
  return WRITE_GENERIC;
}

/** El aviso de conexión se borra cuando llega una respuesta del servidor y hay red. */
export function connectionBack({ shown, serverOk, fromCache, online } = {}) {
  return !!shown && serverOk === true && fromCache !== true && online !== false;
}
