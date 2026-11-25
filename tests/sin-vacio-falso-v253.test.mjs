// v253: Próximos (y las otras listas) no dicen «No hay…» antes de que lleguen los
// datos, y el cartel de «No hay conexión» no sale cuando la caché ya era igual al servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FirebaseStore } from '../js/store.js';
import { connectionBack } from '../js/db-notice.js';

function fakeSnap(docs, { fromCache = false, changes = docs.length } = {}) {
  return {
    metadata: { fromCache, hasPendingWrites: false },
    docs: docs.map((row) => ({ id: row.id, data: () => ({ ...row }) })),
    docChanges: () => Array.from({ length: changes }, () => ({})),
  };
}

function upcomingStore() {
  const store = new FirebaseStore();
  const calls = [];
  store.fs = { onSnapshot: (q, opts, next, fail) => { calls.push({ opts, next, fail }); return () => {}; } };
  store._applyMatchPlan = () => 'q';
  store._swap = () => {};
  store._backfillMatches = () => {};
  store._buckets = { matches: {}, players: {} };
  const views = [];
  store.listeners = new Set([(view) => views.push(view)]);
  store._listenUpcoming();
  return { store, call: calls[0], views };
}

test('arranca sin los partidos: matchesReady false hasta el primer snapshot', () => {
  const store = new FirebaseStore();
  for (const key of ['matchesReady', 'historyReady', 'logReady', 'rosterReady']) assert.equal(store.state[key], false, key);
});

test('Próximos escucha con metadatos y el primer snapshot (aunque venga vacío) lo deja listo', () => {
  const { store, call, views } = upcomingStore();
  assert.deepEqual(call.opts, { includeMetadataChanges: true });
  call.next(fakeSnap([], { fromCache: false, changes: 0 }));
  assert.equal(store.state.matchesReady, true);
  assert.equal(views.at(-1).matchesReady, true);
  assert.deepEqual(views.at(-1).matches, []);
});

test('caché igual al servidor: llega el snapshot solo de metadatos y cuenta como conexión', () => {
  const { store, call, views } = upcomingStore();
  call.next(fakeSnap([{ id: 'm1', date: '2099-01-01', viewers: ['*'] }], { fromCache: true }));
  assert.ok(!store.serverOk);
  assert.equal(store.state.fromCache, true);
  const before = views.length;
  call.next(fakeSnap([{ id: 'm1', date: '2099-01-01', viewers: ['*'] }], { fromCache: false, changes: 0 }));
  assert.equal(store.serverOk, true, 'antes quedaba en false y a los 15 s salía el cartel');
  assert.equal(store.state.fromCache, false);
  assert.equal(views.length, before + 1, 'avisa para que se borre el cartel');
  assert.equal(connectionBack({ shown: true, serverOk: store.serverOk, fromCache: views.at(-1).fromCache, online: true }), true);
});

test('si la escucha falla, deja de decir «Cargando…»', () => {
  const { store, call } = upcomingStore();
  store._onListenError = () => {};
  call.fail({ code: 'unavailable' });
  assert.equal(store.state.matchesReady, true);
});

test('las pantallas usan los campos y el demo (sin campos) cuenta como listo', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  for (const key of ['matchesReady', 'historyReady', 'logReady']) assert.match(app, new RegExp(`app\\.${key} = view\\.${key} !== false;`));
  assert.match(app, /app\.matchesReady === false \? loadingHtml\('home-loading'\)/);
  assert.match(app, /app\.historyReady === false \? loadingHtml\('hist-wait'\)/);
  assert.match(app, /app\.rosterReady === false\) return `<div class="loading" id="roster-list">/);
  assert.match(app, /app\.logReady === false/);
  assert.match(app, /app\.session\?\.usersReady === false/);
  assert.match(app, /if \(!rows && !statsDataReady\(\)\) return loadingHtml\('stats-days'\);/);
  assert.match(app, /if \(!rows && !statsDataReady\(\)\) return loadingHtml\('stats-periods'\);/);
  const auth = readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
  assert.match(auth, /this\.usersReady = false;/);
});

test('los campos de «listo» entran en la firma que decide si se redibuja', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /app\.guestHiddenError, app\.rosterReady, app\.matchesReady, app\.historyReady, app\.logReady\]\);/);
  assert.match(app, /location\.hash !== '#\/usuarios' \|\| usersArrived/);
});
