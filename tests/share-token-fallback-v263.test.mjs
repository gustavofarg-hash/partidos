// v263: si el Listen del token no llega, un getDoc al servidor (o REST) puede
// resolver el organizador. Un exists:false solo de la caché no cierra.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SHARE_TOKEN_LOAD_ERROR,
  SHARE_TOKEN_LOOKUP_MS,
  SHARE_TOKEN_WAIT_MS,
  fetchShareTokenRest,
  resolveShareTokenAfterWait,
  shareTokenFromRestDocument,
  shareTokenFromServerSnap,
  shareTokenRestUrl,
  shareTokenSnapshotState,
  fetchFirestoreRestDocument,
  fetchFirestoreRestQuery,
  firestoreRestDocUrl,
  guestPlanToStructuredQuery,
} from '../js/self-signup.js';
import { firestoreInitSettings } from '../js/store.js';

test('un exists:false solo de la caché sigue pendiente; el servidor sí cierra', () => {
  assert.equal(shareTokenSnapshotState({ exists: false, fromCache: true }), 'pending');
  assert.equal(shareTokenSnapshotState({ exists: true, fromCache: true, uid: '' }), 'pending');
  assert.equal(shareTokenSnapshotState({ exists: false, fromCache: false }), 'missing');
  assert.equal(shareTokenSnapshotState({ exists: true, fromCache: false, uid: 'orgFicticioA' }), 'ready');
  assert.equal(SHARE_TOKEN_WAIT_MS, 12_000);
  assert.equal(SHARE_TOKEN_LOOKUP_MS, 5_000);
  assert.equal(SHARE_TOKEN_LOAD_ERROR, 'No se pudieron cargar los partidos.');
});

test('getDoc al servidor: un uid es listo; un miss de caché no es definitivo', () => {
  assert.equal(shareTokenFromServerSnap({
    exists: () => true,
    data: () => ({ uid: 'orgFicticioA', name: 'Gus' }),
    metadata: { fromCache: false },
  }).status, 'ready');
  assert.equal(shareTokenFromServerSnap({
    exists: () => true,
    data: () => ({ uid: 'orgFicticioA', name: 'Gus' }),
    metadata: { fromCache: false },
  }).data.name, 'Gus');
  assert.equal(shareTokenFromServerSnap({
    exists: () => false,
    data: () => null,
    metadata: { fromCache: true },
  }).status, 'pending');
  assert.equal(shareTokenFromServerSnap({
    exists: () => false,
    data: () => null,
    metadata: { fromCache: false },
  }).status, 'missing');
  assert.equal(shareTokenFromServerSnap({
    exists: () => true,
    data: () => ({ name: 'Gus' }),
    metadata: { fromCache: false },
  }).status, 'missing');
});

test('después de esperar: getDoc con uid gana; si el servidor no lo tiene, no se prueba REST; si getDoc falla, entra REST', async () => {
  const ready = { status: 'ready', data: { uid: 'orgFicticioA', name: 'Gus' } };
  const missing = { status: 'missing' };
  let restCalls = 0;
  const rest = async () => { restCalls += 1; return ready; };

  assert.deepEqual(await resolveShareTokenAfterWait({
    getFromServer: async () => ready,
    getFromRest: rest,
  }), ready);
  assert.equal(restCalls, 0);

  assert.deepEqual(await resolveShareTokenAfterWait({
    getFromServer: async () => missing,
    getFromRest: rest,
  }), missing);
  assert.equal(restCalls, 0);

  assert.deepEqual(await resolveShareTokenAfterWait({
    getFromServer: async () => { throw new Error('unavailable'); },
    getFromRest: rest,
  }), ready);
  assert.equal(restCalls, 1);

  restCalls = 0;
  assert.deepEqual(await resolveShareTokenAfterWait({
    getFromServer: async () => ({ status: 'pending' }),
    getFromRest: rest,
  }), ready);
  assert.equal(restCalls, 1);

  assert.deepEqual(await resolveShareTokenAfterWait({
    getFromServer: async () => { throw new Error('unavailable'); },
    getFromRest: async () => { throw new Error('offline'); },
  }), { status: 'error' });
});

