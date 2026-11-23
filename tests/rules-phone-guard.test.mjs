// v233: un teléfono, una persona por partido, también sin sesión.
// phoneGuards/{partido}__{huella}: el alta con teléfono la escribe en el mismo
// lote; las reglas la exigen y no dejan pisar la de otro jugador anotado.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-phone-guard.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { phoneGuardDoc, phoneGuardId } from '../js/phone-guard.js';
import { ALREADY_SIGNED_UP, phoneTakenText } from '../js/guests.js';

const ORG = 'orgGustavoUid123456';
const MARTIN = 'orgMartinUid1234567';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const OPEN = '2026-11-28_2000';
const JUAN = 'RosterJuanAbcdef0001';      // ficha de Gustavo, teléfono K1
const JUANCHO = 'RosterJuanchoAbcd0002';  // la misma persona, ficha de Martín, mismo teléfono
const LEAN = 'RosterLeanAbcdef0003';      // otro teléfono
const K1 = '1'.repeat(64);
const K2 = '2'.repeat(64);
const K3 = '3'.repeat(64);
const K4 = '4'.repeat(64);
const K5 = '5'.repeat(64);
const K6 = '6'.repeat(64);
const K7 = '7'.repeat(64);

function slot(extra = {}) {
  const now = Date.now();
  return {
    matchId: OPEN, matchDate: '2026-11-28', name: 'Juan', phone: '',
    addedBy: 'Gustavo', addedByUid: ORG, createdAt: now, updatedAt: now,
    waiting: false, waitOrder: null, rosterAt: now, confirmToken: 'confirmTokenValue1234',
    hasPhone: true, phoneKey: K1, phoneOwnerUid: ORG, phoneShared: false,
    viewers: ['*'], adders: ['*'],
    ...extra,
  };
}

function guestRow(rosterId, name, extra = {}) {
  const now = Date.now();
  return {
    matchId: OPEN, matchDate: '2026-11-28', name, rosterId, selfSignup: true,
    waiting: false, waitOrder: null, tentative: true, tentativeAt: now, rosterAt: now,
    addedByUid: ORG, addedBy: 'Gustavo', signedUpWith: ORG, signedUpWithName: 'Gustavo', shareToken: SHARE,
    createdAt: now, updatedAt: now, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false,
    confirmToken: 'confirmTokenGuest1234', viewers: ['*'], adders: ['*'],
    ...extra,
  };
}

