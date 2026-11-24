// v249: cada organizador agenda al jugador compartido con su propio nombre y apodo.
// La ficha sigue siendo una sola (mismo id, mismo WhatsApp). Unit (sin Firebase). Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoStore } from '../js/store.js';
import {
  displayName, givenName, nickOf, ownRosterEntry, personKey, phoneIdentity, playersSeenBy,
  rosterBase, rosterLinkEntry, rosterNameFor, rosterNamePlan, rosterSeenBy,
} from '../js/roster.js';
import { rosterMirror, sameMirror } from '../js/link-reset.js';

const PHONE = '5491155550199'; // ficticio
const GUS = { uid: 'gustavo', name: 'Gustavo', role: 'admin' };
const MAR = { uid: 'martin', name: 'Martín', role: 'organizer' };

function memStore(key) {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const store = createDemoStore();
  store.key = key;
  const db = () => JSON.parse(mem.get(key));
  let last = null;
  store.listeners.add((view) => { last = view; });
  const view = () => { store._emit(); return last; };
  return { store, db, view };
}

test('rosterNameFor: sin entrada propia vale el nombre de la ficha; con entrada, la suya', () => {
  const person = { id: 'r1', name: 'Juan Pérez', shortName: 'Juancho', holders: ['gustavo', 'martin'], names: { martin: { name: 'Juani', shortName: '' } } };
  assert.deepEqual(rosterNameFor(person, 'gustavo'), { name: 'Juan Pérez', shortName: 'Juancho', own: false });
  assert.deepEqual(rosterNameFor(person, 'martin'), { name: 'Juani', shortName: '', own: true });
  assert.equal(ownRosterEntry(person, 'otro'), null);
  assert.equal(ownRosterEntry({ names: { x: { name: '  ' } } }, 'x'), null);
});

test('rosterSeenBy guarda la base y se puede volver a calcular para otro organizador', () => {
  const person = { id: 'r1', name: 'Juan Pérez', shortName: 'Juancho', holders: ['gustavo', 'martin'], names: { martin: { name: 'Juani', shortName: 'Pibe' } } };
  const mar = rosterSeenBy(person, MAR);
  assert.equal(mar.name, 'Juani');
  assert.equal(mar.shortName, 'Pibe');
  assert.equal(mar.ownView, true);
  assert.equal(mar.baseName, 'Juan Pérez');
  const gus = rosterSeenBy(mar, GUS);
  assert.equal(gus.name, 'Juan Pérez');
  assert.equal(gus.shortName, 'Juancho');
  const other = rosterSeenBy(person, { uid: 'lucia', name: 'Lucía' });
  assert.equal(other.ownView, false);
  assert.equal(other.name, 'Juan Pérez');
  const base = rosterBase(mar);
  assert.equal(base.name, 'Juan Pérez');
  assert.equal(base.shortName, 'Juancho');
  assert.equal('ownView' in base || 'baseName' in base, false);
});

test('rosterNamePlan: único dueño escribe la ficha; ficha compartida escribe names.{uid}', () => {
  const solo = { name: 'Ana', holders: ['gustavo'] };
  assert.deepEqual(rosterNamePlan(solo, 'gustavo', { name: 'Ana María' }), { mode: 'base', uid: 'gustavo', name: 'Ana María', shortName: '', dropOwn: false });
  const shared = { name: 'Ana', shortName: 'Anita', holders: ['gustavo', 'martin'] };
  assert.deepEqual(rosterNamePlan(shared, 'martin', { shortName: 'Negra' }), { mode: 'own', uid: 'martin', entry: { name: 'Ana', shortName: 'Negra' } });
  // Volvió a quedar solo: escribe la ficha con lo que veía y borra su entrada.
  const back = { name: 'Ana', holders: ['martin'], names: { martin: { name: 'Anita M', shortName: 'Negra' } } };
  assert.deepEqual(rosterNamePlan(back, 'martin', {}), { mode: 'base', uid: 'martin', name: 'Anita M', shortName: 'Negra', dropOwn: true });
  // Ficha vieja sin dueño ni lista: como siempre.
  assert.equal(rosterNamePlan({ name: 'Viejo' }, 'gustavo', { name: 'Viejo 2' }).mode, 'base');
});

