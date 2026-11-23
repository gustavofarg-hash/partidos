// v237: «Resetear link». Unitarias, sin Firestore: el link con la clave, el menú,
// las consultas de la página del jugador y los lotes que arma la app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINK_INVALID_TEXT, canResetLink, isLinkKey, linkKeyTargets, linkResetQuestion, newLinkKey, rosterMirror, sameMirror } from '../js/link-reset.js';
import { playerMoreItems } from '../js/player-more.js';
import { playerLink, playerLinkParts, isPlayerDeepLink } from '../js/share.js';
import { guestListenPlan } from '../js/profile.js';
import { FirebaseStore, createDemoStore } from '../js/store.js';

const RID = 'RosterJuanAbcdef0001';
const TOKEN = 'abcdefghijklmnopqrstuvwx';
const M = '2026-11-28_2000';
const K1 = '1'.repeat(64);

test('clave: al azar, 32 caracteres base64url, distinta cada vez', () => {
  const a = newLinkKey();
  const b = newLinkKey();
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, b);
  assert.equal(isLinkKey(a), true);
  assert.equal(isLinkKey('corta'), false);
  assert.equal(isLinkKey('con/barra-1234567890'), false);
  assert.equal(isLinkKey(undefined), false);
});

test('link: sin clave igual que antes; con clave al final; las partes se leen', () => {
  const base = playerLink(RID, TOKEN);
  assert.match(base, new RegExp(`#/jugador/${RID}/${TOKEN}$`));
  assert.equal(playerLink(RID, TOKEN, ''), base);
  assert.match(playerLink(RID), new RegExp(`#/jugador/${RID}$`));
  const key = newLinkKey();
  const withKey = playerLink(RID, TOKEN, key);
  assert.equal(withKey, `${base}/${key}`);
  assert.deepEqual(playerLinkParts(withKey.slice(withKey.indexOf('#'))), { id: RID, token: TOKEN, key });
  // Sin token del organizador, «-» en su lugar.
  const noToken = playerLink(RID, '', key);
  assert.match(noToken, new RegExp(`#/jugador/${RID}/-/${key}$`));
  assert.deepEqual(playerLinkParts(noToken.slice(noToken.indexOf('#'))), { id: RID, token: '', key });
  assert.deepEqual(playerLinkParts(`#/jugador/${RID}/${TOKEN}`), { id: RID, token: TOKEN, key: '' });
  assert.equal(isPlayerDeepLink(`#/jugador/${RID}/${TOKEN}/${key}`), true);
});

test('menú ⋮: 🔃 Resetear link primero, solo para quien tiene la ficha o el admin', () => {
  assert.deepEqual(playerMoreItems({ canReset: true, canCredit: true, creditAmount: 10 }).map((i) => i.label),
    ['🔃 Resetear link', 'Compartir link', 'Cargar Crédito', 'Devolver Crédito']);
  assert.deepEqual(playerMoreItems({ canCredit: true, creditAmount: 10 }).map((i) => i.key), ['share', 'credit', 'refund']);
  const person = { id: RID, holders: ['gus'], createdByUid: 'gus' };
  assert.equal(canResetLink(person, { uid: 'gus', role: 'organizer' }), true);
  assert.equal(canResetLink(person, { uid: 'martin', role: 'organizer' }), false);
  assert.equal(canResetLink(person, { uid: 'admin1', role: 'admin' }), true);
  assert.equal(canResetLink({ id: RID, createdByUid: 'gus' }, { uid: 'gus', role: 'organizer' }), true);
  assert.equal(canResetLink(null, { uid: 'gus' }), false);
  assert.equal(canResetLink(person, null), false);
  assert.equal(linkResetQuestion('Juan'), '¿Resetear el link de Juan? Los links anteriores dejan de funcionar.');
  assert.equal(LINK_INVALID_TEXT, 'Este link ya no es válido. Pedí uno nuevo al organizador.');
});

test('espejo de la ficha: solo lo que la página del jugador usa; sin notas ni teléfono', () => {
  const person = { id: RID, name: 'Juan', shortName: 'Juanchi', holders: ['gus'], createdByUid: 'gus', phoneKey: K1, hasPhone: true, phone: '1155555555', notes: ['x'] };
  assert.deepEqual(rosterMirror(person), { name: 'Juan', shortName: 'Juanchi', holders: ['gus'], createdByUid: 'gus', phoneKey: K1, hasPhone: true });
  assert.equal(sameMirror(person, { ...person, notes: [] }), true);
  assert.equal(sameMirror(person, { ...person, name: 'Juan P' }), false);
  const players = [
    { id: 'a', rosterId: RID, matchDate: '2026-11-28' },
    { id: 'b', rosterId: RID, matchDate: '2026-11-20' },
    { id: 'c', rosterId: 'otra', matchDate: '2026-11-28' },
    { id: 'd', rosterId: RID, matchDate: '2026-11-29', linkKey: 'yaTieneEstaClave123' },
  ];
  assert.deepEqual(linkKeyTargets(players, RID, 'yaTieneEstaClave123', '2026-11-23'), ['a']);
});