test('v233: guardia de teléfono por partido en cada camino', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, writeBatch, collection, runTransaction, serverTimestamp } = fs;
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-phone-guard',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
      await setDoc(doc(db, 'roster', JUAN), { name: 'Juan', holders: [ORG], createdByUid: ORG, phoneKey: K1, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', JUANCHO), { name: 'Juancho', holders: [ORG], createdByUid: ORG, phoneKey: K1, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean', holders: [ORG], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', OPEN), {
        date: '2026-11-28', time: '20:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
      });
    });
    const org = testEnv.authenticatedContext(ORG, { email: 'g@demo.local' }).firestore();
    const martin = testEnv.authenticatedContext(MARTIN, { email: 'm@demo.local' }).firestore();
    const anon = testEnv.unauthenticatedContext().firestore();
    const guardRef = (db, key) => doc(db, 'phoneGuards', phoneGuardId(OPEN, key));
    const addWithGuard = (db, id, row, key = row.phoneKey, guardFor = id) => {
      const batch = writeBatch(db);
      batch.set(doc(db, 'players', id), row);
      batch.set(guardRef(db, key), phoneGuardDoc(guardFor, row, key));
      return batch.commit();
    };
    const charge = (rosterId, playerId) => assertSucceeds(runTransaction(anon, async (tx) => {
      const ref = doc(anon, 'signupRates', rosterId);
      const snap = await tx.get(ref);
      const prev = snap.exists() ? snap.data() : null;
      tx.set(ref, { windowStart: prev ? prev.windowStart : serverTimestamp(), count: (prev?.count || 0) + 1, lastId: playerId });
    }));

    // 1. Alta del organizador: sin guardia, o con la guardia de otro id, no entra.
    await assertFails(setDoc(doc(org, 'players', 'juan'), slot()));
    await assertFails(addWithGuard(org, 'juan', slot(), K1, 'otroJugador'));
    await assertSucceeds(addWithGuard(org, 'juan', slot()));
    // Sin teléfono no hace falta guardia.
    await assertSucceeds(setDoc(doc(org, 'players', 'sinTel'), slot({ name: 'Sin tel', hasPhone: false, phoneKey: '', phoneOwnerUid: '' })));

    // 2. Martín anota a la misma persona con otro nombre: la guardia lo frena.
    await assertFails(addWithGuard(martin, 'juancho', slot({ name: 'Juancho', addedBy: 'Martín', addedByUid: MARTIN, phoneOwnerUid: MARTIN })));
    await assertFails(setDoc(doc(martin, 'players', 'juancho'), slot({ name: 'Juancho', addedBy: 'Martín', addedByUid: MARTIN, phoneOwnerUid: MARTIN })));
    // El organizador lee la guardia para el mensaje; nadie la lista.
    const seen = await assertSucceeds(getDoc(guardRef(martin, K1)));
    assert.equal(phoneTakenText(seen.data().name, seen.data().addedBy), 'Ese número ya está anotado en este partido como Juan (lo anotó Gustavo).');
    await assertFails(getDocs(collection(martin, 'phoneGuards')));

    // 3. Sin sesión: no se lee ni se lista; el alta del enlace con el mismo número no entra.
    await assertFails(getDoc(guardRef(anon, K1)));
    await assertFails(getDocs(collection(anon, 'phoneGuards')));
    const juanchoSelf = `${OPEN}__${JUANCHO}`;
    await charge(JUANCHO, juanchoSelf);
    await assertFails(addWithGuard(anon, juanchoSelf, guestRow(JUANCHO, 'Juancho'), K1));
    await assertFails(setDoc(doc(anon, 'players', juanchoSelf), guestRow(JUANCHO, 'Juancho')));
    // La pregunta del enlace: su número está tomado (niega) / el de Lean está libre (anda).
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN, 'rosters', JUANCHO)));
    await assertSucceeds(getDoc(doc(anon, 'phoneChecks', OPEN, 'rosters', LEAN)));

    // 4. Lean por el enlace: con su guardia entra; sin ella, no. Sin pasar el tope de 1000 expresiones.
    const leanSelf = `${OPEN}__${LEAN}`;
    await charge(LEAN, leanSelf);
    await assertFails(setDoc(doc(anon, 'players', leanSelf), guestRow(LEAN, 'Lean')));
    await assertSucceeds(addWithGuard(anon, leanSelf, guestRow(LEAN, 'Lean'), K2));
    // Segunda vez, mismo id: no se pisa.
    await assertFails(addWithGuard(anon, leanSelf, guestRow(LEAN, 'Lean'), K2));
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN, 'rosters', LEAN)));

    // 5. A la espera y de vuelta: la guardia no se toca.
    await assertSucceeds(updateDoc(doc(org, 'players', 'juan'), { waiting: true, waitOrder: 1, updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(org, 'players', 'juan'), { waiting: false, waitOrder: null, updatedAt: Date.now() }));
    await testEnv.withSecurityRulesDisabled(async (context) => {
      assert.equal((await getDoc(guardRef(context.firestore(), K1))).data().playerId, 'juan');
    });

    // 6. Cambio de número: sin la guardia nueva no entra; con la mudanza, sí, y el viejo queda libre.
    await assertFails(updateDoc(doc(org, 'players', 'juan'), { phoneKey: K3, updatedAt: Date.now() }));
    {
      const batch = writeBatch(org);
      batch.update(doc(org, 'players', 'juan'), { phoneKey: K3, updatedAt: Date.now() });
      batch.set(guardRef(org, K3), phoneGuardDoc('juan', slot(), K3));
      batch.delete(guardRef(org, K1));
      await assertSucceeds(batch.commit());
    }
    // A Lean no se le puede poner el número de Juan.
    {
      const batch = writeBatch(org);
      batch.update(doc(org, 'players', leanSelf), { phoneKey: K3, hasPhone: true, phoneOwnerUid: ORG, updatedAt: Date.now() });
      batch.set(guardRef(org, K3), phoneGuardDoc(leanSelf, guestRow(LEAN, 'Lean'), K3));
      await assertFails(batch.commit());
    }
    await assertSucceeds(addWithGuard(martin, 'juancho', slot({ name: 'Juancho', addedBy: 'Martín', addedByUid: MARTIN, phoneOwnerUid: MARTIN })));

    // 7. Baja: jugador y guardia en el mismo lote; después el número entra por el enlace.
    {
      const batch = writeBatch(martin);
      batch.delete(doc(martin, 'players', 'juancho'));
      batch.delete(guardRef(martin, K1));
      await assertSucceeds(batch.commit());
    }
    await assertSucceeds(addWithGuard(anon, juanchoSelf, guestRow(JUANCHO, 'Juancho'), K1));
    // El jugador del enlace se baja y saca su guardia.
    await charge(JUANCHO, juanchoSelf);
    {
      const batch = writeBatch(anon);
      batch.delete(doc(anon, 'players', juanchoSelf));
      batch.delete(guardRef(anon, K1));
      await assertSucceeds(batch.commit());
    }

    // 8. Nadie borra ni pisa la guardia de un jugador anotado, ni inventa una.
    await assertFails(deleteDoc(guardRef(anon, K2)));
    await assertFails(deleteDoc(guardRef(martin, K2)));
    await assertFails(setDoc(guardRef(anon, K2), phoneGuardDoc('juan', slot(), K2)));
    await assertFails(setDoc(guardRef(anon, K6), phoneGuardDoc('noExiste', slot(), K6)));

    // 9. Guardia vieja de un jugador que ya no está: se pisa sin problema.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(guardRef(db, K4), phoneGuardDoc('fantasma', slot(), K4));
      // Altas de antes de v233, sin guardia.
      await setDoc(doc(db, 'players', 'viejo'), slot({ name: 'Viejo', phoneKey: K5 }));
      await setDoc(doc(db, 'players', 'viejoA'), slot({ name: 'Viejo A', phoneKey: K7 }));
      await setDoc(doc(db, 'players', 'viejoB'), slot({ name: 'Viejo B', phoneKey: K7 }));
      await setDoc(guardRef(db, K7), phoneGuardDoc('viejoA', slot(), K7));
    });
    await assertSucceeds(addWithGuard(org, 'nuevo4', slot({ name: 'Nuevo', phoneKey: K4 })));

    // 10. Jugadores sin guardia (de antes): cambiar estado, número y borrar sigue andando.
    await assertSucceeds(updateDoc(doc(org, 'players', 'viejo'), { waiting: true, waitOrder: 2, updatedAt: Date.now() }));
    {
      const batch = writeBatch(org);
      batch.update(doc(org, 'players', 'viejo'), { phoneKey: K6, updatedAt: Date.now() });
      batch.set(guardRef(org, K6), phoneGuardDoc('viejo', slot(), K6));
      batch.delete(guardRef(org, K5));
      await assertSucceeds(batch.commit());
    }
    {
      // La guardia de K7 es de viejoA: borrar a viejoB con ella falla, sin ella anda (el reintento de la app).
      const withGuard = writeBatch(org);
      withGuard.delete(doc(org, 'players', 'viejoB'));
      withGuard.delete(guardRef(org, K7));
      await assertFails(withGuard.commit());
      await assertSucceeds(deleteDoc(doc(org, 'players', 'viejoB')));
    }
  } finally {
    await testEnv.cleanup();
  }
});