test('rosterLinkEntry: al vincular queda lo que escribió, sin sugerir el nombre del otro', () => {
  assert.deepEqual(rosterLinkEntry({ name: 'Juan Pérez', shortName: 'Juancho' }, 'martin', { name: 'Juani' }), { name: 'Juani', shortName: '' });
  assert.deepEqual(rosterLinkEntry({ name: 'Juan Pérez', shortName: 'Juancho' }, 'martin', { name: 'Juani', shortName: 'pibe' }), { name: 'Juani', shortName: 'Pibe' });
});

test('demo: Martín agenda el mismo WhatsApp con otro nombre y no le cambia la agenda a Gustavo', async () => {
  const { store, db, view } = memStore('f7c-test-v249-link');
  store.setActor(GUS);
  const id = await store.addRoster({ name: 'Juan Pérez', phone: PHONE, shortName: 'Juancho' }, 'Gustavo');
  store.setActor(MAR);
  const linked = await store.addRoster({ name: 'Juani Ficticio', phone: '11 5555-0199', shortName: '' }, 'Martín');
  assert.equal(linked, id, 'es el mismo jugador');
  let raw = db().roster[id];
  assert.equal(raw.name, 'Juan Pérez');
  assert.equal(raw.shortName, 'Juancho');
  assert.deepEqual(raw.holders, ['gustavo', 'martin']);
  assert.deepEqual(raw.names, { martin: { name: 'Juani Ficticio', shortName: '' } });
  let seen = view().roster.find((row) => row.id === id);
  assert.equal(seen.name, 'Juani Ficticio');
  assert.equal(seen.shortName, undefined);

  // Martín lo renombra y le pone apodo: solo su entrada.
  await store.updateRoster(id, { name: 'Juani Ficticio', shortName: 'Pibe' });
  await store.setRosterNick(id, 'Pibito');
  raw = db().roster[id];
  assert.equal(raw.name, 'Juan Pérez');
  assert.equal(raw.shortName, 'Juancho');
  assert.deepEqual(raw.names.martin, { name: 'Juani Ficticio', shortName: 'Pibito' });

  // Gustavo lo renombra: su cambio no pisa el de Martín.
  store.setActor(GUS);
  seen = view().roster.find((row) => row.id === id);
  assert.equal(seen.name, 'Juan Pérez');
  assert.equal(seen.shortName, 'Juancho');
  await store.patchRoster(id, { name: 'Juan Carlos Pérez', shortName: 'Juanca' });
  raw = db().roster[id];
  assert.equal(raw.name, 'Juan Pérez', 'ficha compartida: la base no cambia');
  assert.deepEqual(raw.names.gustavo, { name: 'Juan Carlos Pérez', shortName: 'Juanca' });
  assert.deepEqual(raw.names.martin, { name: 'Juani Ficticio', shortName: 'Pibito' });
  store.setActor(MAR);
  seen = view().roster.find((row) => row.id === id);
  assert.equal(seen.name, 'Juani Ficticio');
  assert.equal(seen.shortName, 'Pibito');

  // Martín se lo saca de su agenda: su entrada se va, la de Gustavo queda.
  await store.deleteRoster(id);
  raw = db().roster[id];
  assert.deepEqual(raw.holders, ['gustavo']);
  assert.equal(raw.names.martin, undefined);
  // Gustavo vuelve a ser el único: al editar escribe la ficha y borra su entrada.
  store.setActor(GUS);
  await store.setRosterNick(id, 'Juanca');
  raw = db().roster[id];
  assert.equal(raw.name, 'Juan Carlos Pérez');
  assert.equal(raw.shortName, 'Juanca');
  assert.equal(raw.names, undefined);
});

test('demo: datos viejos (ficha compartida sin names) se ven igual para los dos', async () => {
  const { store, db, view } = memStore('f7c-test-v249-legacy');
  store.setActor(GUS);
  const id = await store.addRoster({ name: 'Pedro Viejo', phone: PHONE, shortName: 'Pedrito' }, 'Gustavo');
  const all = db();
  all.roster[id].holders = ['gustavo', 'martin'];
  localStorage.setItem('f7c-test-v249-legacy', JSON.stringify(all));
  for (const actor of [GUS, MAR]) {
    store.setActor(actor);
    const seen = view().roster.find((row) => row.id === id);
    assert.equal(seen.name, 'Pedro Viejo');
    assert.equal(seen.shortName, 'Pedrito');
  }
});

