// v247: Autoservicio de un jugador suspendido. La lista de partidos no aparece NUNCA,
// ni un instante, ni con la caché del navegador. Solo el emulador. Datos ficticios.
// Uso: FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/autoservicio-suspendido-v247.mjs http://127.0.0.1:18447/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18447/';
refuseRealTarget(BASE);

const PROJECT = 'demo-suspendido';
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

const RID = 'FicticioSuspendido001';
const RID2 = 'FicticioHabilitado002';
const TOKG = 'tokenFicticioGustavo0001';
const TOKM = 'tokenFicticioMartin00001';
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(Date.now() + 864e5));

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  const put = (path, id, data) => setDoc(doc(db, path, id), data);
  await put('users', 'gus', { role: 'organizer', name: 'Gustavo', active: true, createdAt: 1 });
  await put('users', 'mar', { role: 'organizer', name: 'Martín', active: true, createdAt: 1 });
  for (const [id, name] of [[RID, 'Ficticio Suspendido'], [RID2, 'Ficticio Habilitado']]) {
    await put('roster', id, { name, createdBy: 'Gustavo', createdByUid: 'gus', holders: ['gus', 'mar'], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: 'gus', phoneShared: false });
  }
  await put('shareTokens', TOKG, { uid: 'gus', name: 'Gustavo', createdAt: 1 });
  await put('shareTokens', TOKM, { uid: 'mar', name: 'Martín', createdAt: 1 });
  const match = (id, time, createdByUid, adders) => put('matches', id, {
    date: tomorrow, time, note: `Ficticio ${id}`, capacity: 14, perTeam: 7, viewers: ['*'], adders, createdByUid,
    createdBy: createdByUid === 'gus' ? 'Gustavo' : 'Martín', playerVisible: true, playerCount: 0,
  });
  await match('m-gus', '19:00', 'gus', ['gus']);
  await match('m-mar', '21:00', 'mar', ['mar']);
  await match('m-shared', '22:00', 'gus', ['gus', 'mar']);
  // Gustavo suspendió a la primera ficha.
  await put('suspendFlags', `${RID}_gus`, { ownerUid: 'gus', rosterId: RID, at: 1 });
});

const browser = await chromium.launch();
async function guest({ delay = 0, fail = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires', serviceWorkers: 'block' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
    if (info.delay) globalThis.__F7C_FLAG_DELAY_MS = info.delay;
    if (info.fail) globalThis.__F7C_FLAG_FAIL = true;
    // Desde el primer pintado: ¿apareció alguna vez la lista o un partido?
    const t0 = performance.now();
    const seen = { signup: false, rows: [], firstFinal: '', at: 0, states: [] };
    globalThis.__seen = seen;
    const look = () => {
      const rows = [...document.querySelectorAll('#self-list .self-row, #self-list [data-match]')].map((el) => el.dataset.match || '?');
      if (document.querySelector('#player-signup')) seen.signup = true;
      for (const id of rows) if (!seen.rows.includes(id)) seen.rows.push(id);
      const state = document.querySelector('#player-locked') ? 'locked' : document.querySelector('#player-signup') ? 'signup' : document.querySelector('#player-check-error') ? 'error' : document.querySelector('#player-loading, .loading') ? 'loading' : 'other';
      if (seen.states[seen.states.length - 1] !== state) seen.states.push(state);
      if (!seen.firstFinal && ['locked', 'signup', 'error'].includes(state)) { seen.firstFinal = state; seen.at = Math.round(performance.now() - t0); }
    };
    const start = () => {
      look();
      new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      const tick = () => { look(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  }, { firestore: host, auth: authHost, delay, fail });
  await ctx.route(/https?:\/\/([^/]+\.)?(firestore\.googleapis\.com|firebaseio\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com)\//, (route) => route.abort());
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const settle = async (page) => {
  await page.waitForSelector('#player-locked, #player-signup, #player-check-error, #player-link-invalid', { timeout: 20000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => ({ ...globalThis.__seen, final: document.querySelector('#player-locked') ? 'locked' : document.querySelector('#player-signup') ? 'signup' : document.querySelector('#player-check-error') ? 'error' : 'other', list: [...new Set([...document.querySelectorAll('#self-list [data-match]')].map((el) => el.dataset.match))] }));
};

const pageErrors = [];
try {
  // 1) Link de quien lo suspendió, con la marca lenta: nunca la lista.
  {
    const g = await guest({ delay: 700 });
    await g.page.goto(`${BASE}#/jugador/${RID}/${TOKG}`);
    const r = await settle(g.page);
    check('Link de quien lo suspendió: termina en NO TENÉS ACCESO', r.final === 'locked', JSON.stringify(r.states));
    check('…y la lista de partidos no apareció nunca', !r.signup && r.rows.length === 0 && r.final === 'locked', JSON.stringify({ signup: r.signup, rows: r.rows }));
    // Otra vez, con la caché del navegador (IndexedDB) ya cargada.
    await g.page.evaluate(() => { globalThis.__seen = null; });
    await g.page.reload();
    const again = await settle(g.page);
    check('Con la caché del navegador tampoco aparece', again.final === 'locked' && !again.signup && again.rows.length === 0, JSON.stringify(again.states));
    pageErrors.push(...g.errors);
    await g.ctx.close();
  }
  // 2) Link de otro organizador: entra, ve el de Martín y nunca los de Gustavo (ni el compartido).
  {
    const g = await guest({ delay: 700 });
    await g.page.goto(`${BASE}#/jugador/${RID}/${TOKM}`);
    const r = await settle(g.page);
    check('Link de otro organizador: entra', r.final === 'signup', JSON.stringify(r.states));
    check('…ve el partido de Martín', r.list.includes('m-mar'), JSON.stringify(r.list));
    check('…y nunca vio, ni un instante, los de quien lo suspendió', !r.rows.includes('m-gus') && !r.rows.includes('m-shared'), JSON.stringify(r.rows));
    pageErrors.push(...g.errors);
    await g.ctx.close();
  }
  // 3) Jugador no suspendido: ve la lista y la espera extra es mínima.
  {
    const g = await guest();
    const t0 = Date.now();
    await g.page.goto(`${BASE}#/jugador/${RID2}/${TOKG}`);
    const r = await settle(g.page);
    check('No suspendido: ve sus partidos', r.final === 'signup' && r.list.includes('m-gus') && r.list.includes('m-shared'), JSON.stringify(r.list));
    check('…sin pasar por NO TENÉS ACCESO', !r.states.includes('locked'), JSON.stringify(r.states));
    console.log(`   (lista visible a los ${r.at} ms del primer pintado; ${Date.now() - t0} ms con la espera de la prueba)`);
    pageErrors.push(...g.errors);
    await g.ctx.close();
  }
  // 4) Si leer la marca falla: ni la lista ni NO TENÉS ACCESO; un aviso con Reintentar.
  {
    const g = await guest({ fail: true });
    await g.page.goto(`${BASE}#/jugador/${RID}/${TOKG}`);
    const r = await settle(g.page);
    check('Si falla la marca: aviso para reintentar', r.final === 'error' && (await g.page.locator('#player-check-retry').count()) === 1, JSON.stringify(r.states));
    check('…y la lista no apareció nunca', !r.signup && r.rows.length === 0, JSON.stringify(r.states));
    await g.ctx.close();
  }
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
