// v237: «Resetear link». Solo la ficha reseteada pide la clave; las demás siguen igual.
// Con el link viejo falla cada camino sin sesión (ficha, lista, anotarse, bajarse,
// phoneChecks, aviso, registro, token); con la clave vigente anda; rotar mata la anterior.
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-resetear-link.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ORG = 'orgGustavoUid123456';
const MARTIN = 'orgMartinUid1234567';
const SHARE = 'abcdefghijklmnopqrstuvwx';
const OPEN = '2026-11-28_2000';
const OPEN2 = '2026-11-29_2000';
const JUAN = 'RosterJuanAbcdef0001';   // se resetea
const LEAN = 'RosterLeanAbcdef0003';   // nunca se resetea
const K1 = '1'.repeat(64);
const K2 = '2'.repeat(64);

test('v237: link reseteado en cada camino sin sesión', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc, getDoc, getDocs, writeBatch, collection, query, where, runTransaction, serverTimestamp, addDoc } = fs;
  const { FirebaseStore } = await import('../js/store.js');
  const { LINK_INVALID_TEXT } = await import('../js/link-reset.js');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: 'demo-resetear-link',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  const raw = async (fn) => {
    let out;
    await testEnv.withSecurityRulesDisabled(async (context) => { out = await fn(context.firestore()); });
    return out;
  };
  try {
    await testEnv.clearFirestore();
    const matchDoc = (date) => ({
      date, time: '20:00', venueName: 'Polideportivo Colegiales', capacity: 14,
      createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true,
    });
    await raw(async (db) => {
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MARTIN), { role: 'organizer', name: 'Martín', email: 'm@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
      await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
      await setDoc(doc(db, 'roster', JUAN), { name: 'Juan', holders: [ORG], createdByUid: ORG, phoneKey: K1, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'roster', LEAN), { name: 'Lean', holders: [ORG], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', OPEN), matchDoc('2026-11-28'));
      await setDoc(doc(db, 'matches', OPEN2), matchDoc('2026-11-29'));
    });
    const match = { id: OPEN, ...matchDoc('2026-11-28') };
    const match2 = { id: OPEN2, ...matchDoc('2026-11-29') };
    const organizer = { uid: ORG, name: 'Gustavo', token: SHARE };
    const anon = testEnv.unauthenticatedContext().firestore();
    const orgDb = testEnv.authenticatedContext(ORG, { email: 'g@demo.local' }).firestore();
    const martinDb = testEnv.authenticatedContext(MARTIN, { email: 'm@demo.local' }).firestore();

    // Página del jugador sin sesión, con la app de siempre (los avisos y el registro van de verdad).
    const guestStore = (rosterId, person, key = '') => {
      const s = new FirebaseStore();
      s.fs = fs;
      s.db = anon;
      s._guest = true;
      s._guestRosterId = rosterId;
      s._shareToken = SHARE;
      s._linkKey = key;
      s._emit = () => {};
      s._writeConfirmation = async () => {};
      s.state.matches = [match, match2];
      s.state.venues = [];
      s.state.suspensions = [];
      s.state.roster = [{ id: rosterId, ...person }];
      s.state.players = [];
      return s;
    };
    const listFor = (db, rosterId, key) => getDocs(query(collection(db, 'players'),
      where('rosterId', '==', rosterId),
      ...(key ? [where('linkKey', '==', key)] : []),
      where('viewers', 'array-contains', '*'),
      where('matchDate', '>=', '2026-11-23'),
      where('matchDate', '<=', '2026-12-07')));
    const proof = (db, rosterId, key) => [doc(db, 'linkProofs', rosterId, 'k', key), { at: serverTimestamp() }];
    const pingCount = (rosterId) => raw(async (db) => (await getDocs(query(collection(db, 'signupPings'), where('rosterId', '==', rosterId)))).size);
    const logCount = (rosterId) => raw(async (db) => (await getDocs(query(collection(db, 'log'), where('rosterId', '==', rosterId)))).size);
    const juan = { name: 'Juan', phoneKey: K1, hasPhone: true, holders: [ORG], createdByUid: ORG };
    const lean = { name: 'Lean', phoneKey: K2, hasPhone: true, holders: [ORG], createdByUid: ORG };

    // 1. Sin resetear: todo igual que antes (Lean y Juan).
    const leanGuest = guestStore(LEAN, lean);
    const leanId = await leanGuest.selfJoin(match, { id: LEAN, ...lean }, { organizer });
    await assertSucceeds(getDoc(doc(anon, 'roster', LEAN)));
    assert.equal((await assertSucceeds(listFor(anon, LEAN))).size, 1);
    await assertSucceeds(getDoc(doc(anon, 'players', leanId)));
    await assertSucceeds(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', LEAN)));
    await assertSucceeds(leanGuest.savePlayerPushToken(LEAN, 'pushTokenLean123456789'));
    await assertSucceeds(getDocs(query(collection(anon, 'confirmSeen'), where('rosterId', '==', LEAN))));
    await leanGuest._guestSelfCancel(leanId, Date.parse('2026-11-24T12:00:00-03:00'));
    assert.equal((await listFor(anon, LEAN)).size, 0);
    assert.equal(await pingCount(LEAN), 2);
    assert.equal(await logCount(LEAN), 2);
    // Una ficha sin resetear no tiene clave: la consulta con clave no sirve para colarse en otra.
    await assertFails(getDoc(doc(anon, 'rosterLinks', LEAN, 'k', 'clave-inventada-12345678')));

    const juanOld = guestStore(JUAN, juan);
    const juanId = await juanOld.selfJoin(match, { id: JUAN, ...juan }, { organizer });

    // 2. Quién resetea: solo quien tiene la ficha (o el admin). Nadie sin sesión ve la clave.
    await assertFails(setDoc(doc(martinDb, 'rosterLocks', JUAN), { key: 'x'.repeat(24), at: 1, by: MARTIN, byName: 'Martín' }));
    await assertFails(setDoc(doc(orgDb, 'rosterLocks', JUAN), { key: 'corta', at: 1, by: ORG, byName: 'Gustavo' }));
    const gus = new FirebaseStore();
    gus.fs = fs;
    gus.db = orgDb;
    gus.actor = { uid: ORG, name: 'Gustavo', role: 'organizer' };
    gus._emit = () => {};
    gus.state.roster = [{ id: JUAN, ...juan }, { id: LEAN, ...lean }];
    gus.state.players = [{ id: juanId, ...(await raw(async (db) => (await getDoc(doc(db, 'players', juanId))).data())) }];
    const first = await gus.resetPlayerLink(JUAN);
    assert.match(first.key, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(first.updated, 1);
    assert.equal(first.missed, 0);
    const key1 = first.key;
    assert.equal(gus.rosterLinkKey(JUAN), key1);
    await assertFails(getDoc(doc(anon, 'rosterLocks', JUAN)));
    await assertFails(getDocs(collection(anon, 'rosterLocks')));
    await assertSucceeds(getDoc(doc(orgDb, 'rosterLocks', JUAN)));
    await assertFails(getDoc(doc(anon, 'linkProofs', JUAN, 'k', key1)));
    const flag = await assertSucceeds(getDoc(doc(anon, 'rosterLinks', JUAN)));
    assert.deepEqual(Object.keys(flag.data()).sort(), ['at', 'locked']);

    // 3. Link viejo (sin clave): cada camino falla.
    await assertFails(getDoc(doc(anon, 'roster', JUAN)));
    await assertFails(listFor(anon, JUAN));
    await assertFails(getDocs(query(collection(anon, 'players'), where('shareToken', '==', SHARE), where('rosterId', '==', JUAN))));
    await assertFails(getDoc(doc(anon, 'players', juanId)));
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', JUAN)));
    await assertFails(getDocs(query(collection(anon, 'confirmSeen'), where('rosterId', '==', JUAN))));
    await assert.rejects(juanOld.selfJoin(match2, { id: JUAN, ...juan }, { organizer }), (e) => /permission-denied/.test(String(e?.code)));
    juanOld.state.players = [{ id: juanId, ...(await raw(async (db) => (await getDoc(doc(db, 'players', juanId))).data())) }];
    await assert.rejects(juanOld._guestSelfCancel(juanId, Date.parse('2026-11-24T12:00:00-03:00')), (e) => /permission-denied/.test(String(e?.code)));
    await assertFails(juanOld.savePlayerPushToken(JUAN, 'pushTokenJuan123456789'));
    await assertFails(addDoc(collection(anon, 'signupPings'), { kind: 'alta', name: 'Juan', playerId: juanId, rosterId: JUAN, matchId: OPEN, date: '2026-11-28', time: '20:00', venueName: 'x', createdAt: Date.now(), organizerUid: ORG, shareToken: SHARE }));
    // Con una clave inventada tampoco (la prueba de otra clave se niega).
    const fake = 'claveInventada_1234567890';
    await assertFails(getDoc(doc(anon, 'rosterLinks', JUAN, 'k', fake)));
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', JUAN, 'k', fake)));
    await assertFails(listFor(anon, JUAN, fake));
    await assertFails(setDoc(...proof(anon, JUAN, fake)));
    // La prueba sola, o con otra hora, no sirve.
    await assertFails(setDoc(doc(anon, 'linkProofs', JUAN, 'k', key1), { at: 1 }));
    // El organizador sigue viendo todo con su sesión.
    await assertSucceeds(getDoc(doc(orgDb, 'roster', JUAN)));
    // Lean no cambió.
    await assertSucceeds(getDoc(doc(anon, 'roster', LEAN)));
    await assertSucceeds(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', LEAN)));

    // 4. Link nuevo (con la clave): cada camino anda.
    const mirror = await assertSucceeds(getDoc(doc(anon, 'rosterLinks', JUAN, 'k', key1)));
    assert.equal(mirror.data().name, 'Juan');
    assert.equal(mirror.data().phoneKey, K1);
    const listed = await assertSucceeds(listFor(anon, JUAN, key1));
    assert.deepEqual(listed.docs.map((d) => d.id), [juanId]);
    await assertSucceeds(getDocs(query(collection(anon, 'players'), where('shareToken', '==', SHARE), where('rosterId', '==', JUAN), where('linkKey', '==', key1))));
    await assertSucceeds(getDocs(query(collection(anon, 'confirmSeen'), where('rosterId', '==', JUAN), where('linkKey', '==', key1))));
    await assertSucceeds(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', JUAN, 'k', key1)));
    // Su número ya está en OPEN: la pregunta con clave niega igual que antes.
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN, 'rosters', JUAN, 'k', key1)));
    const juanNew = guestStore(JUAN, { ...mirror.data() }, key1);
    juanNew.state.players = listed.docs.map((d) => ({ id: d.id, ...d.data() }));
    const pings0 = await pingCount(JUAN);
    const logs0 = await logCount(JUAN);
    await juanNew._guestSelfCancel(juanId, Date.parse('2026-11-24T12:00:00-03:00'));
    assert.equal((await listFor(anon, JUAN, key1)).size, 0);
    // Alta con teléfono (guardia + prueba + tope): entra, sin pasar el tope de 1000 expresiones.
    const juan2 = await juanNew.selfJoin(match2, { id: JUAN, ...mirror.data() }, { organizer });
    const row2 = await raw(async (db) => (await getDoc(doc(db, 'players', juan2))).data());
    assert.equal(row2.linkKey, key1);
    assert.equal((await listFor(anon, JUAN, key1)).size, 1);
    // Anotado a la espera (otro camino del alta) también entra.
    await juanNew._guestSelfCancel(juan2, Date.parse('2026-11-24T12:00:00-03:00'));
    const juan3 = await juanNew.selfJoin(match2, { id: JUAN, ...mirror.data() }, { organizer, waiting: true });
    assert.ok(juan3);
    await assertSucceeds(juanNew.savePlayerPushToken(JUAN, 'pushTokenJuan123456789'));
    assert.equal(await pingCount(JUAN), pings0 + 4);
    assert.equal(await logCount(JUAN), logs0 + 4);
    // El organizador anota a Juan en otro partido: la fila lleva la clave y el link la ve.
    gus.state.matches = [match, match2];
    gus.state.venues = [];
    gus.state.suspensions = [];
    gus.state.players = [];
    gus._writeConfirmation = async () => {};
    gus._appendLogs = async () => {};
    gus.state.rosterLocks = { [JUAN]: key1 };
    const byOrg = await gus.addPlayer(match, { name: 'Juan', rosterId: JUAN, hasPhone: true, phoneKey: K1 }, 'Gustavo');
    assert.equal((await raw(async (db) => (await getDoc(doc(db, 'players', byOrg))).data())).linkKey, key1);
    assert.equal((await listFor(anon, JUAN, key1)).docs.some((d) => d.id === byOrg), true);

    // 5. Rotar: la clave anterior muere en todos los caminos; la nueva anda.
    gus.state.players = (await raw(async (db) => (await getDocs(query(collection(db, 'players'), where('rosterId', '==', JUAN)))).docs.map((d) => ({ id: d.id, ...d.data() }))));
    const second = await gus.resetPlayerLink(JUAN);
    const key2 = second.key;
    assert.notEqual(key2, key1);
    assert.equal(second.updated, 2);
    await assertFails(getDoc(doc(anon, 'rosterLinks', JUAN, 'k', key1)));
    assert.equal(await raw(async (db) => (await getDoc(doc(db, 'rosterLinks', JUAN, 'k', key1))).exists()), false);
    await assertFails(listFor(anon, JUAN, key1));
    await assertFails(getDoc(doc(anon, 'phoneChecks', OPEN2, 'rosters', JUAN, 'k', key1)));
    juanNew.state.players = (await raw(async (db) => (await getDocs(query(collection(db, 'players'), where('rosterId', '==', JUAN)))).docs.map((d) => ({ id: d.id, ...d.data() }))));
    await assert.rejects(juanNew._guestSelfCancel(juan3, Date.parse('2026-11-24T12:00:00-03:00')), (e) => /permission-denied/.test(String(e?.code)));
    await assertFails(juanNew.savePlayerPushToken(JUAN, 'pushTokenJuan123456789'));
    await assertFails(setDoc(...proof(anon, JUAN, key1)));
    await assertSucceeds(getDoc(doc(anon, 'rosterLinks', JUAN, 'k', key2)));
    assert.equal((await assertSucceeds(listFor(anon, JUAN, key2))).size, 2);
    const juanNewer = guestStore(JUAN, juan, key2);
    juanNewer.state.players = juanNew.state.players;
    await juanNewer._guestSelfCancel(juan3, Date.parse('2026-11-24T12:00:00-03:00'));
    // La fila escrita con la clave vieja no sirve para leer con la nueva lista.
    assert.equal((await listFor(anon, JUAN, key2)).size, 1);

    // 6. La página del jugador: el link viejo muestra el aviso; el nuevo, la ficha.
    const page = async (key) => {
      const s = new FirebaseStore();
      s.fs = fs;
      s.db = anon;
      s._shareToken = SHARE;
      s._linkKey = key;
      let done;
      const ready = new Promise((resolve) => { done = resolve; });
      s._emit = () => { if (s.serverOk) done(); };
      s._listenGuest(JUAN);
      await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 8000))]);
      // La caché del SDK puede contestar primero; el servidor manda después.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      s._stop?.();
      return s;
    };
    const stale = await page('');
    assert.equal(stale.linkInvalid, true);
    assert.deepEqual(stale.state.roster, []);
    const staleKey = await page(key1);
    assert.equal(staleKey.linkInvalid, true);
    const fresh = await page(key2);
    assert.equal(fresh.linkInvalid, false);
    assert.equal(fresh.state.roster[0]?.name, 'Juan');
    assert.equal(fresh.state.players.length, 1);
    assert.equal(LINK_INVALID_TEXT, 'Este link ya no es válido. Pedí uno nuevo al organizador.');
  } finally {
    await testEnv.cleanup();
  }
});

