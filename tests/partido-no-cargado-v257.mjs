// v257: al anotar a alguien con invitados, la app reescribe las tarjetas de
// confirmación de las otras filas de la misma persona SOLO si su partido está
// cargado. Una fila de un partido pasado que no está cargado (más viejo que los
// 30 del historial) o de un partido que ya no existe no se toca: antes su tarjeta
// salía sin hora, las reglas la negaban y quedaba el titular sin sus invitados.
// Solo el emulador. Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/partido-no-cargado-v257.mjs http://127.0.0.1:18570/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18570/';
refuseRealTarget(BASE);

const PROJECT = 'demo-partido-no-cargado';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const [fsHost, fsPort] = host.split(':');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, collection, getDocs } = await import('firebase/firestore');
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: fsHost, port: Number(fsPort) },
});

const EMAIL = 'admin@ficticio.test';
const PASS = 'clave-ficticia-257';
const ba = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + offset * 864e5));
const tomorrow = ba(1);
const oldDay = ba(-17);
const OLD = `${oldDay}_1630`;
const R1 = 'FicticioRepetido0001';
const R2 = 'FicticioHuerfano0001';

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const U = (await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json()).localId;
const row = (matchId, matchDate, extra) => ({ matchId, matchDate, viewers: ['*'], adders: [U], createdAt: 1, updatedAt: 1, waiting: false, waitOrder: null, rosterAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: '', phoneShared: false, addedByUid: U, addedBy: 'Gus', ...extra });
const match = (date, time, extra = {}) => ({ date, time, note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U], createdByUid: U, createdBy: 'Gus', playerCount: 0, ...extra });
const oldCard = { playerId: 'viejo1', matchId: OLD, name: 'Ficticio Repetido', date: oldDay, time: '16:30', note: 'Ficticio', venue: 'Cancha ficticia', cancelled: false, viewers: ['*'], confirmed: 'si', confirmedAt: 5 };
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Gus', email: EMAIL, active: true, createdAt: 1 });
  for (const [id, name] of [[R1, 'Ficticio Repetido'], [R2, 'Ficticio Huérfano']]) {
    await put('roster', id, { name, createdBy: 'Gus', createdByUid: U, holders: [U], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: U, phoneShared: false });
  }
  await put('matches', 'mA', match(tomorrow, '20:00'));
  await put('matches', 'mB', match(tomorrow, '22:00', { playerCount: 1 }));
  // 30 partidos pasados más nuevos: el del día -17 queda afuera de lo que carga el historial.
  for (let i = 1; i <= 30; i++) await put('matches', `pasado${i}`, match(ba(-1 - (i % 10)), `${String(8 + Math.floor(i / 10)).padStart(2, '0')}:${String(i).padStart(2, '0')}`));
  await put('matches', OLD, match(oldDay, '16:30', { playerCount: 1 }));
  await put('players', 'viejo1', row(OLD, oldDay, { name: 'Ficticio Repetido', rosterId: R1, confirmToken: 'tokFicticioViejo0001' }));
  await put('confirmations', 'tokFicticioViejo0001', oldCard);
  // La misma persona en otro partido cargado del mismo día: su tarjeta se sigue actualizando.
  await put('players', 'otroB', row('mB', tomorrow, { name: 'Ficticio Repetido', rosterId: R1, confirmToken: 'tokFicticioOtroB0001' }));
  // Una fila que quedó de un partido que ya no existe.
  await put('players', 'huerfano1', row('partidoBorrado', ba(-3), { name: 'Ficticio Huérfano', rosterId: R2, confirmToken: 'tokFicticioHuerf0001' }));
});

