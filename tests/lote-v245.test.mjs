// v245: pedidos 4, 12, 19 y el del suspendido (14:50 del 23/11). Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activeSuspenderUids, guestLinkBlocked, guestMatchesAllowed, matchOrganizerUids, suspendFlagId } from '../js/guest-block.js';
import { monthIsReady, statsRangesFor, yearMonths } from '../js/stats-range.js';
import { FirebaseStore, createDemoStore } from '../js/store.js';
import { playerMoneyAll } from '../js/ledger.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function memoryStorage() {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  return mem;
}

// ── Suspendido: Autoservicio ──
test('suspendido: la marca es {ficha}_{organizador} y saca los partidos de quien lo suspendió', () => {
  assert.equal(suspendFlagId('ficha123', 'gus'), 'ficha123_gus');
  assert.equal(suspendFlagId('', 'gus'), '');
  assert.deepEqual(matchOrganizerUids({ createdByUid: 'gus', adders: ['*', 'mar', 'gus'] }), ['gus', 'mar']);
  const matches = [
    { id: 'g', createdByUid: 'gus', adders: ['gus'] },
    { id: 'm', createdByUid: 'mar', adders: ['mar'] },
    { id: 'gm', createdByUid: 'mar', adders: ['mar', 'gus'] },
  ];
  assert.deepEqual(guestMatchesAllowed(matches, ['gus']).map((m) => m.id), ['m']);
  assert.deepEqual(guestMatchesAllowed(matches, []).map((m) => m.id), ['g', 'm', 'gm']);
  assert.equal(guestLinkBlocked({ uid: 'gus' }, ['gus']), true);
  assert.equal(guestLinkBlocked({ uid: 'mar' }, ['gus']), false);
  assert.equal(guestLinkBlocked(null, ['gus']), false);
  assert.deepEqual(activeSuspenderUids([
    { rosterId: 'r1', ownerUid: 'gus', suspended: true },
    { rosterId: 'r1', ownerUid: 'mar', suspended: false },
    { rosterId: 'r2', ownerUid: 'mar', suspended: true },
  ], 'r1'), ['gus']);
});

test('suspendido: la página del jugador consulta la marca de a un documento, una vez por organizador', async () => {
  const store = new FirebaseStore();
  const asked = [];
  store.db = {};
  store.fs = {
    doc: (_db, col, id) => ({ col, id }),
    getDoc: async (ref) => { asked.push(`${ref.col}/${ref.id}`); return { exists: () => ref.id === 'ficha1_gus' }; },
  };
  store._guest = true;
  store._guestRosterId = 'ficha1';
  assert.equal(await store._checkGuestBlocks(['gus', 'mar', 'gus']), true);
  assert.equal(await store._checkGuestBlocks(['gus', 'mar']), false);
  assert.deepEqual(asked.sort(), ['suspendFlags/ficha1_gus', 'suspendFlags/ficha1_mar']);
  assert.deepEqual(store.guestBlockedUids(), ['gus']);
});

test('suspendido: suspender y levantar escriben y borran la marca; las viejas se marcan una vez', async () => {
  memoryStorage();
  const store = new FirebaseStore();
  const writes = [];
  store.db = {};
  store.actor = { uid: 'gus', name: 'Gustavo', role: 'organizer' };
  store.fs = {
    doc: (_db, col, id) => ({ col, id }),
    setDoc: async (ref, data) => { writes.push(['set', `${ref.col}/${ref.id}`, data]); },
    deleteDoc: async (ref) => { writes.push(['del', `${ref.col}/${ref.id}`]); },
  };
  store.state.suspensions = [
    { id: 'r1_gus', rosterId: 'r1', ownerUid: 'gus', suspended: true },
    { id: 'r2_gus', rosterId: 'r2', ownerUid: 'gus', suspended: false },
    { id: 'r3_mar', rosterId: 'r3', ownerUid: 'mar', suspended: true },
  ];
  assert.equal(await store.syncSuspendFlags(), 1);
  assert.equal(await store.syncSuspendFlags(), 0);
  const again = new FirebaseStore();
  Object.assign(again, { db: store.db, actor: store.actor, fs: store.fs });
  again.state.suspensions = store.state.suspensions;
  assert.equal(await again.syncSuspendFlags(), 0, 'el mismo teléfono no la vuelve a escribir');
  assert.deepEqual(writes.map((w) => w.slice(0, 2)), [['set', 'suspendFlags/r1_gus']]);
  assert.deepEqual(Object.keys(writes[0][2]).sort(), ['at', 'ownerUid', 'rosterId']);
  assert.equal(await store._setSuspendFlag('r9', 'gus', false), true);
  assert.deepEqual(writes.at(-1), ['del', 'suspendFlags/r9_gus']);
  store.fs.setDoc = async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); };
  assert.equal(await store._setSuspendFlag('r9', 'gus', true), false, 'sin la regla publicada no corta la suspensión');
});

