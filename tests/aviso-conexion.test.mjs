// v240 (pedidos 5 y 15): el cartel de la base. Organizador: texto corto;
// admin: el detalle. El de conexión se borra solo al volver el servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DB_GENERIC, NO_SERVER_DETAIL, OFFLINE_SHORT, WRITE_GENERIC, adminOnlyDetail, connectionBack, isConnectionError, storeErrorNotice, writeFailureFor } from '../js/db-notice.js';
import { writeFailureText } from '../js/usage.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const RULES = 'Firebase rechazó el acceso. Hay que actualizar las reglas de Firestore (publicar firestore.rules).';

test('sin servidor: organizador ve «Sin conexión, reintentando…», admin el detalle', () => {
  assert.equal(OFFLINE_SHORT, 'Sin conexión, reintentando…');
  assert.deepEqual(storeErrorNotice({ code: 'no-server' }, { admin: false }), { text: OFFLINE_SHORT, connection: true });
  assert.deepEqual(storeErrorNotice({ code: 'no-server' }, { admin: true }), { text: NO_SERVER_DETAIL, connection: true });
  assert.match(NO_SERVER_DETAIL, /^No hay conexión con la base de datos de Firebase/);
  assert.equal(storeErrorNotice({ code: 'unavailable', message: 'x' }, { admin: false }).text, OFFLINE_SHORT);
  assert.match(storeErrorNotice({ code: 'unavailable', message: 'backend caído' }, { admin: true }).text, /unavailable.*backend caído/);
  assert.equal(storeErrorNotice({ code: 'offline' }, { admin: false }).connection, true);
  assert.equal(isConnectionError({ code: 'deadline_exceeded' }), true);
  assert.equal(isConnectionError({ code: 'permission-denied' }), false);
});

test('otros errores: detalle solo para el admin', () => {
  assert.deepEqual(storeErrorNotice({ code: 'permission-denied' }, { admin: false, rulesMsg: RULES }), { text: DB_GENERIC, connection: false });
  assert.equal(storeErrorNotice({ code: 'permission-denied' }, { admin: true, rulesMsg: RULES }).text, RULES);
  assert.equal(storeErrorNotice({ code: 'internal', message: 'algo técnico' }, { admin: false }).text, DB_GENERIC);
  assert.match(storeErrorNotice({ code: 'internal', message: 'algo técnico' }, { admin: true }).text, /algo técnico/);
  const idx = 'Falta el índice de Firestore para los jugadores del historial (matchId + viewers).';
  assert.equal(adminOnlyDetail(idx, true), idx);
  assert.equal(adminOnlyDetail(idx, false), DB_GENERIC);
  assert.equal(adminOnlyDetail('', false), '');
});

test('guardar: el código de Firebase solo lo ve el admin', () => {
  const raw = writeFailureText({ code: 'internal', message: 'INTERNAL ASSERTION FAILED' });
  assert.match(raw, /INTERNAL ASSERTION/);
  assert.equal(writeFailureFor(raw, true), raw);
  assert.equal(writeFailureFor(raw, false), WRITE_GENERIC);
  for (const code of ['resource-exhausted', 'deadline-exceeded', 'permission-denied']) {
    const text = writeFailureText({ code });
    assert.equal(writeFailureFor(text, false), text, code);
  }
});

test('el aviso de conexión se borra al volver el servidor', () => {
  assert.equal(connectionBack({ shown: true, serverOk: true, fromCache: false, online: true }), true);
  assert.equal(connectionBack({ shown: true, serverOk: false, fromCache: false, online: true }), false);
  assert.equal(connectionBack({ shown: true, serverOk: true, fromCache: true, online: true }), false);
  assert.equal(connectionBack({ shown: true, serverOk: true, fromCache: false, online: false }), false);
  assert.equal(connectionBack({ shown: false, serverOk: true, fromCache: false, online: true }), false);
});

test('la app usa los avisos nuevos', () => {
  assert.match(app, /app\.store = await createStore\(\(e\) => \{\n\s+\/\/ v240[^\n]*\n\s+showConnectionNotice\(e\);/);
  assert.doesNotMatch(app, /'No hay conexión con la base de datos de Firebase/);
  assert.match(app, /if \(!app\.guestPlayer\) clearConnectionNotice\(view\);/);
  assert.match(app, /toast\(writeFailureFor\(writeFailureText\(e\), isAdminUser\(\)\), 4500\)/);
  assert.match(app, /showError\(adminOnlyDetail\(rosterError, isAdminUser\(\)\)\)/);
  assert.match(app, /window\.addEventListener\('offline', offline\)/);
});
