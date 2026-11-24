// v248: anular solo por Autoservicio el día del partido resta 0,5 de Comportamiento.
// Unit (sin Firebase). Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SELF_DROP_GRACE_MS, SELF_DROP_POINTS, SELF_DROP_REASON, selfDropEntry, selfDropPenalty,
} from '../js/self-signup.js';
import { FirebaseStore } from '../js/store.js';
import { toEpoch } from '../js/dates.js';

const DAY = '2026-11-28';
const KICKOFF = toEpoch(DAY, '21:00');
const MIDNIGHT = toEpoch(DAY, '00:00');
const MIN = 60 * 1000;
const match = { id: 'mFicticio1', date: DAY, time: '21:00', createdByUid: 'orgA' };

// Confirmado por Autoservicio: se anotó el día anterior y el organizador lo aceptó.
const confirmedSelf = {
  matchId: match.id, matchDate: DAY, rosterId: 'fichaFicticia0001', name: 'Jugador Ficticio',
  selfSignup: true, waiting: false, tentative: null, tentativeAt: null, acceptedBy: 'Gus',
  addedByUid: 'orgA', addedBy: 'Gus', signedUpWith: 'orgA', signedUpWithName: 'Gus',
  createdAt: MIDNIGHT - 10 * 60 * MIN,
};

test('confirmado que anula el día del partido: resta, a nombre del organizador del alta', () => {
  const at = MIDNIGHT + 9 * 60 * MIN; // 9:00 del día, el partido es a las 21
  const res = selfDropPenalty({ player: confirmedSelf, match, now: at });
  assert.equal(res.penalize, true);
  assert.equal(res.organizerUid, 'orgA');
  assert.equal(res.organizerName, 'Gus');
});

test('pendiente de confirmación y lista de espera no restan', () => {
  const at = MIDNIGHT + 9 * 60 * MIN;
  const pending = { ...confirmedSelf, tentative: true, tentativeAt: 1, acceptedBy: undefined };
  assert.deepEqual(selfDropPenalty({ player: pending, match, now: at }), { penalize: false, why: 'pendiente' });
  const waiting = { ...confirmedSelf, waiting: true, waitOrder: 1, tentative: false };
  assert.deepEqual(selfDropPenalty({ player: waiting, match, now: at }), { penalize: false, why: 'espera' });
  // Un «a confirmar» que cargó el organizador tampoco: no estaba confirmado.
  const orgTentative = { ...confirmedSelf, selfSignup: false, tentative: true };
  assert.equal(selfDropPenalty({ player: orgTentative, match, now: at }).penalize, false);
  // «No jugó pero pagó» no ocupa lugar.
  assert.equal(selfDropPenalty({ player: { ...confirmedSelf, noPlay: true }, match, now: at }).penalize, false);
});

test('confirmado que cargó el organizador (sin Autoservicio): resta a nombre de quien lo anotó', () => {
  const byOrg = { ...confirmedSelf, selfSignup: false, signedUpWith: undefined, signedUpWithName: undefined, addedByUid: 'orgB', addedBy: 'Martín' };
  const res = selfDropPenalty({ player: byOrg, match, now: MIDNIGHT + 60 * MIN });
  assert.equal(res.penalize, true);
  assert.equal(res.organizerUid, 'orgB');
  assert.equal(res.organizerName, 'Martín');
});

test('antes de las 0:00 del día del partido no resta; desde las 0:00 sí', () => {
  assert.deepEqual(selfDropPenalty({ player: confirmedSelf, match, now: MIDNIGHT - 1 }), { penalize: false, why: 'otro-dia' });
  assert.deepEqual(selfDropPenalty({ player: confirmedSelf, match, now: MIDNIGHT - 60 * MIN }), { penalize: false, why: 'otro-dia' });
  assert.equal(selfDropPenalty({ player: confirmedSelf, match, now: MIDNIGHT }).penalize, true);
  assert.equal(selfDropPenalty({ player: confirmedSelf, match, now: KICKOFF - 4 * 60 * MIN - 1 }).penalize, true);
  // Es la hora de Buenos Aires: 23:30 del día anterior (02:30 UTC del día del partido) no cuenta.
  assert.equal(selfDropPenalty({ player: confirmedSelf, match, now: Date.parse(`${DAY}T02:30:00Z`) }).penalize, false);
  assert.equal(selfDropPenalty({ player: confirmedSelf, match, now: Date.parse(`${DAY}T03:00:00Z`) }).penalize, true);
});

test('anotado hace 4 minutos no resta; hace 6 minutos sí; justo 5 minutos no', () => {
  const at = MIDNIGHT + 10 * 60 * MIN;
  const four = { ...confirmedSelf, createdAt: at - 4 * MIN };
  const six = { ...confirmedSelf, createdAt: at - 6 * MIN };
  const five = { ...confirmedSelf, createdAt: at - SELF_DROP_GRACE_MS };
  assert.deepEqual(selfDropPenalty({ player: four, match, now: at }), { penalize: false, why: 'recien-anotado' });
  assert.equal(selfDropPenalty({ player: six, match, now: at }).penalize, true);
  assert.equal(selfDropPenalty({ player: five, match, now: at }).penalize, false);
});

test('sin hora de alta guardada no resta (no se adivina)', () => {
  const at = MIDNIGHT + 10 * 60 * MIN;
  for (const createdAt of [undefined, null, 0, 'ayer', 1.5]) {
    assert.deepEqual(selfDropPenalty({ player: { ...confirmedSelf, createdAt }, match, now: at }), { penalize: false, why: 'sin-hora-de-alta' });
  }
});