test('REST: arma la URL, lee uid y name, 404 es missing, otro error no cierra como missing', async () => {
  const url = shareTokenRestUrl({
    host: '127.0.0.1:8181',
    ssl: false,
    projectId: 'demo-share-fallback-v263',
    token: 'tokenFicticioOrganiz0001',
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:8181\/v1\/projects\/demo-share-fallback-v263\/databases\/\(default\)\/documents\/shareTokens\/tokenFicticioOrganiz0001$/);
  assert.deepEqual(shareTokenFromRestDocument({
    fields: { uid: { stringValue: 'orgFicticioA' }, name: { stringValue: 'Gus' } },
  }), { uid: 'orgFicticioA', name: 'Gus' });

  const found = await fetchShareTokenRest({
    host: 'example.test',
    projectId: 'demo-share-fallback-v263',
    token: 'tokenFicticioOrganiz0001',
    fetch: async () => ({
      status: 200,
      ok: true,
      json: async () => ({ fields: { uid: { stringValue: 'orgFicticioA' }, name: { stringValue: 'Gus' } } }),
    }),
  });
  assert.deepEqual(found, { status: 'ready', data: { uid: 'orgFicticioA', name: 'Gus' } });

  const miss = await fetchShareTokenRest({
    host: 'example.test',
    projectId: 'demo-share-fallback-v263',
    token: 'tokenFicticioInexistente01',
    fetch: async () => ({ status: 404, ok: false, json: async () => ({}) }),
  });
  assert.deepEqual(miss, { status: 'missing' });

  const denied = await fetchShareTokenRest({
    host: 'example.test',
    projectId: 'demo-share-fallback-v263',
    token: 'tokenFicticioOrganiz0001',
    fetch: async () => ({ status: 403, ok: false, json: async () => ({}) }),
  });
  assert.equal(denied.status, 'error');
  assert.equal(denied.code, 403);
});

test('Firestore arranca con long polling y caché persistente; a los 12 s no se falla sin getDoc/REST', () => {
  const settings = firestoreInitSettings({
    persistentLocalCache: (opts) => ({ kind: 'persistent', opts }),
    persistentMultipleTabManager: () => ({ kind: 'tabs' }),
  });
  assert.equal(settings.experimentalAutoDetectLongPolling, true);
  assert.equal(settings.localCache.kind, 'persistent');

  const store = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  assert.match(store, /experimentalAutoDetectLongPolling: true/);
  assert.match(store, /getDoc\(doc\(this\.db, 'shareTokens', tok\), \{ source: 'server' \}\)/);
  assert.match(store, /resolveShareTokenAfterWait\(/);
  assert.match(store, /_getShareTokenFromRest\(/);
  const timerAt = store.indexOf('this._shareWaitTimer = setTimeout');
  assert.ok(timerAt >= 0);
  const timer = store.slice(timerAt, timerAt + 280);
  assert.match(timer, /lookupShareAfterWait/);
  assert.doesNotMatch(timer, /failShare\(\);/);
  assert.match(store, /__F7C_SHARE_TEST_CACHE_MISS/);
  assert.doesNotMatch(store, /clearIndexedDbPersistence/);
});

test('REST también lee una ficha y una consulta de partidos', async () => {
  const docUrl = firestoreRestDocUrl({
    host: '127.0.0.1:8181',
    ssl: false,
    projectId: 'demo-share-fallback-v263',
    segments: ['roster', 'FicticioJugadorUno001'],
  });
  assert.match(docUrl, /\/documents\/roster\/FicticioJugadorUno001$/);
  const q = guestPlanToStructuredQuery({
    collection: 'matches',
    filters: [
      { field: 'createdByUid', op: '==', value: 'orgFicticioA' },
      { field: 'date', op: '>=', value: '2026-11-30' },
    ],
    orderBy: ['date', 'asc'],
  });
  assert.equal(q.from[0].collectionId, 'matches');
  assert.equal(q.where.compositeFilter.op, 'AND');
  assert.equal(q.where.compositeFilter.filters[0].fieldFilter.op, 'EQUAL');
  assert.equal(q.orderBy[0].field.fieldPath, 'date');

  const doc = await fetchFirestoreRestDocument({
    host: 'example.test',
    projectId: 'demo-share-fallback-v263',
    segments: ['roster', 'FicticioJugadorUno001'],
    fetch: async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        name: 'projects/demo-share-fallback-v263/databases/(default)/documents/roster/FicticioJugadorUno001',
        fields: { name: { stringValue: 'Ficticio Uno' }, createdByUid: { stringValue: 'orgFicticioA' } },
      }),
    }),
  });
  assert.equal(doc.status, 'ready');
  assert.equal(doc.data.name, 'Ficticio Uno');
  assert.equal(doc.data.id, 'FicticioJugadorUno001');

  const list = await fetchFirestoreRestQuery({
    host: 'example.test',
    projectId: 'demo-share-fallback-v263',
    plan: { collection: 'matches', filters: [{ field: 'viewers', op: 'array-contains', value: '*' }] },
    fetch: async () => ({
      status: 200,
      ok: true,
      json: async () => ([{
        document: {
          name: 'projects/demo/databases/(default)/documents/matches/2026-12-01_2000',
          fields: { date: { stringValue: '2026-12-01' }, viewers: { arrayValue: { values: [{ stringValue: '*' }] } }, playerVisible: { booleanValue: true } },
        },
      }]),
    }),
  });
  assert.equal(list.status, 'ready');
  assert.equal(list.data[0].id, '2026-12-01_2000');
  assert.equal(list.data[0].playerVisible, true);
  assert.deepEqual(list.data[0].viewers, ['*']);
});
