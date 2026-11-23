// v238: Enviar recordatorios usa el WhatsApp que muestra la lista del partido.
// Bug: un jugador anotado por el link (fila sin número) aparecía con «Sin número
// de WhatsApp» y «Cargar WhatsApp» aunque su ficha de Jugadores tenía el número.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playersForOrganizer, reminderLinks, reminderProgress, needsReminderBanner, withAgendaPhones } from '../js/reminders.js';

const GUS = { uid: 'gusUid', name: 'Gustavo' };
const PHONE = '5491100000001';   // ficticio
const match = { id: 'm1', date: '2099-11-23', time: '16:30', capacity: 14 };
const roster = [
  { id: 'rAgus', name: 'Agustín Prueba', shortName: 'Agus', phone: PHONE, holders: ['gusUid'], createdByUid: 'gusUid' },
  { id: 'rAjeno', name: 'Ajeno', phone: '5491100000002', holders: ['otroUid'], createdByUid: 'otroUid' },
];
// Fila del alta por el link: sin número en la fila, como guarda la app.
const linkRow = { id: 'p1', matchId: 'm1', name: 'Agustín Prueba', rosterId: 'rAgus', selfSignup: true, addedBy: 'Gustavo', addedByUid: 'gusUid', phone: '', hasPhone: false, confirmToken: 'tokenAgus1234567890' };
const ajenoRow = { id: 'p2', matchId: 'm1', name: 'Ajeno', rosterId: 'rAjeno', addedBy: 'Gustavo', addedByUid: 'gusUid', phone: '', hasPhone: false, confirmToken: 'tokenAjeno123456789' };
const withPhone = { id: 'p3', matchId: 'm1', name: 'Con número', addedBy: 'Gustavo', phone: '5491100000003', confirmToken: 'tokenCon12345678901' };

test('el recordatorio toma el WhatsApp de la ficha cuando la fila no lo trae', () => {
  const before = reminderLinks({ match, players: [linkRow], roster });
  assert.equal(before.length, 0, 'sin la ficha, la fila sola no tiene número (el bug)');
  const seen = withAgendaPhones([linkRow, ajenoRow, withPhone], roster, GUS);
  assert.equal(seen[0].phone, PHONE);
  assert.equal(seen[0].hasPhone, true);
  // La ficha de otro organizador no se usa: su número no es visible para Gustavo.
  assert.equal(seen[1].phone, '');
  // La fila con número queda igual (mismo objeto).
  assert.equal(seen[2], withPhone);
  const links = reminderLinks({ match, players: seen, roster });
  assert.deepEqual(links.map((l) => l.id).sort(), ['p1', 'p3']);
  assert.match(links.find((l) => l.id === 'p1').waUrl, new RegExp(PHONE));
  // «0 de 0 enviados» pasaba a contarlo.
  assert.equal(reminderProgress(playersForOrganizer([linkRow], 'Gustavo')).total, 0);
  assert.equal(reminderProgress(playersForOrganizer(withAgendaPhones([linkRow], roster, GUS), 'Gustavo')).total, 1);
  const now = Date.parse('2099-11-23T15:00:00-03:00');
  assert.equal(needsReminderBanner(match, withAgendaPhones([linkRow], roster, GUS), now), true);
  // No toca el original.
  assert.equal(linkRow.phone, '');
});

test('la app arma recordatorios y cartel con el número de la ficha', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /const everyone = withAgendaPhones\(playersOf\(m\.id\), app\.roster, actor\(\)\);/);
  assert.match(app, /return playersForOrganizer\(withAgendaPhones\(playersOf\(matchId\), app\.roster, actor\(\)\), app\.who, \{ actor: actor\(\), roster: app\.roster \}\);/);
});
