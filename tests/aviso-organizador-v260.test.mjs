// v260: «Aceptar» / «Rechazar» desde el aviso del celular guardan qué organizador
// lo recibió y lo tocó: un token por organizador (con su uid), acceptedBy con su
// nombre y el Registro a su nombre en vez de «Desde el aviso».
// Funciones contra el emulador (necesita firebase-admin y firebase-functions en
// functions/node_modules):
// firebase emulators:exec --project demo-f7c --only firestore "node --test tests/aviso-organizador-v260.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recipientGroups, decisionWrites, organizerLabel, organizerUids } = require('../functions/logic.js');

test('un grupo de celulares por organizador; sin celulares, nada', () => {
  const rows = [
    { uid: 'b', token: 't3' }, { uid: 'a', token: 't1' }, { uid: 'a', token: 't2' },
    { uid: 'x', token: 't9' }, { uid: 'c', token: '' },
  ];
  assert.deepEqual(recipientGroups(['a', 'b', 'c'], rows).map((g) => [g.uid, g.rows.map((r) => r.token)]), [['a', ['t1', 't2']], ['b', ['t3']]]);
  assert.deepEqual(recipientGroups(['solo'], rows), []);
  // Con organizador del link, solo él (como antes).
  assert.deepEqual(organizerUids({ createdByUid: 'a', adders: ['b'] }, [], 'link'), ['link']);
});

test('qué escribe la decisión', () => {
  assert.equal(organizerLabel('  Martín   Ficticio '), 'Martín Ficticio');
  assert.deepEqual(decisionWrites({ uid: 'u1' }, 'aceptar', 'Martín Ficticio', 7), {
    playerPatch: { tentative: null, tentativeAt: null, updatedAt: 7, acceptedBy: 'Martín Ficticio' },
    actorUid: 'u1', actorName: 'Martín Ficticio',
  });
  assert.deepEqual(decisionWrites({ uid: 'u1' }, 'rechazar', 'Martín Ficticio', 7), { playerPatch: null, actorUid: 'u1', actorName: 'Martín Ficticio' });
  // Token de antes de v260 (sin uid) o sin nombre: como antes.
  assert.deepEqual(decisionWrites({}, 'aceptar', 'Martín Ficticio', 7), {
    playerPatch: { tentative: null, tentativeAt: null, updatedAt: 7 }, actorUid: 'aviso', actorName: 'Desde el aviso',
  });
  assert.deepEqual(decisionWrites({ uid: 'u1' }, 'aceptar', '', 7).actorName, 'Desde el aviso');
});