test('v233: el enlace y el organizador ven el mensaje de siempre (FirebaseStore contra el emulador)', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc, getDoc, writeBatch } = fs;
  const { FirebaseStore } = await import('../js/store.js');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-phone-guard-store',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
      await setDoc(doc(db, 'roster', JUAN), { name: 'Juan', holders: [ORG], createdByUid: ORG, phoneKey: K1, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', JUANCHO), { name: 'Juancho', holders: [ORG], createdByUid: ORG, phoneKey: K1, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean', holders: [ORG], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', OPEN), {
        date: '2026-11-28', time: '20:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
      });
      await setDoc(doc(db, 'players', 'juan'), slot());
      await setDoc(doc(db, 'phoneGuards', phoneGuardId(OPEN, K1)), phoneGuardDoc('juan', slot(), K1));
    });
    const match = { id: OPEN, date: '2026-11-28', time: '20:00', capacity: 14, createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 1, playerVisible: true };
    const quiet = (store) => {
      store._appendLogs = async () => {};
      store._writeSignupPing = async () => {};
      store._writeConfirmation = async () => {};
      store.ensureShortLink = async () => {};
      store._emit = () => {};
      store.state.matches = [match];
      store.state.venues = [];
      store.state.suspensions = [];
    };

    // El enlace de Juancho (mismo teléfono que Juan): «Ya estás anotado en este partido.»
    const guest = new FirebaseStore();
    guest.fs = fs;
    guest.db = testEnv.unauthenticatedContext().firestore();
    quiet(guest);
    guest.state.players = [];
    guest.state.roster = [{ id: JUANCHO, name: 'Juancho', phoneKey: K1 }];
    await assert.rejects(
      guest.selfJoin(match, { id: JUANCHO, name: 'Juancho', phoneKey: K1 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE } }),
      (error) => error.code === 'already-in-match' && error.message === ALREADY_SIGNED_UP,
    );
    // Lean, con otro número, entra y queda su guardia.
    guest.state.roster = [{ id: LEAN, name: 'Lean', phoneKey: K2 }];
    const leanId = await guest.selfJoin(match, { id: LEAN, name: 'Lean', phoneKey: K2 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE } });
    assert.equal(leanId, `${OPEN}__${LEAN}`);
    // Y se baja: jugador y guardia afuera.
    guest.state.players = [{ id: leanId, ...guestRow(LEAN, 'Lean') }];
    guest.state.matches = [{ ...match, date: '2099-01-01' }];
    await guest.selfCancel(leanId, Date.parse('2026-11-23T12:00:00-03:00'));

    // Martín no ve a Juan (no está en su lista) y quiere anotarlo como Juancho: el mensaje del organizador.
    const mar = new FirebaseStore();
    mar.fs = fs;
    mar.db = testEnv.authenticatedContext(MARTIN, { email: 'm@demo.local' }).firestore();
    mar.actor = { uid: MARTIN, name: 'Martín', role: 'organizer' };
    quiet(mar);
    mar.state.players = [];
    mar.state.roster = [];
    await assert.rejects(
      mar.addPlayer(match, { name: 'Juancho', phoneKey: K1, hasPhone: true }, 'Martín'),
      (error) => error.code === 'already-in-match' && error.message === 'Ese número ya está anotado en este partido como Juan (lo anotó Gustavo).',
    );

    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      assert.equal((await getDoc(doc(db, 'players', leanId))).exists(), false);
      assert.equal((await getDoc(doc(db, 'phoneGuards', phoneGuardId(OPEN, K2)))).exists(), false);
      assert.equal((await getDoc(doc(db, 'phoneGuards', phoneGuardId(OPEN, K1)))).data().playerId, 'juan');
    });
    void writeBatch;
  } finally {
    await testEnv.cleanup();
  }
});

