// v235: en el Autoservicio, «Confirmado (por Gustavo)» con el organizador que lo confirmó.
import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedLabel, selfRowAction, selfSignupRows } from '../js/self-signup.js';
import { acceptedByPatch, createDemoStore } from '../js/store.js';

const kick = Date.parse('2026-10-19T21:00:00-03:00');
const early = Date.parse('2026-10-19T13:00:00-03:00');
const late = Date.parse('2026-10-19T18:00:00-03:00');

test('confirmado por: quién aceptó, quién lo anotó, o «Confirmado» solo', () => {
  assert.equal(confirmedLabel({ selfSignup: true, acceptedBy: 'Gustavo Fernández', signedUpWithName: 'Martín' }), 'Confirmado (por Gustavo)');
  assert.equal(confirmedLabel({ selfSignup: true, acceptedBy: '  Gus  ' }), 'Confirmado (por Gus)');
  // Aceptado antes de v235: no se sabe quién fue. No se adivina con el dueño del enlace.
  assert.equal(confirmedLabel({ selfSignup: true, signedUpWithName: 'Gustavo', addedBy: 'Gustavo' }), 'Confirmado');
  // Lo anotó un organizador: ese organizador.
  assert.equal(confirmedLabel({ signedUpWithName: 'Martín López', addedBy: 'Gustavo' }), 'Confirmado (por Martín)');
  assert.equal(confirmedLabel({ addedBy: 'Gustavo' }), 'Confirmado (por Gustavo)');
  assert.equal(confirmedLabel({ guestAuto: true, addedBy: 'Juan' }), 'Confirmado');
  assert.equal(confirmedLabel({}), 'Confirmado');
  assert.equal(confirmedLabel(null), 'Confirmado');
  const row = selfRowAction({ player: { selfSignup: true, acceptedBy: 'Gustavo' }, kickoff: kick, now: early });
  assert.deepEqual([row.action, row.status, row.note], ['cancel', 'confirmed', 'Confirmado (por Gustavo)']);
  const locked = selfRowAction({ player: { selfSignup: true, acceptedBy: 'Martín' }, kickoff: kick, now: late });
  assert.deepEqual([locked.action, locked.note, locked.lock], ['locked', 'Confirmado (por Martín)', 'Avisale al organizador para bajarte']);
  // Pendiente y espera no cambian.
  assert.equal(selfRowAction({ player: { selfSignup: true, tentative: true, acceptedBy: 'X' }, organizerName: 'Gustavo' }).note, 'Esperando la confirmación de Gustavo...');
  assert.equal(selfRowAction({ player: { waiting: true, addedBy: 'Gustavo' } }).note, 'En lista de espera');
});

test('confirmado por: solo se guarda cuando el organizador acepta una anotación pendiente', () => {
  const pending = { selfSignup: true, tentative: true, waiting: false };
  assert.deepEqual(acceptedByPatch(pending, { name: ' Gustavo  Fernández ' }, { accepted: true }), { acceptedBy: 'Gustavo Fernández' });
  assert.deepEqual(acceptedByPatch(pending, { name: 'Gustavo' }), {});
  assert.deepEqual(acceptedByPatch(pending, { name: '' }, { accepted: true }), {});
  assert.deepEqual(acceptedByPatch({ tentative: true }, { name: 'Gustavo' }, { accepted: true }), {});
  assert.deepEqual(acceptedByPatch({ ...pending, waiting: true }, { name: 'Gustavo' }, { accepted: true }), {});
  assert.equal(acceptedByPatch(pending, { name: 'x'.repeat(80) }, { accepted: true }).acceptedBy.length, 40);
});

test('confirmado por: en el demo, Confirmar guarda al organizador y el jugador lo ve', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const store = createDemoStore();
  store.key = 'f7c-test-confirmado-por';
  store.actor = { uid: 'gustavo', name: 'Gustavo' };
  await store.init();
  const rosterId = await store.addRoster({ name: 'Ana Sola', phone: '5491170002350' }, 'Gustavo');
  const otherId = await store.addRoster({ name: 'Beto Solo', phone: '5491170002351' }, 'Gustavo');
  const match = { id: await store.addMatch({ date: '2026-10-19', time: '21:00', capacity: 14 }, 'Gustavo'), date: '2026-10-19', time: '21:00', capacity: 14 };
  const db = () => JSON.parse(mem.get('f7c-test-confirmado-por'));
  const anaId = await store.selfJoin(match, { id: rosterId, name: 'Ana Sola', phone: '5491170002350' }, { waiting: false });
  const betoId = await store.selfJoin(match, { id: otherId, name: 'Beto Solo', phone: '5491170002351' }, { waiting: false });
  assert.equal(db().players[anaId].tentative, true);
  store.actor = { uid: 'martin', name: 'Martín López' };
  await store.confirmSelf(anaId);
  assert.equal(db().players[anaId].acceptedBy, 'Martín López');
  // La reserva que se libera sola (respondió «Sí, juego») no inventa quién aceptó.
  await store.clearTentative(betoId);
  assert.equal('acceptedBy' in db().players[betoId], false);
  const players = Object.entries(db().players).map(([id, p]) => ({ id, ...p }));
  const matches = Object.entries(db().matches).map(([id, m]) => ({ id, ...m }));
  const [ana] = selfSignupRows({ person: { id: rosterId, name: 'Ana Sola', holders: ['gustavo'] }, matches, players, now: early });
  assert.equal(ana.note, 'Confirmado (por Martín)');
  const [beto] = selfSignupRows({ person: { id: otherId, name: 'Beto Solo', holders: ['gustavo'] }, matches, players, now: early });
  assert.equal(beto.note, 'Confirmado');
  // Confirmar dos veces no pisa al primero.
  store.actor = { uid: 'gustavo', name: 'Gustavo' };
  await store.confirmSelf(anaId);
  assert.equal(db().players[anaId].acceptedBy, 'Martín López');
});
