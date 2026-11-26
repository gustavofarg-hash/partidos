// v258: el recordatorio de quien juega dos partidos el mismo día nombra los dos
// horarios aunque sus filas no tengan huella (Autoservicio) y el WhatsApp salga de
// la ficha; y deja «Enviado» también en la fila del otro partido (no en la espera).
// Reglas: firebase emulators:exec --project demo-f7c --only firestore "node --test tests/recordatorio-dia-v258.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reminderLinks, withAgendaPhones } from '../js/reminders.js';

const DAY = '2026-12-03';
const NOW = new Date('2026-12-03T12:00:00-03:00');
const mA = { id: `${DAY}_1900`, date: DAY, time: '19:00' };
const mB = { id: `${DAY}_2000`, date: DAY, time: '20:00' };
const RID = 'FichaFicticia000001';
const roster = [{ id: RID, name: 'Ficticio Uno', phone: '5491100000000', holders: ['org1'], phoneOwnerUid: 'org1', phoneShared: true }];
const actor = { uid: 'org1', name: 'Org', role: 'organizer' };
const row = (id, m, extra = {}) => ({ id, matchId: m.id, matchDate: DAY, name: 'Ficticio Uno', rosterId: RID, confirmToken: `tok${id}`.padEnd(22, 'x'), waiting: false, ...extra });

function send({ a, b }) {
  // Lo que hace Enviar recordatorios desde el de las 20: WhatsApp de la ficha en la fila del partido abierto.
  const fresh = withAgendaPhones([b], roster, actor);
  return reminderLinks({ match: mB, players: fresh, roster, allPlayers: [a, b], matches: [mA, mB], now: NOW })[0];
}

test('Autoservicio (filas sin huella): nombra los dos horarios con el WhatsApp de la ficha', () => {
  const link = send({ a: row('pA', mA, { selfSignup: true, phoneKey: '' }), b: row('pB', mB, { selfSignup: true, phoneKey: '' }) });
  assert.ok(link, 'sale el link');
  assert.match(link.text, /¿Confirmás que jugás HOY 19:00 y 20:00\?/);
  assert.match(link.text, new RegExp(`confirmar\\.html\\?m=${mB.id}&p=pB&t=`));
  assert.equal(link.phone, '5491100000000');
  assert.deepEqual(link.alsoIds, ['pA']);
});

test('Cargadas por el organizador (filas con huella): igual que antes', () => {
  const k = { phoneKey: 'ab'.repeat(32), hasPhone: true };
  const link = send({ a: row('pA', mA, k), b: row('pB', mB, k) });
  assert.match(link.text, /HOY 19:00 y 20:00/);
  assert.deepEqual(link.alsoIds, ['pA']);
});

test('Ya confirmó el otro: se nombra igual; en la espera del otro: no, y no se marca', () => {
  const confirmed = send({ a: row('pA', mA, { confirmed: 'si' }), b: row('pB', mB) });
  assert.match(confirmed.text, /HOY 19:00 y 20:00/);
  assert.deepEqual(confirmed.alsoIds, ['pA']);
  const waiting = send({ a: row('pA', mA, { waiting: true }), b: row('pB', mB) });
  assert.match(waiting.text, /¿Confirmás que jugás HOY 20:00\?/);
  assert.deepEqual(waiting.alsoIds, []);
});

test('Un solo partido: un horario y nada más para marcar', () => {
  const fresh = withAgendaPhones([row('pB', mB)], roster, actor);
  const [link] = reminderLinks({ match: mB, players: fresh, roster, allPlayers: [row('pB', mB)], matches: [mA, mB], now: NOW });
  assert.match(link.text, /¿Confirmás que jugás HOY 20:00\?/);
  assert.deepEqual(link.alsoIds, []);
});

test('La app arma allPlayers con las filas guardadas y marca las otras del día', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const open = app.slice(app.indexOf('async function openReminders('), app.indexOf('function moveWait('));
  assert.match(open, /for \(const player of playersOf\(m\.id\)\)/);
  assert.doesNotMatch(open, /for \(const player of fresh\) rosterNow\.set/);
  assert.match(open, /run\(markReminderSentWithDay\(id, linkById\.get\(id\)\?\.alsoIds \|\| \[\]\)\)/);
  assert.match(open, /await app\.store\.markReminderSentAlso\(other\)/);
});

test('reglas v258: otro organizador marca solo «Enviado» en una fila que ve', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) { t.skip('sin emulador de Firestore'); return; }
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { doc, setDoc, updateDoc } = await import('firebase/firestore');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-recordatorio-dia', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) } });
  try {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      for (const [uid, name] of [['orgUno0000000000001', 'Org Uno'], ['orgDos0000000000002', 'Org Dos']]) await setDoc(doc(db, 'users', uid), { role: 'organizer', name, email: `${uid}@ficticio.test`, active: true, createdAt: 1 });
      const m = { date: DAY, capacity: 14, perTeam: 7, viewers: ['*'], adders: ['orgUno0000000000001'], createdByUid: 'orgUno0000000000001', playerCount: 1 };
      await setDoc(doc(db, 'matches', mA.id), { ...m, time: '19:00' });
      await setDoc(doc(db, 'matches', 'privado'), { ...m, time: '18:00', viewers: ['orgUno0000000000001'] });
      const base = { matchDate: DAY, name: 'Ficticio Uno', addedBy: 'Org Uno', addedByUid: 'orgUno0000000000001', createdAt: 1, updatedAt: 1, waiting: false, rosterAt: 1, confirmToken: 'tokFicticio0000000001', hasPhone: false, phoneKey: '', phoneShared: false, adders: ['orgUno0000000000001'] };
      await setDoc(doc(db, 'players', 'pA'), { ...base, matchId: mA.id, viewers: ['*'] });
      await setDoc(doc(db, 'players', 'pPriv'), { ...base, matchId: 'privado', viewers: ['orgUno0000000000001'] });
    });
    const dos = env.authenticatedContext('orgDos0000000000002').firestore();
    await assertSucceeds(updateDoc(doc(dos, 'players', 'pA'), { reminderSentAt: 5, updatedAt: 5 }));
    await assertSucceeds(updateDoc(doc(dos, 'players', 'pA'), { reminderSentAt: 6 }));
    await assertFails(updateDoc(doc(dos, 'players', 'pA'), { reminderSentAt: 7, confirmed: 'si' }));
    await assertFails(updateDoc(doc(dos, 'players', 'pA'), { reminderSentAt: 'ayer', updatedAt: 8 }));
    await assertFails(updateDoc(doc(dos, 'players', 'pA'), { name: 'Otro' }));
    await assertFails(updateDoc(doc(dos, 'players', 'pPriv'), { reminderSentAt: 9, updatedAt: 9 }));
    await assertFails(updateDoc(doc(env.unauthenticatedContext().firestore(), 'players', 'pA'), { reminderSentAt: 10, updatedAt: 10 }));
  } finally {
    await env.cleanup();
  }
});
