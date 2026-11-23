// Alta desde el enlace del jugador, sin sesión, con el token del organizador.
// El documento es el que escribe _guestSelfJoin. Si la regla vuelve a llamar
// a validPlayer, Firestore corta en 1000 expresiones y niega el alta.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-guest-signup.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selfMoveEntry } from '../js/log.js';

const ROSTER = 'NZpoLFKUUh044kfNGSmR';
const MATCH = '2026-11-17_1700';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const ORG = 'orgGustavoUid123456';
const NAME = 'Ángel Díaz';

function payload(id, { waiting = false } = {}) {
  const now = Date.now();
  return {
    matchId: MATCH,
    matchDate: '2026-11-17',
    name: NAME,
    rosterId: ROSTER,
    selfSignup: true,
    waiting,
    waitOrder: waiting ? 1 : null,
    tentative: !waiting,
    tentativeAt: waiting ? null : now,
    rosterAt: waiting ? null : now,
    addedByUid: ORG,
    addedBy: 'Gustavo',
    signedUpWith: ORG,
    signedUpWithName: 'Gustavo',
    shareToken: SHARE,
    createdAt: now,
    updatedAt: now,
    phone: '',
    hasPhone: false,
    phoneKey: '',
    phoneOwnerUid: '',
    phoneShared: false,
    confirmToken: 'confirmTokenValue1234',
    viewers: ['*'],
    adders: ['*'],
  };
}

function logEntry(player, { type, detail, shareToken, actorName, actorUid }) {
  return selfMoveEntry(
    { id: MATCH, date: '2026-11-17', time: '17:00', venueName: 'Polideportivo Colegiales', createdByUid: ORG, viewers: ['*'], adders: ['*'] },
    [],
    player,
    { type, detail, actorName, actorUid, rosterId: ROSTER, guest: true, shareToken },
  );
}

test('el enlace con token puede anotarse, esperar y anular', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc, deleteDoc, serverTimestamp, runTransaction } = await import('firebase/firestore');
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const [hostname, portRaw] = host.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-guest-signup',
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: hostname,
      port: Number(portRaw),
    },
  });
  try {
    await testEnv.clearFirestore();
    const admin = testEnv.authenticatedContext('admin-uid', { email: 'gustavof.arg@gmail.com' });
    const adb = admin.firestore();
    await assertSucceeds(setDoc(doc(adb, 'users', 'admin-uid'), {
      role: 'admin', name: 'Gustavo', email: 'gustavof.arg@gmail.com', active: true, createdAt: 1,
    }));
    await assertSucceeds(setDoc(doc(adb, 'users', ORG), {
      role: 'organizer', name: 'Gustavo', email: 'gustavo@demo.local', active: true, createdAt: 1,
    }));
    await assertSucceeds(setDoc(doc(adb, 'roster', ROSTER), {
      name: NAME, holders: [ORG], createdByUid: ORG, createdAt: 1, updatedAt: 1,
    }));
    await assertSucceeds(setDoc(doc(adb, 'matches', MATCH), {
      date: '2026-11-17', time: '17:00', venueName: 'Polideportivo Colegiales',
      capacity: 14, createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
    }));
    const org = testEnv.authenticatedContext(ORG, { email: 'gustavo@demo.local' });
    await assertSucceeds(setDoc(doc(org.firestore(), 'shareTokens', SHARE), {
      uid: ORG, name: 'Gustavo', createdAt: 1,
    }));

    const anon = testEnv.unauthenticatedContext().firestore();
    const charge = (playerId, count) => assertSucceeds(runTransaction(anon, async (tx) => {
      const ref = doc(anon, 'signupRates', ROSTER);
      const snap = await tx.get(ref);
      const prev = snap.exists() ? snap.data() : null;
      tx.set(ref, {
        windowStart: prev ? prev.windowStart : serverTimestamp(),
        count,
        lastId: playerId,
      });
    }));

    const playerId = 'm1abcxyzpending01';
    const body = payload(playerId);
    await charge(playerId, 1);
    await assertSucceeds(setDoc(doc(anon, 'players', playerId), body));
    await assertSucceeds(setDoc(doc(anon, 'log', 'logAltaPendiente01'), logEntry(
      { id: playerId, ...body },
      { type: 'se anotó', detail: 'Pendiente de confirmación', shareToken: SHARE, actorName: 'Gustavo', actorUid: ORG },
    )));
    await assertSucceeds(setDoc(doc(anon, 'signupPings', 'pingAltaPendiente01'), {
      kind: 'alta', name: NAME, playerId, rosterId: ROSTER, matchId: MATCH,
      date: '2026-11-17', time: '17:00', venueName: 'Polideportivo Colegiales',
      createdAt: Date.now(), organizerUid: ORG, shareToken: SHARE,
    }));
    const saved = await getDoc(doc(adb, 'players', playerId));
    assert.equal(saved.exists(), true);
    assert.equal(saved.data().tentative, true);
    assert.equal(saved.data().shareToken, SHARE);
    assert.equal(saved.data().addedByUid, ORG);

    const paid = payload('m1abcxyzpaidblock1');
    paid.paid = true;
    await charge('m1abcxyzpaidblock1', 2);
    await assertFails(setDoc(doc(anon, 'players', 'm1abcxyzpaidblock1'), paid));

    const waitId = 'm1abcxyzwaitlist01';
    const waiting = payload(waitId, { waiting: true });
    await charge(waitId, 3);
    await assertSucceeds(setDoc(doc(anon, 'players', waitId), waiting));
    await assertSucceeds(setDoc(doc(anon, 'log', 'logAltaEspera0001'), logEntry(
      { id: waitId, ...waiting },
      { type: 'se anotó', detail: 'En la lista de espera', shareToken: SHARE, actorName: 'Gustavo', actorUid: ORG },
    )));

    await charge(playerId, 4);
    await assertSucceeds(deleteDoc(doc(anon, 'players', playerId)));
    await assertSucceeds(setDoc(doc(anon, 'log', 'logBajaPendiente01'), logEntry(
      { id: playerId, name: NAME },
      { type: 'se bajó', detail: 'Anuló su lugar', shareToken: '', actorName: NAME, actorUid: '' },
    )));
    await charge(waitId, 5);
    await assertSucceeds(deleteDoc(doc(anon, 'players', waitId)));
    const gone = await getDoc(doc(adb, 'players', playerId));
    const waitGone = await getDoc(doc(adb, 'players', waitId));
    assert.equal(gone.exists(), false);
    assert.equal(waitGone.exists(), false);

    const confirmedId = 'm1abcxyzconfirmed1';
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'players', confirmedId), { ...payload(confirmedId), tentative: false, tentativeAt: null });
    });
    await assertSucceeds(setDoc(doc(anon, 'confirmSeen', confirmedId), { rosterId: ROSTER, seen: true }));
    await assertFails(setDoc(doc(anon, 'confirmSeen', playerId), { rosterId: ROSTER, seen: true }));
    await assertFails(setDoc(doc(anon, 'confirmSeen', confirmedId), { rosterId: ROSTER, seen: false }));
    const tokenTail = 'abcdefghijklmnopqrstuvwx';
    await assertSucceeds(setDoc(doc(anon, 'playerTokens', `${ROSTER}_${tokenTail}`), {
      rosterId: ROSTER, token: tokenTail, updatedAt: Date.now(),
    }));
    await assertFails(setDoc(doc(anon, 'playerTokens', `${ROSTER}_${tokenTail}b`), {
      rosterId: 'otraFichaQueNoExiste', token: tokenTail, updatedAt: Date.now(),
    }));
    const staff = testEnv.authenticatedContext(ORG, { email: 'gustavo@demo.local' }).firestore();
    await assertSucceeds(setDoc(doc(staff, 'signupPings', 'pingConfirmo000001'), {
      kind: 'confirmado', name: NAME, playerId: confirmedId, rosterId: ROSTER, matchId: MATCH,
      date: '2026-11-17', time: '17:00', venueName: 'Polideportivo Colegiales',
      createdAt: Date.now(), organizerUid: '', shareToken: '',
    }));
  } finally {
    await testEnv.cleanup();
  }
});

