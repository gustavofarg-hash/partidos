// v246: en «No jugó pero pagó» (y en el partido y la espera) la línea del pago se ve entera, sin «…». Demo, datos ficticios.
// python3 -m http.server 18446 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-pago-entero-v246.mjs http://127.0.0.1:18446/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18446/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const SHOTS = process.env.SHOTS || '';

const browser = await chromium.launch();
const demoContext = async (seed = null) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
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
  await ctx.route(/firestore\.googleapis\.com|firebaseio\.com|identitytoolkit\.googleapis\.com/, (route) => route.abort());
  return ctx;
};
const errors = [];
const ctx = await demoContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who && window.__app.store?.actor?.uid);
  const mid = await page.evaluate(async () => {
    const s = window.__app.store;
    const day = '2099-11-28';
    const id = await s.addMatch({ date: day, time: '20:00', capacity: 1 }, 'Gustavo');
    const m = { id, date: day, capacity: 1 };
    await s.addPlayer(m, { name: 'Ficticio Titular' }, 'Gustavo');
    await s.addPlayer(m, { name: 'Ficticio Espera' }, 'Gustavo');
    await s.addPlayer(m, { name: 'Ficticio No Jugó' }, 'Gustavo', { noPlay: true });
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    for (const row of Object.values(db.players)) {
      if (row.matchId !== id) continue;
      Object.assign(row, { paid: true, amount: 5000, transfer: 5000, transferTo: 'Gustavo', cash: 0, method: 'transferencia', receivedBy: 'Gustavo' });
    }
    localStorage.setItem('f7c-demo-db', JSON.stringify(db));
    return id;
  });
  await page.reload();
  await page.waitForFunction(() => window.__app?.who);
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, mid);
  await page.waitForSelector('#no-play-list .pay-line');
  const lineOf = (list) => page.evaluate((sel) => {
    const el = document.querySelector(`${sel} .pay-line`);
    if (!el) return null;
    const css = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const row = el.closest('.slot').getBoundingClientRect();
    return { text: el.textContent.trim(), cut: el.scrollWidth > el.clientWidth + 1, ellipsis: css.textOverflow === 'ellipsis' && css.whiteSpace === 'nowrap', inside: r.right <= row.right + 1 };
  }, list);
  for (const [label, sel] of [['No jugó pero pagó', '#no-play-list'], ['el partido', '#slots'], ['la espera', '#wait-list']]) {
    const line = await lineOf(sel);
    check(`En ${label} el pago dice «cobró Gustavo» entero`, line && line.text.endsWith('cobró Gustavo') && !line.cut && !line.ellipsis && line.inside, JSON.stringify(line));
  }
  await page.locator('#no-play-list').scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v246-no-jugo-pago.png` });
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
