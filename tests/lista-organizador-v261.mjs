// v261: Autoservicio con el token del organizador. Si todavía no se sabe quién es,
// «Cargando…» (no una lista vacía); cuando llega, aparece la lista. Si no se puede
// saber, «No se pudieron cargar los partidos.» y Reintentar. Si el navegador ya
// bloqueó avisos, el texto se ve sin tocar el botón. Solo el emulador. Datos ficticios.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/lista-organizador-v261.mjs http://127.0.0.1:18610/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18610/';
refuseRealTarget(BASE);

const PROJECT = 'demo-lista-organizador-v261';
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
async function openPage({ holdShare = false, denied = false, token = TOK, hashWait } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
    if (info.holdShare) {
      globalThis.__F7C_HOLD_SHARE = true;
      globalThis.__F7C_SHARE_WAIT_MS = 60_000;
    }
    if (info.denied && typeof Notification !== 'undefined') {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
    }
  }, { firestore: host, auth: authHost, holdShare, denied });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (r) => r.abort());
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(`${BASE}#/jugador/${RID}/${token}`);
  if (hashWait) await page.waitForSelector(hashWait, { timeout: 20000 });
  return { ctx, page };
}

try {
  // 1) El organizador todavía no se sabe: «Cargando…», no una lista vacía.
  const held = await openPage({ holdShare: true, hashWait: '#player-loading, #player-signup, #self-list, #self-empty' });
  const loading = await held.page.locator('#player-loading').textContent().catch(() => '');
  check('Sin organizador listo: se ve «Cargando…»', /Cargando/.test(loading || ''), loading);
  check('Sin organizador listo: no hay lista de partidos', await held.page.locator('#self-list, #player-signup').count() === 0);
  check('Sin organizador listo: no dice «No hay partidos próximos»', await held.page.locator('#self-empty').count() === 0);
  // 2) Cuando llega el organizador, aparece la lista.
  await held.page.evaluate(() => { globalThis.__F7C_HOLD_SHARE = false; });
  await held.page.waitForSelector(`#self-list li[data-match="${MID}"]`, { timeout: 20000 }).catch(() => {});
  check('Cuando llega el organizador aparece el partido', await held.page.locator(`#self-list li[data-match="${MID}"]`).count() === 1);
  await held.ctx.close();

  // 3) El servidor no tiene el token: error y Reintentar.
  const missing = await openPage({ token: 'tokenFicticioInexistente01', hashWait: '#player-share-error, #player-signup, #self-list, #player-loading' });
  await missing.page.waitForSelector('#player-share-error', { timeout: 20000 }).catch(() => {});
  const err = await missing.page.locator('#player-share-error').textContent().catch(() => '');
  check('Token que no existe: «No se pudieron cargar los partidos.»', /No se pudieron cargar los partidos/.test(err || ''), err);
  check('Token que no existe: botón Reintentar', await missing.page.locator('#player-share-retry').count() === 1);
  check('Token que no existe: no se pinta la lista vacía', await missing.page.locator('#self-list, #player-signup').count() === 0);
  await missing.ctx.close();

  // 4) Notificaciones ya bloqueadas: el aviso se ve sin tocar el botón; el botón sigue.
  const blocked = await openPage({ denied: true, hashWait: '#player-signup, #player-share-error, #player-loading' });
  await blocked.page.waitForSelector(`#self-list li[data-match="${MID}"], #player-push`, { timeout: 15000 }).catch(() => {});
  const notice = await blocked.page.locator('#player-push-msg').textContent().catch(() => '');
  const hidden = await blocked.page.locator('#player-push-msg').isHidden().catch(() => true);
  check('Avisos bloqueados: el botón sigue a la vista', await blocked.page.locator('#player-push').count() === 1);
  check('Avisos bloqueados: el aviso se ve sin tocar el botón', !hidden && /El navegador no deja mostrar avisos/.test(notice || ''), notice);
  check('Avisos bloqueados: la lista de partidos se ve', await blocked.page.locator(`#self-list li[data-match="${MID}"]`).count() === 1);
  await blocked.ctx.close();
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