test('en el partido cada organizador ve su nombre; la identidad (promo, deuda) es la misma', async () => {
  const { store, view } = memStore('f7c-test-v249-match');
  store.setActor(GUS);
  const id = await store.addRoster({ name: 'Juan Pérez', phone: PHONE, shortName: 'Juancho' }, 'Gustavo');
  const m1 = await store.addMatch({ date: '2026-12-10', time: '20:00', capacity: 14, price: 9000 }, 'Gustavo');
  const gusMatch = view().matches.find((row) => row.id === m1);
  const gusPerson = view().roster.find((row) => row.id === id);
  await store.addPlayer(gusMatch, { name: gusPerson.name, shortName: gusPerson.shortName, phone: PHONE, rosterId: id }, 'Gustavo');
  store.setActor(MAR);
  await store.addRoster({ name: 'Juani', phone: PHONE, shortName: 'Pibe' }, 'Martín');
  const m2 = await store.addMatch({ date: '2026-12-10', time: '22:00', capacity: 14, price: 9000 }, 'Martín');
  const marMatch = view().matches.find((row) => row.id === m2);
  const marPerson = view().roster.find((row) => row.id === id);
  assert.equal(marPerson.name, 'Juani');
  await store.addPlayer(marMatch, { name: marPerson.name, shortName: marPerson.shortName, phone: PHONE, rosterId: id }, 'Martín');

  // Martín: en los dos partidos lo ve como «Pibe» / «Juani».
  let v = view();
  let players = playersSeenBy(v.players, v.roster);
  for (const p of players.filter((row) => row.rosterId === id)) {
    assert.equal(displayName(p, v.roster), 'Pibe');
    assert.equal(nickOf(p, v.roster), 'Pibe');
    assert.equal(p.name, 'Juani');
    assert.equal(givenName(p, v.roster), 'Pibe');
  }
  const keys = new Set(players.filter((row) => row.rosterId === id).map((row) => personKey(row, players)));
  assert.equal(keys.size, 1, 'misma persona en los dos partidos del día (promo 2x)');
  assert.ok([...keys][0].startsWith('p:'));

  // Gustavo: en los dos lo ve como «Juancho» / «Juan Pérez».
  store.setActor(GUS);
  v = view();
  players = playersSeenBy(v.players, v.roster);
  for (const p of players.filter((row) => row.rosterId === id)) {
    assert.equal(displayName(p, v.roster), 'Juancho');
    assert.equal(p.name, 'Juan Pérez');
  }
  assert.equal(new Set(players.filter((row) => row.rosterId === id).map((row) => personKey(row, players))).size, 1);

  // Lucía no lo tiene en su agenda: ve lo que dice cada partido.
  store.setActor({ uid: 'lucia', name: 'Lucía', role: 'organizer' });
  v = view();
  const names = playersSeenBy(v.players, v.roster).filter((row) => row.rosterId === id).map((p) => displayName(p, v.roster)).sort();
  assert.deepEqual(names, ['Juancho', 'Pibe']);
});

test('Autoservicio: saludo con la agenda del organizador del link (1ª palabra del apodo o del nombre)', () => {
  const person = { id: 'fichaFicticia0001', name: 'Juan Pérez', shortName: 'Juancho Grande', holders: ['gustavo', 'martin'], names: { martin: { name: 'Juani Ficticio', shortName: '' } } };
  const greet = (uid) => givenName(uid ? rosterSeenBy(person, { uid }) : person);
  assert.equal(greet('gustavo'), 'Juancho');
  assert.equal(greet('martin'), 'Juani');
  assert.equal(greet(''), 'Juancho', 'sin organizador: la ficha, como antes');
  // Organizador que no lo tiene agendado: la ficha (pregunta abierta para Gustavo).
  assert.equal(greet('lucia'), 'Juancho');
});

test('el espejo del link reseteado lleva la ficha tal cual y los nombres propios', () => {
  const person = rosterSeenBy({ id: 'r1', name: 'Juan Pérez', shortName: 'Juancho', holders: ['gustavo', 'martin'], names: { martin: { name: 'Juani', shortName: '' } }, phoneKey: phoneIdentity({ phone: PHONE }), hasPhone: true }, MAR);
  const mirror = rosterMirror(person);
  assert.equal(mirror.name, 'Juan Pérez');
  assert.equal(mirror.shortName, 'Juancho');
  assert.deepEqual(mirror.names, { martin: { name: 'Juani', shortName: '' } });
  assert.equal(sameMirror(person, rosterSeenBy(person, GUS)), true);
  assert.equal('names' in rosterMirror({ name: 'Solo' }), false);
});

