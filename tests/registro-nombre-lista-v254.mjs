// v254: una línea nueva del Registro dice el nombre como se ve en la lista del
// partido para quien la escribe: el apodo si hay, si no el Nombre (y con su agenda,
// v249). Caso de Gustavo: a «Invitado 1» (invitado de Nico Miranda) le pusieron el
// apodo «Fran D.»; al cobrarle, el Registro decía «Invitado 1». Las líneas viejas no
// cambian. Solo el emulador. Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/registro-nombre-lista-v254.mjs http://127.0.0.1:18540/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18540/';
refuseRealTarget(BASE);

const PROJECT = 'demo-registro-nombre';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const [fsHost, fsPort] = host.split(':');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, setDoc, collection, getDocs } = await import('firebase/firestore');
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: fsHost, port: Number(fsPort) },
});

const EMAIL = 'organizador@ficticio.test';
const PASS = 'clave-ficticia-254';
const RID = 'FicticioAgendaPipa001';
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 864e5));

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const signUp = await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json();
const U = signUp.localId;
const M = 'uidFicticioMartin0001';
const base = (date) => ({ matchId: 'm1', matchDate: date, viewers: ['*'], editors: ['*'], createdAt: 1, paid: false, cash: 0, transfer: 0, fromCredit: 0, pendingTransfer: 0 });
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Gus', email: EMAIL, active: true, createdAt: 1 });
  await put('users', M, { role: 'organizer', name: 'Martín', email: 'martin@ficticio.test', active: true, createdAt: 1 });
  await put('matches', 'm1', { date: tomorrow, time: '20:00', note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U, M], createdByUid: M, createdBy: 'Martín', playerCount: 3 });
  await put('roster', RID, { name: 'Ficticio Pérez', shortName: 'Pipa', createdBy: 'Gus', createdByUid: U, holders: [U], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: U, phoneShared: false });
  await put('players', 'p-host', { ...base(tomorrow), name: 'Nico Miranda', addedByUid: M, addedBy: 'Martín' });
  await put('players', 'p-guest', { ...base(tomorrow), name: 'Invitado 1', shortName: 'Fran D.', invitedBy: 'p-host', invitedByName: 'Nico Miranda', guestAuto: false, addedByUid: M, addedBy: 'Martín' });
  await put('players', 'p-agenda', { ...base(tomorrow), name: 'Ficticio Pérez', rosterId: RID, addedByUid: U, addedBy: 'Gus' });
  // Línea vieja (de antes del cambio): tiene que quedar como está.
  await put('log', 'vieja', { at: Date.now() - 6e5, actorUid: U, actorName: 'Gus', section: 'pagos', type: 'pago', matchId: 'm1', matchDate: tomorrow, matchTime: '20:00', matchLabel: 'Línea vieja ficticia', editors: ['*'], playerName: 'Invitado 1', hostName: 'Nico Miranda', detail: '', amount: 1000, method: 'efectivo', paidTo: 'Gus' });
});

const browser = await chromium.launch();
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
  }, { firestore: host, auth: authHost });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (r) => r.abort());
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded && window.__app.roster?.length, null, { timeout: 20000 });
  await page.evaluate(() => { location.hash = '#/partido/m1'; });
  await page.waitForSelector('.slot:has-text("Fran D.") .pay-btn', { timeout: 15000 });
  const listNames = await page.$$eval('#slots .name', (els) => els.map((el) => el.textContent.trim()));
  check('La lista muestra «Fran D.» y «Pipa»', listNames.includes('Fran D.') && listNames.includes('Pipa'), JSON.stringify(listNames));

  const pay = async (shown) => {
    await page.click(`.slot:has-text("${shown}") .pay-btn`);
    await page.waitForSelector('#pay-form');
    await page.fill('#pay-form [name=cash]', '5000');
    await page.click('#pay-form button[type=submit]');
    await page.waitForSelector(`.slot:has-text("${shown}") .pay-line.ok`, { timeout: 15000 });
  };
  await pay('Fran D.');
  await pay('Pipa');

  await page.evaluate(() => { location.hash = '#/registro/pagos'; });
  await page.waitForFunction(() => document.querySelectorAll('#log-list li').length >= 3, null, { timeout: 15000 });
  const lines = await page.$$eval('#log-list li', (els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
  const guestLine = lines.find((t) => /Efectivo \$5\.000/.test(t) && /invitado de/.test(t)) || '';
  check('El pago del invitado dice «Fran D. (invitado de Nico Miranda)»', guestLine.includes('Fran D. (invitado de Nico Miranda) · Efectivo $5.000') && !guestLine.includes('Invitado 1'), guestLine);
  const agendaLine = lines.find((t) => /Efectivo \$5\.000/.test(t) && !/invitado de/.test(t)) || '';
  check('El pago del jugador de mi agenda dice su apodo «Pipa»', /· Pipa · Efectivo \$5\.000/.test(agendaLine) && !agendaLine.includes('Ficticio Pérez'), agendaLine);
  const oldLine = lines.find((t) => t.includes('Línea vieja ficticia')) || '';
  check('La línea vieja no cambia (sigue «Invitado 1»)', oldLine.includes('Invitado 1 (invitado de Nico Miranda) · Efectivo $1.000'), oldLine);

  let saved = [];
  await testEnv.withSecurityRulesDisabled(async (c) => {
    saved = (await getDocs(collection(c.firestore(), 'log'))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  const newPays = saved.filter((row) => row.id !== 'vieja' && row.section === 'pagos' && row.amount === 5000);
  check('En Firestore quedó el nombre de la lista (sin campos nuevos)', newPays.length === 2
    && newPays.some((row) => row.playerName === 'Fran D.' && row.hostName === 'Nico Miranda')
    && newPays.some((row) => row.playerName === 'Pipa' && row.hostName === '')
    && newPays.every((row) => !('playerId' in row) && !('playerShortName' in row)), JSON.stringify(newPays.map((row) => [row.playerName, row.hostName])));
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
