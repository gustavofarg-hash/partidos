// v250: «Cancelar partido» también con el partido vacío, y cancelarlo no rompe nada.
// Modo demo, sin Firebase (toda la red de Firebase cortada). Datos ficticios.
// python3 -m http.server 18450 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-cancelar-vacio-v250.mjs http://127.0.0.1:18450/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18450/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const SHOTS = process.env.SHOTS || '';

const browser = await chromium.launch();
const demoContext = async (seed = null) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
  await ctx.addInitScript((db) => {
    globalThis.__F7C_TEST = true;
    if (db && !localStorage.getItem('f7c-demo-db')) localStorage.setItem('f7c-demo-db', db);
  }, seed);
  await ctx.route('**/config.js', async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/export const firebaseConfig = \{[\s\S]*?\n\};/, `export const firebaseConfig = {
  apiKey: "TU_API_KEY", authDomain: "TU_PROYECTO.firebaseapp.com", projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app", messagingSenderId: "TU_SENDER_ID", appId: "TU_APP_ID",
};`).replace(/export const FCM_VAPID_KEY = ".*";/, 'export const FCM_VAPID_KEY = "";');
    if (/projectId:\s*["'](?:mis-partidos-prueba|futbol-partidos)["']/.test(body)) throw new Error('config.js sigue apuntando a un proyecto real');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  await ctx.route(/firestore\.googleapis\.com|firebaseio\.com|identitytoolkit\.googleapis\.com|gstatic\.com/, (route) => route.abort());
  return ctx;
};
const login = async (page, email, password) => {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', email);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who && window.__app.store?.actor?.uid);
};
const errors = [];
const toasts = [];
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/v250-${name}.png` }); };
try {
  const ctx = await demoContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'gustavo@demo.local', 'demo-gustavo');
  await page.exposeFunction('__noteToast', (t) => toasts.push(t));
  await page.evaluate(() => {
    const el = document.querySelector('#toast');
    new MutationObserver(() => { if (el.textContent) window.__noteToast(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  const ids = await page.evaluate(async () => {
    const s = window.__app.store;
    const empty = await s.addMatch({ date: '2099-12-11', time: '20:00', capacity: 14 }, 'Gustavo');
    const full = await s.addMatch({ date: '2099-12-12', time: '20:00', capacity: 14 }, 'Gustavo');
    await s.addPlayer({ id: full, date: '2099-12-12', capacity: 14 }, { name: 'Ficticio Anotado' }, 'Gustavo');
    return { empty, full };
  });
  const open = async (id) => {
    await page.evaluate((mid) => { location.hash = `#/partido/${encodeURIComponent(mid)}`; }, id);
    await page.waitForSelector('#btn-teams');
  };

  await open(ids.full);
  check('Con jugadores sigue el botón Cancelar partido', (await page.locator('#btn-cancel-match').count()) === 1);
  await open(ids.empty);
  check('Sin jugadores: se ve Cancelar partido', await page.locator('#btn-cancel-match').isVisible());
  check('Sin jugadores: Borrar sigue estando', (await page.locator('#btn-del-match').count()) === 1);

  await page.click('#btn-cancel-match');
  await page.waitForSelector('#ask-ok');
  await page.click('#ask-ok');
  await page.waitForSelector('#cancel-form');
  const hint = await page.locator('#cancel-hint').innerText();
  check('El aviso no dice «con sus 0 jugadores»', !/0 jugadores/.test(hint) && hint.startsWith('Queda cancelado. No se borra.'), hint);
  await page.fill('#cancel-notes', 'Lluvia');
  await page.click('#cancel-form button[type=submit]');
  await page.waitForSelector('#match-cancelled', { timeout: 10000 });
  await page.waitForTimeout(800);
  const saved = await page.evaluate((mid) => JSON.parse(localStorage.getItem('f7c-demo-db')).matches[mid], ids.empty);
  check('Queda cancelado con las notas', saved?.cancelled === true && saved?.notes === 'Lluvia' && typeof saved?.cancelledAt === 'number', JSON.stringify({ cancelled: saved?.cancelled, notes: saved?.notes }));
  check('Avisa «Partido cancelado»', toasts.some((t) => t.includes('Partido cancelado')), toasts.join(' | '));
  check('No ofrece WhatsApp ni dice que nadie tiene WhatsApp', !toasts.some((t) => /WhatsApp/.test(t)) && (await page.locator('#cancel-links').count()) === 0 && !(await page.locator('#ask-ok').isVisible()), toasts.join(' | '));
  check('Ya cancelado: no se ve Cancelar y sí Reactivar', (await page.locator('#btn-cancel-match').count()) === 0 && (await page.locator('#btn-reactivate-match').count()) === 1);
  await shot(page, 'cancelado-vacio');
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
