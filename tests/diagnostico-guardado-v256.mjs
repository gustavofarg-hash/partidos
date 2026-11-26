// v256: cuando falla un guardado de Agregar jugador (o de invitados), el aviso del
// admin dice el paso y el documento, la consola lo registra, y lo demás no cambia
// (lo que ya se guardó queda, los invitados no se cargan, el organizador ve el texto corto).
// Falla real de firestore.rules, con datos ficticios: un partido viejo con una nota
// de más de 300 letras (no se puede actualizar). (La fila de un partido no cargado,
// que hacía fallar la confirmación, ya no falla desde v257: ver
// tests/partido-no-cargado-v257.mjs.)
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/diagnostico-guardado-v256.mjs http://127.0.0.1:18560/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18560/';
refuseRealTarget(BASE);

const PROJECT = 'demo-diagnostico-guardado';
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

const ADMIN = { email: 'admin@ficticio.test', pass: 'clave-ficticia-256a' };
const ORG = { email: 'organizador@ficticio.test', pass: 'clave-ficticia-256o' };
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 864e5));
const RID = 'FicticioRepetido0001';

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const signUp = async ({ email, pass }) => (await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
})).json()).localId;
const U = await signUp(ADMIN);
const O = await signUp(ORG);
const row = (matchId, extra) => ({ matchId, matchDate: tomorrow, viewers: ['*'], adders: [U, O], createdAt: 1, updatedAt: 1, waiting: false, waitOrder: null, rosterAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false, addedByUid: U, addedBy: 'Gus', ...extra });
const match = (time, extra = {}) => ({ date: tomorrow, time, note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U, O], createdByUid: U, createdBy: 'Gus', playerCount: 0, ...extra });
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Gus', email: ADMIN.email, active: true, createdAt: 1 });
  await put('users', O, { role: 'organizer', name: 'Martín', email: ORG.email, active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Ficticio Repetido', createdBy: 'Gus', createdByUid: U, holders: [U, O], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: U, phoneShared: false });
  await put('matches', 'mA', match('20:00'));
  await put('matches', 'mC', match('22:00'));
  await put('matches', 'mN', match('18:00', { note: 'x'.repeat(301), playerCount: 1 }));
  await put('matches', 'mN2', match('19:00', { note: 'y'.repeat(301), playerCount: 0 }));
  await put('players', 'hN', row('mN', { name: 'Ficticio Anfitrión' }));
});

const allPlayers = async () => {
  let out = [];
  await testEnv.withSecurityRulesDisabled(async (c) => {
    out = (await getDocs(collection(c.firestore(), 'players'))).docs.map((d) => ({ id: d.id, ...d.data() }));
  });
  return out;
};

const browser = await chromium.launch();
const open = async (who) => {
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
  const logs = [];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', who.email);
  await page.fill('#login-password', who.pass);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded && window.__app.roster?.length && window.__app.matches?.length >= 4, null, { timeout: 20000 });
  return { ctx, page, logs, errors };
};
const addWithGuests = async (page, matchId, name, guests) => {
  await page.evaluate((id) => { location.hash = `#/partido/${id}`; }, matchId);
  await page.waitForSelector('#btn-add-player', { timeout: 15000 });
  await page.click('#btn-add-player');
  await page.waitForSelector('#player-form');
  await page.fill('#player-name', name);
  for (let i = 0; i < guests; i++) await page.click('#friend-plus');
  await page.click('#player-form button[type=submit]');
};
const toastText = async (page) => {
  await page.waitForFunction(() => /No se pudo guardar/.test(document.querySelector('#toast')?.textContent || '') && !document.querySelector('#toast').hidden, null, { timeout: 20000 });
  return page.textContent('#toast');
};

