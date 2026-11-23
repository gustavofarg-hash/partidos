// Punto 10: el jugador que anota el organizador en un «solo yo» se ve anotado
// desde su enlace (shareToken + rosterId), sin abrir el partido a los demás.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-solo-yo-link.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ORG = 'orgGustavoUid123456';
const MARTIN = 'orgMartinUid1234567';
const ROSTER = 'NZpoLFKUUh044kfNGSmR';
const OTHER = 'OtraFichaDeJugador01';
const PRIV = '2026-11-21_1000';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const SHARE_M = 'martinTokenAbcdefghijklm';

function slot(extra = {}) {
  const now = Date.now();
  return {
    matchId: PRIV, matchDate: '2026-11-21', name: 'Lean A', phone: '',
    addedBy: 'Gustavo', addedByUid: ORG, createdAt: now, updatedAt: now,
    waiting: false, waitOrder: null, rosterAt: now, confirmToken: 'confirmTokenValue1234',
    hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false,
    viewers: [ORG], adders: [ORG], rosterId: ROSTER,
    signedUpWith: ORG, signedUpWithName: 'Gustavo', shareToken: SHARE,
    ...extra,
  };
}

test('«solo yo»: el enlace ve su propio alta y nada más', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, getDocs, query, collection, where } = await import('firebase/firestore');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-solo-yo-link',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE_M), { uid: MARTIN, name: 'Martín', createdAt: 1 });
      await setDoc(doc(db, 'matches', PRIV), {
        date: '2026-11-21', time: '10:00', venueName: 'Polideportivo Colegiales', capacity: 14,
        createdByUid: ORG, viewers: [ORG], adders: [ORG], playerVisible: true, playerKey: SHARE, playerCount: 0, solo: true,
      });
    });
    const org = testEnv.authenticatedContext(ORG, { email: 'g@demo.local' }).firestore();
    // El organizador lo anota con el token del partido (su enlace).
    await assertSucceeds(setDoc(doc(org, 'players', 'alta-solo-yo'), slot()));
    // Sin token también se puede (jugador sin ficha o partido sin enlace).
    const bare = slot({ name: 'Sin ficha', shareToken: '' });
    delete bare.rosterId;
    await assertSucceeds(setDoc(doc(org, 'players', 'alta-sin-token'), bare));
    // Con el token de otro organizador, no.
    await assertFails(setDoc(doc(org, 'players', 'alta-token-ajeno'), slot({ shareToken: SHARE_M, rosterId: OTHER })));
    await assertFails(setDoc(doc(org, 'players', 'alta-token-ajeno2'), slot({ shareToken: SHARE_M, rosterId: OTHER, paid: false })));

    const anon = testEnv.unauthenticatedContext().firestore();
    const mine = await assertSucceeds(getDocs(query(collection(anon, 'players'), where('shareToken', '==', SHARE), where('rosterId', '==', ROSTER))));
    assert.deepEqual(mine.docs.map((row) => row.id), ['alta-solo-yo']);
    // Con el enlace de otro organizador no aparece.
    const other = await assertSucceeds(getDocs(query(collection(anon, 'players'), where('shareToken', '==', SHARE_M), where('rosterId', '==', ROSTER))));
    assert.equal(other.size, 0);
    // La consulta abierta (viewers *) sigue sin ver el «solo yo».
    const open = await assertSucceeds(getDocs(query(collection(anon, 'players'), where('rosterId', '==', ROSTER), where('viewers', 'array-contains', '*'))));
    assert.equal(open.size, 0);
    // Y sin filtrar por token no se puede listar.
    await assertFails(getDocs(query(collection(anon, 'players'), where('rosterId', '==', ROSTER))));
  } finally {
    await testEnv.cleanup();
  }
});
