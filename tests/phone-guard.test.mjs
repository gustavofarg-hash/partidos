// v233: guardia de teléfono por partido. Unidades: ids, huella, mudanza, plan del
// backfill y los lotes que arma FirebaseStore (sin Firestore real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { guardKeyFor, guardMoves, newPlayerDocId, phoneGuardDoc, phoneGuardId } from '../js/phone-guard.js';
import { phoneGuardBackfillPlan } from '../js/backfill-phone-guards.js';
import { ALREADY_SIGNED_UP } from '../js/guests.js';
import { FirebaseStore } from '../js/store.js';

const K1 = '1'.repeat(64);
const K2 = '2'.repeat(64);
const M = '2026-11-28_2000';
const match = { id: M, date: '2026-11-28', time: '20:00', capacity: 14, createdByUid: 'gus', viewers: ['*'], adders: ['*'], playerCount: 0 };

test('id y huella de la guardia', () => {
  assert.equal(phoneGuardId(M, K1), `${M}__${K1}`);
  assert.equal(phoneGuardId(M, 'corta'), '');
  assert.equal(phoneGuardId('a/b', K1), '');
  assert.equal(guardKeyFor({ phoneKey: K1, rosterId: 'r' }, K2), K1);
  assert.equal(guardKeyFor({ phoneKey: '', rosterId: 'r' }, K2), K2);
  assert.equal(guardKeyFor({ phoneKey: '' }, K2), '');
  assert.equal(guardKeyFor({}, ''), '');
  assert.match(newPlayerDocId(), /^[A-Za-z0-9]{20}$/);
  const g = phoneGuardDoc('p1', { matchId: M, name: 'Juan', addedBy: 'Gustavo', signedUpWithName: 'Martín' }, K1, 5);
  assert.deepEqual(g, { matchId: M, phoneKey: K1, playerId: 'p1', name: 'Juan', addedBy: 'Martín', createdAt: 5 });
});

test('mudanza de la guardia al cambiar el número', () => {
  const moved = guardMoves('p1', { matchId: M, phoneKey: K1 }, { matchId: M, phoneKey: K2 });
  assert.equal(moved.set.id, phoneGuardId(M, K2));
  assert.equal(moved.set.data.playerId, 'p1');
  assert.equal(moved.drop, phoneGuardId(M, K1));
  const cleared = guardMoves('p1', { matchId: M, phoneKey: K1 }, { matchId: M, phoneKey: '' });
  assert.equal(cleared.set, null);
  assert.equal(cleared.drop, phoneGuardId(M, K1));
  // La ficha ya tenía ese número: la huella propia nueva igual reescribe la guardia (las reglas la piden).
  const same = guardMoves('p1', { matchId: M, phoneKey: '', rosterId: 'r' }, { matchId: M, phoneKey: K1, rosterId: 'r' }, K1);
  assert.equal(same.set.id, phoneGuardId(M, K1));
  assert.equal(same.drop, '');
});

test('backfill: solo partidos que vienen, uno por número, conflictos aparte', () => {
  const matches = [
    { id: M, date: '2026-11-28' },
    { id: 'viejo', date: '2026-11-01' },
    { id: 'cancelado', date: '2026-11-29', cancelled: true },
  ];
  const players = [
    { id: 'a', matchId: M, name: 'Juan', phoneKey: K1, createdAt: 2 },
    { id: 'b', matchId: M, name: 'Juancho', phoneKey: K1, createdAt: 1 },
    { id: 'c', matchId: M, name: 'Lean', phoneKey: '', rosterId: 'fLean', selfSignup: true, createdAt: 3 },
    { id: 'd', matchId: M, name: 'Sin tel', phoneKey: '', createdAt: 4 },
    { id: 'e', matchId: 'viejo', name: 'Pasado', phoneKey: K1 },
    { id: 'f', matchId: 'cancelado', name: 'Cancelado', phoneKey: K2 },
  ];
  const { plan, conflicts, skipped } = phoneGuardBackfillPlan({ players, matches, today: '2026-11-23', rosterKeys: { fLean: K2 }, now: 9 });
  assert.deepEqual(plan.map((row) => [row.id, row.data.playerId]).sort(), [[phoneGuardId(M, K1), 'b'], [phoneGuardId(M, K2), 'c']].sort());
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].players.map((row) => row.id), ['b', 'a']);
  assert.equal(skipped.length, 0);
  const again = phoneGuardBackfillPlan({ players, matches, today: '2026-11-23', rosterKeys: { fLean: K2 }, existing: [phoneGuardId(M, K2)] });
  assert.deepEqual(again.plan.map((row) => row.id), [phoneGuardId(M, K1)]);
  assert.deepEqual(again.skipped, [{ id: phoneGuardId(M, K2), reason: 'ya-existe' }]);
});

