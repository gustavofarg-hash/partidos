// v257: solo se reescriben las tarjetas de confirmación de filas cuyo partido está cargado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { confirmSyncRows } from '../js/store.js';

const rows = [
  { id: 'nuevo', matchId: 'mA' },
  { id: 'otroB', matchId: 'mB' },
  { id: 'viejo', matchId: '2026-11-09_1630' },
  { id: 'huerfano', matchId: 'partidoBorrado' },
  { id: 'sinPartido', matchId: '' },
];
const loaded = [{ id: 'mA' }, { id: 'mB' }];

test('las filas de partidos cargados sí, las de partidos no cargados no', () => {
  assert.deepEqual(confirmSyncRows(rows, loaded, 'nuevo').map((r) => r.id), ['nuevo', 'otroB']);
});

test('la fila propia va siempre, aunque su partido no esté en la lista', () => {
  assert.deepEqual(confirmSyncRows(rows, [{ id: 'mB' }], 'nuevo').map((r) => r.id), ['nuevo', 'otroB']);
  assert.deepEqual(confirmSyncRows(rows, [], 'viejo').map((r) => r.id), ['viejo']);
});

test('sin datos no rompe', () => {
  assert.deepEqual(confirmSyncRows(null, null), []);
  assert.deepEqual(confirmSyncRows([null, { id: 'x', matchId: 'mA' }], [{ id: 'mA' }]).map((r) => r.id), ['x']);
});

test('_syncConfirmGroup usa el filtro', () => {
  const store = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const start = store.indexOf('async _syncConfirmGroup(');
  const body = store.slice(start, store.indexOf('subscribe(fn)', start));
  assert.match(body, /for \(const row of confirmSyncRows\(related, matches, current\.id\)\)/);
  assert.doesNotMatch(body, /for \(const row of related\)/);
});