test('página del jugador: sin clave, las consultas de siempre; con clave, todas fijan linkKey', () => {
  const plain = guestListenPlan({ rosterId: RID, today: '2026-11-23', shareToken: TOKEN });
  assert.equal(JSON.stringify(plain).includes('linkKey'), false);
  const key = newLinkKey();
  const keyed = guestListenPlan({ rosterId: RID, today: '2026-11-23', shareToken: TOKEN, linkKey: key });
  for (const name of ['players', 'linkPlayers', 'seen']) {
    assert.deepEqual(keyed[name].filters.find((f) => f.field === 'linkKey'), { field: 'linkKey', op: '==', value: key }, name);
  }
  // El orden de la consulta de jugadores coincide con el índice nuevo.
  assert.deepEqual(keyed.players.filters.map((f) => f.field), ['rosterId', 'linkKey', 'viewers', 'matchDate', 'matchDate']);
  const idx = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8')).indexes;
  assert.ok(idx.some((i) => i.collectionGroup === 'players' && i.fields.map((f) => f.fieldPath).join(',') === 'rosterId,linkKey,viewers,matchDate'));
  // Los partidos no dependen de la ficha: iguales con y sin clave.
  assert.deepEqual(keyed.matches, plain.matches);
});

function fakeGuest({ key = '' } = {}) {
  const store = new FirebaseStore();
  store.db = {};
  store.actor = null;
  store._guest = true;
  store._guestRosterId = RID;
  store._linkKey = key;
  const log = { batches: [], singles: [], reads: [], tx: [] };
  store._emit = () => {};
  store.loadSignupLimit = async () => ({ maxMoves: 10, windowMinutes: 60 });
  store.state.matches = [{ id: M, date: '2026-11-28', time: '20:00', capacity: 14, createdByUid: 'gus', viewers: ['*'], adders: ['*'] }];
  store.state.venues = [];
  store.state.players = [];
  store.state.roster = [{ id: RID, name: 'Juan', phoneKey: K1 }];
  const data = {};
  store.fs = {
    doc(_db, ...segments) { return { path: segments.length ? segments.join('/') : `${_db.path}/auto`, id: segments.at(-1) || 'auto' }; },
    collection(_db, name) { return { path: name }; },
    serverTimestamp() { return '<ahora>'; },
    async addDoc(ref) { log.singles.push(`add ${ref.path}`); return { id: 'autoId' }; },
    async setDoc(ref, value) { log.singles.push(`set ${ref.path}`); data[ref.path] = value; },
    async deleteDoc(ref) { log.singles.push(`delete ${ref.path}`); },
    async getDoc(ref) { log.reads.push(ref.path); return { exists: () => false, data: () => null }; },
    async runTransaction(_db, fn) {
      const ops = [];
      await fn({ get: async () => ({ exists: () => false, data: () => null }), set: (ref) => ops.push(`set ${ref.path}`) });
      log.tx.push(ops.join(' + '));
    },
    writeBatch() {
      const ops = [];
      return {
        set(ref, value) { ops.push(`set ${ref.path}`); data[ref.path] = value; },
        delete(ref) { ops.push(`delete ${ref.path}`); },
        async commit() { log.batches.push(ops.join(' + ')); },
      };
    },
  };
  return { store, log, data };
}

test('sin clave (ficha sin resetear): la app escribe exactamente lo de antes', async () => {
  const { store, log, data } = fakeGuest();
  const id = await store.selfJoin(store.state.matches[0], { id: RID, name: 'Juan', phoneKey: K1 }, { organizer: { uid: 'gus', name: 'Gustavo', token: TOKEN } });
  assert.deepEqual(log.tx, [`set signupRates/${RID}`]);
  assert.deepEqual(log.batches, [`set players/${id} + set phoneGuards/${M}__${K1}`]);
  assert.equal('linkKey' in data[`players/${id}`], false);
  assert.equal(log.singles.some((s) => s.startsWith('set log/')), true);
  assert.equal(log.singles.includes('add signupPings'), true);
  assert.equal(JSON.stringify(log).includes('linkProofs'), false);
  await store.savePlayerPushToken(RID, 'pushTokenJuan123456789');
  assert.equal(log.singles.at(-1).startsWith('set playerTokens/'), true);
  await store._selfPhoneTaken(M, RID);
  assert.equal(log.reads.at(-1), `phoneChecks/${M}/rosters/${RID}`);
});

