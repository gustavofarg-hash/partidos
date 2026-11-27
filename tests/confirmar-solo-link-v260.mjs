// v260: una anotación pendiente del Autoservicio la confirma solo el organizador
// del link: «Confirmar lugar» (partido y menú del jugador) y el ✅ de «A confirmar»
// no le aparecen a otro organizador, tampoco al admin. La fila y su cartel siguen
// a la vista. Un lugar reservado por un organizador, como antes. Solo el emulador.
// Datos ficticios.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/confirmar-solo-link-v260.mjs http://127.0.0.1:18600/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18600/';
refuseRealTarget(BASE);

const PROJECT = 'demo-confirmar-solo-link';
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

const PASS = 'clave-ficticia-260';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 2 * 864e5));
const M = `${day}_2000`;
await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const signUp = async (email) => (await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASS, returnSecureToken: true }),
})).json()).localId;
const GUS = await signUp('admin@ficticio.test');
const MAR = await signUp('otro@ficticio.test');
const base = { matchId: M, matchDate: day, waiting: false, waitOrder: null, rosterAt: 1, createdAt: 1, updatedAt: 1, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false, viewers: ['*'], adders: [GUS, MAR] };
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', GUS, { role: 'admin', name: 'Gus Ficticio', email: 'admin@ficticio.test', active: true, createdAt: 1 });
  await put('users', MAR, { role: 'organizer', name: 'Martín Ficticio', email: 'otro@ficticio.test', active: true, createdAt: 1 });
  await put('roster', 'FichaFicticiaUno0001', { name: 'Ficticio Uno', createdBy: 'Martín Ficticio', createdByUid: MAR, holders: [MAR, GUS], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: MAR, phoneShared: false });
  await put('matches', M, { date: day, time: '20:00', note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [GUS, MAR], createdByUid: GUS, createdBy: 'Gus Ficticio', playerVisible: true, playerCount: 2 });
  // Anotado por Autoservicio con el link de Martín, pendiente.
  await put('players', 'filaAuto', { ...base, name: 'Ficticio Uno', rosterId: 'FichaFicticiaUno0001', selfSignup: true, tentative: true, tentativeAt: 1, addedByUid: MAR, addedBy: 'Martín Ficticio', signedUpWith: MAR, signedUpWithName: 'Martín Ficticio', shareToken: 'tokenFicticioMartin00001', confirmToken: 'tokFicticioAuto000001' });
  // Lugar reservado por el organizador (no es Autoservicio).
  await put('players', 'filaReserva', { ...base, name: 'Ficticio Dos', tentative: true, tentativeAt: 1, addedByUid: MAR, addedBy: 'Martín Ficticio', confirmToken: 'tokFicticioReserva001' });
});
const read = async (id) => {
  let out = null;
  await testEnv.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), 'players', id)); out = s.exists() ? s.data() : null; });
  return out;
};

const browser = await chromium.launch();
const pageErrors = [];
async function login(email) {
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
  let page = null;
  ctx.on('page', (p) => { if (page && p !== page) p.close().catch(() => {}); });
  page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', email);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded && ['filaAuto', 'filaReserva'].every((id) => window.__app.players?.some((p) => p.id === id)), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  return { ctx, page };
}
const openMatch = async (page) => {
  await page.evaluate((id) => { location.hash = `#/partido/${id}`; }, M);
  await page.waitForSelector('#slots [data-player="filaAuto"]', { timeout: 15000 });
};
const menuHasConfirm = async (page, id) => {
  await page.click(`#slots [data-menu="${id}"]`);
  await page.waitForSelector('#menu-panel', { timeout: 10000 });
  const has = await page.locator('#pm-confirm-spot').count();
  await page.click('[data-close]').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  return has > 0;
};

try {
  // El admin (no es el organizador del link).
  const gus = await login('admin@ficticio.test');
  const homeAuto = await gus.page.locator('#pending-signups [data-accept="filaAuto"]').count();
  check('Admin: «A confirmar» no muestra la anotación del link de otro', homeAuto === 0);
  await openMatch(gus.page);
  check('Admin: la fila pendiente sigue en la lista', await gus.page.locator('#slots [data-player="filaAuto"]').count() === 1);
  const badge = await gus.page.locator('#slots [data-player="filaAuto"] .reserved-badge').textContent().catch(() => '');
  check('Admin: con su cartel «Reservado · a confirmar»', /Reservado · a confirmar/.test(badge || ''), badge);
  check('Admin: sin «Confirmar lugar» en el partido para la del Autoservicio', await gus.page.locator('[data-confirm-spot="filaAuto"]').count() === 0);
  check('Admin: el lugar reservado por un organizador sigue con «Confirmar lugar»', await gus.page.locator('[data-confirm-spot="filaReserva"]').count() === 1);
  check('Admin: sin «Confirmar lugar» en el menú del jugador del Autoservicio', !(await menuHasConfirm(gus.page, 'filaAuto')));
  check('Admin: el menú del lugar reservado sí lo tiene', await menuHasConfirm(gus.page, 'filaReserva'));
  await gus.ctx.close();

  // Martín, organizador del link.
  const mar = await login('otro@ficticio.test');
  check('Link: «A confirmar» muestra la anotación con ✅', await mar.page.locator('#pending-signups [data-accept="filaAuto"]').count() === 1);
  await openMatch(mar.page);
  check('Link: «Confirmar lugar» en el partido', await mar.page.locator('[data-confirm-spot="filaAuto"]').count() === 1);
  check('Link: «Confirmar lugar» en el menú del jugador', await menuHasConfirm(mar.page, 'filaAuto'));
  await mar.page.click('[data-confirm-spot="filaAuto"]');
  let row = null;
  for (let i = 0; i < 20; i++) { row = await read('filaAuto'); if (row?.tentative !== true) break; await mar.page.waitForTimeout(500); }
  check('Link: al confirmar queda confirmado a su nombre', row?.tentative == null && row?.acceptedBy === 'Martín Ficticio', `${row?.tentative} ${row?.acceptedBy}`);
  await mar.ctx.close();
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