function loadFunctions(t) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) { t.skip('sin emulador de Firestore'); return null; }
  process.env.GCLOUD_PROJECT ||= 'demo-aviso-v260';
  let messaging;
  try { messaging = require('../functions/node_modules/firebase-admin/lib/messaging/index.js'); }
  catch { t.skip('sin firebase-admin en functions/node_modules'); return null; }
  const sent = [];
  const fake = { sendEachForMulticast: async (msg) => { sent.push(msg); return { responses: msg.tokens.map(() => ({ success: true })) }; } };
  Object.defineProperty(messaging, 'getMessaging', { value: () => fake, configurable: true, writable: true });
  const fns = require('../functions/index.js');
  const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore/index.js');
  return { fns, db: getFirestore(), sent };
}

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      getHeader: (k) => headers[k.toLowerCase()],
      removeHeader: (k) => { delete headers[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; },
      send(data) { resolve({ status: this.statusCode, data }); return this; },
      end() { resolve({ status: this.statusCode }); return this; },
      on() {}, once() {}, emit() {},
    };
    const req = { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://ficticio.test' }, body, url: '/', get: (k) => req.headers[k.toLowerCase()], header: (k) => req.headers[k.toLowerCase()] };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('funciones (emulador): token por organizador; Aceptar y Rechazar a su nombre', async (t) => {
  const env = loadFunctions(t);
  if (!env) return;
  const { fns, db, sent } = env;
  for (const col of ['users', 'matches', 'players', 'signupActions', 'organizerTokens', 'log', 'signupPings', 'roster']) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const day = '2026-12-08';
  await db.doc('users/orgA').set({ role: 'organizer', name: 'Martín Ficticio', active: true });
  await db.doc('users/orgB').set({ role: 'organizer', name: 'Gus Ficticio', active: true });
  await db.doc('matches/m1').set({ date: day, time: '18:00', capacity: 14, createdByUid: 'orgB', adders: ['orgA', 'orgB'], venueName: 'Sede Ficticia' });
  await db.doc('organizerTokens/a1').set({ uid: 'orgA', token: 'devA1' });
  await db.doc('organizerTokens/a2').set({ uid: 'orgA', token: 'devA2' });
  await db.doc('organizerTokens/b1').set({ uid: 'orgB', token: 'devB1' });
  const row = { matchId: 'm1', matchDate: day, name: 'Ficticio Uno', rosterId: 'FichaFicticia000001', selfSignup: true, waiting: false, tentative: true, tentativeAt: 1, addedByUid: 'orgA', addedBy: 'Martín Ficticio', signedUpWith: 'orgA', signedUpWithName: 'Martín Ficticio', confirmToken: 'tokFicticio000000001' };
  for (const id of ['p1', 'p2', 'p3', 'p4']) await db.doc(`players/${id}`).set(row);

  const ping = (id, extra) => ({ data: { data: () => ({ kind: 'alta', name: 'Ficticio Uno', playerId: id, rosterId: '', matchId: 'm1', date: day, time: '18:00', venueName: 'Sede Ficticia', createdAt: 1, ...extra }), ref: db.doc(`signupPings/${id}`) }, params: { pingId: id } });
  // Con organizador del link: solo a él, un token con su uid, a sus dos celulares.
  await fns.notifySelfSignup.run(ping('p1', { organizerUid: 'orgA' }));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].tokens, ['devA1', 'devA2']);
  const tokA = sent[0].data.actionToken;
  assert.match(tokA, /^[a-f0-9]{64}$/);
  assert.equal((await db.doc(`signupActions/${tokA}`).get()).data().uid, 'orgA');
  // Sin organizador del link: a todos los del partido, un token distinto cada uno.
  sent.length = 0;
  await fns.notifySelfSignup.run(ping('p2', { organizerUid: '' }));
  assert.equal(sent.length, 2);
  const byDevice = Object.fromEntries(sent.map((m) => [m.tokens.join(','), m.data.actionToken]));
  assert.ok(byDevice['devB1'] && byDevice['devA1,devA2'] && byDevice['devB1'] !== byDevice['devA1,devA2']);
  assert.equal((await db.doc(`signupActions/${byDevice['devB1']}`).get()).data().uid, 'orgB');
  // Organizador del link sin celulares: no se manda nada ni se crea token.
  sent.length = 0;
  const before = (await db.collection('signupActions').get()).size;
  await fns.notifySelfSignup.run(ping('p3', { organizerUid: 'orgSinCelular' }));
  assert.equal(sent.length, 0);
  assert.equal((await db.collection('signupActions').get()).size, before);

  // Aceptar desde el aviso de Martín.
  const ok = await call(fns.decideSignup, { token: tokA, decision: 'aceptar' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const p1 = (await db.doc('players/p1').get()).data();
  assert.equal(p1.tentative, null);
  assert.equal(p1.acceptedBy, 'Martín Ficticio');
  // En p2 acepta Gus con su token: queda a nombre de Gus.
  assert.equal((await call(fns.decideSignup, { token: byDevice['devB1'], decision: 'aceptar' })).status, 200);
  assert.equal((await db.doc('players/p2').get()).data().acceptedBy, 'Gus Ficticio');
  // El otro token del mismo aviso ya no sirve (ya no está pendiente).
  assert.equal((await call(fns.decideSignup, { token: byDevice['devA1,devA2'], decision: 'aceptar' })).status, 409);
  // Token viejo, sin uid: como antes.
  const old = 'a'.repeat(64);
  await db.doc(`signupActions/${old}`).set({ playerId: 'p3', matchId: 'm1', used: false, createdAt: 1, expiresAt: Date.now() + 3600e3 });
  assert.equal((await call(fns.decideSignup, { token: old, decision: 'aceptar' })).status, 200);
  assert.equal('acceptedBy' in (await db.doc('players/p3').get()).data(), false);
  // Rechazar a nombre del organizador.
  const rej = 'b'.repeat(64);
  await db.doc(`signupActions/${rej}`).set({ playerId: 'p4', matchId: 'm1', uid: 'orgA', used: false, createdAt: 1, expiresAt: Date.now() + 3600e3 });
  assert.equal((await call(fns.decideSignup, { token: rej, decision: 'rechazar' })).status, 200);
  assert.equal((await db.doc('players/p4').get()).exists, false);
  const logs = (await db.collection('log').get()).docs.map((d) => d.data());
  const acts = logs.map((l) => [l.type, l.actorName, l.actorUid]).sort((x, y) => String(x).localeCompare(String(y)));
  assert.deepEqual(acts, [
    ['aceptó', 'Desde el aviso', 'aviso'],
    ['aceptó', 'Gus Ficticio', 'orgB'],
    ['aceptó', 'Martín Ficticio', 'orgA'],
    ['rechazó', 'Martín Ficticio', 'orgA'],
  ].sort((x, y) => String(x).localeCompare(String(y))));
});