test('v233: el alta del enlace con guardia no pasa el tope de 1000 expresiones en los caminos largos', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, writeBatch, runTransaction, serverTimestamp } = await import('firebase/firestore');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-phone-guard-largo',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  const PRIV = '2026-11-29_1000';
  const OTHER = '2026-11-29_2100';
  const MSHARE = 'martinTokenAbcdefghijklm';
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', MSHARE), { uid: MARTIN, name: 'Martín', createdAt: 1 });
      await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean', holders: [ORG, MARTIN], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
      // «Solo yo» de Gustavo con su enlace.
      await setDoc(doc(db, 'matches', PRIV), {
        date: '2026-11-29', time: '10:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: [ORG], adders: [ORG], playerCount: 0, playerVisible: true, playerKey: SHARE, solo: true,
      });
      // Partido de todos que creó Gustavo; el enlace es de Martín.
      await setDoc(doc(db, 'matches', OTHER), {
        date: '2026-11-29', time: '21:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
      });
    });
    const anon = testEnv.unauthenticatedContext().firestore();
    const charge = (playerId) => assertSucceeds(runTransaction(anon, async (tx) => {
      const ref = doc(anon, 'signupRates', LEAN);
      const snap = await tx.get(ref);
      const prev = snap.exists() ? snap.data() : null;
      tx.set(ref, { windowStart: prev ? prev.windowStart : serverTimestamp(), count: (prev?.count || 0) + 1, lastId: playerId });
    }));
    const join = (matchId, row) => {
      const id = `${matchId}__${LEAN}`;
      const batch = writeBatch(anon);
      batch.set(doc(anon, 'players', id), row);
      batch.set(doc(anon, 'phoneGuards', phoneGuardId(matchId, K2)), phoneGuardDoc(id, row, K2));
      return batch.commit();
    };
    const privId = `${PRIV}__${LEAN}`;
    await charge(privId);
    await assertSucceeds(join(PRIV, guestRow(LEAN, 'Lean', { matchId: PRIV, matchDate: '2026-11-29', viewers: [ORG], adders: [ORG] })));
    const otherId = `${OTHER}__${LEAN}`;
    await charge(otherId);
    await assertSucceeds(join(OTHER, guestRow(LEAN, 'Lean', {
      matchId: OTHER, matchDate: '2026-11-29', addedByUid: MARTIN, addedBy: 'Martín', signedUpWith: MARTIN, signedUpWithName: 'Martín', shareToken: MSHARE, waiting: true, waitOrder: 1, tentative: false, tentativeAt: null, rosterAt: null,
    })));
  } finally {
    await testEnv.cleanup();
  }
});

