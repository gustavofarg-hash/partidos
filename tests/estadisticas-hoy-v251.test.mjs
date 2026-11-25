// v251: en Estadísticas (Día, Mes y Año) hoy entra sin esperar al cambio de día
// cuando terminó el último partido de hoy y además: con varios organizadores,
// está guardado el cálculo de compensación; con uno solo, todos tienen cómo pagan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MATCH_LENGTH_MS, diaDatesForOrganizer, organizerDayShare, organizerShareByPeriod, periodBuckets, todayLastEnd, todayStatsReady } from '../js/stats.js';

const staff = [
  { uid: 'gus', name: 'Gustavo', active: true },
  { uid: 'mar', name: 'Martín', active: true },
];
const gus = { uid: 'gus', name: 'Gustavo' };
const at = (hhmm) => new Date(`2026-11-24T${hhmm}:00-03:00`).getTime();
const today = '2026-11-24';
const paid = (id, matchId, cash) => ({ id, matchId, waiting: false, cash, cashTo: 'Gustavo', transfer: 0, fromCredit: 0, signedUpWith: 'gus', signedUpWithName: 'Gustavo', addedBy: 'Gustavo', addedByUid: 'gus' });
const unpaid = (id, matchId) => ({ id, matchId, waiting: false, signedUpWith: 'gus', signedUpWithName: 'Gustavo', addedBy: 'Gustavo', addedByUid: 'gus' });
const mine = (id, time, date = today) => ({ id, date, time, adders: ['gus'], viewers: ['gus'], createdByUid: 'gus', createdBy: 'Gustavo', splitMode: 'equal', price: 5000 });
const saved = { date: today, rows: [{ uid: 'gus', name: 'Gustavo', collected: 10000, entitled: 6000 }, { uid: 'mar', name: 'Martín', collected: 0, entitled: 4000 }] };

test('el partido dura MATCH_LENGTH_MS (1 hora) y se mira el último de hoy', () => {
  assert.equal(MATCH_LENGTH_MS, 3600e3);
  const matches = [mine('a', '19:00'), mine('b', '21:00'), { ...mine('c', '23:00'), cancelled: true }];
  assert.equal(todayLastEnd(matches, at('12:00')), at('22:00'));
  assert.ok(Number.isNaN(todayLastEnd([mine('x', '20:00', '2026-11-23')], at('12:00'))));
});

test('un solo organizador: entra cuando terminó el último partido y todos tienen cómo pagan', () => {
  const matches = [mine('a', '19:00'), mine('b', '21:00')];
  const players = [paid('p1', 'a', 5000), paid('p2', 'b', 5000), { ...unpaid('w', 'b'), waiting: true }];
  assert.equal(todayStatsReady({ matches, players, multi: false, now: at('21:59') }), false, 'falta que termine el de las 21');
  assert.equal(todayStatsReady({ matches, players, multi: false, now: at('22:00') }), true);
  assert.equal(todayStatsReady({ matches, players: [...players, unpaid('p3', 'a')], multi: false, now: at('23:00') }), false, 'uno sin cómo paga');
  assert.equal(todayStatsReady({ matches, players: [...players, { ...unpaid('p4', 'a'), freePlay: true }], multi: false, now: at('23:00') }), true, 'gratis cuenta como cargado');
  assert.equal(todayStatsReady({ matches, players: [...players, { ...unpaid('p5', 'a'), pendingTransfer: 5000, pendingTo: 'Gustavo' }], multi: false, now: at('23:00') }), true, 'transfiere después cuenta');
});

test('varios organizadores: hace falta el cálculo guardado, aunque cambie después', () => {
  const matches = [{ ...mine('a', '20:00'), adders: ['*'] }];
  const players = [paid('p1', 'a', 5000)];
  assert.equal(todayStatsReady({ matches, players, multi: true, saved: null, now: at('23:00') }), false);
  assert.equal(todayStatsReady({ matches, players, multi: true, saved, now: at('20:30') }), false, 'con cálculo pero sin terminar');
  assert.equal(todayStatsReady({ matches, players, multi: true, saved, now: at('21:00') }), true);
  assert.equal(todayStatsReady({ matches, players: [...players, unpaid('p2', 'a')], multi: true, saved: { ...saved, changed: true }, now: at('21:00') }), true);
});