test('suspendido: en demo, el link de quien lo suspendió dice NO TENÉS ACCESO y el resto sigue', async () => {
  memoryStorage();
  const store = createDemoStore();
  store.key = 'f7c-test-v245-susp';
  store.setActor({ uid: 'gustavo', name: 'Gustavo', role: 'admin' });
  const id = await store.addRoster({ name: 'Ficticio Suspendido', phone: '5491100000045' }, 'Gustavo');
  await store.setSuspension(id, { note: 'Faltó sin avisar', date: '2026-11-20' });
  store.setActor(null);
  store.listenAsGuest(id, '', '');
  assert.deepEqual(store.guestBlockedUids(), ['gustavo']);
  store.setActor({ uid: 'gustavo', name: 'Gustavo', role: 'admin' });
  await store.setSuspended(id, false, 'Pidió disculpas');
  store.setActor(null);
  assert.deepEqual(store.guestBlockedUids(), []);
  assert.match(app, /function renderPlayerSignup\(person\) \{\n  \/\/ v245[^\n]*\n  if \(guestLinkBlocked\(linkOrganizer\(\), guestBlocked\(\)\)\) \{\n    showAnonymousDenial\(\);/);
  assert.match(app, /matches: guestMatchesAllowed\(app\.matches, guestBlocked\(\)\),/);
  assert.ok(sw.includes("'js/guest-block.js'"));
});

test('suspendido: rojo y «(suspendido)» en toda la app, lo haya suspendido quien sea', () => {
  const body = app.slice(app.indexOf('function suspendedClass(source) {'), app.indexOf('function suspendedName(source, name) {'));
  assert.match(body, /return activeSuspensions\(app\.suspensions, rosterId\)\.length \? ' suspended' : '';/);
  assert.doesNotMatch(body, /blockingSuspensions\(/);
  // Equipos, la lista a confirmar, la espera, el aviso de cancelación, invitados y la compensación.
  assert.match(app, /class="team-name\$\{suspendedClass\(player\)\}"/);
  assert.match(app, /<p class="pending-name\$\{suspendedClass\(player\)\}">\$\{suspendedName\(player, shownName\(player\)\)\}<\/p>/);
  assert.match(app, /\$\{playerNameHtml\(player, shownName\(player\)\)\} se anotó en la lista de espera/);
  assert.match(app, /<h3>Invitados de \$\{playerNameHtml\(host, host\.name\)\}<\/h3>/);
  // Estadísticas: Jugador usa la ficha con la marca.
  assert.match(app, /id="stats-player">\$\{fichaName\(person, person\.name\)\}/);
});

test('suspendido: reglas de suspendFlags (get suelto, sin lista; solo el dueño escribe)', () => {
  const block = rules.slice(rules.indexOf('match /suspendFlags/{flagId}'), rules.indexOf('function validSuspensionHistory'));
  assert.match(block, /allow get: if true;/);
  assert.doesNotMatch(block, /allow list/);
  assert.match(block, /hasOnly\(\['ownerUid', 'rosterId', 'at'\]\)/);
  assert.match(block, /flagId == request\.resource\.data\.rosterId \+ '_' \+ request\.auth\.uid/);
});

// ── Pedido 12 ──
test('pedido 12: alta directa en No jugó pero pagó, sin lugar, sin espera y sin mover al reemplazo', async () => {
  const mem = memoryStorage();
  const store = createDemoStore();
  store.key = 'f7c-test-v245-noplay';
  store.setActor({ uid: 'gustavo', name: 'Gustavo', role: 'admin' });
  const match = { id: await store.addMatch({ date: '2026-11-21', time: '21:00', capacity: 2 }, 'Gustavo'), date: '2026-11-21', capacity: 2 };
  await store.addPlayer(match, { name: 'Ficticio Uno' }, 'Gustavo');
  await store.addPlayer(match, { name: 'Ficticio Dos' }, 'Gustavo');
  const waitId = await store.addPlayer(match, { name: 'Ficticio Espera' }, 'Gustavo');
  const rosterId = await store.addRoster({ name: 'Ficticio Bajado', phone: '5491100000046' }, 'Gustavo');
  await store.setSuspension(rosterId, { note: 'Faltó', date: '2026-11-21' });
  const pid = await store.addPlayer(match, { name: 'Ficticio Bajado', rosterId }, 'Gustavo', { noPlay: true });
  const db = JSON.parse(mem.get('f7c-test-v245-noplay'));
  assert.equal(db.players[pid].noPlay, true);
  assert.equal(db.players[pid].waiting, false);
  assert.equal(db.players[pid].tentative, undefined);
  assert.equal(db.players[waitId].waiting, true, 'el de la espera sigue en la espera');
  const log = Object.values(db.log).find((row) => row.playerName === 'Ficticio Bajado');
  assert.equal(log?.detail, 'No jugó pero pagó');
  // Dos veces la misma persona no.
  await assert.rejects(() => store.addPlayer(match, { name: 'Ficticio Bajado', rosterId }, 'Gustavo', { noPlay: true }));
});

test('pedido 12: botón en el partido, Cargar pago al terminar y Recalcular la compensación guardada', () => {
  assert.match(app, /id="no-play-add">Agregar a No jugó pero pagó<\/button>/);
  assert.match(app, /app\.store\.addPlayer\(m, data, app\.who, \{ noPlay: true \}\)/);
  assert.match(app, /if \(typeof pid === 'string' && pid\) openNoPlayPayment\(m, pid\);/);
  assert.match(app, /return now === saved\.fingerprint \? saved : \{ \.\.\.saved, changed: true, stale: true \};/);
  assert.match(app, /id="comp-redo" data-comp-make=/);
  assert.match(rules, /'shareToken', 'linkKey', 'noPlay'\]\)/);
});

// ── Pedido 19 ──
test('pedido 19: el año se pide de a un mes y un mes cuenta solo cuando está entero', () => {
  assert.deepEqual(yearMonths('2026', '2026-03-10'), ['2026-03', '2026-02', '2026-01']);
  assert.equal(yearMonths('2025', '2026-03-10').length, 12);
  assert.deepEqual(yearMonths('2027', '2026-03-10'), []);
  const ranges = statsRangesFor({ mode: 'anio', today: '2026-03-10' });
  assert.deepEqual(ranges, [
    { from: '2026-03-01', to: '2026-03-09' },
    { from: '2026-02-01', to: '2026-02-28' },
    { from: '2026-01-01', to: '2026-01-31' },
  ]);
  const done = new Set(['2026-02-01']);
  const ready = (from) => done.has(from);
  assert.equal(monthIsReady('2026-02', '2026-03-10', ready), true);
  assert.equal(monthIsReady('2026-01', '2026-03-10', ready), false);
  assert.equal(monthIsReady('2026-04', '2026-03-10', ready), true, 'un mes sin días pasados no espera nada');
  assert.equal(monthIsReady('2026-01', '2026-03-10', null), true, 'demo: todo está en memoria');
});

test('pedido 19: el store dice si un rango ya está y la app no muestra meses a medias', () => {
  const store = new FirebaseStore();
  store.fs = { getDocs: () => {} };
  store.db = {};
  store.actor = { uid: 'gus' };
  store._historyBounds = { mode: 'recent' };
  store._historySeen = true;
  store.state.historyHasMore = true;
  store._historyCursor = '2026-11-09';
  assert.equal(store.statsRangeReady('2026-11-10', '2026-11-22'), true);
  assert.equal(store.statsRangeReady('2026-11-01', '2026-11-22'), false);
  store._statsCovered = [{ from: '2026-11-01', to: '2026-11-08' }];
  assert.equal(store.statsRangeReady('2026-11-01', '2026-11-22'), true);
  assert.equal(store.statsRangeReady('2026-10-01', '2026-10-31'), false);
  store.state.historyLoading = true;
  assert.equal(store.statsRangeReady('2026-11-10', '2026-11-22'), false, 'mientras carga el historial, no');
  assert.match(app, /dates\.filter\(\(date\) => statsMonthReady\(date\.slice\(0, 7\)\)\)/);
  assert.match(app, /const shown = grain === 'month' \? buckets\.filter\(\(bucket\) => ready\(bucket\.key\)\) : buckets;/);
  assert.match(app, /Sumando los meses… el total puede cambiar/);
  assert.match(app, /new IntersectionObserver/);
  assert.match(app, /id="stats-older" data-stats-older="1">Cargar más<\/button>/);
});


test('pedido 4: «Pagó $X en N partidos» suma lo pagado y lo que debe con todos los organizadores', () => {
  const staff = [{ uid: 'gus', name: 'Gustavo' }, { uid: 'mar', name: 'Martín' }];
  const matches = [
    { id: 'm1', date: '2026-10-01', time: '20:00', price: 5000, createdByUid: 'gus' },
    { id: 'm2', date: '2026-10-08', time: '20:00', price: 5000, createdByUid: 'mar' },
    { id: 'm3', date: '2026-10-15', time: '20:00', price: 5000, createdByUid: 'mar' },
    { id: 'm4', date: '2026-10-22', time: '20:00', price: 5000, createdByUid: 'gus' },
  ];
  const base = { rosterId: 'ros-ficticio-0001', name: 'Ficticio Pago' };
  const players = [
    // Se anotó con Gustavo y le pagó a Martín: el pago es de Martín.
    { ...base, id: 'p1', matchId: 'm1', addedByUid: 'gus', addedBy: 'Gus', signedUpWith: 'gus', signedUpWithName: 'Gus', paid: true, amount: 5000, cash: 5000, cashTo: 'Martín', transfer: 0 },
    // Pagó a Martín.
    { ...base, id: 'p2', matchId: 'm2', addedByUid: 'mar', addedBy: 'Martín', signedUpWith: 'mar', signedUpWithName: 'Martín', paid: true, amount: 5000, transfer: 5000, transferTo: 'Martín', cash: 0 },
    // Le debe a Martín.
    { ...base, id: 'p3', matchId: 'm3', addedByUid: 'mar', addedBy: 'Martín', signedUpWith: 'mar', signedUpWithName: 'Martín' },
    // Le debe a Gustavo (anotado como «Gus»).
    { ...base, id: 'p4', matchId: 'm4', addedByUid: 'gus', addedBy: 'Gus', signedUpWith: 'gus', signedUpWithName: 'Gus' },
    // En espera: ni pagó ni debe.
    { ...base, id: 'p5', matchId: 'm4', waiting: true, addedByUid: 'gus', addedBy: 'Gus' },
    // Otro jugador: no entra.
    { id: 'x', matchId: 'm4', rosterId: 'ros-ficticio-0002', name: 'Otro Ficticio', paid: true, amount: 5000, cash: 5000, cashTo: 'Gustavo', transfer: 0 },
  ];
  const money = playerMoneyAll({ person: { id: base.rosterId, name: base.name }, players, matches, prices: {}, staff });
  assert.equal(money.text, 'Pagó $10.000 en 2 partidos · Debe $10.000 en 2 partidos');
  const byUid = Object.fromEntries(money.rows.map((row) => [row.uid, row]));
  assert.deepEqual([byUid.mar.paid, byUid.mar.owed], [10000, 5000]);
  assert.deepEqual([byUid.gus.paid, byUid.gus.owed], [0, 5000]);
  assert.equal(byUid.gus.name, 'Gustavo', '«Gus» y «Gustavo» son la misma cuenta');
  assert.equal(money.rows.length, 2);
  // Un solo pago a otro organizador: singular y cuenta igual.
  const one = playerMoneyAll({ person: { id: base.rosterId, name: base.name }, players: [players[1]], matches, prices: {}, staff });
  assert.equal(one.text, 'Pagó $5.000 en 1 partido');
  const none = playerMoneyAll({ person: { id: 'ros-nadie-000000001', name: 'Nadie' }, players, matches, prices: {}, staff });
  assert.equal(none.text, 'Sin pagos cargados');
});

test('pedido 4: la línea de la ficha ya no filtra por el organizador logueado', () => {
  const body = app.slice(app.indexOf('function profilePayLine'), app.indexOf('function profileMoney'));
  assert.match(body, /playerMoneyAll\(/);
  assert.doesNotMatch(body, /organizer:\s*/);
  assert.match(app, /\$\{profilePayLine\(person\)\}/);
  assert.doesNotMatch(app, /id="stat-pay">\$\{esc\(record\.paidText\)\}/);
  assert.doesNotMatch(app, /profilePaidHtml|id="profile-paid"/, 'sin el bloque aparte');
});
