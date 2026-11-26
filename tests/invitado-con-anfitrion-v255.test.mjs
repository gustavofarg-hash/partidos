// v255: el invitado sin nombre queda «Invitado N (X)», X = el apodo entero del que
// invita (como lo ve quien lo anota) o su Nombre. Los invitados ya cargados no cambian.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { alreadyInMatch, autoGuestName, GUEST_NAME_MAX, isAutoGuestName, isGenericGuest, resolveFriendNames, sameDayPromoGuestEditPatches, sameDayPromoGuestNickPatches, sameDayPromoGuestRenames, sameDayPromoGuestTwins, sameGuestName } from '../js/guests.js';
import { guestIdentityName, personKey } from '../js/roster.js';
import { playerPromoKey } from '../js/prices.js';

test('el nombre automático lleva al que invita entre paréntesis; la numeración sigue por anfitrión', () => {
  assert.deepEqual(resolveFriendNames(['', ''], [], 'Nico M.'), [
    { name: 'Invitado 1 (Nico M.)', guestAuto: true },
    { name: 'Invitado 2 (Nico M.)', guestAuto: true },
  ]);
  // Mezcla con los viejos: sigue desde el más alto, con o sin paréntesis.
  assert.equal(resolveFriendNames([''], ['Invitado 1', 'Amigo 2'], 'Nico M.')[0].name, 'Invitado 3 (Nico M.)');
  assert.equal(resolveFriendNames([''], ['Invitado 4 (Nico M.)'], 'Nico M.')[0].name, 'Invitado 5 (Nico M.)');
  // Un nombre escrito queda como se escribió.
  assert.deepEqual(resolveFriendNames(['Pipa', ''], [], 'Nico M.'), [{ name: 'Pipa', guestAuto: false }, { name: 'Invitado 1 (Nico M.)', guestAuto: true }]);
  // Sin anfitrión conocido, como antes.
  assert.equal(resolveFriendNames([''], [])[0].name, 'Invitado 1');
});

test('si no entra en 60, se corta lo de adentro con «…»', () => {
  const long = 'Bartolomé Ezequiel Santisteban Goñi de la Torre y Fernández';
  const name = autoGuestName(12, long);
  assert.equal(Array.from(name).length <= GUEST_NAME_MAX, true);
  assert.match(name, /^Invitado 12 \(Bartolomé .+…\)$/);
  assert.equal(Array.from(name).length, GUEST_NAME_MAX);
  // Un apodo (hasta 40) entra entero.
  const nick = 'A'.repeat(40);
  assert.equal(autoGuestName(99, nick), `Invitado 99 (${nick})`);
});

test('se reconoce como nombre automático (no choca, no es «Suelen anotarse»)', () => {
  for (const name of ['Invitado 1 (Nico M.)', 'invitado 3 (Nicolás)', 'Invitado 1', 'Amigo 2']) assert.equal(isAutoGuestName(name), true, name);
  for (const name of ['Invitado', 'Invitado (Nico)', 'Pipa (Nico)', 'Invitado 1 ()']) assert.equal(isAutoGuestName(name), false, name);
  assert.equal(isGenericGuest({ name: 'Invitado 1 (Nico M.)', invitedBy: 'h' }), true);
  // Dos «Invitado 1 (Nico M.)» automáticos de distintos anfitriones no chocan.
  const mates = [{ id: 'g1', name: 'Invitado 1 (Nico M.)', invitedBy: 'h1', guestAuto: true }];
  assert.equal(alreadyInMatch(mates, { name: 'Invitado 1 (Nico M.)', invitedBy: 'h2', guestAuto: true }), null);
  // «Suelen anotarse» y la búsqueda en Jugadores usan isAutoGuestName: lo excluyen.
  const regulars = readFileSync(new URL('../js/regulars.js', import.meta.url), 'utf8');
  assert.match(regulars, /if \(isAutoGuestName\(player\?\.name\)\) continue;/);
});