function denied() { return Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); }

function fakeStore({ actor = { uid: 'gus', name: 'Gustavo', role: 'organizer' }, deny = () => false, docs = {}, unreadable = () => false } = {}) {
  const store = new FirebaseStore();
  store.db = {};
  store.actor = actor;
  store.state.players = [];
  store.state.matches = [match];
  store.state.venues = [];
  store.state.roster = [];
  store.state.suspensions = [];
  const log = { batches: [], singles: [], reads: [] };
  store._writeConfirmation = async () => {};
  store.ensureShortLink = async () => {};
  store._appendLogs = async () => {};
  store._writeSignupPing = async () => {};
  store._chargeSignupRate = async () => {};
  store._syncConfirmGroup = async () => {};
  store._emit = () => {};
  store.fs = {
    doc(_db, ...segments) { return { path: segments.join('/'), id: segments.at(-1) }; },
    collection(_db, name) { return { path: name }; },
    async addDoc(ref, data) { log.singles.push(`add ${ref.path}`); return { id: 'autoId' }; },
    async setDoc(ref) { log.singles.push(`set ${ref.path}`); },
    async updateDoc(ref) { log.singles.push(`update ${ref.path}`); },
    async deleteDoc(ref) { log.singles.push(`delete ${ref.path}`); },
    async getDoc(ref) {
      log.reads.push(ref.path);
      if (unreadable(ref.path)) throw denied();
      const data = docs[ref.path];
      return { exists: () => !!data, data: () => data };
    },
    deleteField() { return '<borrar>'; },
    writeBatch() {
      const ops = [];
      return {
        set(ref) { ops.push(`set ${ref.path}`); },
        update(ref) { ops.push(`update ${ref.path}`); },
        delete(ref) { ops.push(`delete ${ref.path}`); },
        async commit() {
          log.batches.push(ops.join(' + '));
          if (deny(ops)) throw denied();
        },
      };
    },
  };
  return { store, log };
}

test('alta del organizador con teléfono: jugador y guardia en un lote; sin teléfono, como antes', async () => {
  const { store, log } = fakeStore();
  const id = await store.addPlayer(match, { name: 'Juan', phoneKey: K1, hasPhone: true }, 'Gustavo');
  assert.match(id, /^[A-Za-z0-9]{20}$/);
  assert.deepEqual(log.batches, [`set players/${id} + set phoneGuards/${M}__${K1}`]);
  assert.equal(log.reads.length, 0, 'el organizador no lee la guardia si el lote anda');
  const bare = fakeStore();
  await bare.store.addPlayer(match, { name: 'Sin tel' }, 'Gustavo');
  assert.deepEqual(bare.log.batches, []);
  assert.equal(bare.log.singles[0], 'add players');
});

test('las reglas niegan por la guardia: el organizador ve «Ese número ya está anotado…»', async () => {
  const { store, log } = fakeStore({
    deny: (ops) => ops.some((op) => op.includes('phoneGuards')),
    docs: { [`phoneGuards/${M}__${K1}`]: { playerId: 'otro', name: 'Juan', addedBy: 'Gustavo', matchId: M, phoneKey: K1 } },
    unreadable: (path) => path === 'players/otro',
  });
  store.actor = { uid: 'mar', name: 'Martín', role: 'organizer' };
  await assert.rejects(
    store.addPlayer(match, { name: 'Juancho', phoneKey: K1, hasPhone: true }, 'Martín'),
    (error) => error.code === 'already-in-match' && error.message === 'Ese número ya está anotado en este partido como Juan (lo anotó Gustavo).',
  );
  assert.equal(log.batches.length, 1);
});

