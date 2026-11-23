// v235: «Confirmado (por Gustavo)». Al aceptar la anotación del Autoservicio el
// organizador guarda acceptedBy con su nombre. Las reglas no cambian: el
// organizador ya podía escribir el campo, el jugador no puede ponérselo solo.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-confirmado-por.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selfSignupRows } from '../js/self-signup.js';

const ORG = 'orgGustavoUid123456';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const OPEN = '2026-11-28_2000';
const LEAN = 'RosterLeanAbcdef0003';
const MARIA = 'RosterMariaAbcde0004';
const K2 = '2'.repeat(64);
const K3 = '3'.repeat(64);

test('v235: el organizador guarda quién aceptó y el jugador lo ve; el jugador no se lo pone solo', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc, getDoc, getDocs, updateDoc, collection, query, where } = fs;
  const { FirebaseStore } = await import('../js/store.js');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-confirmado-por',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean', holders: [ORG], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', MARIA), { name: 'María', holders: [ORG], createdByUid: ORG, phoneKey: K3, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', OPEN), {
        date: '2026-11-28', time: '20:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
      });
    });
    const match = { id: OPEN, date: '2026-11-28', time: '20:00', capacity: 14, createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true };
    const anon = testEnv.unauthenticatedContext().firestore();
    const quiet = (store) => {
      store._appendLogs = async () => {};
      store._writeSignupPing = async () => {};
      store._writeConfirmation = async () => {};
      store._emit = () => {};
      store.state.matches = [match];
      store.state.venues = [];
      store.state.suspensions = [];
    };

    // 1. María, por el enlace, no puede anotarse ya «aceptada por» nadie: el mismo
    // alta de la app con acceptedBy agregado no entra; sin el campo, sí.
    const forger = new FirebaseStore();
    forger.fs = {
      ...fs,
      writeBatch: (db) => {
        const batch = fs.writeBatch(db);
        const set = batch.set.bind(batch);
        batch.set = (ref, data, opts) => set(ref, ref.path.startsWith('players/') ? { ...data, acceptedBy: 'Gustavo' } : data, opts);
        return batch;
      },
      setDoc: (ref, data, opts) => fs.setDoc(ref, ref.path.startsWith('players/') ? { ...data, acceptedBy: 'Gustavo' } : data, opts),
    };
    forger.db = anon;
    quiet(forger);
    forger.state.players = [];
    forger.state.roster = [{ id: MARIA, name: 'María', phoneKey: K3 }];
    await assert.rejects(
      forger.selfJoin(match, { id: MARIA, name: 'María', phoneKey: K3 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE } }),
      (error) => /permission-denied/.test(String(error?.code || '')),
    );
    const honest = new FirebaseStore();
    honest.fs = fs;
    honest.db = anon;
    quiet(honest);
    honest.state.players = [];
    honest.state.roster = [{ id: MARIA, name: 'María', phoneKey: K3 }];
    const mariaId = await honest.selfJoin(match, { id: MARIA, name: 'María', phoneKey: K3 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE } });
    assert.equal(mariaId, `${OPEN}__${MARIA}`);

    // 2. Lean se anota por el enlace (pendiente) con la app de siempre.
    const guest = new FirebaseStore();
    guest.fs = fs;
    guest.db = anon;
    quiet(guest);
    guest.state.players = [];
    guest.state.roster = [{ id: LEAN, name: 'Lean', phoneKey: K2 }];
    const leanId = await guest.selfJoin(match, { id: LEAN, name: 'Lean', phoneKey: K2 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE } });
    const ref = doc(anon, 'players', leanId);
    // Él no se pone «aceptado por» en su fila.
    await assertFails(updateDoc(ref, { acceptedBy: 'Gustavo' }));

    // 3. Gustavo toca Confirmar: pasa por las reglas y queda acceptedBy.
    const gus = new FirebaseStore();
    gus.fs = fs;
    gus.db = testEnv.authenticatedContext(ORG, { email: 'g@demo.local' }).firestore();
    gus.actor = { uid: ORG, name: 'Gustavo', role: 'organizer' };
    quiet(gus);
    let pending = null;
    await testEnv.withSecurityRulesDisabled(async (context) => { pending = (await getDoc(doc(context.firestore(), 'players', leanId))).data(); });
    assert.equal(pending.tentative, true);
    assert.equal('acceptedBy' in pending, false);
    gus.state.players = [{ id: leanId, ...pending }];
    gus.state.roster = [{ id: LEAN, name: 'Lean', phoneKey: K2, holders: [ORG] }];
    await gus.confirmSelf(leanId);

    // 4. Sin sesión, el Autoservicio lee su fila y muestra «Confirmado (por Gustavo)».
    const snap = await assertSucceeds(getDocs(query(collection(anon, 'players'), where('viewers', 'array-contains', '*'), where('rosterId', '==', LEAN))));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].acceptedBy, 'Gustavo');
    assert.notEqual(rows[0].tentative, true);
    const [row] = selfSignupRows({ person: { id: LEAN, name: 'Lean', holders: [ORG] }, matches: [match], players: rows, now: Date.parse('2026-11-28T12:00:00-03:00') });
    assert.equal(row.note, 'Confirmado (por Gustavo)');
    assert.equal(row.status, 'confirmed');
  } finally {
    await testEnv.cleanup();
  }
});
