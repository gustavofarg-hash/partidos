// v238: Enviar recordatorios usa el WhatsApp de la ficha cuando la fila no lo trae
// (alta por el link). En modo demo, sin Firebase.
// python3 -m http.server 18438 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-recordatorio-agenda.mjs http://127.0.0.1:18438/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18438/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires' });
await ctx.addInitScript(() => { globalThis.__F7C_TEST = true; });
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
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const PHONE = '5491170003801'; // ficticio
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who);
  const ids = await page.evaluate(async (phone) => {
    const s = window.__app.store; const who = window.__app.who;
    const rid = await s.addRoster({ name: 'Agustín Recordatorio', shortName: 'Agus', phone }, who);
    const mid = await s.addMatch({ date: '2099-11-23', time: '16:30', capacity: 14 }, who);
    const match = window.__app.matches.find((m) => m.id === mid) || { id: mid, date: '2099-11-23', capacity: 14 };
    // Como el alta por el link: la fila apunta a la ficha pero no trae número.
    const pid = await s.addPlayer(match, { name: 'Agustín Recordatorio', rosterId: rid, shortName: 'Agus' }, who);
    return { rid, mid, pid };
  }, PHONE);
  const row = await page.evaluate((pid) => JSON.parse(localStorage.getItem('f7c-demo-db')).players[pid], ids.pid);
  check('La fila del partido no trae número (como el alta por el link)', !row.phone && row.hasPhone !== true);
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, ids.mid);
  await page.waitForSelector('.slot:has-text("Agus") .phone-line');
  const shown = (await page.locator('.slot:has-text("Agus") .phone-line').innerText()).replace(/\D/g, '');
  check('La lista del partido muestra el WhatsApp de la ficha', shown.endsWith('70003801'), shown);
  await page.click('#btn-remind');
  await page.waitForSelector('#remind-list');
  const remind = page.locator('#remind-list .remind-row', { hasText: 'Agustín Recordatorio' });
  const text = (await remind.innerText()).replace(/\s+/g, ' ');
  check('Enviar recordatorios no pide «Cargar WhatsApp»', !text.includes('Cargar WhatsApp') && !text.includes('Sin número de WhatsApp'), text);
  const href = await remind.locator('a[data-send]').getAttribute('href').catch(() => '');
  check('El Enviar abre el WhatsApp de ese número', decodeURIComponent(href || '').includes(PHONE), (href || '').slice(0, 80));
  const prog = (await page.locator('#remind-prog').innerText()).trim();
  check('El contador lo cuenta («0 de 1 enviados»)', prog.startsWith('0 de 1 enviados'), prog);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/v238-recordatorios.png` });
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
