// v254: el Registro guarda el nombre como se ve en la lista del partido para
// quien escribe la línea (apodo si hay, si no el Nombre). Las líneas viejas no cambian.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { logText, pagoEntry, partidoEntry, playerLogFields, selfMoveEntry } from '../js/log.js';
import { behaviorLog } from '../js/behavior.js';

const actor = { uid: 'uGus', name: 'Gus' };
const match = { id: 'm1', date: '2026-11-25', time: '20:00', viewers: ['*'] };
const host = { id: 'h', matchId: 'm1', name: 'Nico Miranda' };
const guest = { id: 'g', matchId: 'm1', name: 'Invitado 1', shortName: 'Fran D.', invitedBy: 'h', invitedByName: 'Nico Miranda' };
const cash = { type: 'pago', method: 'efectivo', amount: 5000, paidTo: 'Gus' };

test('el caso de Gustavo: el pago del invitado con apodo dice «Fran D. (invitado de Nico Miranda)»', () => {
  const entry = pagoEntry(actor, match, [], guest, [host, guest], cash);
  assert.equal(entry.playerName, 'Fran D.');
  assert.equal(entry.hostName, 'Nico Miranda');
  assert.match(logText(entry), /· Fran D\. \(invitado de Nico Miranda\) · Efectivo \$5\.000$/);
  assert.equal('playerId' in entry, false, 'sin campos nuevos: firestore.rules no cambia');
});

test('sin apodo, el Nombre', () => {
  const plain = { ...guest, shortName: '' };
  assert.deepEqual(playerLogFields(plain, [host, plain]), { playerName: 'Invitado 1', hostName: 'Nico Miranda' });
  assert.deepEqual(playerLogFields({ name: 'Juan' }, []), { playerName: 'Juan', hostName: '' });
  assert.deepEqual(playerLogFields({}, []), { playerName: 'Sin nombre', hostName: '' });
});

test('jugador de mi agenda: el nombre y apodo que veo yo (v249)', () => {
  const roster = [{ id: 'r1', name: 'Ficticio Pérez', shortName: 'Pipa', ownView: true }];
  const player = { id: 'p', matchId: 'm1', name: 'Otro Nombre', rosterId: 'r1' };
  assert.equal(playerLogFields(player, [player], roster).playerName, 'Pipa');
  const noNick = [{ id: 'r1', name: 'Ficticio Pérez', ownView: true }];
  assert.equal(playerLogFields(player, [player], noNick).playerName, 'Ficticio Pérez');
  // Ficha ajena (no la tengo): manda lo del partido, y si no tiene apodo el de la ficha, como en la lista.
  const other = [{ id: 'r1', name: 'Ficticio Pérez', shortName: 'Pipa', ownView: false }];
  assert.equal(playerLogFields(player, [player], other).playerName, 'Pipa');
  assert.equal(playerLogFields({ ...player, shortName: 'Tito' }, [], other).playerName, 'Tito');
});

test('el «invitado de» es el nombre que se ve del que invitó (mi agenda, el primero de la cadena)', () => {
  const roster = [{ id: 'rh', name: 'Nicolás Miranda', ownView: true }];
  const h = { ...host, rosterId: 'rh' };
  assert.equal(playerLogFields(guest, [h, guest], roster).hostName, 'Nicolás Miranda');
  const g2 = { id: 'g2', matchId: 'm1', name: 'Invitado 2', invitedBy: 'g', invitedByName: 'Invitado 1' };
  assert.equal(playerLogFields(g2, [host, guest, g2]).hostName, 'Nico Miranda', 'como la etiqueta de la lista');
  assert.equal(playerLogFields({ ...guest, invitedBy: 'falta' }, []).hostName, 'Nico Miranda', 'sin el anfitrión cargado, el guardado');
});

test('las líneas de partidos también: alta/baja con el apodo', () => {
  const entry = partidoEntry(actor, match, [], { type: 'baja', ...playerLogFields(guest, [host, guest]) });
  assert.equal(logText(entry).includes('Fran D. (invitado de Nico Miranda)'), true);
});

test('aceptó/rechazó del organizador: el nombre de la lista; desde el link del jugador, el de la ficha (reglas)', () => {
  const p = { id: 'p', matchId: 'm1', name: 'Ficticio Pérez', shortName: 'Pipa' };
  const org = selfMoveEntry(match, [], p, { type: 'aceptó', actorUid: 'uGus', actorName: 'Gus' }, { mates: [p], roster: [] });
  assert.equal(org.playerName, 'Pipa');
  const self = selfMoveEntry(match, [], p, { type: 'se anotó', actorName: 'Ficticio Pérez', rosterId: 'r1', guest: true }, { mates: [p], roster: [] });
  assert.equal(self.playerName, 'Ficticio Pérez');
});

test('comportamiento: el apodo de la ficha si tiene', () => {
  assert.equal(behaviorLog(actor, { id: 'r1', name: 'Ficticio Pérez', shortName: 'Pipa' }, { type: 'falta', points: 1 }).playerName, 'Pipa');
  assert.equal(behaviorLog(actor, { id: 'r1', name: 'Ficticio Pérez' }, { type: 'falta', points: 1 }).playerName, 'Ficticio Pérez');
});

test('una línea vieja se dibuja con lo que tiene guardado (no se busca el nombre de hoy)', () => {
  const old = { section: 'pagos', type: 'pago', method: 'efectivo', amount: 5000, matchLabel: 'Miércoles 25/11 · 20:00', playerName: 'Invitado 1', hostName: 'Nico Miranda' };
  assert.equal(logText(old), 'Miércoles 25/11 · 20:00 · Invitado 1 (invitado de Nico Miranda) · Efectivo $5.000');
});

test('los stores pasan la agenda cargada, sin leer nada más', () => {
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  assert.match(src, /_logRoster\(\) \{\n\s+return Array\.isArray\(this\.state\.roster\) \? this\.state\.roster : \[\];/);
  assert.equal((src.match(/pagoEntry\([^\n]*\n?/g) || []).length > 0, true);
  for (const line of src.split('\n').filter((l) => /playerLogFields\(/.test(l) && !/^import/.test(l))) {
    assert.match(line, /_logRoster\(/, line.trim());
  }
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /'editors', 'playerName', 'hostName', 'detail', 'amount', 'method', 'paidTo'\]\)/);
});
