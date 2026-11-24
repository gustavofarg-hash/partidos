// v249: nombre y apodo propios de cada organizador en la ficha compartida (names.{uid}).
// Reglas y la app de verdad (FirebaseStore) contra el emulador. Datos ficticios.
//   firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-nombre-propio-v249.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalWa, phoneKey } from '../js/privacy.js';

const GUS = 'gusFicticioV249';
const MAR = 'marFicticioV249';
const OTRO = 'otroFicticioV249';
const PHONE = '5491155550199'; // ficticio
const SHARED = 'fichaCompartidaV249aa';
const KEY = phoneKey(canonicalWa(PHONE));

test('v249: cada organizador escribe solo su nombre propio; la ficha y la agenda del otro no cambian', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const fsMod = await import('firebase/firestore');
  const { doc, getDoc, setDoc, updateDoc, deleteField, setLogLevel } = fsMod;
  setLogLevel('silent');
  const [hostname, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-v249',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(port) },
  });
  const read = async (id) => {
    let data = null;
    await env.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'roster', id));
      data = snap.exists() ? snap.data() : null;
    });
    return data;
  };
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', GUS), { role: 'organizer', name: 'Gus', email: 'gus@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', MAR), { role: 'organizer', name: 'Martín', email: 'martin@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', OTRO), { role: 'organizer', name: 'Otro', email: 'otro@demo.local', active: true, createdAt: 1 });
      // Ficha vieja compartida: un solo nombre para los dos (como en producción hoy).
      await setDoc(doc(db, 'roster', SHARED), {
        name: 'Juan Pérez', shortName: 'Juancho', createdBy: 'Gus', createdByUid: GUS, createdAt: 1, updatedAt: 1,
        holders: [GUS, MAR], hasPhone: true, phoneKey: KEY, phoneOwnerUid: GUS, phoneShared: false,
      });
      await setDoc(doc(db, 'rosterContacts', SHARED), { phone: PHONE, ownerUid: GUS, visibleToAll: false, phoneKey: KEY, readers: [GUS, MAR] });
    });
    const gus = env.authenticatedContext(GUS, { email: 'gus@demo.local' }).firestore();
    const mar = env.authenticatedContext(MAR, { email: 'martin@demo.local' }).firestore();
    const otro = env.authenticatedContext(OTRO, { email: 'otro@demo.local' }).firestore();
    const anon = env.unauthenticatedContext().firestore();

    // Martín escribe su entrada.
    await assertSucceeds(updateDoc(doc(mar, 'roster', SHARED), { [`names.${MAR}`]: { name: 'Juani', shortName: '' }, updatedAt: 2 }));
    // No puede escribir la de Gus, ni una entrada mal formada.
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { [`names.${GUS}`]: { name: 'Pisado', shortName: '' }, updatedAt: 3 }));
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { [`names.${MAR}`]: { name: '', shortName: '' }, updatedAt: 3 }));
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { [`names.${MAR}`]: { name: 'x'.repeat(61) }, updatedAt: 3 }));
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { [`names.${MAR}`]: { name: 'Ok', shortName: 'x'.repeat(41) }, updatedAt: 3 }));
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { [`names.${MAR}`]: { name: 'Ok', phone: PHONE }, updatedAt: 3 }));
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { names: 'texto', updatedAt: 3 }));
    // Quien no la tiene no escribe nombre propio.
    await assertFails(updateDoc(doc(otro, 'roster', SHARED), { [`names.${OTRO}`]: { name: 'Intruso', shortName: '' }, updatedAt: 3 }));
    // Gus escribe la suya; la de Martín queda.
    await assertSucceeds(updateDoc(doc(gus, 'roster', SHARED), { [`names.${GUS}`]: { name: 'Juan Carlos Pérez', shortName: 'Juanca' }, updatedAt: 4 }));
    let data = await read(SHARED);
    assert.equal(data.name, 'Juan Pérez');
    assert.deepEqual(data.names[MAR], { name: 'Juani', shortName: '' });
    assert.deepEqual(data.names[GUS], { name: 'Juan Carlos Pérez', shortName: 'Juanca' });
    // Gus no borra la entrada de Martín.
    await assertFails(updateDoc(doc(gus, 'roster', SHARED), { [`names.${MAR}`]: deleteField(), updatedAt: 5 }));

    // La página del jugador (sin sesión) lee la ficha con los nombres.
    const snap = await assertSucceeds(getDoc(doc(anon, 'roster', SHARED)));
    assert.deepEqual(snap.data().names[GUS], { name: 'Juan Carlos Pérez', shortName: 'Juanca' });

    // Martín se va de la ficha llevándose su entrada, y solo la suya.
    await assertFails(updateDoc(doc(mar, 'roster', SHARED), { holders: [GUS], [`names.${MAR}`]: deleteField(), [`names.${GUS}`]: deleteField(), updatedAt: 6 }));
    await assertSucceeds(updateDoc(doc(mar, 'roster', SHARED), { holders: [GUS], [`names.${MAR}`]: deleteField(), updatedAt: 6 }));

    // Vincular (el otro organizador agenda el mismo WhatsApp): solo su entrada, sin pisar name.
    await assertSucceeds(setDoc(doc(otro, 'rosterClaims', `${SHARED}_${OTRO}`), { phone: PHONE, rosterId: SHARED }));
    await assertFails(updateDoc(doc(otro, 'roster', SHARED), { holders: [GUS, OTRO], [`names.${GUS}`]: { name: 'Pisado', shortName: '' }, updatedAt: 7 }));
    await assertSucceeds(updateDoc(doc(otro, 'roster', SHARED), { holders: [GUS, OTRO], [`names.${OTRO}`]: { name: 'Juancito Otro', shortName: 'Tito' }, updatedAt: 7 }));
    data = await read(SHARED);
    assert.equal(data.name, 'Juan Pérez');
    assert.deepEqual(data.names[OTRO], { name: 'Juancito Otro', shortName: 'Tito' });

    // Espejo del link reseteado con los nombres propios.
    await assertSucceeds(setDoc(doc(gus, 'rosterLocks', SHARED), { key: 'claveFicticiaV249abcd', at: 1, by: GUS, byName: 'Gus' }));
    await assertSucceeds(setDoc(doc(gus, 'rosterLinks', SHARED, 'k', 'claveFicticiaV249abcd'), {
      name: 'Juan Pérez', shortName: 'Juancho', holders: [GUS, OTRO], createdByUid: GUS, phoneKey: KEY, hasPhone: true,
      names: { [GUS]: { name: 'Juan Carlos Pérez', shortName: 'Juanca' } },
    }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await fsMod.deleteDoc(doc(ctx.firestore(), 'rosterLocks', SHARED));
    });

    // ---- La app de verdad (FirebaseStore con sesión) contra el emulador ----
    const { FirebaseStore } = await import('../js/store.js');
    const { rosterSeenBy } = await import('../js/roster.js');
    const make = (db, uid, name) => {
      const store = new FirebaseStore();
      store.db = db;
      store.fs = fsMod;
      store.actor = { uid, name, role: 'organizer' };
      store._emit = () => {};
      store.state.players = [];
      store.state.matches = [];
      store.state.rosterContacts = {};
      return store;
    };
    const load = async (store) => {
      const raw = await read(SHARED);
      store.state.roster = [rosterSeenBy({ id: SHARED, ...raw }, store.actor)];
    };
    // Martín vuelve a agendarlo por WhatsApp con su nombre: queda como suyo.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'rosterContacts', SHARED), { readers: [GUS, OTRO] });
    });
    const sMar = make(mar, MAR, 'Martín');
    await load(sMar);
    const kept = await sMar.addRoster({ name: 'Juani Ficticio', phone: PHONE, shortName: '' }, 'Martín');
    assert.equal(kept, SHARED);
    data = await read(SHARED);
    assert.equal(data.name, 'Juan Pérez');
    assert.equal(data.shortName, 'Juancho');
    assert.deepEqual(data.names[MAR], { name: 'Juani Ficticio', shortName: '' });
    assert.ok(data.holders.includes(MAR));
    // Martín le cambia nombre y apodo desde su agenda.
    await load(sMar);
    await sMar.updateRoster(SHARED, { name: 'Juani F', shortName: 'Pibe' });
    await load(sMar);
    await sMar.setRosterNick(SHARED, 'Pibito');
    await load(sMar);
    await sMar.patchRoster(SHARED, { name: 'Juani Fic', level: 7 });
    data = await read(SHARED);
    assert.equal(data.name, 'Juan Pérez');
    assert.equal(data.shortName, 'Juancho');
    assert.deepEqual(data.names[MAR], { name: 'Juani Fic', shortName: 'Pibito' });
    assert.deepEqual(data.names[GUS], { name: 'Juan Carlos Pérez', shortName: 'Juanca' });
    assert.equal(data.level, 7);
    // Gus edita: lo de Martín no cambia.
    const sGus = make(gus, GUS, 'Gus');
    await load(sGus);
    assert.equal(sGus.state.roster[0].name, 'Juan Carlos Pérez');
    await sGus.setRosterNick(SHARED, 'Juanqui');
    data = await read(SHARED);
    assert.deepEqual(data.names[GUS], { name: 'Juan Carlos Pérez', shortName: 'Juanqui' });
    assert.deepEqual(data.names[MAR], { name: 'Juani Fic', shortName: 'Pibito' });
    // Martín se lo saca de la agenda con la app: se va con su entrada.
    sMar.state.credits = []; sMar.state.prices = null;
    await load(sMar);
    await sMar.deleteRoster(SHARED);
    data = await read(SHARED);
    assert.equal(data.holders.includes(MAR), false);
    assert.equal(data.names[MAR], undefined);
    assert.ok(data.names[GUS]);

    // ---- Página de confirmar: saluda con la agenda de quien MANDÓ el link ----
    const MATCH = 'partidoV249n1';
    const PID = 'filaFicticiaV249n1';
    const TOKEN = 'tokenFicticioV249abcdefgh';
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'matches', MATCH), { date: '2099-12-10', time: '20:00', capacity: 14, createdByUid: GUS, viewers: ['*'], adders: ['*'] });
      await setDoc(doc(db, 'confirmations', TOKEN), { playerId: PID, matchId: MATCH, name: 'Juan Pérez', shortName: 'Juancho', date: '2099-12-10', time: '20:00', viewers: ['*'] });
    });
    const row = { id: PID, matchId: MATCH, matchDate: '2099-12-10', rosterId: SHARED, name: 'Juan Pérez', shortName: 'Juancho', addedByUid: GUS, confirmToken: TOKEN, phoneKey: KEY, hasPhone: true };
    const match = { id: MATCH, date: '2099-12-10', time: '20:00', viewers: ['*'], adders: ['*'] };
    const sOtro = make(otro, OTRO, 'Otro');
    const raw2 = await read(SHARED);
    sOtro.state.roster = [rosterSeenBy({ id: SHARED, ...raw2 }, sOtro.actor)];
    sOtro.state.players = [row];
    sOtro.state.matches = [match];
    sOtro.state.confirmations = [];
    await sOtro.markConfirmSender(PID);
    const cardOf = async () => {
      let out = null;
      await env.withSecurityRulesDisabled(async (ctx) => { out = (await getDoc(doc(ctx.firestore(), 'confirmations', TOKEN))).data(); });
      return out;
    };
    let card = await cardOf();
    assert.equal(card.sentByUid, OTRO);
    assert.equal(card.name, 'Juancito Otro');
    assert.equal(card.shortName, 'Tito');
    // Gus reescribe la tarjeta (otro cambio del jugador): sigue el saludo de quien la mandó.
    const sGus2 = make(gus, GUS, 'Gus');
    sGus2.state.roster = [rosterSeenBy({ id: SHARED, ...raw2 }, sGus2.actor)];
    sGus2.state.players = [row];
    sGus2.state.matches = [match];
    sGus2.state.confirmations = [{ id: TOKEN, ...card }];
    await sGus2._syncConfirmGroup(PID, row, match);
    card = await cardOf();
    assert.equal(card.sentByUid, OTRO);
    assert.equal(card.name, 'Juancito Otro');
    assert.equal(card.shortName, 'Tito');
    // El jugador (sin sesión) confirma igual.
    await assertSucceeds(updateDoc(doc(anon, 'confirmations', TOKEN), { confirmed: 'si', confirmedAt: 5 }));
  } finally {
    await env.cleanup();
  }
});