const read = async (path, id) => {
  let out = null;
  await testEnv.withSecurityRulesDisabled(async (c) => { const s = await getDoc(doc(c.firestore(), path, id)); out = s.exists() ? s.data() : null; });
  return out;
};
const playersIn = async (matchId) => {
  let out = [];
  await testEnv.withSecurityRulesDisabled(async (c) => {
    out = (await getDocs(collection(c.firestore(), 'players'))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.matchId === matchId);
  });
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
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded && window.__app.roster?.length >= 2 && window.__app.players?.some((p) => p.id === 'viejo1') && window.__app.players?.some((p) => p.id === 'huerfano1'), null, { timeout: 20000 });
  const seen = await page.evaluate((old) => ({
    oldRow: window.__app.players.some((p) => p.id === 'viejo1'),
    oldMatch: (window.__app.matches || []).some((m) => m.id === old),
  }), OLD);
  check('Escenario: la fila del partido pasado está en la app y su partido no', seen.oldRow && !seen.oldMatch, JSON.stringify(seen));

  const add = async (name, guests) => {
    await page.evaluate(() => { location.hash = '#/partido/mA'; });
    await page.waitForSelector('#btn-add-player', { timeout: 15000 });
    await page.click('#btn-add-player');
    await page.waitForSelector('#player-form');
    await page.fill('#roster-find', name.split(' ')[1]);
    await page.waitForSelector('#roster-hits [data-pick]', { timeout: 10000 });
    await page.locator('#roster-hits [data-pick]').first().click();
    for (let i = 0; i < guests.length; i++) await page.click('#friend-plus');
    for (let i = 0; i < guests.length; i++) if (guests[i]) await page.locator('#friend-rows input').nth(i).fill(guests[i]);
    await page.click('#player-form button[type=submit]');
  };
  const toastNow = () => page.evaluate(() => { const t = document.querySelector('#toast'); return t && !t.hidden ? t.textContent : ''; });

  // 1) Con un partido pasado no cargado: titular + 2 invitados sin nombre.
  await add('Ficticio Repetido', ['', '']);
  await page.waitForSelector('#slots .name:text-is("Invitado 2 (Ficticio Repetido)")', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const t1 = await toastNow();
  check('Sin aviso de error', !/No se pudo guardar/.test(t1), t1);
  const inA = (await playersIn('mA')).map((p) => p.name).sort();
  check('Se guardan el titular y los 2 invitados', JSON.stringify(inA) === JSON.stringify(['Ficticio Repetido', 'Invitado 1 (Ficticio Repetido)', 'Invitado 2 (Ficticio Repetido)']), JSON.stringify(inA));
  const hostRow = (await playersIn('mA')).find((p) => p.name === 'Ficticio Repetido');
  const hostCard = hostRow?.confirmToken ? await read('confirmations', hostRow.confirmToken) : null;
  check('La tarjeta del titular nuevo se escribe', hostCard?.playerId === hostRow?.id && hostCard?.time === '20:00', JSON.stringify(hostCard));
  const oldAfter = await read('confirmations', 'tokFicticioViejo0001');
  check('La tarjeta del partido pasado no se toca', JSON.stringify(oldAfter) === JSON.stringify(oldCard), JSON.stringify(oldAfter));
  const otherCard = await read('confirmations', 'tokFicticioOtroB0001');
  check('La de otro partido cargado del mismo día sí se actualiza (con los dos horarios)', otherCard?.time === '22:00' && Array.isArray(otherCard?.also) && otherCard.also.length === 2, JSON.stringify(otherCard));
  check('El contador del partido queda en 3', (await read('matches', 'mA'))?.playerCount === 3);

  // 2) Con una fila de un partido que ya no existe: titular + 2 invitados con nombre.
  await add('Ficticio Huérfano', ['Pepe Ficticio', 'Lalo Ficticio']);
  await page.waitForSelector('#slots .name:text-is("Lalo Ficticio")', { timeout: 15000 });
  await page.waitForTimeout(2500);
  const t2 = await toastNow();
  check('Sin aviso de error (partido borrado)', !/No se pudo guardar/.test(t2), t2);
  const inA2 = (await playersIn('mA')).filter((p) => p.name !== 'Ficticio Repetido' && !/Invitado/.test(p.name)).map((p) => p.name).sort();
  check('Se guardan el titular y los 2 invitados con nombre', JSON.stringify(inA2) === JSON.stringify(['Ficticio Huérfano', 'Lalo Ficticio', 'Pepe Ficticio']), JSON.stringify(inA2));
  check('No se crea tarjeta para la fila huérfana', (await read('confirmations', 'tokFicticioHuerf0001')) === null);
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