test('sin ficha o sin organizador no resta', () => {
  const at = MIDNIGHT + 10 * 60 * MIN;
  assert.equal(selfDropPenalty({ player: { ...confirmedSelf, rosterId: '' }, match, now: at }).why, 'sin-ficha');
  const orphan = { ...confirmedSelf, signedUpWith: '', addedByUid: '' };
  assert.equal(selfDropPenalty({ player: orphan, match, now: at }).why, 'sin-organizador');
});

test('la entrada: id fijo por fila y alta, −0,5, motivo fijo, mismos campos que las del organizador', () => {
  const at = MIDNIGHT + 10 * 60 * MIN;
  const decision = selfDropPenalty({ player: confirmedSelf, match, now: at });
  const drop = selfDropEntry({ playerId: 'mFicticio1__fichaFicticia0001', player: confirmedSelf, match, decision, now: at });
  assert.equal(drop.docId, `auto_mFicticio1__fichaFicticia0001_${confirmedSelf.createdAt}`);
  assert.deepEqual(drop.entry, {
    type: 'baja', points: SELF_DROP_POINTS, reason: SELF_DROP_REASON, comment: '', matchId: match.id,
    createdByUid: 'orgA', createdByName: 'Gus', createdAt: at, rosterId: 'fichaFicticia0001',
    playerId: 'mFicticio1__fichaFicticia0001',
  });
  assert.equal(SELF_DROP_POINTS, -0.5);
  assert.equal(SELF_DROP_REASON, 'Se bajó el día del partido (Autoservicio)');
  // La misma baja da el mismo id: un reintento no duplica.
  assert.equal(selfDropEntry({ playerId: 'mFicticio1__fichaFicticia0001', player: confirmedSelf, match, decision, now: at + 999 }).docId, drop.docId);
  assert.equal(selfDropEntry({ playerId: 'x', player: confirmedSelf, match, decision: { penalize: false }, now: at }), null);
});

function fakeGuestStore(player, { deny = 0 } = {}) {
  const store = new FirebaseStore();
  const commits = [];
  let denied = 0;
  store.db = {};
  store.actor = null;
  store.state.players = [player];
  store.state.matches = [match];
  store.state.venues = [];
  store.state.roster = [];
  store._chargeSignupRate = async () => {};
  store._appendLogs = async () => {};
  store._writeSignupPing = async () => {};
  store._emit = () => {};
  store.fs = {
    doc: (_db, col, id) => ({ path: `${col}/${id}` }),
    deleteDoc: async (ref) => { commits.push([['delete', ref.path]]); },
    writeBatch: () => {
      const ops = [];
      return {
        delete: (ref) => ops.push(['delete', ref.path]),
        set: (ref, data) => ops.push(['set', ref.path, data]),
        commit: async () => {
          if (denied < deny && ops.some((op) => op[1].startsWith('behavior/'))) {
            denied += 1;
            throw Object.assign(new Error('denied'), { code: 'permission-denied' });
          }
          commits.push(ops);
        },
      };
    },
  };
  return { store, commits };
}

test('la baja del jugador sin sesión escribe la entrada en el mismo lote que borra su fila', async () => {
  const id = 'mFicticio1__fichaFicticia0001';
  const at = MIDNIGHT + 10 * 60 * MIN;
  const { store, commits } = fakeGuestStore({ id, ...confirmedSelf });
  await store.selfCancel(id, at);
  assert.equal(commits.length, 1);
  const [batch] = commits;
  assert.deepEqual(batch[0], ['delete', `players/${id}`]);
  const set = batch.find((op) => op[0] === 'set');
  assert.equal(set[1], `behavior/auto_${id}_${confirmedSelf.createdAt}`);
  assert.equal(set[2].points, -0.5);
  // Un segundo toque (o un re-render) ya no encuentra la fila: no escribe otra entrada.
  await store.selfCancel(id, at + 1000);
  assert.equal(commits.length, 1);
});

test('si las reglas niegan la entrada, la baja sale igual sin la entrada', async () => {
  const id = 'mFicticio1__fichaFicticia0001';
  const at = MIDNIGHT + 10 * 60 * MIN;
  const { store, commits } = fakeGuestStore({ id, ...confirmedSelf }, { deny: 1 });
  await store.selfCancel(id, at);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], [['delete', `players/${id}`]]);
  assert.equal(store.state.players.length, 0);
});

test('un pendiente que anula el día del partido no escribe entrada', async () => {
  const id = 'mFicticio1__fichaFicticia0002';
  const at = MIDNIGHT + 10 * 60 * MIN;
  const { store, commits } = fakeGuestStore({ id, ...confirmedSelf, rosterId: 'fichaFicticia0002', tentative: true, tentativeAt: 1 });
  await store.selfCancel(id, at);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].some((op) => op[0] === 'set'), false);
});

test('el día anterior no escribe entrada', async () => {
  const id = 'mFicticio1__fichaFicticia0001';
  const { store, commits } = fakeGuestStore({ id, ...confirmedSelf });
  await store.selfCancel(id, MIDNIGHT - 2 * 60 * MIN);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].some((op) => op[0] === 'set'), false);
});

test('el jugador no ve ningún aviso: la app no muestra el motivo ni los puntos en el Autoservicio', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.equal(app.includes('SELF_DROP'), false);
  assert.equal(app.includes('Se bajó el día del partido'), false);
});
