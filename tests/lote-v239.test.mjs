// v239: lote de pedidos. Datos ficticios, sin teléfonos reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cancelLinks, cancelMessage, confirmationIdentity, confirmationRecord, playersForOrganizer, promotionMessage } from '../js/reminders.js';
import { givenName, rosterHit, searchRoster } from '../js/roster.js';
import { SHORTCUT_DOUBLE_MS, shortcutHash, shortcutMatch } from '../js/shortcut.js';
import { toEpoch } from '../js/dates.js';

const require = createRequire(import.meta.url);
const { pushCopy } = require('../functions/logic.js');
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('#2 Mis jugadores incluye las altas del link sin organizador de una ficha propia', () => {
  const gus = { uid: 'gusUid', name: 'Gustavo' };
  const roster = [
    { id: 'rMia', name: 'Pedro Prueba', holders: ['gusUid'] },
    { id: 'rAjena', name: 'Otro Prueba', holders: ['otroUid'] },
    { id: 'rVieja', name: 'Sin Dueño' },
  ];
  const rows = [
    { id: 'a', name: 'Pedro Prueba', rosterId: 'rMia', addedBy: 'Pedro Prueba', addedByUid: 'anonUid' },
    { id: 'b', name: 'Otro Prueba', rosterId: 'rAjena', addedBy: 'Otro Prueba', addedByUid: 'anonUid' },
    { id: 'c', name: 'Sin Dueño', rosterId: 'rVieja', addedBy: 'Sin Dueño', addedByUid: 'anonUid' },
    { id: 'd', name: 'Con Gus', rosterId: 'rMia', addedBy: 'Gustavo', addedByUid: 'gusUid' },
    { id: 'e', name: 'Renombrado', addedBy: 'Gus Viejo', addedByUid: 'gusUid' },
    { id: 'f', name: 'De Martín', addedBy: 'Martín', addedByUid: 'martinUid' },
    { id: 'g', name: 'Pedro Prueba', rosterId: 'rMia', addedBy: 'Martín', addedByUid: 'martinUid', signedUpWith: 'martinUid' },
  ];
  const mine = playersForOrganizer(rows, 'Gustavo', { actor: gus, roster }).map((p) => p.id);
  assert.deepEqual(mine, ['a', 'd', 'e']);
  // Sin actor sigue igual que antes: solo por nombre.
  assert.deepEqual(playersForOrganizer(rows, 'Gustavo').map((p) => p.id), ['d']);
  assert.match(app, /playersForOrganizer\(fresh, app\.who, \{ actor: actor\(\), roster: app\.roster \}\)/);
});

test('#3 el aviso de alta, espera y baja dice la cancha', () => {
  const match = { id: 'm1', date: '2026-10-19', time: '21:00', venueName: 'Colegiales', court: '2' };
  assert.equal(pushCopy('alta', { name: 'Ana' }, match, 'futbol-partidos').body, 'Ana se anotó y espera confirmación. 19/10 · 21:00 · Colegiales (Cancha 2)');
  assert.match(pushCopy('espera', { name: 'Ana' }, match).body, /Colegiales \(Cancha 2\)$/);
  assert.match(pushCopy('baja', { name: 'Ana' }, { ...match, court: 'Cancha 3' }).body, /Colegiales \(Cancha 3\)$/);
  assert.equal(pushCopy('confirmado', { name: 'Ana', rosterId: 'r' }, match).body, '¡Te confirmaron para el Lunes 19/10 21:00 en Colegiales (Cancha 2)!');
  // Sin cancha, como antes.
  assert.equal(pushCopy('alta', { name: 'Ana' }, { ...match, court: '' }).body, 'Ana se anotó y espera confirmación. 19/10 · 21:00 · Colegiales');
});

test('#13 la búsqueda acepta varias palabras en cualquier orden', () => {
  const roster = [
    { id: '1', name: 'Juan Pérez', shortName: 'Juanchi', phone: '5491100000011' },
    { id: '2', name: 'Juan Gómez', phone: '5491100000022' },
    { id: '3', name: 'Pedro Pérez' },
  ];
  const ids = (q) => searchRoster(roster, q).map((p) => p.id);
  assert.deepEqual(ids('juan perez'), ['1']);
  assert.deepEqual(ids('Pérez Juan'), ['1']);
  assert.deepEqual(ids('ju pe'), ['1']);
  assert.deepEqual(ids('juanchi per'), ['1']);
  assert.deepEqual(ids('juan  '), ['2', '1']);
  assert.deepEqual(ids('juan 0022'), ['2']);
  assert.deepEqual(ids('juan lopez'), []);
  assert.deepEqual(ids('perez'), ['1', '3']);
  // Una palabra sigue igual: comienzo de palabra, o parte del teléfono.
  assert.equal(rosterHit(roster[0], 'erez'), false);
  assert.equal(rosterHit(roster[0], '0011'), true);
});

