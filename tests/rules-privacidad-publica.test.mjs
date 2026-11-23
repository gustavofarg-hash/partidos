// Punto 18 (v232): sin sesión nadie vuelca los anotados de partidos abiertos.
// Solo se listan las filas de la ficha que fija la consulta (rosterId ==),
// que es lo que hace la página del jugador. Teléfono, token y pagos ajenos no se ven.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-privacidad-publica.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guestListenPlan } from '../js/profile.js';

const ORG = 'orgGustavoUid123456';
const STRANGER = 'otroUsuarioSinRol123';
const JUAN = 'RosterJuanAbcdef0001';
const LEAN = 'RosterLeanAbcdef0002';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const OPEN = '2026-11-25_2000';
const PRIV = '2026-11-26_1000';

function row(extra = {}) {
  return {
    matchId: OPEN, matchDate: '2026-11-25', name: 'Juan', viewers: ['*'], adders: ['*'],
    rosterId: JUAN, phoneKey: 'a'.repeat(64), confirmToken: 'confirmTokenJuan1234', shareToken: SHARE,
    paid: true, amount: 5000, method: 'efectivo', cash: 5000, transfer: 0, waiting: false,
    addedBy: 'Gustavo', addedByUid: ORG,
    ...extra,
  };
}

function build(fs, db, plan) {
  const { collection, query, where, orderBy } = fs;
  const parts = plan.filters.map((f) => where(f.field, f.op, f.value));
  if (plan.orderBy?.length) parts.push(orderBy(plan.orderBy[0], plan.orderBy[1]));
  return query(collection(db, plan.collection), ...parts);
}

test('punto 18: sin sesión solo se listan las filas de la propia ficha', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc, getDoc, getDocs, query, collection, where, orderBy } = fs;
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-privacidad-publica',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'roster', JUAN), { name: 'Juan' });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean' });
      await setDoc(doc(db, 'players', `${OPEN}__${JUAN}`), row({ selfSignup: true }));
      await setDoc(doc(db, 'players', 'leanAbierto'), row({ name: 'Lean', rosterId: LEAN, phoneKey: 'b'.repeat(64), confirmToken: 'confirmTokenLean1234' }));
      await setDoc(doc(db, 'players', 'sinFicha'), row({ name: 'Invitado', rosterId: '', phoneKey: '', confirmToken: 'confirmTokenInv12345' }));
      await setDoc(doc(db, 'players', 'leanSoloYo'), row({ matchId: PRIV, matchDate: '2026-11-26', name: 'Lean', rosterId: LEAN, viewers: [ORG], adders: [ORG], phoneKey: 'b'.repeat(64) }));
      await setDoc(doc(db, 'confirmations', 'confirmTokenJuan1234'), { m: OPEN, p: `${OPEN}__${JUAN}`, t: 'confirmTokenJuan1234' });
    });

    const anon = testEnv.unauthenticatedContext().firestore();
    const players = collection(anon, 'players');
    // Volcados que antes andaban: ahora no.
    await assertFails(getDocs(query(players, where('viewers', 'array-contains', '*'))));
    await assertFails(getDocs(query(players, where('viewers', 'array-contains', '*'), where('matchDate', '>=', '2026-11-23'), orderBy('matchDate', 'asc'))));
    await assertFails(getDocs(query(players, where('viewers', 'array-contains', '*'), where('rosterId', '>=', '0'))));
    await assertFails(getDocs(query(players, where('viewers', 'array-contains', '*'), where('rosterId', '!=', 'x'))));
    await assertFails(getDocs(query(players, where('viewers', 'array-contains', '*'), where('matchId', '==', OPEN))));
    await assertFails(getDocs(query(players, where('shareToken', '==', SHARE))));

    // La página del jugador (las mismas consultas que arma guestListenPlan) sigue andando.
    const plan = guestListenPlan({ rosterId: JUAN, today: '2026-11-23', shareToken: SHARE });
    const own = await assertSucceeds(getDocs(build(fs, anon, plan.players)));
    assert.deepEqual(own.docs.map((d) => d.id), [`${OPEN}__${JUAN}`]);
    const link = await assertSucceeds(getDocs(build(fs, anon, plan.linkPlayers)));
    assert.deepEqual(link.docs.map((d) => d.id), [`${OPEN}__${JUAN}`]);
    // «Solo yo»: Lean se ve a sí mismo con su enlace, y a nadie más.
    const leanPlan = guestListenPlan({ rosterId: LEAN, today: '2026-11-23', shareToken: SHARE });
    const leanLink = await assertSucceeds(getDocs(build(fs, anon, leanPlan.linkPlayers)));
    assert.deepEqual(leanLink.docs.map((d) => d.id).sort(), ['leanAbierto', 'leanSoloYo']);
    const leanOpen = await assertSucceeds(getDocs(build(fs, anon, leanPlan.players)));
    assert.deepEqual(leanOpen.docs.map((d) => d.id), ['leanAbierto']);

    // Lectura directa de la propia fila y página de confirmación: sin cambios.
    await assertSucceeds(getDoc(doc(anon, 'players', `${OPEN}__${JUAN}`)));
    await assertSucceeds(getDoc(doc(anon, 'confirmations', 'confirmTokenJuan1234')));

    // Con sesión pero sin ser organizador activo: tampoco vuelca.
    const stranger = testEnv.authenticatedContext(STRANGER, { email: 'x@demo.local' }).firestore();
    await assertFails(getDocs(query(collection(stranger, 'players'), where('viewers', 'array-contains', '*'))));

    // El organizador sigue leyendo todo como antes.
    const org = testEnv.authenticatedContext(ORG, { email: 'g@demo.local' }).firestore();
    const all = await assertSucceeds(getDocs(query(collection(org, 'players'), where('viewers', 'array-contains-any', [ORG, '*']), where('matchDate', '>=', '2026-11-20'), orderBy('matchDate', 'desc'))));
    assert.equal(all.size, 4);
    const star = await assertSucceeds(getDocs(query(collection(org, 'players'), where('matchId', 'in', [OPEN]), where('viewers', 'array-contains', '*'))));
    assert.equal(star.size, 3);
  } finally {
    await testEnv.cleanup();
  }
});
