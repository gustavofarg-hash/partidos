// v259: «Confirmado (por …)» siempre en el Autoservicio; el «Sí, juego» del link es
// solo informativo; subir de la lista de espera guarda quién lo subió.
// Reglas: firebase emulators:exec --project demo-f7c --only firestore "node --test tests/confirmado-por-v259.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmedLabel, selfRowAction } from '../js/self-signup.js';
import * as reminders from '../js/reminders.js';
import * as store from '../js/store.js';

const ORG = 'Gus Ficticio';
const base = { selfSignup: true, waiting: false, tentative: null, name: 'Ficticio Uno', signedUpWithName: ORG, addedBy: ORG };

test('Autoservicio: acceptedBy → organizador del link → quien agregó', () => {
  assert.equal(confirmedLabel({ ...base, acceptedBy: 'Otro Ficticio' }), 'Confirmado (por Otro)');
  assert.equal(confirmedLabel(base), 'Confirmado (por Gus)');
  assert.equal(confirmedLabel({ ...base, signedUpWithName: '' }), 'Confirmado (por Gus)');
  assert.equal(confirmedLabel({ ...base, signedUpWithName: '', addedBy: '' }), 'Confirmado');
  const far = Date.now() + 5 * 864e5;
  assert.equal(selfRowAction({ player: base, full: false, kickoff: far }).note, 'Confirmado (por Gus)');
});

test('Cargados por el organizador e invitados: como antes', () => {
  assert.equal(confirmedLabel({ name: 'X', signedUpWithName: ORG, addedBy: 'Otro' }), 'Confirmado (por Gus)');
  assert.equal(confirmedLabel({ name: 'X', guestAuto: true, signedUpWithName: ORG, addedBy: ORG }), 'Confirmado');
});

test('El «Sí» del link no suelta el lugar pendiente: queda como dato', () => {
  assert.equal(typeof reminders.reservationClearedByAnswer, 'undefined');
  const held = reminders.confirmStatus({ tentative: true, confirmed: 'si' });
  assert.deepEqual(held, { cls: 'reserved', text: 'Reservado · a confirmar', note: 'Respondió que juega', said: 'si' });
  assert.equal(reminders.confirmStatus({ tentative: true, confirmed: 'no' }).note, 'No juega · se puede liberar el lugar');
  assert.equal(reminders.confirmStatus({ confirmed: 'si' }).text, '✅ Confirmó');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /releaseAnsweredReservations|reservationClearedByAnswer/);
  assert.equal((app.match(/app\.store\.clearTentative\(/g) || []).length, 0, 'nadie suelta el lugar sin «Confirmar lugar»');
  assert.match(app, /app\.store\.confirmSelf\(player\.id\)/);
});

test('Subir de la espera guarda quién lo subió', () => {
  assert.deepEqual(store.promotedByPatch({ waiting: true }, { uid: 'u', name: '  Gus   Ficticio ' }), { acceptedBy: 'Gus Ficticio' });
  assert.deepEqual(store.promotedByPatch({ waiting: false }, { name: ORG }), {});
  assert.deepEqual(store.promotedByPatch({ waiting: true }, { name: '' }), {});
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const calls = src.match(/async promoteFromWaiting\(id\) \{[\s\S]*?updatePlayer\(id, \{[^\n]*\}\);/g) || [];
  assert.equal(calls.length, 2, 'las dos tiendas');
  for (const c of calls) assert.match(c, /promotedByPatch\((before|cur), this\._actor\(\)\)/);
});

test('reglas: el organizador sube de la espera con acceptedBy; el jugador no se lo pone', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) { t.skip('sin emulador de Firestore'); return; }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, updateDoc } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-confirmado-por-v259', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) } });
  const U = 'orgFicticio000000001';
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, 'users', U), { role: 'organizer', name: ORG, email: 'org@ficticio.test', active: true, createdAt: 1 });
      await setDoc(doc(db, 'matches', 'm1'), { date: '2026-12-10', time: '18:00', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U], createdByUid: U, playerCount: 0 });
      const row = { matchId: 'm1', matchDate: '2026-12-10', name: 'Ficticio Uno', rosterId: 'FichaFicticia0001', selfSignup: true, waiting: true, waitOrder: 1, tentative: false, tentativeAt: null, rosterAt: null, addedByUid: U, addedBy: ORG, signedUpWith: U, signedUpWithName: ORG, createdAt: 1, updatedAt: 1, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false, confirmToken: 'tokFicticio000000001', viewers: ['*'], adders: [U] };
      await setDoc(doc(db, 'players', 'w1'), row);
      await setDoc(doc(db, 'players', 'w2'), row);
    });
    const org = env.authenticatedContext(U).firestore();
    await assertSucceeds(updateDoc(doc(org, 'players', 'w1'), { waiting: false, waitOrder: null, rosterAt: 5, acceptedBy: ORG, updatedAt: 5 }));
    await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'players', 'w2'), { acceptedBy: 'Yo mismo', updatedAt: 6 }));
  } finally {
    await env.cleanup();
  }
});