test('con clave: cada escritura lleva la prueba; la fila lleva la clave; phoneChecks por la clave', async () => {
  const key = newLinkKey();
  const { store, log, data } = fakeGuest({ key });
  const proof = `set linkProofs/${RID}/k/${key}`;
  const id = await store.selfJoin(store.state.matches[0], { id: RID, name: 'Juan', phoneKey: K1 }, { organizer: { uid: 'gus', name: 'Gustavo', token: TOKEN } });
  assert.deepEqual(log.tx, [`set signupRates/${RID} + ${proof}`]);
  // El alta no lleva la prueba aparte: la clave va en la fila y las reglas la comparan.
  assert.equal(log.batches[0], `set players/${id} + set phoneGuards/${M}__${K1}`);
  assert.equal(data[`players/${id}`].linkKey, key);
  assert.ok(log.batches.some((b) => b.startsWith('set log/') && b.endsWith(proof)), 'registro con prueba');
  assert.ok(log.batches.some((b) => b.startsWith('set signupPings/') && b.endsWith(proof)), 'aviso con prueba');
  store.state.players = [{ id, ...data[`players/${id}`] }];
  await store._guestSelfCancel(id, Date.parse('2026-11-24T12:00:00-03:00'));
  assert.ok(log.batches.includes(`delete players/${id} + delete phoneGuards/${M}__${K1} + ${proof}`));
  await store.savePlayerPushToken(RID, 'pushTokenJuan123456789');
  assert.match(log.batches.at(-1), new RegExp(`^set playerTokens/${RID}_\\S+ \\+ ${proof.replace(/[-/]/g, '\\$&')}$`));
  await store.markConfirmSeen('p1', RID);
  assert.equal(log.batches.at(-1), `set confirmSeen/p1 + ${proof}`);
  assert.equal(data['confirmSeen/p1'].linkKey, key);
  await store._selfPhoneTaken(M, RID);
  assert.equal(log.reads.at(-1), `phoneChecks/${M}/rosters/${RID}/k/${key}`);
  // Con sesión (organizador) la clave del link no se usa.
  store.actor = { uid: 'gus', name: 'Gustavo', role: 'organizer' };
  assert.equal(store._guestLinkKey(), '');
});

test('demo: resetear rota la clave, marca las anotaciones y el link viejo queda inválido', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const store = createDemoStore();
  await store.init();
  store.setActor({ uid: 'gus', name: 'Gustavo', role: 'organizer' });
  const db = JSON.parse(mem.get(store.key));
  db.roster[RID] = { name: 'Juan', holders: ['gus'], createdByUid: 'gus' };
  db.players.p1 = { matchId: M, matchDate: '2099-01-01', name: 'Juan', rosterId: RID };
  mem.set(store.key, JSON.stringify(db));
  assert.equal(store.rosterLinkKey(RID), '');
  const first = await store.resetPlayerLink(RID);
  assert.equal(isLinkKey(first.key), true);
  assert.equal(first.updated, 1);
  assert.equal(store.rosterLinkKey(RID), first.key);
  assert.equal(JSON.parse(mem.get(store.key)).players.p1.linkKey, first.key);
  const second = await store.resetPlayerLink(RID);
  assert.notEqual(second.key, first.key);
  store.setActor(null);
  store.setGuestLink(RID, first.key);
  assert.equal(store.linkInvalid, true);
  store.setGuestLink(RID, '');
  assert.equal(store.linkInvalid, true);
  store.setGuestLink(RID, second.key);
  assert.equal(store.linkInvalid, false);
  // Una ficha sin resetear: el link de siempre sigue andando.
  store.setGuestLink('OtraFichaAbcdef00001', '');
  assert.equal(store.linkInvalid, false);
});

test('reglas: la clave no es pública y las fichas sin resetear siguen por el camino de antes', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = (name) => {
    const at = rules.indexOf(`match /${name}/`);
    return rules.slice(at, rules.indexOf('\n    }', at));
  };
  assert.match(block('rosterLocks'), /allow get, list: if isActiveStaff\(\);/);
  assert.match(block('linkProofs'), /allow read, delete: if false;/);
  assert.match(rules, /function guestRoster\(rosterId\) \{\s+return guestRosterBase\(rosterId\) && linkOpenNow\(rosterId\);/);
  assert.match(rules, /return !linkLocked\(rosterId\)\s+\|\| getAfter\(/);
  assert.equal((rules.match(/--force/g) || []).length, 0);
});

test('v237: versión, precache y botón en la app', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes('f7c-v23'));
  assert.ok(sw.includes("'js/link-reset.js'"));
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("if (kind === 'reset') resetPlayerLinkFlow(rosterId, phone);"));
  assert.ok(app.includes('linkResetQuestion(person.name)'));
  assert.ok(app.includes('id="reset-share">Compartir link'));
});