test('el admin escribe sin reglas: mira la guardia antes y no escribe si es de otro', async () => {
  const { store, log } = fakeStore({
    actor: { uid: 'gus', name: 'Gustavo', role: 'admin' },
    docs: {
      [`phoneGuards/${M}__${K1}`]: { playerId: 'juan', name: 'Juan', addedBy: 'Martín' },
      'players/juan': { matchId: M, name: 'Juan', phoneKey: K1, addedBy: 'Martín' },
    },
  });
  await assert.rejects(
    store.addPlayer(match, { name: 'Juancho', phoneKey: K1, hasPhone: true }, 'Gustavo'),
    (error) => error.message === 'Ese número ya está anotado en este partido como Juan (lo anotó Martín).',
  );
  assert.deepEqual(log.batches, []);
  // Guardia vieja de un jugador borrado: no frena.
  const stale = fakeStore({
    actor: { uid: 'gus', name: 'Gustavo', role: 'admin' },
    docs: { [`phoneGuards/${M}__${K1}`]: { playerId: 'fantasma', name: 'Fantasma' } },
  });
  await stale.store.addPlayer(match, { name: 'Juan', phoneKey: K1, hasPhone: true }, 'Gustavo');
  assert.equal(stale.log.batches.length, 1);
});

test('Autoservicio sin sesión: lote con guardia; si la guardia es de otro, «Ya estás anotado en este partido.»', async () => {
  const person = { id: 'fichaJuancho0000001', name: 'Juancho', phoneKey: K1 };
  const organizer = { uid: 'gus', name: 'Gustavo', token: 'abcdefghijklmnopqrstuvwx' };
  const ok = fakeStore({ actor: null });
  const id = await ok.store.selfJoin(match, person, { organizer });
  assert.equal(id, `${M}__${person.id}`);
  assert.deepEqual(ok.log.batches, [`set players/${id} + set phoneGuards/${M}__${K1}`]);
  const taken = fakeStore({
    actor: null,
    deny: () => true,
    unreadable: (path) => path.startsWith('phoneChecks/'),
  });
  await assert.rejects(
    taken.store.selfJoin(match, person, { organizer }),
    (error) => error.code === 'already-in-match' && error.message === ALREADY_SIGNED_UP,
  );
  assert.deepEqual(taken.log.reads, [`phoneChecks/${M}/rosters/${person.id}`]);
  // Ficha sin teléfono: como antes, sin guardia ni lote.
  const plain = fakeStore({ actor: null });
  await plain.store.selfJoin(match, { id: 'fichaSinTel00000001', name: 'Pepe' }, { organizer });
  assert.deepEqual(plain.log.batches, []);
  assert.deepEqual(plain.log.singles, [`set players/${M}__fichaSinTel00000001`]);
});

test('baja: la guardia sale en el mismo lote; si es de otro (alta vieja), se reintenta sin ella', async () => {
  const row = { id: 'p1', matchId: M, name: 'Juan', phoneKey: K1, confirmToken: 'tok' };
  const { store, log } = fakeStore();
  store.state.players = [row];
  await store.deletePlayer('p1', { skipLog: true });
  assert.deepEqual(log.batches, [`delete players/p1 + delete confirmations/tok + delete phoneGuards/${M}__${K1}`]);
  const legacy = fakeStore({ deny: (ops) => ops.some((op) => op.includes('phoneGuards')) });
  legacy.store.state.players = [row];
  await legacy.store.deletePlayer('p1', { skipLog: true });
  assert.deepEqual(legacy.log.batches, [
    `delete players/p1 + delete confirmations/tok + delete phoneGuards/${M}__${K1}`,
    'delete players/p1 + delete confirmations/tok',
  ]);
});

test('editar el número muda la guardia; pasar a la espera no la toca', async () => {
  const row = { id: 'p1', matchId: M, name: 'Juan', phoneKey: K1, hasPhone: true, addedByUid: 'gus' };
  const { store, log } = fakeStore();
  store.state.players = [row];
  store._writeContactDoc = async () => ({ cleared: true, phoneKey: K2, ownerUid: 'gus', visibleToAll: false });
  await store.updatePlayer('p1', { phone: '+5491122223333' });
  assert.deepEqual(log.batches, [`update players/p1 + set phoneGuards/${M}__${K2} + delete phoneGuards/${M}__${K1}`]);
  const { phoneKey } = await import('../js/privacy.js');
  // Antes de escribir el contacto, una lectura de la guardia del número nuevo.
  assert.deepEqual(log.reads, [`phoneGuards/${M}__${phoneKey('+5491122223333')}`]);
  const wait = fakeStore();
  wait.store.state.players = [row];
  await wait.store.updatePlayer('p1', { waiting: true, waitOrder: 1 });
  assert.deepEqual(wait.log.batches, []);
  assert.deepEqual(wait.log.singles, ['update players/p1']);
  assert.deepEqual(wait.log.reads, []);
});