try {
  // 1) Admin: Ficticio Repetido con 2 invitados en un partido que no se puede actualizar.
  const admin = await open(ADMIN);
  await addWithGuests(admin.page, 'mN', 'Ficticio Repetido', 2);
  const t1 = await toastText(admin.page);
  check('Admin: el aviso dice el paso y el documento (al anotar a Ficticio Repetido › al actualizar el partido (matches/mN))', t1.startsWith('No se pudo guardar al anotar a Ficticio Repetido › al actualizar el partido (matches/mN)'), t1);
  check('Admin: y el motivo corto de siempre', t1.endsWith(': Firebase rechazó el permiso'), t1);
  check('Admin: el aviso es el de varias líneas', await admin.page.locator('#toast.detail').count() === 1);
  const radius = await admin.page.$eval('#toast', (el) => getComputedStyle(el).borderRadius);
  check('Admin: con bordes de tarjeta, no de píldora', radius === '14px', radius);
  const box = await admin.page.$eval('#toast', (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, w: window.innerWidth }; });
  check('Admin: entra en la pantalla del teléfono', box.left >= 0 && box.right <= box.w, JSON.stringify(box));
  await admin.page.waitForTimeout(8000);
  check('Admin: sigue a la vista 8 segundos después', await admin.page.isVisible('#toast'));
  check('La consola registra el paso y el documento', admin.logs.some((l) => l.startsWith('Guardado: falló al anotar a Ficticio Repetido › al actualizar el partido (matches/mN)')), admin.logs.join(' | ').slice(0, 400));
  await admin.page.click('#toast');
  check('Tocándolo se cierra', await admin.page.isHidden('#toast'));
  const afterN = (await allPlayers()).filter((p) => p.matchId === 'mN').map((p) => p.name).sort();
  check('Sin cambio de comportamiento: el titular quedó, los invitados no', JSON.stringify(afterN) === JSON.stringify(['Ficticio Anfitrión', 'Ficticio Repetido']), JSON.stringify(afterN));

  // 2) El invitado de un anotado, en el mismo partido.
  await admin.page.waitForSelector('#slots .name:text-is("Ficticio Anfitrión")', { timeout: 15000 });
  await admin.page.locator('#slots .slot', { has: admin.page.locator('.name:text-is("Ficticio Anfitrión")') }).locator('[data-menu]').click();
  await admin.page.click('#pm-friend');
  await admin.page.waitForSelector('#friend-form');
  await admin.page.click('#friend-form button[type=submit]');
  const t3 = await toastText(admin.page);
  check('Admin: «con el invitado 1 › al actualizar el partido (matches/mN)»', t3 === 'No se pudo guardar con el invitado 1 › al actualizar el partido (matches/mN): Firebase rechazó el permiso', t3);
  check('Admin: sin errores de página', admin.errors.length === 0, admin.errors.join(' | '));
  await admin.ctx.close();

  // 3) Organizador: el mismo caso, el aviso corto de siempre (sin detalle).
  const org = await open(ORG);
  await addWithGuests(org.page, 'mN2', 'Ficticio Repetido', 2);
  const t4 = await toastText(org.page);
  check('Organizador: el aviso no cambia («No se pudo guardar: Firebase rechazó el permiso»)', t4 === 'No se pudo guardar: Firebase rechazó el permiso', t4);
  check('Organizador: sin el aviso largo', await org.page.locator('#toast.detail').count() === 0);
  check('Organizador: la consola igual registra el paso', org.logs.some((l) => l.startsWith('Guardado: falló al anotar a Ficticio Repetido › al actualizar el partido (matches/mN2)')));

  // 4) Lo que anda sigue andando: otro jugador nuevo con 2 invitados.
  await addWithGuests(org.page, 'mC', 'Ficticio Dos', 2);
  await org.page.waitForSelector('#slots .name:text-is("Invitado 2 (Ficticio Dos)")', { timeout: 15000 });
  const okC = (await allPlayers()).filter((p) => p.matchId === 'mC').map((p) => p.name).sort();
  check('Otro jugador con 2 invitados se guarda entero', JSON.stringify(okC) === JSON.stringify(['Ficticio Dos', 'Invitado 1 (Ficticio Dos)', 'Invitado 2 (Ficticio Dos)']), JSON.stringify(okC));
  check('Organizador: sin errores de página', org.errors.length === 0, org.errors.join(' | '));
  await org.ctx.close();
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
