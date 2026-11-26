// v258: Enviar recordatorios para alguien anotado por Autoservicio en dos partidos
// del mismo día (filas sin huella; el WhatsApp sale de la ficha): el mensaje dice
// «HOY 19:00 y 20:00», el link es el del partido abierto, y al tocar Enviar quedan
// «Enviado» las dos filas (también la del partido de otro organizador). La fila en
// lista de espera de un tercer partido no se nombra ni se marca. Solo el emulador.
// Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/recordatorio-dia-v258.mjs http://127.0.0.1:18580/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';
import { phoneKey } from '../js/privacy.js';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18580/';
refuseRealTarget(BASE);

const PROJECT = 'demo-recordatorio-dia';
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

const EMAIL = 'admin@ficticio.test';
const PASS = 'clave-ficticia-258';
const O2 = 'otroOrganizadorFicticio01';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date());
const A = `${today}_1900`;
const B = `${today}_2000`;
const W = `${today}_2100`;
const RID = 'FichaFicticiaUno0001';
const PHONE = '5491100000000';
const KEY = phoneKey(PHONE);

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const U = (await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json()).localId;
const match = (time, owner, extra = {}) => ({ date: today, time, note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [owner], createdByUid: owner, createdBy: owner === U ? 'Gus' : 'Otro', playerCount: 1, ...extra });
// Alta de Autoservicio: sin teléfono ni huella en la fila, con la ficha.
const self = (matchId, owner, token, extra = {}) => ({ matchId, matchDate: today, name: 'Ficticio Uno', rosterId: RID, selfSignup: true, waiting: false, waitOrder: null, rosterAt: 1, addedBy: 'Ficticio Uno', addedByUid: '', createdAt: 1, updatedAt: 1, phone: '', hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false, confirmToken: token, viewers: ['*'], adders: [owner], signedUpWith: owner, signedUpWithName: owner === U ? 'Gus' : 'Otro', ...extra });
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Gus', email: EMAIL, active: true, createdAt: 1 });
  await put('users', O2, { role: 'organizer', name: 'Otro', email: 'otro@ficticio.test', active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Ficticio Uno', holders: [U, O2], createdByUid: U, phoneKey: KEY, hasPhone: true, phoneOwnerUid: U, phoneShared: true, createdAt: 1, updatedAt: 1 });
  await put('rosterContacts', RID, { phone: PHONE, ownerUid: U, visibleToAll: true, phoneKey: KEY });
  await put('matches', A, match('19:00', O2));
  await put('matches', B, match('20:00', U));
  await put('matches', W, match('21:00', U));
  await put('players', 'filaA', self(A, O2, 'tokFicticioFilaA00001'));
  await put('players', 'filaB', self(B, U, 'tokFicticioFilaB00001'));
  await put('players', 'filaW', self(W, U, 'tokFicticioFilaW00001', { waiting: true, waitOrder: 1, rosterAt: null }));
});
const read = async (id) => {
  let out = null;
  await testEnv.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), 'players', id)); out = s.exists() ? s.data() : null; });
  return out;
};

const browser = await chromium.launch();
try {
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
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction((ids) => window.__app?.loaded && ids.every((id) => window.__app.players?.some((p) => p.id === id)) && window.__app.roster?.some((r) => r.phone), ['filaA', 'filaB', 'filaW'], { timeout: 20000 });
  await page.evaluate((id) => { location.hash = `#/partido/${id}`; }, B);
  await page.waitForSelector('#btn-remind', { timeout: 15000 });
  await page.click('#btn-remind');
  await page.waitForSelector('#remind-scope', { timeout: 15000 });
  await page.click('[data-remind-scope="all"]');
  const send = page.locator('#remind-list a[data-send="filaB"]');
  await send.waitFor({ timeout: 15000 });
  const href = await send.getAttribute('href');
  check('Abre WhatsApp con el número de la ficha', href.startsWith(`https://wa.me/${PHONE}?text=`), href.slice(0, 60));
  const text = decodeURIComponent(href.split('text=')[1] || '');
  check('El mensaje dice «HOY 19:00 y 20:00»', text.includes('¿Confirmás que jugás HOY 19:00 y 20:00?'), text.split('\n')[0]);
  check('No nombra el partido donde está en la espera', !text.includes('21:00'), text.split('\n')[0]);
  check('El link es el del partido abierto', text.includes(`confirmar.html?m=${encodeURIComponent(B)}&p=filaB&t=tokFicticioFilaB00001`) || text.includes(`confirmar.html?m=${B}&p=filaB&t=tokFicticioFilaB00001`), text.split('\n').pop());
  await send.click();
  await page.waitForFunction(() => document.querySelector('[data-remind="filaB"] .sent'), null, { timeout: 10000 });
  let a = null; let b = null;
  for (let i = 0; i < 20; i++) {
    a = await read('filaA'); b = await read('filaB');
    if (typeof a?.reminderSentAt === 'number' && typeof b?.reminderSentAt === 'number') break;
    await page.waitForTimeout(500);
  }
  check('Queda «Enviado» la fila del partido abierto', typeof b?.reminderSentAt === 'number');
  check('Y también la del otro partido del día (de otro organizador)', typeof a?.reminderSentAt === 'number');
  const aKeys = Object.keys(a || {}).sort().join(',');
  check('En la otra fila solo cambia la marca (y updatedAt)', a?.confirmed === undefined && a?.name === 'Ficticio Uno' && a?.adders?.[0] === O2, aKeys);
  check('La fila en lista de espera no se marca', !(await read('filaW'))?.reminderSentAt);
  // La app también lo ve en la fila del otro partido (de ahí sale el «Enviado» de su hoja).
  const seen = await page.waitForFunction(() => window.__app.players.find((p) => p.id === 'filaA')?.reminderSentAt, null, { timeout: 10000 }).then(() => true, () => false);
  check('La app ve «Enviado» en la fila del otro partido', seen);
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