test('#17 los mensajes al jugador usan la primera palabra del Nombre corto', () => {
  const roster = [{ id: 'r1', name: 'Ana María López', shortName: 'Ani Lu' }];
  const ana = { id: 'p1', name: 'Ana María López', rosterId: 'r1', phone: '5491100000033' };
  assert.equal(givenName(ana, roster), 'Ani');
  assert.equal(givenName({ name: 'Luis Gómez' }, []), 'Luis');
  assert.equal(givenName({ name: 'Luis Gómez', shortName: 'Lucho' }, []), 'Lucho');
  const match = { date: '2026-10-22', time: '21:00', notes: 'Lluvia' };
  assert.match(promotionMessage({ player: ana, match, venue: 'Colegiales', confirmUrl: 'u', roster }), /^¡Hola Ani! Se hizo un lugar/);
  assert.match(cancelMessage({ player: ana, match, venue: 'Colegiales', roster }), /^Hola Ani, se canceló/);
  assert.match(decodeURIComponent(cancelLinks({ match, players: [ana], venue: 'Colegiales', roster })[0].waUrl), /Hola Ani, se canceló/);
  // La página de confirmar lee el apodo del documento de confirmación.
  const card = confirmationIdentity({ playerId: 'p1', player: ana, match, roster });
  assert.equal(card.shortName, 'Ani Lu');
  assert.equal(card.name, 'Ana María López');
  assert.equal(givenName(card), 'Ani');
  assert.equal(confirmationRecord({ playerId: 'p1', player: { name: 'Sin Apodo' }, match }).shortName, '');
  assert.equal(givenName({ name: 'Sin Apodo', shortName: '' }), 'Sin');
  assert.match(app, /promotionMessage\(\{ player, match, venue: placeOf\(match\), confirmUrl, roster: app\.roster \}\)/);
  assert.match(app, /cancelLinks\(\{ match, players: people, venue: placeOf\(match\), roster: app\.roster \}\)/);
});

test('#9 el atajo del ícono elige el partido en juego o el próximo', () => {
  const day = '2026-11-23';
  const m = (id, time, extra = {}) => ({ id, date: day, time, ...extra });
  const matches = [m('a', '16:30'), m('b', '17:30'), m('c', '19:00'), m('x', '18:00', { cancelled: true })];
  const at = (time) => toEpoch(day, time);
  assert.equal(shortcutMatch(matches, at('18:15'))?.id, 'b');
  assert.equal(shortcutMatch(matches, at('17:00'))?.id, 'a');
  assert.equal(shortcutMatch(matches, at('17:30'))?.id, 'b');
  // Pasada la hora, va al próximo.
  assert.equal(shortcutMatch(matches, at('18:31'))?.id, 'c');
  assert.equal(shortcutMatch(matches, at('10:00'))?.id, 'a');
  assert.equal(shortcutMatch(matches, at('20:30')), null);
  assert.equal(shortcutHash({ id: 'b' }), '#/partido/b');
  assert.equal(shortcutHash({ id: 'b' }, true), '#/partido/b/equipos');
  assert.equal(shortcutHash(null, true), '#/');
  assert.ok(SHORTCUT_DOUBLE_MS >= 250 && SHORTCUT_DOUBLE_MS <= 500);
  assert.match(app, /if \(e\.target\.closest\?\.\('img'\)\) \{ brandIconTap\(\); return; \}/);
  assert.ok(sw.includes("'js/shortcut.js'"));
});

test('#6 los − y + de goles cuentan solo con un toque', () => {
  assert.match(app, /bindTap\(\$\('#team-board'\), '\[data-goal\]'/);
  assert.doesNotMatch(app, /const goal = e\.target\.closest\('\[data-goal\]'\);\n\s+const row = e\.target\.closest\('\[data-drag-player\]'\);\n\s+if \(!goal \|\| !row/);
  assert.match(css, /\.goal-box button \{[^}]*touch-action: pan-y;/);
});

test('#16 al pasar a «No jugó pero pagó» se abre Cargar pago', () => {
  assert.match(app, /\.then\(\(ok\) => \{ if \(ok\) openNoPlayPayment\(m, p\.id\); \}\)/);
  assert.match(app, /function openNoPlayPayment\(m, playerId\) \{[\s\S]{0,200}fresh\.paid === true[\s\S]{0,80}openPaymentForm\(m, fresh\)/);
});
