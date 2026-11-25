// v240: Estadísticas pide los días del mes que el historial (últimos 30) no
// trajo. Bug: en noviembre de 2026 Día y Mes arrancaban el 9/11. Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeById, monthRange, shiftMonth, statsFetchRange, statsRangesFor } from '../js/stats-range.js';
import { FirebaseStore } from '../js/store.js';
import { periodBuckets, diaDatesForOrganizer } from '../js/stats.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('rangos: el mes en curso siempre; otro mes o el año solo si se eligen', () => {
  const today = '2026-11-23';
  assert.deepEqual(statsRangesFor({ mode: 'dia', today }), [{ from: '2026-11-01', to: '2026-11-22' }]);
  assert.deepEqual(statsRangesFor({ mode: 'mes', today }), [{ from: '2026-11-01', to: '2026-11-22' }]);
  assert.deepEqual(statsRangesFor({ mode: 'jugador', today }), [{ from: '2026-11-01', to: '2026-11-22' }]);
  assert.deepEqual(statsRangesFor({ mode: 'mes', id: '2026-10', today }), [
    { from: '2026-11-01', to: '2026-11-22' }, { from: '2026-10-01', to: '2026-10-31' },
  ]);
  assert.deepEqual(statsRangesFor({ mode: 'mes', today, monthsBack: 2 }).map((r) => r.from), ['2026-11-01', '2026-10-01', '2026-09-01']);
  // v245: el año va de a un mes, del más nuevo al más viejo.
  assert.deepEqual(statsRangesFor({ mode: 'anio', today }).at(-1), { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(statsRangesFor({ mode: 'anio', today }).length, 11);
  assert.deepEqual(statsRangesFor({ mode: 'anio', id: '2025', today }).at(-1), { from: '2025-01-01', to: '2025-01-31' });
  // El 1 del mes no hay días pasados del mes.
  assert.deepEqual(statsRangesFor({ mode: 'mes', today: '2026-12-01' }), []);
  assert.equal(monthRange('2026-02', '2026-03-10').to, '2026-02-28');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('qué falta pedir: del 1 hasta el día anterior al más viejo cargado', () => {
  const loaded = { ready: true, hasMore: true, oldest: '2026-11-09' };
  assert.deepEqual(statsFetchRange({ from: '2026-11-01', to: '2026-11-22', loaded }), { from: '2026-11-01', to: '2026-11-08' });
  // El historial ya trajo todo lo pasado: no se lee nada.
  assert.equal(statsFetchRange({ from: '2026-11-01', to: '2026-11-22', loaded: { ...loaded, hasMore: false } }), null);
  // Todavía no llegó el historial: se espera.
  assert.equal(statsFetchRange({ from: '2026-11-01', to: '2026-11-22', loaded: { ...loaded, ready: false } }), null);
  // Lo cargado ya cubre el mes.
  assert.equal(statsFetchRange({ from: '2026-11-01', to: '2026-11-22', loaded: { ...loaded, oldest: '2026-10-28' } }), null);
  // Ya pedido en la sesión.
  assert.equal(statsFetchRange({ from: '2026-11-01', to: '2026-11-22', loaded, covered: [{ from: '2026-11-01', to: '2026-11-08' }] }), null);
  // Historial filtrado por fecha: se pide el rango entero.
  assert.deepEqual(statsFetchRange({ from: '2026-10-01', to: '2026-10-31', loaded: null }), { from: '2026-10-01', to: '2026-10-31' });
  const live = [{ id: 'a', v: 1 }];
  assert.deepEqual(mergeById(live, [{ id: 'a', v: 2 }, { id: 'b' }]), [{ id: 'a', v: 1 }, { id: 'b' }]);
  assert.equal(mergeById(live, []), live);
});

// Base en memoria con el mismo filtro que Firestore, para ver qué se pide.
function fakeFs(data) {
  const calls = [];
  const test1 = (row, w) => {
    const v = row[w.field];
    if (w.op === '==') return v === w.value;
    if (w.op === '>=') return v >= w.value;
    if (w.op === '<=') return v <= w.value;
    if (w.op === '<') return v < w.value;
    if (w.op === 'in') return w.value.includes(v);
    if (w.op === 'array-contains') return (v || []).includes(w.value);
    if (w.op === 'array-contains-any') return (v || []).some((x) => w.value.includes(x));
    throw new Error(w.op);
  };
  return {
    calls,
    collection(_db, col) { return { col }; },
    query(ref, ...parts) { return { col: ref.col, parts }; },
    where(field, op, value) { return { field, op, value }; },
    orderBy(field, dir) { return { orderBy: field, dir }; },
    limit(n) { return { limit: n }; },
    async getDocs(q) {
      calls.push(q);
      const rows = Object.entries(data[q.col] || {}).map(([id, row]) => ({ id, ...row }))
        .filter((row) => q.parts.filter((p) => p.op).every((w) => test1(row, w)));
      return { docs: rows.map(({ id, ...rest }) => ({ id, data: () => rest })) };
    },
  };
}

function seedNovember() {
  const matches = {};
  const players = {};
  let n = 0;
  // 55 partidos del 1 al 22/11, 2 o 3 por día; el 3/11 uno cancelado.
  for (let day = 1; day <= 22; day += 1) {
    const date = `2026-11-${String(day).padStart(2, '0')}`;
    const count = day % 2 ? 2 : 3;
    for (let i = 0; i < count; i += 1) {
      const id = `${date}_${18 + i}00`;
      matches[id] = { date, time: `${18 + i}:00`, viewers: ['*'], createdByUid: 'gus', cancelled: day === 3 && i === 0 };
      for (let k = 0; k < 2; k += 1) {
        players[`${id}-p${k}`] = { matchId: id, matchDate: date, name: `Jugador ${k}`, viewers: ['*'], addedByUid: 'gus', addedBy: 'Gustavo', signedUpWith: 'gus', signedUpWithName: 'Gustavo', paid: true, amount: 5000, cash: 5000, cashTo: 'Gustavo' };
      }
      n += 1;
    }
  }
  matches['2026-10-30_2000'] = { date: '2026-10-30', time: '20:00', viewers: ['*'], createdByUid: 'gus' };
  matches['ajeno'] = { date: '2026-11-02', time: '20:00', viewers: ['otro'], createdByUid: 'otro' };
  return { matches, players };
}

function storeWith(fs) {
  const store = new FirebaseStore();
  store.fs = fs;
  store.db = {};
  store.actor = { uid: 'gus', name: 'Gustavo', role: 'admin' };
  store._historyBounds = { mode: 'recent', before: '2026-11-23', limit: 30, empty: false };
  store._historySeen = true;
  store.state.historyHasMore = true;
  store.state.historyLoading = false;
  store._historyCursor = '2026-11-09';
  const views = [];
  store.listeners = new Set([(view) => views.push(view)]);
  store._view = () => ({ ...store.state });
  return { store, views };
}

test('la tienda pide una vez los días que faltan del mes, con sus jugadores', async () => {
  const data = seedNovember();
  const fs = fakeFs(data);
  const { store, views } = storeWith(fs);
  assert.equal(await store.loadStatsRange('2026-11-01', '2026-11-22'), true);
  const matchQuery = fs.calls[0];
  assert.equal(matchQuery.col, 'matches');
  const dates = matchQuery.parts.filter((p) => p.field === 'date');
  assert.deepEqual(dates.map((p) => [p.op, p.value]), [['>=', '2026-11-01'], ['<=', '2026-11-08']]);
  assert.deepEqual(matchQuery.parts.find((p) => p.field === 'viewers').value, ['gus', '*']);
  assert.equal(matchQuery.parts.some((p) => p.limit), false);
  const ids = store.state.statsMatches.map((m) => m.id);
  assert.equal(ids.every((id) => id >= '2026-11-01' && id < '2026-11-09'), true);
  assert.equal(ids.includes('ajeno'), false);
  assert.equal(store.state.statsMatches.length, 20);
  // Jugadores: solo de los no cancelados, por matchId y viewers.
  const playerQueries = fs.calls.slice(1);
  assert.equal(playerQueries.length, 2);
  assert.equal(playerQueries.every((q) => q.col === 'players' && q.parts.some((p) => p.field === 'matchId' && p.op === 'in') && q.parts.some((p) => p.field === 'viewers' && p.op === 'array-contains')), true);
  assert.equal(store.state.statsPlayers.length, 19 * 2);
  assert.equal(views.at(-1).statsLoading, false);
  // Segunda vez: nada.
  const before = fs.calls.length;
  assert.equal(await store.loadStatsRange('2026-11-01', '2026-11-22'), false);
  assert.equal(fs.calls.length, before);
  // Historial completo: nada.
  const other = storeWith(fakeFs(data));
  other.store.state.historyHasMore = false;
  assert.equal(await other.store.loadStatsRange('2026-11-01', '2026-11-22'), false);
});

test('con lo pedido, Mes suma el mes entero y Día lista desde el 1', async () => {
  const data = seedNovember();
  const { store } = storeWith(fakeFs(data));
  // Lo que trae el historial: los 30 más nuevos (desde el 9/11).
  const all = Object.entries(data.matches).map(([id, m]) => ({ id, ...m })).filter((m) => m.viewers.includes('*'));
  const history = all.filter((m) => m.date >= '2026-11-09' && m.date < '2026-11-23');
  const historyPlayers = Object.entries(data.players).map(([id, p]) => ({ id, ...p })).filter((p) => history.some((m) => m.id === p.matchId));
  const who = { uid: 'gus', name: 'Gustavo' };
  const staff = [{ uid: 'gus', name: 'Gustavo', role: 'admin', active: true }];
  const now = Date.parse('2026-11-23T12:00:00-03:00');
  const nov = (matches, players) => periodBuckets({ matches, players, prices: null, grain: 'month', who, staff, now }).find((b) => b.key === '2026-11');
  assert.equal(nov(history, historyPlayers).matches, history.length);
  await store.loadStatsRange('2026-11-01', '2026-11-22');
  const matches = mergeById(history, store.state.statsMatches);
  const players = mergeById(historyPlayers, store.state.statsPlayers);
  const full = nov(matches, players);
  assert.equal(full.matches + full.cancelled, 55);
  assert.equal(full.cancelled, 1);
  const days = diaDatesForOrganizer({ today: '2026-11-23', matches, staff, who });
  assert.equal(days.at(-1), '2026-11-01');
  assert.equal(days[0], '2026-11-22');
});

test('la app usa lo pedido en Día, Mes, Año y Jugador', () => {
  assert.match(app, /requestStatsRanges\(mode, r\.id\);/);
  assert.match(app, /function statsMatchList\(\) \{\n  return mergeById\(knownMatches\(\), app\.statsMatches\);/);
  for (const re of [
    /const matches = statsMatchList\(\)\.filter\(\(match\) => match\?\.date\);/,
    /return organizerShareByPeriod\(\{\n    matches: statsMatchList\(\),\n    players: statsPlayerList\(\),/,
    /const buckets = periodBuckets\(\{\n    matches: statsMatchList\(\),\n    players: statsPlayerList\(\),/,
    /players: statsPlayerList\(\),\n      matches: statsMatchList\(\),/,
  ]) assert.match(app, re);
  assert.match(app, /app\.statsMatches, app\.statsPlayers, app\.statsLoading, app\.statsError, app\.guestBlocked, app\.guestReady, app\.guestAccessError, app\.guestHiddenError(, [^\]]+)?\]\);/);
  assert.match(app, /id="stats-older"/);
  assert.ok(sw.includes("'js/stats-range.js'"));
});