test('la identidad (promo, renombre, saldo) ignora «(…)» del nombre automático del mismo anfitrión', () => {
  assert.equal(guestIdentityName('Invitado 1 (Nico M.)'), 'invitado 1');
  assert.equal(guestIdentityName('Invitado 1'), 'invitado 1');
  assert.equal(guestIdentityName('Pipa (Nico)'), 'pipa (nico)', 'un nombre escrito no se toca');
  assert.equal(sameGuestName('Invitado 1', 'Invitado 1 (Nico M.)'), true);
  assert.equal(sameGuestName('Invitado 1 (Nico M.)', 'Invitado 2 (Nico M.)'), false);
  const players = [
    { id: 'hA', matchId: 'A', name: 'Nico Miranda', rosterId: 'rNico' },
    { id: 'hB', matchId: 'B', name: 'Nico Miranda', rosterId: 'rNico' },
    { id: 'gA', matchId: 'A', name: 'Invitado 1', invitedBy: 'hA' },
    { id: 'gB', matchId: 'B', name: 'Invitado 1 (Nicolás)', invitedBy: 'hB' },
    { id: 'oB', matchId: 'B', name: 'Otro', rosterId: 'rOtro' },
    { id: 'xB', matchId: 'B', name: 'Invitado 1 (Otro)', invitedBy: 'oB' },
  ];
  const matches = [{ id: 'A', date: '2026-11-27' }, { id: 'B', date: '2026-11-27' }];
  assert.equal(personKey(players[2], players), personKey(players[3], players));
  assert.notEqual(personKey(players[3], players), personKey(players[5], players), 'el de otro anfitrión es otra persona');
  assert.equal(playerPromoKey(players[2], players), playerPromoKey(players[3], players));
  assert.deepEqual(sameDayPromoGuestTwins({ player: players[2], players, matches }).map((row) => row.id), ['gB']);
  assert.deepEqual(sameDayPromoGuestRenames({ player: players[3], newName: 'Fran D.', players, matches }).map((row) => row.id), ['gA']);
  assert.deepEqual(sameDayPromoGuestEditPatches({ player: players[2], patch: { name: 'Fran D.', guestAuto: false }, players, matches }).map((row) => [row.id, row.patch.name]), [['gB', 'Fran D.']]);
  assert.deepEqual(sameDayPromoGuestNickPatches({ player: players[2], shortName: 'Fran', players, matches }), [{ id: 'gB', shortName: 'Fran' }]);
});

test('un saldo o promo de un invitado viejo no cambia de clave', () => {
  const players = [{ id: 'h', name: 'Nico', rosterId: 'r' }, { id: 'g', name: 'Invitado 1', invitedBy: 'h' }, { id: 'p', name: 'Pipa', invitedBy: 'h' }];
  assert.equal(personKey(players[1], players), 'g:r:r|invitado 1');
  assert.equal(personKey(players[2], players), 'g:r:r|pipa');
});

test('la app arma el paréntesis como lo ve quien anota y los mismos nombres en todos los partidos del día', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /const hostLabel = opts\.hostLabel \?\? \(host\?\.id \? shownName\(host\) : String\(host\?\.name \|\| ''\)\);/);
  assert.match(app, /const hostLabel = shownName\(host\);\n\s+const next = resolveFriendNames\(\[''\], friendNamesOf\(m\.id, host\.id\), hostLabel\)/);
  assert.match(app, /const resolved = guestsFromRows\(rows, friendNamesOf\(m\.id, host\.id\), hostLabel\);/);
  assert.match(app, /const hostLabel = usePick \? \(cleanShortName\(person\.shortName\) \|\| person\.name\) : name;/);
  assert.match(app, /sameGuestName\(name, friend\.name\)/);
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /d\.name\.size\(\) > 0 && d\.name\.size\(\) <= 60/);
});
