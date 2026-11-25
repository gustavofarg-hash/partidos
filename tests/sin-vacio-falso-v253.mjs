// v253: ninguna lista dice «No hay…» antes de que lleguen los datos (Próximos,
// Pasados, Jugadores, Estadísticas Día/Mes/Año, Registro, Usuarios); con la lista
// de verdad vacía el mensaje sigue saliendo. Y al recargar con la caché igual al
// servidor no aparece el cartel rojo de «No hay conexión con la base de datos».
// Solo el emulador. Datos ficticios.
// Uso (con firestore y auth en el emulador):
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8181 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tests/sin-vacio-falso-v253.mjs http://127.0.0.1:18530/
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { refuseRealTarget, refuseUnlessEmulator } from './no-real-firebase.mjs';

refuseUnlessEmulator();
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18530/';
refuseRealTarget(BASE);

const PROJECT = 'demo-sin-vacio';
const host = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const [fsHost, fsPort] = host.split(':');
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
const { doc, setDoc, deleteDoc } = await import('firebase/firestore');
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: fsHost, port: Number(fsPort) },
});

const EMAIL = 'organizador@ficticio.test';
const PASS = 'clave-ficticia-253';
const RID = 'FicticioJugadorUno001';
const fmt = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires' }).format(new Date(ms));
const tomorrow = fmt(Date.now() + 864e5);
const yesterday = fmt(Date.now() - 864e5);

await testEnv.clearFirestore();
await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
const signUp = await (await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS, returnSecureToken: true }),
})).json();
const U = signUp.localId;
await testEnv.withSecurityRulesDisabled(async (c) => {
  const db = c.firestore();
  const put = (p, id, d) => setDoc(doc(db, p, id), d);
  await put('users', U, { role: 'admin', name: 'Organizador', email: EMAIL, active: true, createdAt: 1 });
  await put('roster', RID, { name: 'Ficticio Uno', createdBy: 'Organizador', createdByUid: U, holders: [U], createdAt: 1, updatedAt: 1, hasPhone: false, phoneKey: '', phoneOwnerUid: U, phoneShared: false });
  for (const [id, date] of [['m-next', tomorrow], ['m-past', yesterday]]) {
    await put('matches', id, { date, time: '20:00', note: 'Ficticio', capacity: 14, perTeam: 7, viewers: ['*'], adders: [U], createdByUid: U, createdBy: 'Organizador', playerCount: 1 });
    await put('players', `${id}-p`, { matchId: id, matchDate: date, name: 'Ficticio Uno', rosterId: RID, viewers: ['*'], editors: ['*'], paid: true, split: true, cash: 5000, cashTo: 'Organizador', transfer: 0, fromCredit: 0, pendingTransfer: 0, addedByUid: U, addedBy: 'Organizador', signedUpWith: U, signedUpWithName: 'Organizador', createdAt: 1 });
  }
  await put('log', 'l1', { at: Date.now() - 6e4, section: 'partidos', type: 'nuevo partido', editors: ['*'], viewers: ['*'], actorUid: U, actorName: 'Organizador', matchId: 'm-next' });
});

const EMPTY = { '#home-empty': 'home-empty', '#list-history.empty': 'hist-empty', 'p#roster-list.empty-wait': 'roster-empty', '#stats-days .empty-wait': 'dia-empty', '#stats-periods .empty-wait': 'per-empty', '#log-empty': 'log-empty', '#user-list .empty-wait': 'users-empty' };
const FULL = { '#list-next .match-card': 'home', '#list-history .match-card': 'hist', 'ul#roster-list li': 'roster', '#stats-days [data-date]': 'dia', '#stats-periods [data-period]': 'per', '#log-list li': 'log', '#user-list li:not(.empty-wait):not(.loading)': 'users' };
const ROUTES = [
  ['#/', 'Próximos', 'home'], ['#/historial', 'Pasados', 'hist'], ['#/jugadores', 'Jugadores', 'roster'],
  ['#/estadisticas/dia', 'Estadísticas · Día', 'dia'], ['#/estadisticas/mes', 'Estadísticas · Mes', 'per'],
  ['#/estadisticas/anio', 'Estadísticas · Año', 'per'], ['#/registro', 'Registro', 'log'], ['#/usuarios', 'Usuarios', 'users'],
];

