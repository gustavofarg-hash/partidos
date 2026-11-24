// v247: Autoservicio de un suspendido: la lista no aparece hasta saber la marca. Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FirebaseStore } from '../js/store.js';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const storeSrc = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');

function guestStore(getDoc) {
  const store = new FirebaseStore();
  store.db = {};
  store.fs = { doc: (_db, col, id) => ({ col, id }), getDoc };
  store._guest = true;
  store._guestRosterId = 'ficha1';
  return store;
}

test('dos pedidos a la vez del mismo organizador esperan la misma respuesta (antes el segundo decía «sin marca»)', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  const store = guestStore(async () => { reads += 1; await gate; return { exists: () => true, metadata: { fromCache: false } }; });
  const first = store._checkGuestBlocks(['gus']);
  const second = store._checkGuestBlocks(['gus']);
  assert.equal(store._guestBlockOf('gus'), 'pending');
  assert.deepEqual(store.guestBlockedUids(), [], 'mientras pregunta no figura suspendido ni libre');
  release();
  assert.equal(await second, true, 'el segundo espera al primero');
  assert.equal(await first, true);
  assert.equal(reads, 1);
  assert.deepEqual(store.guestBlockedUids(), ['gus']);
});

test('si la lectura falla dos veces queda «error», no «sin marca»; sin conexión, «no hay marca» tampoco alcanza', async () => {
  let reads = 0;
  const failing = guestStore(async () => { reads += 1; throw Object.assign(new Error('x'), { code: 'unavailable' }); });
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await failing._checkGuestBlocks(['gus']), true);
  } finally { console.error = quiet; }
  assert.equal(reads, 2, 'un reintento');
  assert.equal(failing._guestBlockOf('gus'), 'error');
  assert.deepEqual(failing.guestBlockedUids(), []);
  const cached = guestStore(async () => ({ exists: () => false, metadata: { fromCache: true } }));
  await cached._checkGuestBlocks(['gus']);
  assert.equal(cached._guestBlockOf('gus'), 'error');
  const live = guestStore(async () => ({ exists: () => false, metadata: { fromCache: false } }));
  assert.equal(await live._checkGuestBlocks(['gus']), false);
  assert.equal(live._guestBlockOf('gus'), 'clear');
});

test('la página del jugador no pinta partidos antes de saber la marca', () => {
  // Store: publica solo con la marca del dueño del link y la de cada organizador de los partidos.
  assert.match(storeSrc, /this\.state\.guestReady = false;/);
  assert.match(storeSrc, /if \(!seen\.roster \|\| !seen\.matches \|\| !seen\.players \|\| !seen\.share \|\| matchesPending\) return;\n      this\.state\.guestReady = true;/);
  assert.match(storeSrc, /every\(\(uid\) => stateOf\(uid\) === 'clear'\)/);
  // App: «Cargando…» mientras tanto, y un aviso si no se pudo saber.
  const guestRender = app.slice(app.indexOf('function render() {'), app.indexOf("if (document.documentElement.classList.contains('signed-out')) unlockShell();"));
  assert.match(guestRender, /if \(app\.guestReady === false\) \{ showGuestLoading\(\); return; \}/);
  assert.ok(guestRender.indexOf('showGuestLoading') < guestRender.indexOf('renderPlayerSignup'));
  const signup = app.slice(app.indexOf('function renderPlayerSignup'), app.indexOf('function confirmNoticesHtml'));
  assert.ok(signup.indexOf('showGuestAccessError') < signup.indexOf('selfSignupSection(person)'));
  assert.match(app, /app\.guestReady = view\.guestReady !== false;/);
});
