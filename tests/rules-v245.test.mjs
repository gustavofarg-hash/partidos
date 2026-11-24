// v245: reglas de suspendFlags y del alta directa en «No jugó pero pagó».
// Solo emulador. Datos ficticios.
//   firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-v245.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUS = 'gusV245';
const MAR = 'marV245';
const FICHA = 'fichaFicticiaV245xx';

test('v245: suspendFlags y No jugó pero pagó con las reglas reales', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, getDoc, deleteDoc, collection, getDocs } = await import('firebase/firestore');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-v245',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', GUS), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MAR), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'matches', 'm1'), { date: '2026-11-21', time: '21:00', capacity: 2, createdByUid: GUS, viewers: [GUS], adders: [GUS] });
    });
    const gus = env.authenticatedContext(GUS, { email: 'g@demo.local' }).firestore();
    const mar = env.authenticatedContext(MAR, { email: 'm@demo.local' }).firestore();
    const anon = env.unauthenticatedContext().firestore();
    const flag = `${FICHA}_${GUS}`;
    // El dueño escribe su marca, con solo esos campos y el id correcto.
    await assertSucceeds(setDoc(doc(gus, 'suspendFlags', flag), { ownerUid: GUS, rosterId: FICHA, at: 1 }));
    await assertFails(setDoc(doc(gus, 'suspendFlags', `${FICHA}_${MAR}`), { ownerUid: GUS, rosterId: FICHA, at: 1 }));
    await assertFails(setDoc(doc(mar, 'suspendFlags', flag), { ownerUid: GUS, rosterId: FICHA, at: 1 }));
    await assertFails(setDoc(doc(gus, 'suspendFlags', flag), { ownerUid: GUS, rosterId: FICHA, at: 1, note: 'motivo' }));
    await assertFails(setDoc(doc(anon, 'suspendFlags', `${FICHA}_x`), { ownerUid: 'x', rosterId: FICHA, at: 1 }));
    // Sin sesión: get de una marca sí, lista no.
    const snap = await assertSucceeds(getDoc(doc(anon, 'suspendFlags', flag)));
    assert.equal(snap.exists(), true);
    await assertSucceeds(getDoc(doc(anon, 'suspendFlags', `${FICHA}_${MAR}`)));
    await assertFails(getDocs(collection(anon, 'suspendFlags')));
    // Solo el dueño la borra; borrar una que no existe no falla (levantar sin marca vieja).
    await assertFails(deleteDoc(doc(mar, 'suspendFlags', flag)));
    await assertSucceeds(deleteDoc(doc(gus, 'suspendFlags', flag)));
    await assertSucceeds(deleteDoc(doc(gus, 'suspendFlags', flag)));

    // Alta directa en No jugó pero pagó.
    const base = {
      matchId: 'm1', matchDate: '2026-11-21', name: 'Ficticio Bajado', addedBy: 'Gustavo', addedByUid: GUS,
      createdAt: 1, updatedAt: 1, viewers: [GUS], adders: [GUS], waiting: false, waitOrder: null, rosterAt: 1,
      confirmToken: 'tokenficticio0123456789', hasPhone: false, phoneKey: '', phoneOwnerUid: GUS, phoneShared: false,
    };
    await assertSucceeds(setDoc(doc(gus, 'players', 'np1'), { ...base, noPlay: true }));
    await assertSucceeds(setDoc(doc(gus, 'players', 'np2'), { ...base, noPlay: false }));
    await assertFails(setDoc(doc(gus, 'players', 'np3'), { ...base, noPlay: true, waiting: true, waitOrder: 1, rosterAt: null }));
    await assertFails(setDoc(doc(gus, 'players', 'np4'), { ...base, noPlay: true, tentative: true, tentativeAt: 1 }));
    await assertFails(setDoc(doc(gus, 'players', 'np5'), { ...base, noPlay: 'si' }));
    await assertFails(setDoc(doc(mar, 'players', 'np6'), { ...base, addedBy: 'Martín', addedByUid: MAR, phoneOwnerUid: MAR, noPlay: true }));
  } finally {
    await env.cleanup();
  }
});
