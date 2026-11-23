// Punto 11: los que se anotan solos (Autoservicio) entran en Faltan pagar,
// en deudores y en la compensación «según quién anotó», nunca a su propio nombre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { organizerMatchDebt, orphanSelfSignup, orphanSelfSignupOwner, owesOrganizer, playerDebt } from '../js/ledger.js';
import { dayCompensation, matchCompensation, signedOwner } from '../js/compensate.js';
import { FirebaseStore } from '../js/store.js';

const gus = { uid: 'gus', name: 'Gustavo' };
const mar = { uid: 'mar', name: 'Martín' };
const staff = [{ ...gus, active: true }, { ...mar, active: true }];
const prices = {};
const match = { id: 'm', date: '2026-10-18', time: '21:00', price: 5000, createdByUid: 'gus', adders: ['*'], viewers: ['*'] };

// Así quedaban: sin uid, Agregó con el nombre del propio jugador y sin token.
const orphan = { id: 'lean', matchId: 'm', name: 'Lean A', selfSignup: true, addedByUid: '', addedBy: 'Lean A', shareToken: '' };
// Así quedan ahora: con el organizador del enlace.
const stamped = { id: 'ana', matchId: 'm', name: 'Ana Link', selfSignup: true, addedByUid: 'mar', addedBy: 'Martín', signedUpWith: 'mar', signedUpWithName: 'Martín', shareToken: 'tokenMartin12345678901' };

test('Autoservicio sin organizador entra en Faltan pagar del que creó el partido', () => {
  assert.equal(orphanSelfSignup(orphan), true);
  assert.equal(orphanSelfSignup(stamped), false);
  const mine = organizerMatchDebt({ match, players: [orphan, stamped], matches: [match], prices, organizer: gus });
  assert.deepEqual(mine.rows.map((row) => [row.name, row.owed]), [['Lean A', 5000]]);
  const his = organizerMatchDebt({ match, players: [orphan, stamped], matches: [match], prices, organizer: mar });
  assert.deepEqual(his.rows.map((row) => row.name), ['Ana Link']);
  // Su propio nombre nunca cuenta como organizador.
  assert.equal(owesOrganizer(orphan, { uid: '', name: 'Lean A' }, match), false);
  assert.equal(owesOrganizer({ ...orphan, name: 'Gustavo', addedBy: 'Gustavo' }, { uid: 'mar', name: 'Gustavo' }, match), false);
  // Sin el partido no se sabe de quién es.
  assert.equal(owesOrganizer(orphan, gus), false);
  // Pagó: ya no debe.
  const paid = { ...orphan, paid: true, amount: 5000, cash: 5000, cashTo: 'Gustavo', transfer: 0 };
  assert.equal(organizerMatchDebt({ match, players: [paid], matches: [match], prices, organizer: gus }).total, 0);
});

test('con token del enlace manda el token, no el creador', () => {
  const withToken = { ...orphan, shareToken: 'tokenMartin12345678901' };
  assert.equal(owesOrganizer(withToken, { ...mar, token: 'tokenMartin12345678901' }, match), true);
  assert.equal(owesOrganizer(withToken, { ...gus, token: 'tokenGustavo1234567890' }, match), false);
  const tokens = new Map([['tokenMartin12345678901', { uid: 'mar', name: 'Martín' }]]);
  assert.equal(orphanSelfSignupOwner(withToken, match, tokens).uid, 'mar');
  assert.equal(orphanSelfSignupOwner(withToken, match).uid, 'gus');
  assert.equal(orphanSelfSignupOwner(orphan, { ...match, createdByUid: '' }), null);
});

test('deudores en Jugadores: playerDebt del organizador incluye al de Autoservicio', () => {
  const debt = playerDebt({ person: { name: 'Lean A' }, players: [orphan], matches: [match], prices, organizer: gus });
  assert.equal(debt.total, 5000);
  assert.equal(playerDebt({ person: { name: 'Lean A' }, players: [orphan], matches: [match], prices, organizer: mar }).total, 0);
  const stampedDebt = playerDebt({ person: { name: 'Ana Link' }, players: [stamped], matches: [match], prices, organizer: mar });
  assert.equal(stampedDebt.total, 5000);
});

test('compensación según quién anotó con Autoservicio: sin fila a nombre del jugador', () => {
  const signed = { ...match, splitMode: 'signed' };
  const players = [
    { ...orphan, paid: true, amount: 5000, cash: 5000, cashTo: 'Martín', transfer: 0 },
    { ...stamped, paid: true, amount: 5000, cash: 5000, cashTo: 'Martín', transfer: 0 },
  ];
  assert.deepEqual(signedOwner(players[0], signed, staff), { uid: 'gus', name: 'Gustavo' });
  assert.deepEqual(signedOwner(players[1], signed, staff), { uid: 'mar', name: 'Martín' });
  const one = matchCompensation(signed, players, staff);
  assert.equal(one.rows.some((row) => row.name === 'Lean A' || row.uid.startsWith('name:')), false);
  const day = dayCompensation([signed], players, staff);
  assert.equal(day.rows.find((row) => row.uid === 'gus').entitled, 5000);
  assert.equal(day.rows.find((row) => row.uid === 'mar').entitled, 5000);
  assert.equal(day.rows.find((row) => row.uid === 'mar').collected, 10000);
  assert.deepEqual(day.transfers.map((t) => [t.fromName, t.toName, t.amount]), [['Martín', 'Gustavo', 5000]]);
  // Autoservicio con uid pero sin Se anotó con: vale el uid.
  const onlyUid = { ...players[1], signedUpWith: undefined, signedUpWithName: undefined };
  assert.deepEqual(signedOwner(onlyUid, signed, staff), { uid: 'mar', name: 'Martín' });
  // Sin dueño conocido: se reparte entre los que anotan, no a nombre del jugador.
  const nobody = dayCompensation([{ ...signed, createdByUid: '' }], [players[0]], staff);
  assert.equal(nobody.rows.find((row) => row.uid === 'gus').entitled, 2500);
  assert.equal(nobody.rows.find((row) => row.uid === 'mar').entitled, 2500);
  assert.equal(nobody.rows.some((row) => row.name === 'Lean A'), false);
  // Los viejos anotados a mano siguen usando Agregó.
  assert.deepEqual(signedOwner({ id: 'x', matchId: 'm', addedBy: 'Martín' }, signed, staff), { uid: 'mar', name: 'Martín' });
});

