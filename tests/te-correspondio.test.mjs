// Punto 8: «Te correspondió» en Estadísticas > Día.
// Con cálculo guardado del día, su fila. Sin cálculo, el modo de cada partido:
// partes iguales entre todos los que pueden anotar (canAdd), anoten o no;
// según quién anotó, lo que pagaron los que anotó cada uno. Uno solo: todo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { organizerDayShare, organizerShareByPeriod, savedShare } from '../js/stats.js';

const staff = [
  { uid: 'gus', name: 'Gustavo', active: true },
  { uid: 'mar', name: 'Martín', active: true },
  { uid: 'zoe', name: 'Zoe', active: true },
  { uid: 'heb', name: 'Heber', active: true },
  { uid: 'old', name: 'Viejo', active: false },
];
const now = new Date('2026-11-23T12:00:00-03:00');
const paid = (id, matchId, cash, cashTo, signed) => ({
  id, matchId, waiting: false, paid: true, split: true, cash, cashTo, transfer: 0, fromCredit: 0,
  signedUpWith: signed.uid, signedUpWithName: signed.name,
});
const gus = { uid: 'gus', name: 'Gustavo' };
const mar = { uid: 'mar', name: 'Martín' };
const zoe = { uid: 'zoe', name: 'Zoe' };
const share = (matches, players, who = gus, saved = null) => organizerDayShare({ matches, players, staff, uid: who.uid, name: who.name, saved, now });

test('con cálculo guardado vale su fila, aunque el cálculo en vivo diera otra cosa', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 10000, 'Gustavo', gus)];
  const saved = { date: '2026-11-20', rows: [{ uid: 'gus', name: 'Gustavo', collected: 10000, entitled: 7000 }, { uid: 'mar', name: 'Martín', collected: 0, entitled: 3000 }] };
  assert.equal(share(matches, players, gus, saved), 7000);
  assert.equal(share(matches, players, mar, saved), 3000);
  assert.equal(share(matches, players, zoe, saved), 0);
  assert.equal(savedShare({ rows: [{ uid: 'viejo', name: 'Gustavo', entitled: 1234 }] }, gus), 1234);
  // Un día que todavía no se jugó no suma, aunque haya algo guardado.
  assert.equal(share([{ ...matches[0], date: '2026-11-30' }], players, gus, saved), 0);
});

test('partes iguales en un partido de todos: entre todos los activos, aunque no anoten ni cobren', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 8000, 'Gustavo', gus), paid('p2', 'a', 4000, 'Gustavo', gus)];
  // 4 activos con permiso de anotar (el inactivo no): 12000 / 4.
  assert.equal(share(matches, players, gus), 3000);
  assert.equal(share(matches, players, zoe), 3000);
  assert.equal(share(matches, players, { uid: 'old', name: 'Viejo' }), 0);
});

test('partes iguales con organizadores elegidos: solo esos, el creador sin trato especial', () => {
  // Creó Gustavo y eligió a Martín y Zoe. Los que pueden anotar son los elegidos
  // y quien lo creó (canAdd lo deja anotar); Heber no.
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['mar', 'zoe'], viewers: ['gus', 'mar', 'zoe'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 9000, 'Martín', mar)];
  assert.equal(share(matches, players, mar), 3000);
  assert.equal(share(matches, players, zoe), 3000);
  assert.equal(share(matches, players, gus), 3000);
  assert.equal(share(matches, players, { uid: 'heb', name: 'Heber' }), 0);
});

test('según quién anotó: cada uno se queda con lo de los suyos', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['*'], splitMode: 'signed', createdByUid: 'gus' }];
  const players = [
    paid('p1', 'a', 5000, 'Martín', gus),
    paid('p2', 'a', 5000, 'Martín', gus),
    paid('p3', 'a', 5000, 'Martín', mar),
  ];
  assert.equal(share(matches, players, gus), 10000);
  assert.equal(share(matches, players, mar), 5000);
  assert.equal(share(matches, players, zoe), 0);
});

test('un solo organizador con permiso: todo el total', () => {
  const matches = [{ id: 'a', date: '2026-11-20', time: '21:00', adders: ['gus'], viewers: ['gus'], splitMode: 'equal', createdByUid: 'gus' }];
  const players = [paid('p1', 'a', 5000, 'Gustavo', gus), paid('p2', 'a', 5000, 'Gustavo', gus)];
  assert.equal(share(matches, players, gus), 10000);
  assert.equal(share(matches, players, mar), 0);
});

test('Mes y Año usan lo guardado de cada día si lo hay', () => {
  const matches = [
    { id: 'a', date: '2026-11-10', time: '21:00', adders: ['gus'], splitMode: 'equal', createdByUid: 'gus' },
    { id: 'b', date: '2026-11-11', time: '21:00', adders: ['gus'], splitMode: 'equal', createdByUid: 'gus' },
  ];
  const players = [paid('p1', 'a', 10000, 'Gustavo', gus), paid('p2', 'b', 6000, 'Gustavo', gus)];
  const savedFor = (date) => (date === '2026-11-10' ? { rows: [{ uid: 'gus', name: 'Gustavo', entitled: 2500 }] } : null);
  const months = organizerShareByPeriod({ matches, players, staff, uid: 'gus', name: 'Gustavo', grain: 'month', savedFor, now });
  assert.equal(months.get('2026-11'), 2500 + 6000);
});
