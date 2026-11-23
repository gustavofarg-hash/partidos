// Punto 10: el que anota el organizador lleva el token del enlace.
// Punto 14: el mismo jugador no queda dos veces en un partido.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALREADY_SIGNED_UP, selfAlreadyInMatch, selfSignupPlayerId } from '../js/guests.js';
import { FirebaseStore, createDemoStore } from '../js/store.js';
import { linkTokenBackfillPlan } from '../js/backfill-solo-yo.js';

const TOKEN = 'tokenGustavo1234567890';
const OWN = 'tokenPropioMartin123456';

function organizerStore({ ownToken = OWN } = {}) {
  const store = new FirebaseStore();
  store.actor = { uid: 'gus', name: 'Gustavo' };
  store.state.players = [];
  store.state.matches = [];
  store.state.venues = [];
  store.state.roster = [];
  store.state.suspensions = [];
  const writes = [];
  let ensured = 0;
  store.ensureShareToken = async () => { ensured += 1; return ownToken; };
  store._writeConfirmation = async () => {};
  store.ensureShortLink = async () => {};
  store._appendLogs = async () => {};
  store._chargeSignupRate = async () => {};
  store._writeSignupPing = async () => {};
  store._emit = () => {};
  store.fs = {
    doc(_db, col, id) { return { path: `${col}/${id}`, id }; },
    collection(_db, col) { return { path: col }; },
    async addDoc(ref, data) { writes.push({ path: `${ref.path}/auto`, data }); return { id: `auto${writes.length}` }; },
    async setDoc(ref, data) { writes.push({ path: ref.path, data }); },
    async updateDoc() {},
    async getDocs() { return { empty: true, docs: [] }; },
    deleteField() { return null; },
  };
  return { store, writes, ensured: () => ensured };
}

const privateMatch = { id: '2026-11-21_1000', date: '2026-11-21', time: '10:00', capacity: 14, createdByUid: 'gus', viewers: ['gus'], adders: ['gus'], playerKey: TOKEN };

test('el organizador anota en un «solo yo» y el jugador queda con el token del enlace', async () => {
  const { store, writes } = organizerStore();
  await store.addPlayer(privateMatch, { name: 'Lean A', rosterId: 'fichaLean' }, 'Gustavo');
  assert.equal(writes[0].data.shareToken, TOKEN);
  assert.deepEqual(writes[0].data.viewers, ['gus']);
});

test('sin playerKey usa el token propio; sin ficha o partido oculto, ninguno', async () => {
  const noKey = organizerStore();
  await noKey.store.addPlayer({ ...privateMatch, playerKey: '' }, { name: 'Lean A', rosterId: 'fichaLean' }, 'Gustavo');
  assert.equal(noKey.writes[0].data.shareToken, OWN);
  const noRoster = organizerStore();
  await noRoster.store.addPlayer(privateMatch, { name: 'Sin ficha' }, 'Gustavo');
  assert.equal('shareToken' in noRoster.writes[0].data, false);
  assert.equal(noRoster.ensured(), 0);
  const hidden = organizerStore();
  await hidden.store.addPlayer({ ...privateMatch, playerVisible: false }, { name: 'Lean A', rosterId: 'fichaLean' }, 'Gustavo');
  assert.equal('shareToken' in hidden.writes[0].data, false);
});

test('id fijo del Autoservicio por partido y ficha', () => {
  assert.equal(selfSignupPlayerId('2026-11-17_1700', 'ficha1'), '2026-11-17_1700__ficha1');
  assert.equal(selfSignupPlayerId('', 'ficha1'), '');
  assert.equal(selfSignupPlayerId('a/b', 'ficha1'), '');
});

test('ya anotado: por ficha, o mismo nombre sin otro teléfono', () => {
  const mates = [{ id: 'x', matchId: 'm', name: 'Lean A', rosterId: 'fichaLean' }];
  assert.ok(selfAlreadyInMatch(mates, { id: 'fichaLean', name: 'Leandro' }));
  assert.ok(selfAlreadyInMatch([{ id: 'y', matchId: 'm', name: 'Lean A' }], { id: 'fichaLean', name: 'Lean A' }));
  assert.equal(selfAlreadyInMatch(mates, { id: 'otra', name: 'Nico' }), null);
});

function guestStore(players) {
  const store = new FirebaseStore();
  store.actor = null;
  store._shareToken = TOKEN;
  store.state.players = players;
  store.state.venues = [];
  store.state.shareOrganizer = { uid: 'gus', name: 'Gustavo', token: TOKEN };
  const writes = [];
  let charged = 0;
  store._chargeSignupRate = async () => { charged += 1; };
  store._appendLogs = async () => {};
  store._writeSignupPing = async () => {};
  store._emit = () => {};
  store.fs = {
    doc(_db, col, id) { return { path: `${col}/${id}` }; },
    async getDoc() { return { exists: () => false, data: () => null }; },
    async setDoc(ref, data) { writes.push({ path: ref.path, data }); },
  };
  return { store, writes, charged: () => charged };
}

