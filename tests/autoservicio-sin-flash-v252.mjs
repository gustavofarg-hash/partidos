// v252: al entrar por Autoservicio no aparece, ni un instante, «NO TENÉS ACCESO»
// con un link válido; sigue apareciendo con uno que de verdad no sirve.
// Con sesión (el celular de un organizador) pasaba: la app dibujaba antes de que
// llegara Jugadores. Solo el emulador. Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/autoservicio-sin-flash-v252.mjs http://127.0.0.1:18452/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18452/';
refuseRealTarget(BASE);

const PROJECT = 'demo-sin-flash';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const [fsHost, fsPort] = host.split(':');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, setDoc } = await import('firebase/firestore');
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: fsHost, port: Number(fsPort) },
});

const EMAIL = 'organizador@ficticio.test';
const PASS = 'clave-ficticia-252';
const RID = 'FicticioJugadorUno001';
const RIDK = 'FicticioJugadorDos002';
const RIDM = 'FicticioDeMartin0003';
const TOK = 'tokenFicticioGustavo0001';
const KEY = 'claveFicticia0001';
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 864e5));

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const account = await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json();
const GUS = account.localId;
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const put = (path, id, data) => setDoc(doc(db, path, id), data);
  await put('users', GUS, { role: 'organizer', name: 'Gustavo', email: EMAIL, active: true, createdAt: 1 });
  await put('users', 'mar', { role: 'organizer', name: 'Martín', active: true, createdAt: 1 });
  const ficha = (name, uid, by) => ({ name, createdBy: by, createdByUid: uid, holders: [uid], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: uid, phoneShared: false });
  await put('roster', RID, ficha('Ficticio Uno', GUS, 'Gustavo'));
  await put('roster', RIDK, ficha('Ficticio Dos', GUS, 'Gustavo'));
  await put('roster', RIDM, ficha('Ficticio De Martín', 'mar', 'Martín'));
  // Link reseteado: con la clave vigente anda; con una vieja, «link inválido».
  await put('rosterLocks', RIDK, { key: KEY, at: 1 });
  await put('rosterLinks', RIDK, { locked: true, at: 1 });
  await setDoc(doc(db, 'rosterLinks', RIDK, 'k', KEY), { name: 'Ficticio Dos', shortName: '', holders: [GUS], createdByUid: GUS, phoneKey: '', hasPhone: false });
  await put('shareTokens', TOK, { uid: GUS, name: 'Gustavo', createdAt: 1 });
  await put('matches', 'm-gus', { date: tomorrow, time: '20:00', note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [GUS], createdByUid: GUS, createdBy: 'Gustavo', playerVisible: true, playerCount: 0 });
});

const browser = await chromium.launch();
async function open(hash, { login = false, delay = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires', serviceWorkers: 'block' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
    // Cada estado de la pantalla desde el primer pintado (MutationObserver + cada cuadro).
    const seen = { states: [] };
    globalThis.__seen = seen;
    const look = () => {
      if (!/#\/jugador\//.test(location.hash)) return;
      const state = document.querySelector('#player-locked') ? 'locked'
        : document.querySelector('#player-signup') ? 'signup'
          : document.querySelector('#player-link-invalid') ? 'invalid'
            : document.querySelector('#player-check-error') ? 'error'
              : document.querySelector('#player-loading, .loading') ? 'loading'
                : document.querySelector('#profile') ? 'profile' : 'other';
      if (seen.states[seen.states.length - 1] !== state) seen.states.push(state);
    };
    const start = () => {
      look();
      new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const tick = () => { look(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  }, { firestore: host, auth: authHost });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (route) => route.abort());
  if (delay) {
    // Red lenta y despareja hacia el emulador: agranda cualquier carrera.
    await ctx.route(/127\.0\.0\.1:(8181|9099)/, async (route) => {
      await new Promise((ok) => setTimeout(ok, Math.random() * delay));
      route.continue().catch(() => {});
    });
  }
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (login) {
    await page.goto(BASE);
    await page.waitForSelector('#login-form', { timeout: 20000 });
    await page.fill('#login-email', EMAIL);
    await page.fill('#login-password', PASS);
    await page.click('#login-form button[type=submit]');
    await page.waitForFunction(() => window.__app?.loaded && window.__app?.session?.user, null, { timeout: 20000 });
    await page.goto('about:blank');
  }
  await page.goto(BASE + hash);
  await page.waitForFunction(() => {
    const s = globalThis.__seen?.states || [];
    return ['signup', 'locked', 'invalid', 'profile'].includes(s[s.length - 1]);
  }, null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const states = await page.evaluate(() => globalThis.__seen.states);
  await ctx.close();
  return { states, final: states[states.length - 1], errors };
}

const pageErrors = [];
try {
  const cases = [
    ['Organizador con sesión, link de un jugador de otro', `#/jugador/${RIDM}/${TOK}`, { login: true }, 'signup'],
    ['…y con la red lenta', `#/jugador/${RIDM}/${TOK}`, { login: true, delay: 500 }, 'signup'],
    ['Organizador con sesión, link de un jugador suyo', `#/jugador/${RID}/${TOK}`, { login: true }, 'profile'],
    ['Jugador sin sesión, link con token', `#/jugador/${RID}/${TOK}`, {}, 'signup'],
    ['…con la red lenta', `#/jugador/${RID}/${TOK}`, { delay: 500 }, 'signup'],
    ['Jugador sin sesión, entrando por /autoservicio/', `autoservicio/#/jugador/${RID}/${TOK}`, {}, 'signup'],
    ['Jugador sin sesión, link reseteado con la clave vigente', `#/jugador/${RIDK}/${TOK}/${KEY}`, { delay: 500 }, 'signup'],
  ];
  for (const [name, hash, opts, want] of cases) {
    const r = await open(hash, opts);
    check(`${name}: termina bien`, r.final === want, r.states.join(' > '));
    check(`${name}: nunca pasó por NO TENÉS ACCESO`, !r.states.includes('locked'), r.states.join(' > '));
    pageErrors.push(...r.errors);
  }
  // Los que de verdad no sirven siguen igual.
  const gone = await open('#/jugador/FicticioNoExiste0099/' + TOK);
  check('Sin sesión, ficha que no existe: NO TENÉS ACCESO', gone.final === 'locked', gone.states.join(' > '));
  const goneOrg = await open('#/jugador/FicticioNoExiste0099/' + TOK, { login: true });
  check('Con sesión, ficha que no existe: NO TENÉS ACCESO (después de Cargando)', goneOrg.final === 'locked' && goneOrg.states.indexOf('locked') === goneOrg.states.length - 1, goneOrg.states.join(' > '));
  const old = await open(`#/jugador/${RIDK}/${TOK}/claveVieja0000001`);
  check('Clave vieja: link inválido', old.final === 'invalid', old.states.join(' > '));
  pageErrors.push(...gone.errors, ...goneOrg.errors, ...old.errors);
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