function guestStore({ tokenDoc = null, loaded = null, token = 'tokenGustavo1234567890' } = {}) {
  const store = new FirebaseStore();
  store.actor = null;
  store._shareToken = token;
  store.state.players = [];
  store.state.venues = [];
  store.state.shareOrganizer = loaded;
  const writes = [];
  const reads = [];
  store._chargeSignupRate = async () => {};
  store._appendLogs = async () => {};
  store._writeSignupPing = async () => {};
  store._emit = () => {};
  store.fs = {
    doc(_db, col, id) { return { path: `${col}/${id}` }; },
    async getDoc(ref) {
      reads.push(ref.path);
      return { exists: () => !!tokenDoc, data: () => tokenDoc };
    },
    async setDoc(ref, data) { writes.push({ path: ref.path, data }); },
  };
  return { store, writes, reads };
}

const signupMatch = { id: '2026-11-17_1700', date: '2026-11-17', time: '17:00', createdByUid: 'mar', adders: ['*'], viewers: ['*'] };
const person = { id: 'ficha1', name: 'Lean A' };

test('el alta sin sesión espera al organizador del enlace y lo guarda', async () => {
  const { store, writes, reads } = guestStore({ tokenDoc: { uid: 'gus', name: 'Gustavo', createdAt: 1 } });
  await store.selfJoin(signupMatch, person, { organizer: null });
  assert.deepEqual(reads, ['shareTokens/tokenGustavo1234567890']);
  const saved = writes.find((row) => row.path.startsWith('players/')).data;
  assert.equal(saved.addedByUid, 'gus');
  assert.equal(saved.addedBy, 'Gustavo');
  assert.equal(saved.signedUpWith, 'gus');
  assert.equal(saved.signedUpWithName, 'Gustavo');
  assert.equal(saved.shareToken, 'tokenGustavo1234567890');
  assert.equal(store.state.shareOrganizer.uid, 'gus');
});

test('si el organizador ya llegó no vuelve a leer el token', async () => {
  const loaded = { uid: 'gus', name: 'Gustavo', token: 'tokenGustavo1234567890' };
  const { store, writes, reads } = guestStore({ loaded });
  await store.selfJoin(signupMatch, person, { organizer: loaded });
  assert.deepEqual(reads, []);
  assert.equal(writes[0].data.addedByUid, 'gus');
});

test('sin organizador del enlace no se anota huérfano', async () => {
  const missing = guestStore({ tokenDoc: null });
  await assert.rejects(() => missing.store.selfJoin(signupMatch, person, {}), (error) => error.code === 'no-organizer');
  assert.equal(missing.writes.length, 0);
  const noToken = guestStore({ token: '' });
  await assert.rejects(() => noToken.store.selfJoin(signupMatch, person, {}), (error) => error.code === 'no-organizer');
  assert.equal(noToken.writes.length, 0);
  assert.equal(noToken.reads.length, 0);
});

test('el arreglo de huérfanos usa el token o el creador y nunca toca a los demás', async () => {
  const { selfSignupBackfillPlan } = await import('../js/backfill-autoservicio.js');
  const tokens = { tokenMartin12345678901: { uid: 'mar', name: 'Martín' } };
  const lost = { ...orphan, id: 'lost', matchId: 'z' };
  const viaToken = { ...orphan, id: 'tok', shareToken: 'tokenMartin12345678901' };
  const { plan, skipped } = selfSignupBackfillPlan({
    players: [orphan, viaToken, stamped, lost, { id: 'manual', matchId: 'm', name: 'A mano', addedBy: 'Gustavo' }],
    matches: [match, { id: 'z', date: '2026-10-19' }],
    staff,
    tokens,
  });
  assert.deepEqual(plan.map((row) => [row.id, row.from, row.patch.addedByUid, row.patch.signedUpWithName]), [
    ['lean', 'creador', 'gus', 'Gustavo'],
    ['tok', 'token', 'mar', 'Martín'],
  ]);
  assert.deepEqual(skipped.map((row) => row.id), ['lost']);
  const fixed = { ...orphan, ...plan[0].patch };
  assert.equal(organizerMatchDebt({ match, players: [fixed], matches: [match], prices, organizer: gus }).total, 5000);
});