test('sin partidos hoy (o solo de otro día) no entra', () => {
  assert.equal(todayStatsReady({ matches: [], players: [], now: at('23:00') }), false);
  assert.equal(todayStatsReady({ matches: [mine('a', '10:00', '2026-11-23')], players: [], now: at('23:00') }), false);
});

test('todos los de hoy cancelados: entra enseguida y Mes/Año suman los cancelados', () => {
  const matches = [mine('y', '21:00', '2026-11-23'), { ...mine('a', '19:00'), cancelled: true }, { ...mine('b', '21:00'), cancelled: true }];
  const players = [paid('p0', 'y', 5000), unpaid('p1', 'a')];
  const ready = todayStatsReady({ matches, players, multi: true, saved: null, now: at('09:00') });
  assert.equal(ready, true, 'sin esperar hora de fin, cálculo ni pagos');
  // Uno cancelado y otro activo: manda la regla de siempre.
  assert.equal(todayStatsReady({ matches: [matches[1], mine('c', '20:00')], players: [], multi: false, now: at('09:00') }), false);
  for (const grain of ['month', 'year']) {
    const before = periodBuckets({ matches, players, grain, who: gus, staff, now: at('09:00') })[0];
    const after = periodBuckets({ matches, players, grain, who: gus, staff, now: at('09:00'), todayCounts: ready })[0];
    assert.equal(before.cancelled, 0);
    assert.equal(after.cancelled, 2);
    assert.equal(after.matches, 1);
    assert.equal(after.collected, before.collected);
    assert.equal(organizerShareByPeriod({ matches, players, staff, who: gus, grain, now: at('09:00'), todayCounts: ready }).get(grain === 'year' ? '2026' : '2026-11'), 5000);
  }
  // Día, igual que los días anteriores, no lista días con todo cancelado.
  assert.deepEqual(diaDatesForOrganizer({ today, matches, staff, who: gus, todayCounts: ready }), ['2026-11-23']);
});

test('Día: hoy aparece solo con todayCounts; mañana nunca', () => {
  const matches = [mine('y', '21:00', '2026-11-23'), mine('a', '19:00'), mine('t', '21:00', '2026-11-25')];
  assert.deepEqual(diaDatesForOrganizer({ today, matches, staff, who: gus }), ['2026-11-23']);
  assert.deepEqual(diaDatesForOrganizer({ today, matches, staff, who: gus, todayCounts: true }), [today, '2026-11-23']);
});

test('Te correspondió de hoy: con todayCounts usa lo guardado o el cálculo en vivo', () => {
  const matches = [mine('a', '19:00')];
  const players = [paid('p1', 'a', 5000), paid('p2', 'a', 5000)];
  const now = at('23:00');
  assert.equal(organizerDayShare({ matches, players, staff, who: gus, now }), 0);
  assert.equal(organizerDayShare({ matches, players, staff, who: gus, now, todayCounts: true }), 10000);
  assert.equal(organizerDayShare({ matches, players, staff, who: gus, now, todayCounts: true, saved }), 6000);
});

test('Mes y Año: partidos, jugadores, monto, cobrado y por medio suman hoy con todayCounts', () => {
  const matches = [mine('y', '21:00', '2026-11-23'), mine('a', '19:00'), mine('t', '21:00', '2026-11-25')];
  const players = [paid('p0', 'y', 5000), paid('p1', 'a', 5000), paid('p2', 'a', 5000), paid('p3', 't', 5000)];
  const now = at('23:00');
  for (const grain of ['month', 'year']) {
    const before = periodBuckets({ matches, players, grain, who: gus, staff, now })[0];
    const after = periodBuckets({ matches, players, grain, who: gus, staff, now, todayCounts: true })[0];
    assert.equal(before.matches, 1);
    assert.equal(after.matches, 2);
    assert.equal(after.players, before.players + 2);
    assert.equal(after.collected, before.collected + 10000);
    assert.equal(after.signedAmount, before.signedAmount + 10000);
    assert.equal(after.byMethod.find((row) => row.kind === 'cash').amount, 15000);
    const shares = organizerShareByPeriod({ matches, players, staff, who: gus, grain, now, todayCounts: true });
    assert.equal(shares.get(grain === 'year' ? '2026' : '2026-11'), 15000);
    assert.equal(organizerShareByPeriod({ matches, players, staff, who: gus, grain, now }).get(grain === 'year' ? '2026' : '2026-11'), 5000);
  }
});
