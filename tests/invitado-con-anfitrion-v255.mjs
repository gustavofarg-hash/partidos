// v255: el invitado sin nombre queda «Invitado N (X)», X = apodo entero del que
// invita (como lo ve quien anota) o su Nombre; si no entra en 60, «…». En «También
// en sus partidos del día» va el mismo nombre; un «Invitado 1» viejo del mismo
// anfitrión cuenta como el mismo (promo y renombre). Solo el emulador. Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/invitado-con-anfitrion-v255.mjs http://127.0.0.1:18550/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18550/';
refuseRealTarget(BASE);

const PROJECT = 'demo-invitado-anfitrion';
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
const PASS = 'clave-ficticia-255';
const RID = 'FicticioNicoMiranda01';
const LONG = 'Bartolomé Ezequiel Santisteban Goñi de la Torre y Fernández';
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 864e5));

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const signUp = await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json();
const U = signUp.localId;
const row = (matchId, extra) => ({ matchId, matchDate: tomorrow, viewers: ['*'], editors: ['*'], createdAt: 1, paid: false, cash: 0, transfer: 0, fromCredit: 0, pendingTransfer: 0, addedByUid: U, addedBy: 'Gus', ...extra });
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Gus', email: EMAIL, active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Nico Miranda', shortName: 'Nico M.', createdBy: 'Gus', createdByUid: U, holders: [U], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: U, phoneShared: false });
  for (const [id, time] of [['mA', '20:00'], ['mB', '21:00']]) {
    await put('matches', id, { date: tomorrow, time, note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U], createdByUid: U, createdBy: 'Gus', playerCount: 2 });
  }
  await put('players', 'hA', row('mA', { name: 'Nico Miranda', rosterId: RID }));
  await put('players', 'hB', row('mB', { name: 'Nico Miranda', rosterId: RID }));
  // Invitado de antes de v255: no cambia.
  await put('players', 'viejoB', row('mB', { name: 'Invitado 1', invitedBy: 'hB', invitedByName: 'Nico Miranda', guestAuto: true }));
  await put('players', 'largoA', row('mA', { name: LONG }));
});

const browser = await chromium.launch();
const pageErrors = [];
const namesIn = async (matchId) => {
  let out = [];
  await testEnv.withSecurityRulesDisabled(async (c) => {
    out = (await getDocs(collection(c.firestore(), 'players'))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.matchId === matchId);
  });
  return out;
};
const guestsOf = async (matchId, hostId) => (await namesIn(matchId)).filter((p) => p.invitedBy === hostId).map((p) => p.name).sort();
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
  await page.waitForFunction(() => window.__app?.loaded && window.__app.roster?.length && window.__app.players?.length >= 4, null, { timeout: 20000 });
  await page.evaluate(() => { location.hash = '#/partido/mA'; });
  await page.waitForSelector('#slots .name:text-is("Nico M.")', { timeout: 15000 });

  // 1) Agregar invitados a Nico (apodo «Nico M.» en mi agenda), también en el otro partido del día.
  await page.locator('#slots .slot', { has: page.locator('.name:text-is("Nico M.")') }).locator('[data-menu]').click();
  await page.click('#pm-friend');
  await page.waitForSelector('#friend-form');
  await page.click('#friend-plus');
  const hint = await page.textContent('#friend-hint');
  check('La ayuda muestra los nombres reales', hint.includes('Invitado 1 (Nico M.), Invitado 2 (Nico M.)'), hint);
  const also = await page.$$eval('#friend-also input[name=also]', (els) => els.map((el) => ({ id: el.value, on: el.checked })));
  check('Ofrece el otro partido del día, marcado', also.length === 1 && also[0].id === 'mB' && also[0].on, JSON.stringify(also));
  await page.click('#friend-form button[type=submit]');
  await page.waitForSelector('#slots .name:text-is("Invitado 2 (Nico M.)")', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const inA = await guestsOf('mA', 'hA');
  check('En este partido: «Invitado 1 (Nico M.)» e «Invitado 2 (Nico M.)»', JSON.stringify(inA) === JSON.stringify(['Invitado 1 (Nico M.)', 'Invitado 2 (Nico M.)']), JSON.stringify(inA));
  const inB = await guestsOf('mB', 'hB');
  check('En el otro partido el viejo «Invitado 1» cuenta como el mismo y se suma solo el 2, con el mismo nombre', JSON.stringify(inB) === JSON.stringify(['Invitado 1', 'Invitado 2 (Nico M.)']), JSON.stringify(inB));
  const promo = await page.evaluate(async () => {
    const { playerPromoKey } = await import('./js/prices.js');
    const all = window.__app.players;
    const a = all.find((p) => p.name === 'Invitado 1 (Nico M.)');
    const b = all.find((p) => p.id === 'viejoB');
    return !!a && !!b && playerPromoKey(a, all) === playerPromoKey(b, all);
  });
  check('Para la promo del día, «Invitado 1 (Nico M.)» y el viejo «Invitado 1» son el mismo', promo);

  // 2) Renombrar en un partido lo renombra en el otro (mismo anfitrión).
  await page.locator('#slots .slot', { has: page.locator('.name:text-is("Invitado 1 (Nico M.)")') }).locator('[data-menu]').click();
  await page.click('#pm-edit');
  await page.waitForSelector('#player-form');
  await page.fill('#player-name', 'Fran D.');
  await page.click('#player-form button[type=submit]');
  await page.waitForSelector('#slots .name:text-is("Fran D.")', { timeout: 15000 });
  await page.waitForTimeout(1500);
  const afterB = await guestsOf('mB', 'hB');
  check('El renombre llega al otro partido del día', afterB.includes('Fran D.') && !afterB.includes('Invitado 1'), JSON.stringify(afterB));

  // 3) Nombre largo sin apodo: se corta con «…» y Firestore lo acepta.
  await page.locator('#slots .slot', { has: page.locator(`.name:text-is("${LONG}")`) }).locator('[data-menu]').click();
  await page.click('#pm-friend');
  await page.waitForSelector('#friend-form');
  await page.click('#friend-form button[type=submit]');
  await page.waitForFunction(() => window.__app.players.some((p) => p.invitedBy === 'largoA'), null, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const longGuest = (await guestsOf('mA', 'largoA'))[0] || '';
  check('Con un Nombre largo queda en 60 con «…» y se guarda', Array.from(longGuest).length === 60 && longGuest.startsWith('Invitado 1 (Bartolomé') && longGuest.endsWith('…)'), longGuest);

  // 4) Jugador nuevo con invitados: el Nombre escrito.
  await page.click('#btn-add-player');
  await page.waitForSelector('#player-form');
  await page.fill('#player-name', 'Ficticio Nuevo');
  await page.click('#friend-plus');
  const newHint = await page.textContent('#friend-hint');
  check('Jugador nuevo: la ayuda dice «Invitado 1 (Ficticio Nuevo)»', newHint.includes('Invitado 1 (Ficticio Nuevo)'), newHint);
  await page.click('#player-form button[type=submit]');
  await page.waitForSelector('#slots .name:text-is("Invitado 1 (Ficticio Nuevo)")', { timeout: 15000 });
  check('Jugador nuevo: el invitado queda «Invitado 1 (Ficticio Nuevo)»', true);
  const tag = await page.locator('#slots .slot', { has: page.locator('.name:text-is("Invitado 1 (Ficticio Nuevo)")') }).locator('.friend-tag').innerText();
  check('Sigue la etiqueta «invitado de»', tag.includes('invitado de Ficticio Nuevo'), tag);
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
