// Punto 8: «Te correspondió» en Estadísticas > Día.
// Con cálculo guardado, su fila. Sin cálculo, solo entre los organizadores
// que participaron en cada partido, según su modo. Uno solo: todo el total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchParticipants, organizerDayShare, organizerShareByPeriod, savedShare } from '../js/stats.js';

const staff = [
  { uid: 'gus', name: 'Gustavo', active: true },
  { uid: 'mar', name: 'Martín', active: true },
  { uid: 'zoe', name: 'Zoe', active: true },
  { uid: 'heb', name: 'Heber', active: true },
];
const now = new Date('2026-11-23T12:00:00-03:00');
const paid = (id, matchId, cash, cashTo, signed, extra = {}) => ({
  id, matchId, waiting: false, paid: true, split: true, cash, cashTo, transfer: 0, fromCredit: 0,
  signedUpWith: signed.uid, signedUpWithName: signed.name, ...extra,
});
const gus = { uid: 'gus', name: 'Gustavo' };
const mar = { uid: 'mar', name: 'Martín' };
const share = (matches, players, who = gus, saved = null) => organizerDayShare({ matches, players, staff, uid: who.uid, name: who.name, saved, now });

test('con cálculo guardado vale su fila, aunque el cálculo en vivo diera otra cosa', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 10000, 'Gustavo', gus)];
  const saved = { date: '2026-11-20', rows: [{ uid: 'gus', name: 'Gustavo', collected: 10000, entitled: 7000 }, { uid: 'mar', name: 'Martín', collected: 0, entitled: 3000 }] };
  assert.equal(share(matches, players, gus, saved), 7000);
  assert.equal(share(matches, players, mar, saved), 3000);
  // Sin fila en lo guardado: no le tocó nada.
  assert.equal(share(matches, players, { uid: 'zoe', name: 'Zoe' }, saved), 0);
  // Por nombre si la fila no tiene su uid.
  assert.equal(savedShare({ rows: [{ uid: 'viejo', name: 'Gustavo', entitled: 1234 }] }, gus), 1234);
  // Un día que todavía no se jugó no suma, aunque haya algo guardado.
  assert.equal(share([{ ...matches[0], date: '2026-11-30' }], players, gus, saved), 0);
});

test('sin cálculo, partes iguales solo entre los que participaron, no entre todos los activos', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [
    paid('p1', 'a', 6000, 'Gustavo', gus),
    paid('p2', 'a', 4000, 'Martín', mar),
    // En la espera no hace participar a Zoe.
    { id: 'w', matchId: 'a', waiting: true, signedUpWith: 'zoe', signedUpWithName: 'Zoe' },
  ];
  assert.deepEqual(matchParticipants(matches[0], players, staff).sort(), ['gus', 'mar']);
  assert.equal(share(matches, players, gus), 5000);
  assert.equal(share(matches, players, mar), 5000);
  assert.equal(share(matches, players, { uid: 'zoe', name: 'Zoe' }), 0);
});

test('sin cálculo, según quién anotó', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'signed', createdByUid: 'gus' }];
  const players = [
    paid('p1', 'a', 5000, 'Martín', gus),
    paid('p2', 'a', 5000, 'Martín', gus),
    paid('p3', 'a', 5000, 'Martín', mar),
  ];
  assert.equal(share(matches, players, gus), 10000);
  assert.equal(share(matches, players, mar), 5000);
  assert.equal(share(matches, players, { uid: 'heb', name: 'Heber' }), 0);
});

test('un solo organizador participó: todo el total, con muchos activos', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 5000, 'Gustavo', gus), paid('p2', 'a', 5000, 'Gustavo', gus)];
  assert.equal(share(matches, players, gus), 10000);
  assert.equal(share(matches, players, mar), 0);
});

test('quien cobró también participó, aunque nadie se anotara con él', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 8000, 'Heber', gus)];
  assert.deepEqual(matchParticipants(matches[0], players, staff).sort(), ['gus', 'heb']);
  assert.equal(share(matches, players, gus), 4000);
});

test('un partido con organizadores elegidos no cambia', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['gus', 'mar'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 10000, 'Gustavo', gus)];
  assert.equal(share(matches, players, gus), 5000);
  assert.equal(share(matches, players, mar), 5000);
});

test('Mes y Año usan lo guardado de cada día si lo hay', () => {
  const matches = [
    { id: 'a', date: '2026-11-10', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' },
    { id: 'b', date: '2026-11-11', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' },
  ];
  const players = [paid('p1', 'a', 10000, 'Gustavo', gus), paid('p2', 'b', 6000, 'Gustavo', gus)];
  const savedFor = (date) => (date === '2026-11-10' ? { rows: [{ uid: 'gus', name: 'Gustavo', entitled: 2500 }] } : null);
  const months = organizerShareByPeriod({ matches, players, staff, uid: 'gus', name: 'Gustavo', grain: 'month', savedFor, now });
  assert.equal(months.get('2026-11'), 2500 + 6000);
});