const match = { id: '2026-11-17_1700', date: '2026-11-17', time: '17:00', createdByUid: 'gus', adders: ['*'], viewers: ['*'] };
const person = { id: 'fichaLean', name: 'Lean A' };

test('Autoservicio escribe partido__ficha y no deja anotarse dos veces', async () => {
  const first = guestStore([]);
  await first.store.selfJoin(match, person, {});
  assert.equal(first.writes[0].path, 'players/2026-11-17_1700__fichaLean');
  // Ya lo había anotado el organizador (otro id): no se anota de nuevo ni gasta movimientos.
  const twice = guestStore([{ id: 'random1', matchId: match.id, name: 'Lean A', rosterId: 'fichaLean', addedByUid: 'gus' }]);
  await assert.rejects(() => twice.store.selfJoin(match, person, {}), (error) => error.code === 'already-in-match' && error.message === ALREADY_SIGNED_UP);
  assert.equal(twice.writes.length, 0);
  assert.equal(twice.charged(), 0);
  // En otro partido sí.
  const other = guestStore([{ id: 'random1', matchId: 'otro', name: 'Lean A', rosterId: 'fichaLean' }]);
  await other.store.selfJoin(match, person, {});
  assert.equal(other.writes.length, 1);
});

test('con sesión tampoco se anota dos veces y usa el mismo id fijo', async () => {
  const { store, writes } = organizerStore();
  store.actor = { uid: 'jugador', name: 'Lean A' };
  store.state.players = [{ id: 'r', matchId: match.id, name: 'Lean A', rosterId: 'fichaLean' }];
  await assert.rejects(() => store.selfJoin(match, person, {}), (error) => error.message === ALREADY_SIGNED_UP);
  store.state.players = [];
  await store.selfJoin(match, person, {});
  assert.equal(writes[0].path, 'players/2026-11-17_1700__fichaLean');
});

test('la versión local tampoco deja dos altas del mismo jugador', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const store = createDemoStore();
  store.key = 'f7c-dup-self';
  store.actor = { uid: 'gus', name: 'Gustavo' };
  await store.init();
  const rosterId = await store.addRoster({ name: 'Lean A', phone: '5491170002061' }, 'Gustavo');
  const matchId = await store.addMatch({ date: '2026-11-19', time: '21:00', capacity: 14 }, 'Gustavo');
  const m = { id: matchId, date: '2026-11-19', time: '21:00', capacity: 14 };
  await store.selfJoin(m, { id: rosterId, name: 'Lean A' }, {});
  await assert.rejects(() => store.selfJoin(m, { id: rosterId, name: 'Lean A' }, {}), (error) => error.message === ALREADY_SIGNED_UP);
});

test('arreglo del punto 10: solo «solo yo» de hoy en adelante, sin token y con ficha', () => {
  const matches = [
    privateMatch,
    { ...privateMatch, id: 'viejo', date: '2026-11-01' },
    { id: 'abierto', date: '2026-11-21', viewers: ['*'], createdByUid: 'gus' },
    { ...privateMatch, id: 'sin-key', playerKey: '', createdByUid: 'mar', viewers: ['mar'] },
    { ...privateMatch, id: 'oculto', playerVisible: false },
    { ...privateMatch, id: 'nadie', playerKey: '', createdByUid: 'zoe', viewers: ['zoe'] },
  ];
  const players = [
    { id: 'p1', matchId: privateMatch.id, rosterId: 'f1', viewers: ['gus'] },
    { id: 'p2', matchId: privateMatch.id, rosterId: 'f2', viewers: ['gus'], shareToken: TOKEN },
    { id: 'p3', matchId: privateMatch.id, viewers: ['gus'] },
    { id: 'p4', matchId: 'viejo', rosterId: 'f1', viewers: ['gus'] },
    { id: 'p5', matchId: 'abierto', rosterId: 'f1', viewers: ['*'] },
    { id: 'p6', matchId: 'sin-key', rosterId: 'f1', viewers: ['mar'] },
    { id: 'p7', matchId: 'oculto', rosterId: 'f1', viewers: ['gus'] },
    { id: 'p8', matchId: 'nadie', rosterId: 'f1', viewers: ['zoe'] },
  ];
  const { plan, skipped } = linkTokenBackfillPlan({ players, matches, today: '2026-11-20', tokensByUid: { mar: OWN } });
  assert.deepEqual(plan.map((row) => [row.id, row.patch.shareToken, row.from]), [
    ['p1', TOKEN, 'partido'],
    ['p6', OWN, 'creador'],
  ]);
  assert.deepEqual(skipped.map((row) => row.id), ['p8']);
});