// Autoservicio con el enlace de un organizador en un partido abierto a todos
// (adders ['*']) que creó otro organizador: queda a nombre del dueño del enlace.
test('el enlace queda a nombre de su organizador en un partido de todos creado por otro', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, serverTimestamp, runTransaction } = await import('firebase/firestore');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-guest-signup-shared',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  const MARTIN = 'orgMartinUid1234567';
  const OWN = '2026-11-18_2100';
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'roster', ROSTER), { name: NAME, holders: [ORG, MARTIN], createdByUid: ORG, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', MATCH), {
        date: '2026-11-17', time: '17:00', venueName: 'Polideportivo Colegiales',
        capacity: 14, createdByUid: MARTIN, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
      });
      await setDoc(doc(db, 'matches', OWN), {
        date: '2026-11-18', time: '21:00', venueName: 'Polideportivo Colegiales',
        capacity: 14, createdByUid: MARTIN, viewers: [MARTIN], adders: [MARTIN], playerCount: 0, playerVisible: true,
      });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
    });
    const anon = testEnv.unauthenticatedContext().firestore();
    let count = 0;
    const charge = (playerId) => assertSucceeds(runTransaction(anon, async (tx) => {
      const ref = doc(anon, 'signupRates', ROSTER);
      const snap = await tx.get(ref);
      const prev = snap.exists() ? snap.data() : null;
      count += 1;
      tx.set(ref, { windowStart: prev ? prev.windowStart : serverTimestamp(), count, lastId: playerId });
    }));
    const shared = 'm2sharedgustavo01';
    await charge(shared);
    await assertSucceeds(setDoc(doc(anon, 'players', shared), payload(shared)));

    // Partido solo de Martín: el enlace de Gustavo no puede ponerse como organizador.
    const mine = 'm2onlymartin00001';
    await charge(mine);
    await assertFails(setDoc(doc(anon, 'players', mine), { ...payload(mine), matchId: OWN, matchDate: '2026-11-18', viewers: [MARTIN], adders: [MARTIN] }));

    // El token tiene que ser del organizador que figura.
    const forged = 'm2forgedmartin001';
    await charge(forged);
    await assertFails(setDoc(doc(anon, 'players', forged), {
      ...payload(forged), addedByUid: MARTIN, addedBy: 'Martín', signedUpWith: MARTIN, signedUpWithName: 'Martín',
    }));
  } finally {
    await testEnv.cleanup();
  }
});
