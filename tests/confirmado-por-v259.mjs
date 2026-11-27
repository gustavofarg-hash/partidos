// v259: «Confirmado (por …)» siempre en el Autoservicio, y el «Sí, juego» del link
// ya no confirma un lugar pendiente. Solo el emulador. Datos ficticios.
// - Un alta del Autoservicio pendiente que respondió «Sí» sigue pendiente con la
//   app del organizador abierta (antes se soltaba sola, sin quién la aceptó).
// - Subir al partido desde la lista de espera guarda acceptedBy con el organizador.
// - Una fila confirmada sin acceptedBy muestra al organizador del link.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/confirmado-por-v259.mjs http://127.0.0.1:18590/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18590/';
refuseRealTarget(BASE);

const PROJECT = 'demo-confirmado-por-v259';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const [fsHost, fsPort] = host.split(':');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc } = await import('firebase/firestore');
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: fsHost, port: Number(fsPort) },
});

const EMAIL = 'organizador@ficticio.test';
const PASS = 'clave-ficticia-259';
const ORG = 'Gus Ficticio';
const RID = 'FicticioJugadorUno001';
const TOK = 'tokenFicticioOrganiz0001';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 2 * 864e5));
const P = `${day}_1700`;
const Q = `${day}_1800`;
const R = `${day}_1900`;

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const GUS = (await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json()).localId;
const match = (time) => ({ date: day, time, note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [GUS], createdByUid: GUS, createdBy: ORG, playerVisible: true, playerCount: 1 });
const self = (matchId, extra) => ({
  matchId, matchDate: day, name: 'Ficticio Uno', rosterId: RID, selfSignup: true,
  waiting: false, waitOrder: null, tentative: null, tentativeAt: null, rosterAt: 1,
  addedByUid: GUS, addedBy: ORG, signedUpWith: GUS, signedUpWithName: ORG, shareToken: TOK,
  createdAt: 1, updatedAt: 1, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false,
  confirmToken: `tokFicticio${matchId.slice(-4)}000000000`, viewers: ['*'], adders: [GUS], ...extra,
});
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', GUS, { role: 'organizer', name: ORG, email: EMAIL, active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Ficticio Uno', createdBy: ORG, createdByUid: GUS, holders: [GUS], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: GUS, phoneShared: false });
  await put('shareTokens', TOK, { uid: GUS, name: ORG, createdAt: 1 });
  await put('matches', P, match('17:00'));
  await put('matches', Q, { ...match('18:00'), playerCount: 0 });
  await put('matches', R, match('19:00'));
  // 17:00: pendiente del Autoservicio que ya respondió «Sí» por el link.
  await put('players', 'filaPend', self(P, { tentative: true, tentativeAt: 1, confirmed: 'si', confirmedAt: 2 }));
  // 18:00: en lista de espera.
  await put('players', 'filaEspera', self(Q, { waiting: true, waitOrder: 1, rosterAt: null }));
  // 19:00: confirmada antes de que se guardara quién (sin acceptedBy).
  await put('players', 'filaVieja', self(R, {}));
});
const read = async (id) => {
  let out = null;
  await testEnv.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), 'players', id)); out = s.exists() ? s.data() : null; });
  return out;
};

const browser = await chromium.launch();
const pageErrors = [];
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
  }, { firestore: host, auth: authHost });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (r) => r.abort());
  await ctx.route(/https?:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => r.fulfill({ contentType: 'text/plain', body: 'ok' }));
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  return { ctx, page };
}
try {
  const { ctx, page } = await newPage();
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded && ['filaPend', 'filaEspera', 'filaVieja'].every((id) => window.__app.players?.some((p) => p.id === id)), null, { timeout: 20000 });
  // Con la app abierta un rato, el «Sí» no suelta el lugar.
  await page.evaluate((id) => { location.hash = `#/partido/${id}`; }, P);
  await page.waitForSelector('[data-confirm-spot="filaPend"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const pend = await read('filaPend');
  check('El «Sí» del link no confirma el pendiente: sigue pendiente', pend?.tentative === true, `tentative=${pend?.tentative}`);
  check('Y no se inventa quién lo aceptó', !('acceptedBy' in (pend || {})));
  check('Sigue el botón «Confirmar lugar»', await page.locator('[data-confirm-spot="filaPend"]').count() === 1);
  const said = await page.locator('.reserved-said').allTextContents();
  check('Se ve que respondió que juega, como dato', said.some((t) => t.includes('Respondió que juega')), said.join(' | '));
  // Subir al partido desde la lista de espera.
  await page.evaluate((id) => { location.hash = `#/partido/${id}`; }, Q);
  await page.waitForSelector('[data-promote="filaEspera"]', { timeout: 15000 });
  await page.click('[data-promote="filaEspera"]');
  let up = null;
  for (let i = 0; i < 20; i++) { up = await read('filaEspera'); if (up?.waiting === false) break; await page.waitForTimeout(500); }
  check('Pasa al partido', up?.waiting === false && up?.waitOrder === null);
  check('Guarda quién lo pasó (acceptedBy)', up?.acceptedBy === ORG, String(up?.acceptedBy));
  await ctx.close();

  // El jugador abre su Autoservicio (sin sesión).
  const player = await newPage();
  await player.page.goto(`${BASE}autoservicio/#/jugador/${RID}/${TOK}`);
  await player.page.waitForSelector(`#self-list li[data-match="${R}"] .self-status`, { timeout: 25000 });
  await player.page.waitForTimeout(1500);
  const note = async (id) => (await player.page.locator(`#self-list li[data-match="${id}"] .self-status`).textContent().catch(() => '')) || '';
  const nP = await note(P); const nQ = await note(Q); const nR = await note(R);
  check('Autoservicio: el pendiente que dijo «Sí» sigue pendiente', /Esperando la confirmación/.test(nP), nP);
  check('Autoservicio: el que subió de la espera dice «Confirmado (por Gus)»', nQ === 'Confirmado (por Gus)', nQ);
  check('Autoservicio: el viejo sin acceptedBy dice «Confirmado (por Gus)» (organizador del link)', nR === 'Confirmado (por Gus)', nR);
  await player.ctx.close();
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