test('editar el número a uno que ya está: el organizador ve el mensaje y no se escribe nada', async () => {
  const row = { id: 'p1', matchId: M, name: 'Lean', phoneKey: K2, hasPhone: true, addedByUid: 'gus' };
  const juan = { id: 'juan', matchId: M, name: 'Juan', phoneKey: '', addedBy: 'Martín' };
  let wrote = false;
  const { store, log } = fakeStore({ docs: {} });
  store.state.players = [row];
  store._writeContactDoc = async () => { wrote = true; return { cleared: true, phoneKey: '' }; };
  // La huella del número nuevo: la que tenga la guardia.
  const { phoneKey } = await import('../js/privacy.js');
  const key = phoneKey('+5491122223333');
  store.fs.getDoc = async (ref) => {
    log.reads.push(ref.path);
    if (ref.path === `phoneGuards/${M}__${key}`) return { exists: () => true, data: () => ({ playerId: 'juan', name: 'Juan', addedBy: 'Martín' }) };
    if (ref.path === 'players/juan') return { exists: () => true, data: () => ({ ...juan, phoneKey: key }) };
    return { exists: () => false, data: () => null };
  };
  await assert.rejects(
    store.updatePlayer('p1', { phone: '+5491122223333' }),
    (error) => error.message === 'Ese número ya está anotado en este partido como Juan (lo anotó Martín).',
  );
  assert.equal(wrote, false);
  assert.deepEqual(log.batches, []);
});

test('el reset borra las guardias antes que los jugadores', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const order = src.slice(src.lastIndexOf('async resetDatabase('), src.lastIndexOf('async resetDatabase(') + 900);
  assert.ok(order.indexOf("'phoneGuards'") > 0 && order.indexOf("'phoneGuards'") < order.indexOf("'players'"));
});

test('backfill: sin dryRun: false no escribe; con él, en lotes', async () => {
  const { applyPhoneGuardPlan } = await import('../js/backfill-phone-guards.js');
  const commits = [];
  const fs = {
    doc(_db, ...segments) { return { path: segments.join('/') }; },
    writeBatch() { const ops = []; return { set(ref) { ops.push(ref.path); }, async commit() { commits.push(ops.length); } }; },
  };
  const plan = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, data: {} }));
  assert.deepEqual(await applyPhoneGuardPlan({ fs, db: {}, plan }), { written: 0, planned: 5 });
  assert.deepEqual(commits, []);
  assert.deepEqual(await applyPhoneGuardPlan({ fs, db: {}, plan, dryRun: false, batchSize: 2 }), { written: 5, planned: 5 });
  assert.deepEqual(commits, [2, 2, 1]);
});

// El selfJoin con sesión (organizador que se anota a sí mismo) pasa por addPlayer:
// mismo lote con guardia y, si las reglas lo niegan por el número, el mensaje del jugador.
// Ojo: en el emulador ese camino ya pasaba el tope de 1000 expresiones antes de v233 (ver informe).
test('selfJoin con sesión: lote con guardia y «Ya estás anotado en este partido.» si el número está tomado', async () => {
  const person = { id: 'fichaGustavo0000001', name: 'Gustavo F', phoneKey: K2 };
  const ok = fakeStore();
  ok.store.state.roster = [{ id: person.id, name: person.name, phoneKey: K2 }];
  const id = await ok.store.selfJoin(match, person, {});
  assert.equal(id, `${M}__${person.id}`);
  assert.deepEqual(ok.log.batches, [`set players/${id} + set phoneGuards/${M}__${K2}`]);
  const taken = fakeStore({ deny: () => true, unreadable: (path) => path.startsWith('phoneChecks/') });
  taken.store.state.roster = [{ id: person.id, name: person.name, phoneKey: K2 }];
  await assert.rejects(taken.store.selfJoin(match, person, {}), (error) => error.code === 'already-in-match' && error.message === ALREADY_SIGNED_UP);
});