test('confirmar: saluda con la agenda de quien MANDÓ el link, la reescriba quien la reescriba', async () => {
  const { confirmationIdentity } = await import('../js/reminders.js');
  const person = { id: 'r1', name: 'Juan Pérez', shortName: 'Juancho', holders: ['gustavo', 'martin'], names: { martin: { name: 'Juani', shortName: 'Pibe' } } };
  // Lo anotó Gustavo, pero el recordatorio lo mandó Martín.
  const player = { matchId: 'm1', rosterId: 'r1', name: 'Juan Pérez', shortName: 'Juancho', addedByUid: 'gustavo' };
  const match = { id: 'm1', date: '2026-12-10', time: '22:00' };
  for (const actor of [GUS, MAR]) {
    const card = confirmationIdentity({ playerId: 'p1', player, match, roster: [rosterSeenBy(person, actor)], senderUid: 'martin' });
    assert.equal(card.name, 'Juani');
    assert.equal(card.shortName, 'Pibe');
    assert.equal(card.sentByUid, 'martin');
  }
  // Lo mandó Gustavo, sin nombre propio: su agenda es la ficha.
  let card = confirmationIdentity({ playerId: 'p1', player: { ...player, name: 'Juani', shortName: 'Pibe' }, match, roster: [rosterSeenBy(person, MAR)], senderUid: 'gustavo' });
  assert.equal(card.name, 'Juan Pérez');
  assert.equal(card.shortName, 'Juancho');
  // No se sabe quién lo mandó: lo de siempre (fila del partido + ficha), igual para cualquiera que la reescriba.
  for (const actor of [GUS, MAR]) {
    card = confirmationIdentity({ playerId: 'p1', player, match, roster: [rosterSeenBy(person, actor)] });
    assert.equal(card.name, 'Juan Pérez');
    assert.equal(card.shortName, 'Juancho');
    assert.equal('sentByUid' in card, false);
  }
  // Lo mandó alguien que no lo tiene agendado: lo de siempre.
  card = confirmationIdentity({ playerId: 'p1', player, match, roster: [person], senderUid: 'lucia' });
  assert.equal(card.name, 'Juan Pérez');
  assert.equal(card.shortName, 'Juancho');
});

test('demo: al mandar el link, la tarjeta de confirmar queda a nombre de quien lo mandó', async () => {
  const { store, db } = memStore('f7c-test-v249-confirm');
  store.setActor(GUS);
  const id = await store.addRoster({ name: 'Juan Pérez', phone: PHONE, shortName: 'Juancho' }, 'Gustavo');
  const mid = await store.addMatch({ date: '2099-12-10', time: '20:00', capacity: 14 }, 'Gustavo');
  const pid = await store.addPlayer({ id: mid, date: '2099-12-10', capacity: 14 }, { name: 'Juan Pérez', shortName: 'Juancho', phone: PHONE, rosterId: id }, 'Gustavo');
  store.setActor(MAR);
  await store.addRoster({ name: 'Juani', phone: PHONE, shortName: 'Pibe' }, 'Martín');
  const token = await store.ensureConfirmToken(pid);
  let card = db().confirmations[token];
  assert.equal(card.name, 'Juan Pérez', 'sin envío: lo de siempre');
  await store.markConfirmSender(pid);
  card = db().confirmations[token];
  assert.equal(card.sentByUid, 'martin');
  assert.equal(card.name, 'Juani');
  assert.equal(card.shortName, 'Pibe');
  // Gustavo toca otra cosa del jugador: la tarjeta sigue con el saludo de Martín.
  store.setActor(GUS);
  await store.setAttendance(pid, 'si').catch(() => {});
  await store.updatePlayer(pid, { reminderSentAt: Date.now() });
  card = db().confirmations[token];
  assert.equal(card.name, 'Juani');
  assert.equal(card.shortName, 'Pibe');
  // Ahora lo manda Gustavo.
  await store.markConfirmSender(pid);
  card = db().confirmations[token];
  assert.equal(card.sentByUid, 'gustavo');
  assert.equal(card.name, 'Juan Pérez');
  assert.equal(card.shortName, 'Juancho');
});
