// v248: reglas de la entrada de Comportamiento que escribe el jugador sin sesión
// al anular solo el día del partido. Solo emulador. Datos ficticios.
//   firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-baja-autoservicio-v248.test.mjs"
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { todayISO, addDays } from '../js/dates.js';

const ORG = 'orgFicticioV248';
const OTHER = 'otroFicticioV248';
const NAME = 'Jugador Ficticio';
const MIN = 60 * 1000;
const REASON = 'Se bajó el día del partido (Autoservicio)';

test('v248: −0,5 del Autoservicio solo con la baja de esa fila, confirmado, el día del partido', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, deleteDoc, writeBatch, Timestamp, serverTimestamp } = await import('firebase/firestore');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-v248',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  const today = todayISO();
  const tomorrow = addDays(today, 1);
  let n = 0;
  // Cada caso con su ficha, su fila y su límite de anotaciones: no se pisan.
  const seed = async ({ date = today, row = {}, lock = '' } = {}) => {
    n += 1;
    const rosterId = `fichaFicticiaV248n${String(n).padStart(3, '0')}`;
    const matchId = `partidoV248n${n}`;
    const playerId = `${matchId}__${rosterId}`;
    const createdAt = Date.now() - 30 * MIN;
    const player = {
      matchId, matchDate: date, name: NAME, rosterId, selfSignup: true, waiting: false, waitOrder: null,
      tentative: null, tentativeAt: null, rosterAt: createdAt, acceptedBy: 'Gus',
      addedByUid: ORG, addedBy: 'Gus', signedUpWith: ORG, signedUpWithName: 'Gus',
      createdAt, updatedAt: createdAt, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false,
      confirmToken: 'tokenFicticioV248xxxxxxx', viewers: [ORG], adders: [ORG], ...row,
    };
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'roster', rosterId), { name: NAME, holders: [ORG], createdByUid: ORG, createdAt: 1, updatedAt: 1 });
      await setDoc(doc(db, 'matches', matchId), { date, time: '23:30', capacity: 14, createdByUid: ORG, viewers: [ORG], adders: [ORG] });
      await setDoc(doc(db, 'players', playerId), player);
      await setDoc(doc(db, 'signupRates', rosterId), { windowStart: Timestamp.now(), count: 1, lastId: playerId });
      if (lock) await setDoc(doc(db, 'rosterLocks', rosterId), { key: lock, at: 1, by: ORG, byName: 'Gus' });
    });
    const entry = {
      type: 'baja', points: -0.5, reason: REASON, comment: '', matchId,
      createdByUid: ORG, createdByName: 'Gus', createdAt: Date.now(), rosterId, playerId,
    };
    return { rosterId, matchId, playerId, player, entry, entryId: `auto_${playerId}_${player.createdAt}` };
  };
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', ORG), { role: 'organizer', name: 'Gus', email: 'o@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', OTHER), { role: 'organizer', name: 'Otro', email: 'x@demo.local', active: true, createdAt: 1 });
    });
    const anon = env.unauthenticatedContext().firestore();
    const other = env.authenticatedContext(OTHER, { email: 'x@demo.local' }).firestore();
    const drop = (s, { entry = s.entry, entryId = s.entryId, del = true, db = anon, proof = '', guard = '' } = {}) => {
      const batch = writeBatch(db);
      if (del) batch.delete(doc(db, 'players', s.playerId));
      if (guard) batch.delete(doc(db, 'phoneGuards', guard));
      batch.set(doc(db, 'behavior', entryId), entry);
      if (proof) batch.set(doc(db, 'linkProofs', s.rosterId, 'k', proof), { at: serverTimestamp() });
      return batch.commit();
    };

    // Confirmado, hoy, anotado hace 30 minutos: la baja y la entrada salen juntas.
    const ok = await seed();
    await assertSucceeds(drop(ok));
    // La entrada no se pisa ni se borra sin sesión, y no se escribe otra vez (la fila ya no está).
    await assertFails(setDoc(doc(anon, 'behavior', ok.entryId), ok.entry));
    await assertFails(deleteDoc(doc(anon, 'behavior', ok.entryId)));
    await assertFails(drop(ok, { del: false }));

    // Sin borrar la fila en el mismo lote: no.
    const alone = await seed();
    await assertFails(drop(alone, { del: false }));
    // La baja sola (sin entrada) sigue andando como siempre.
    const plain = await seed();
    await assertSucceeds(deleteDoc(doc(anon, 'players', plain.playerId)));

    // Pendiente de confirmación y lista de espera: la baja sí, la entrada no.
    const pending = await seed({ row: { tentative: true, tentativeAt: Date.now() - 30 * MIN } });
    await assertFails(drop(pending));
    await assertSucceeds(deleteDoc(doc(anon, 'players', pending.playerId)));
    const waiting = await seed({ row: { waiting: true, waitOrder: 1, tentative: false, rosterAt: null } });
    await assertFails(drop(waiting));

    // Otro día (mañana): no.
    const early = await seed({ date: tomorrow, row: { matchDate: tomorrow } });
    await assertFails(drop(early));

    // Anotado hace 4 minutos: no. Hace 6: sí.
    const fresh = await seed({ row: { createdAt: Date.now() - 4 * MIN } });
    await assertFails(drop(fresh, { entryId: `auto_${fresh.playerId}_${fresh.player.createdAt}` }));
    const six = await seed({ row: { createdAt: Date.now() - 6 * MIN } });
    await assertSucceeds(drop(six, { entryId: `auto_${six.playerId}_${six.player.createdAt}` }));

    // Sin hora de alta: no.
    const noTime = await seed({ row: { createdAt: null } });
    await assertFails(drop(noTime, { entryId: `auto_${noTime.playerId}_null` }));

    // Datos cambiados: otros puntos, otro motivo, otro organizador, otro id, otra ficha, campo de más.
    const bad = await seed();
    await assertFails(drop(bad, { entry: { ...bad.entry, points: -4 } }));
    await assertFails(drop(bad, { entry: { ...bad.entry, reason: 'Otro motivo' } }));
    await assertFails(drop(bad, { entry: { ...bad.entry, createdByUid: OTHER } }));
    await assertFails(drop(bad, { entryId: `auto_${bad.playerId}_1` }));
    await assertFails(drop(bad, { entry: { ...bad.entry, comment: 'algo' } }));
    await assertFails(drop(bad, { entry: { ...bad.entry, matchLabel: 'x' } }));
    await assertFails(drop(bad, { entry: { ...bad.entry, createdAt: Date.now() - 60 * MIN } }));
    const victim = await seed();
    await assertFails(drop(bad, { entry: { ...bad.entry, rosterId: victim.rosterId } }));
    await assertSucceeds(drop(bad));

    // Con sesión, este camino no existe (un organizador anota sus puntos con su propio id).
    const staff = await seed();
    await assertFails(drop(staff, { db: other }));

    // Link reseteado: con la prueba de la clave vigente sí; sin la prueba, no.
    const locked = await seed({ lock: 'claveFicticiaV248abcd', row: { linkKey: 'claveFicticiaV248abcd' } });
    await assertFails(drop(locked));
    await assertSucceeds(drop(locked, { proof: 'claveFicticiaV248abcd' }));

    // El lote más pesado del cliente: link reseteado + guardia de teléfono + entrada.
    const KEY = 'a'.repeat(64);
    const heavy = await seed({ lock: 'claveFicticiaV248efgh', row: { linkKey: 'claveFicticiaV248efgh', phoneKey: KEY, hasPhone: true } });
    const guardId = `${heavy.matchId}__${KEY}`;
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'phoneGuards', guardId), { matchId: heavy.matchId, phoneKey: KEY, playerId: heavy.playerId, name: NAME, addedBy: 'Gus', createdAt: 1 });
    });
    await assertSucceeds(drop(heavy, { proof: 'claveFicticiaV248efgh', guard: guardId }));

    // La app de verdad (FirebaseStore sin sesión) contra el emulador: la baja deja la entrada.
    // El partido es hoy a las 23:59 y la app no deja bajarse con menos de 4 h: correr antes de las 19:59 (BA).
    const { FirebaseStore } = await import('../js/store.js');
    const fsMod = await import('firebase/firestore');
    const app1 = await seed();
    const store = new FirebaseStore();
    store.db = anon;
    store.fs = fsMod;
    store.actor = null;
    store._guest = true;
    store._guestRosterId = app1.rosterId;
    store._emit = () => {};
    store.state.players = [{ id: app1.playerId, ...app1.player }];
    store.state.matches = [{ id: app1.matchId, date: today, time: '23:59', createdByUid: ORG }];
    store.state.venues = [];
    store.state.roster = [];
    await store.selfCancel(app1.playerId);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const gone = await fsMod.getDoc(doc(db, 'players', app1.playerId));
      const entry = await fsMod.getDoc(doc(db, 'behavior', app1.entryId));
      if (gone.exists()) throw new Error('la fila sigue');
      if (!entry.exists()) throw new Error('no quedó la entrada');
      const data = entry.data();
      if (data.points !== -0.5 || data.reason !== REASON || data.createdByUid !== ORG || data.type !== 'baja') throw new Error(JSON.stringify(data));
    });
    // Un pendiente con la app de verdad: se baja y no queda entrada.
    const app2 = await seed({ row: { tentative: true, tentativeAt: Date.now() - 30 * MIN } });
    store._guestRosterId = app2.rosterId;
    store.state.players = [{ id: app2.playerId, ...app2.player }];
    store.state.matches = [{ id: app2.matchId, date: today, time: '23:59', createdByUid: ORG }];
    await store.selfCancel(app2.playerId);
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      if ((await fsMod.getDoc(doc(db, 'players', app2.playerId))).exists()) throw new Error('la fila pendiente sigue');
      if ((await fsMod.getDoc(doc(db, 'behavior', app2.entryId))).exists()) throw new Error('el pendiente tiene entrada');
    });

    // La fila la había cargado el organizador (sin Autoservicio): la entrada va a nombre de quien la cargó.
    const byOrg = await seed({ row: { selfSignup: false, signedUpWith: '', signedUpWithName: '', acceptedBy: null } });
    await assertSucceeds(drop(byOrg));
  } finally {
    await env.cleanup();
  }
});