const browser = await chromium.launch();
const pageErrors = [];
async function newContext(delay = 0) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await ctx.addInitScript((info) => {
    globalThis.__F7C_TEST = true;
    globalThis.__F7C_EMULATOR_HOST = info.firestore;
    globalThis.__F7C_AUTH_EMULATOR = `http://${info.auth}`;
    let on = false;
    try { on = !!sessionStorage.getItem('__mirar'); } catch { /* about:blank */ }
    const seen = { states: [], on };
    globalThis.__seen = seen;
    const look = () => {
      if (!seen.on) return;
      const parts = [];
      for (const [sel, n] of Object.entries(info.EMPTY)) if (document.querySelector(sel)) parts.push(n);
      for (const [sel, n] of Object.entries(info.FULL)) if (document.querySelector(sel)) parts.push(n);
      if (document.querySelector('#view .loading')) parts.push('loading');
      const s = parts.join('+') || 'otro';
      if (seen.states[seen.states.length - 1] !== s) seen.states.push(s);
    };
    const start = () => {
      new MutationObserver(look).observe(document.documentElement, { childList: true, subtree: true });
      const tick = () => { look(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    };
    if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  }, { firestore: host, auth: authHost, EMPTY, FULL });
  await ctx.route(/https?:\/\/([^/]+\.)?(googleapis\.com|firebaseio\.com)\//, (r) => r.abort());
  if (delay) {
    await ctx.route(/127\.0\.0\.1:\d+\/(google\.firestore|identitytoolkit|securetoken)/, async (r) => {
      await new Promise((ok) => setTimeout(ok, Math.random() * delay));
      r.continue().catch(() => {});
    });
  }
  await ctx.route('**/config.js', async (route) => {
    const body = readFileSync(new URL('../config.js', import.meta.url), 'utf8').replace(/projectId:\s*["'][^"']+["']/, `projectId: "${PROJECT}"`);
    await route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  await page.goto(BASE);
  await page.waitForSelector('#login-form', { timeout: 20000 });
  await page.fill('#login-email', EMAIL);
  await page.fill('#login-password', PASS);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.loaded, null, { timeout: 20000 });
  return { ctx, page };
}
async function statesFor(hash, delay) {
  const { ctx, page } = await newContext(delay);
  await page.evaluate(() => sessionStorage.setItem('__mirar', '1'));
  await page.goto('about:blank');
  await page.goto(BASE + hash);
  await page.waitForTimeout(4000);
  const states = await page.evaluate(() => globalThis.__seen.states);
  await ctx.close();
  return states;
}

try {
  for (const [hash, name, full] of ROUTES) {
    const states = await statesFor(hash, 400);
    const flash = states.filter((s) => /-empty/.test(s));
    check(`${name}: no dice «No hay…» antes de que lleguen los datos`, !flash.length && states.some((s) => s.split('+').includes(full)), states.join(' > '));
  }

  // El cartel: con la caché persistente, la segunda carga trae lo mismo que el servidor.
  {
    const { ctx, page } = await newContext();
    await page.waitForTimeout(3000);
    await page.reload();
    await page.waitForFunction(() => window.__app?.loaded, null, { timeout: 20000 });
    await page.waitForTimeout(17000);
    const info = await page.evaluate(() => {
      const el = document.querySelector('#error-banner');
      return { banner: el && !el.hidden ? el.textContent.trim() : '', serverOk: !!window.__app.store.serverOk, fromCache: window.__app.fromCache };
    });
    check('Al recargar (caché igual al servidor) no sale el cartel de «No hay conexión»', !info.banner && info.serverOk && info.fromCache === false, JSON.stringify(info));
    await ctx.close();
  }

  // De verdad vacío: el mensaje sigue saliendo.
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    for (const id of ['m-next', 'm-past']) { await deleteDoc(doc(db, 'matches', id)); await deleteDoc(doc(db, 'players', `${id}-p`)); }
    await deleteDoc(doc(db, 'log', 'l1'));
    await deleteDoc(doc(db, 'roster', RID));
  });
  for (const [hash, name, want] of [['#/', 'Próximos', 'home-empty'], ['#/historial', 'Pasados', 'hist-empty'], ['#/registro', 'Registro', 'log-empty'], ['#/jugadores', 'Jugadores', 'roster-empty'], ['#/estadisticas/dia', 'Estadísticas · Día', 'dia-empty']]) {
    const states = await statesFor(hash, 0);
    check(`${name} de verdad vacío: sigue diciendo «No hay…»`, states.at(-1)?.split('+').includes(want), states.join(' > '));
  }
  check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close();
  await testEnv.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
