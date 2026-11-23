// v236 (punto 1): los tres puntos del jugador en el navegador, en modo demo.
// python3 -m http.server 18436 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-tres-puntos.mjs http://127.0.0.1:18436/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18436/';
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
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who);
  const ids = await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const rid = await s.addRoster({ name: 'Menu Prueba', phone: '5491170003601' }, who);
    const mid = await s.addMatch({ date: '2026-12-01', time: '21:00', capacity: 14 }, who);
    const match = window.__app.matches.find((m) => m.id === mid) || { id: mid, date: '2026-12-01', capacity: 14 };
    await s.addPlayer(match, { name: 'Menu Prueba', phone: '5491170003601', rosterId: rid }, who);
    return { rid, mid };
  });
  const items = (id) => page.$$eval(`#${id}-menu .more-item`, (els) => els.map((e) => `${e.textContent}${e.disabled ? ' (deshabilitado)' : ''}`).join(' | '));

  // Perfil en Jugadores
  await page.evaluate((id) => { location.hash = `#/jugador/${encodeURIComponent(id)}`; }, ids.rid);
  await page.waitForSelector('#profile-more');
  const order = await page.evaluate(() => [...document.querySelector('#profile .name-share').children].map((el) => el.id || el.className));
  check('Perfil: los tres puntos quedan a la derecha de compartir', order.join(',') === 'section,profile-share,more-wrap', order.join(','));
  check('El menú arranca cerrado', await page.$eval('#profile-more-menu', (el) => el.hidden));
  await page.click('#profile-more');
  check('Perfil: Resetear link, Compartir link, Cargar Crédito y Devolver Crédito (deshabilitado con $0)', (await items('profile-more')) === '🔃 Resetear link | Compartir link | Cargar Crédito | Devolver Crédito (deshabilitado)', await items('profile-more'));
  await page.mouse.click(20, 780);
  check('Tocar afuera lo cierra', await page.$eval('#profile-more-menu', (el) => el.hidden));
  await page.click('#profile-more');
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.click('#profile-more-menu [data-more="share"]')]);
  await pop.waitForURL((u) => /wa\.me|whatsapp|phone=/.test(String(u)), { waitUntil: 'commit' }).catch(() => {});
  const shared = decodeURIComponent(pop.url());
  check('Compartir link abre el WhatsApp del jugador con el link completo', /phone=5491170003601|wa\.me\/5491170003601/.test(shared) && shared.includes(`#/jugador/${ids.rid}/`) && !/spoo\.me|da\.gd|\/c\/\?k=/.test(shared), shared.slice(0, 160));
  await pop.close();
  check('El ícono de compartir sigue copiando', await page.locator('#profile-share').count() === 1);

  // Cargar Crédito desde los tres puntos, después Devolver queda habilitado
  await page.click('#profile-more');
  await page.click('#profile-more-menu [data-more="credit"]');
  await page.waitForSelector('dialog.sheet[open] input[name="amount"]');
  check('Cargar Crédito abre la misma hoja de siempre', (await page.locator('dialog.sheet[open] h3').first().innerText()).trim() === 'Cargar crédito');
  // Cargar cancela primero la deuda del partido ($5.000): 8000 deja $3.000 de crédito.
  await page.fill('dialog.sheet[open] input[name="amount"]', '8000');
  await page.click('dialog.sheet[open] button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('dialog.sheet[open] input[name="amount"]'));
  await page.waitForFunction(() => !document.querySelector('#profile-more-menu [data-more="refund"]')?.disabled);
  await page.click('#profile-more');
  check('Con crédito, Devolver Crédito se habilita', (await items('profile-more')) === '🔃 Resetear link | Compartir link | Cargar Crédito | Devolver Crédito', await items('profile-more'));
  await page.click('#profile-more-menu [data-more="refund"]');
  await page.waitForSelector('dialog.sheet[open]');
  check('Devolver Crédito abre la misma hoja de siempre', (await page.locator('dialog.sheet[open] h3').first().innerText()).trim() === 'Devolver crédito');
  await page.click('dialog.sheet[open] [data-close]');

  // Menú del jugador en el partido
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, ids.mid);
  await page.waitForSelector('.slot:has-text("Menu Prueba") .more-btn');
  await page.click('.slot:has-text("Menu Prueba") .more-btn');
  await page.waitForSelector('#pm-more');
  const menuOrder = await page.evaluate(() => [...document.querySelector('dialog.sheet .name-share').children].map((el) => el.id || el.className || el.tagName.toLowerCase()));
  check('Menú del jugador: los tres puntos a la derecha de compartir', menuOrder.join(',').replace(/^[^,]*,/, 'h3,') === 'h3,pm-share,more-wrap', menuOrder.join(','));
  await page.click('#pm-more');
  check('Menú del jugador: las cuatro opciones', (await items('pm-more')) === '🔃 Resetear link | Compartir link | Cargar Crédito | Devolver Crédito', await items('pm-more'));
  const box = await page.evaluate(() => { const r = document.querySelector('#pm-more-menu').getBoundingClientRect(); return { left: r.left, right: r.right, vw: innerWidth }; });
  check('El menú entra en la pantalla', box.left >= 0 && box.right <= box.vw, JSON.stringify(box));
  await page.focus('#pm-more-menu .more-item');
  await page.keyboard.press('Escape');
  check('Escape cierra los tres puntos y deja el menú del jugador', await page.$eval('#pm-more-menu', (el) => el.hidden) && await page.$eval('dialog.sheet', (el) => el.open));
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
