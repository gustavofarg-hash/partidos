// v263: si un bloqueo corta el Listen/WebChannel del token, el getDoc/REST
// igual carga los partidos. Un exists:false de la caché no cierra. Solo el
// emulador. Datos ficticios.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/share-token-fallback-v263.mjs http://127.0.0.1:18630/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18630/';
refuseRealTarget(BASE);

const PROJECT = 'demo-share-fallback-v263';
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

const ORG = 'orgFicticio000000001';
const RID = 'FicticioJugadorUno001';
const TOK = 'tokenFicticioOrganiz0001';
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 2 * 864e5));
const MID = `${day}_2000`;

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', ORG, { role: 'organizer', name: 'Gus Ficticio', email: 'org@ficticio.test', active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Ficticio Uno', createdBy: 'Gus Ficticio', createdByUid: ORG, holders: [ORG], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: ORG, phoneShared: false });
  await put('shareTokens', TOK, { uid: ORG, name: 'Gus Ficticio', createdAt: 1 });
  await put('matches', MID, { date: day, time: '20:00', note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [ORG], createdByUid: ORG, createdBy: 'Gus Ficticio', playerVisible: true, playerCount: 0, venueName: 'Sede Ficticia' });
});

const browser = await chromium.launch();
const pageErrors = [];

async function openPage({ cacheMiss = false, blockListen = false, token = TOK, waitMs = 1500, hashWait } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    locale: 'es-AR',
    timezoneId: 'America/Buenos_Aires',
  });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
    globalThis.__F7C_SHARE_WAIT_MS = info.waitMs;
    if (info.cacheMiss) globalThis.__F7C_SHARE_TEST_CACHE_MISS = true;
  }, { firestore: host, auth: authHost, cacheMiss, waitMs });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (r) => r.abort());
  if (blockListen) {
    await ctx.route(/\/google\.firestore\.v1\.Firestore\/Listen\//i, (route) => route.abort());
    await ctx.route(/\/Listen\/channel/i, (route) => route.abort());
  }
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${BASE}#/jugador/${RID}/${token}`);
  if (hashWait) await page.waitForSelector(hashWait, { timeout: 20000 }).catch(() => {});
  return { ctx, page };
}

try {
  // 1) Listen/WebChannel bloqueado: a los ~1.5 s entra getDoc/REST y se ve el partido.
  const blocked = await openPage({
    blockListen: true,
    hashWait: `#self-list li[data-match="${MID}"], #player-share-error, #player-loading`,
  });
  await blocked.page.waitForSelector(`#self-list li[data-match="${MID}"]`, { timeout: 20000 }).catch(() => {});
  check('Con el Listen bloqueado aparece el partido', await blocked.page.locator(`#self-list li[data-match="${MID}"]`).count() === 1);
  check('Con el Listen bloqueado no sale el error del token', await blocked.page.locator('#player-share-error').count() === 0);
  await blocked.ctx.close();

  // 2) Un exists:false de la caché no cierra; con Listen bloqueado igual se carga por getDoc/REST.
  const stale = await openPage({
    blockListen: true,
    cacheMiss: true,
    hashWait: `#self-list li[data-match="${MID}"], #player-share-error, #player-loading`,
  });
  await stale.page.waitForSelector(`#self-list li[data-match="${MID}"]`, { timeout: 20000 }).catch(() => {});
  check('Caché exists:false: no se falla de entrada', await stale.page.locator('#player-share-error').count() === 0
    || await stale.page.locator(`#self-list li[data-match="${MID}"]`).count() === 1);
  check('Caché exists:false: después del respaldo aparece el partido', await stale.page.locator(`#self-list li[data-match="${MID}"]`).count() === 1);
  await stale.ctx.close();

  // 3) Token que no existe: después del getDoc al servidor, error y Reintentar.
  const missing = await openPage({
    token: 'tokenFicticioInexistente01',
    waitMs: 800,
    hashWait: '#player-share-error, #player-signup, #self-list',
  });
  await missing.page.waitForSelector('#player-share-error', { timeout: 20000 }).catch(() => {});
  const err = await missing.page.locator('#player-share-error').textContent().catch(() => '');
  check('Token que no existe: «No se pudieron cargar los partidos.»', /No se pudieron cargar los partidos/.test(err || ''), err);
  check('Token que no existe: botón Reintentar', await missing.page.locator('#player-share-retry').count() === 1);
  await missing.ctx.close();

  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