// El alta sin sesión con teléfono ya estaba cerca del tope de 1000 expresiones.
// Con la clave tiene que seguir entrando y dejar margen: se suman 6 condiciones
// de relleno a la regla y el alta (a la espera, el camino más caro) igual entra.
test('v237: alta con clave dentro del tope de 1000 expresiones, con margen', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc } = fs;
  const { FirebaseStore } = await import('../js/store.js');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const anchor = "      return d.keys().hasAll(['tentative'])";
  const source = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.ok(source.includes(anchor));
  const pad = Array(6).fill('request.time != null').join(' && ');
  const rules = source.replace(anchor, `      return (${pad}) && d.keys().hasAll(['tentative'])`);
  const KEY = 'K'.repeat(32);
  let n = 0;
  const attempt = async ({ locked, waiting }) => {
    n += 1;
    const rid = `RosterMargenAbcd${String(n).padStart(4, '0')}`;
    const env = await initializeTestEnvironment({ projectId: `demo-margen-${n}`, firestore: { rules, host: hostname, port: Number(portRaw) } });
    try {
      await env.clearFirestore();
      const md = { date: '2026-11-28', time: '20:00', venueName: 'Polideportivo Colegiales', capacity: 14, createdByUid: ORG, viewers: ['*'], adders: ['*'], playerCount: 0, playerVisible: true };
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
        await setDoc(doc(db, 'shareTokens', SHARE), { uid: ORG, name: 'Gustavo', createdAt: 1 });
        await setDoc(doc(db, 'settings', 'signup'), { maxMoves: 50, windowMinutes: 60 });
        await setDoc(doc(db, 'roster', rid), { name: 'Lean', holders: [ORG], createdByUid: ORG, phoneKey: K2, hasPhone: true, createdAt: 1, updatedAt: 1 });
        await setDoc(doc(db, 'matches', OPEN), md);
        if (locked) await setDoc(doc(db, 'rosterLocks', rid), { key: KEY, at: 1, by: ORG, byName: 'Gustavo' });
      });
      const s = new FirebaseStore();
      s.fs = fs;
      s.db = env.unauthenticatedContext().firestore();
      s._guest = true;
      s._guestRosterId = rid;
      s._linkKey = locked ? KEY : '';
      s._appendLogs = async () => {};
      s._writeSignupPing = async () => {};
      s._emit = () => {};
      s.state.matches = [{ id: OPEN, ...md }];
      s.state.venues = [];
      s.state.players = [];
      s.state.roster = [{ id: rid, name: 'Lean', phoneKey: K2 }];
      await s.selfJoin({ id: OPEN, ...md }, { id: rid, name: 'Lean', phoneKey: K2 }, { organizer: { uid: ORG, name: 'Gustavo', token: SHARE }, waiting });
      return 'ok';
    } catch (error) {
      return String(error?.message || error).includes('maximum of 1000') ? 'tope' : String(error?.code || error);
    } finally {
      await env.cleanup();
    }
  };
  for (const locked of [false, true]) {
    for (const waiting of [false, true]) {
      assert.equal(await attempt({ locked, waiting }), 'ok', `locked=${locked} waiting=${waiting}`);
    }
  }
});
