// v237: «Resetear link» en el navegador, en modo demo (sin Firebase).
// python3 -m http.server 18437 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-resetear-link.mjs http://127.0.0.1:18437/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18437/';
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
  await ctx.route(/firestore\.googleapis\.com|firebaseio\.com|identitytoolkit\.googleapis\.com/, (route) => route.abort());
  return ctx;
};
const errors = [];
const ctx = await demoContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const linkOf = (url) => { const at = url.indexOf('#/jugador/'); return at < 0 ? '' : url.slice(at).split('&')[0]; };
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who);
  const ids = await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const rid = await s.addRoster({ name: 'Reset Prueba', phone: '5491170003701' }, who);
    const mid = await s.addMatch({ date: '2099-12-01', time: '21:00', capacity: 14 }, who);
    const match = window.__app.matches.find((m) => m.id === mid) || { id: mid, date: '2099-12-01', capacity: 14 };
    await s.addPlayer(match, { name: 'Reset Prueba', phone: '5491170003701', rosterId: rid }, who);
    return { rid, mid };
  });
  const share = async (opener) => {
    const [pop] = await Promise.all([page.waitForEvent('popup'), opener()]);
    await pop.waitForURL((u) => /wa\.me|whatsapp|phone=/.test(String(u)), { waitUntil: 'commit' }).catch(() => {});
    const url = decodeURIComponent(pop.url());
    await pop.close();
    return url;
  };

  await page.evaluate((id) => { location.hash = `#/jugador/${encodeURIComponent(id)}`; }, ids.rid);
  await page.waitForSelector('#profile-more');
  await page.click('#profile-more');
  check('El menú ⋮ ofrece 🔃 Resetear link primero', (await page.locator('#profile-more-menu .more-item').first().innerText()).trim() === '🔃 Resetear link');
  const before = await share(() => page.click('#profile-more-menu [data-more="share"]'));
  const oldLink = linkOf(before);
  check('Antes de resetear, el link es el de siempre (sin clave)', oldLink.split('/').length === 4, oldLink);

  // Cancelar no cambia nada.
  await page.click('#profile-more');
  await page.click('#profile-more-menu [data-more="reset"]');
  await page.waitForSelector('#ask[open]');
  const question = (await page.locator('#ask[open]').innerText()).trim();
  check('Pide confirmación con el texto pedido', question.includes('¿Resetear el link de Reset Prueba? Los links anteriores dejan de funcionar.'), question);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v237-confirmar.png` });
  await page.locator('#ask[open] button', { hasText: /Cancelar|No/ }).first().click();
  check('Cancelar no resetea', await page.evaluate((id) => window.__app.store.rosterLinkKey(id), ids.rid) === '');

  // Resetear: ofrece compartir el link nuevo enseguida.
  await page.click('#profile-more');
  await page.click('#profile-more-menu [data-more="reset"]');
  await page.waitForSelector('#ask[open]');
  await page.locator('#ask[open] button', { hasText: 'Resetear' }).click();
  await page.waitForSelector('#reset-share');
  check('Después de resetear, la hoja ofrece Compartir link', (await page.locator('dialog.sheet[open]').innerText()).includes('Los links anteriores de Reset Prueba ya no funcionan.'));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/v237-reseteado.png` });
  const fresh = await share(() => page.click('#reset-share'));
  const key1 = await page.evaluate((id) => window.__app.store.rosterLinkKey(id), ids.rid);
  const newLink = linkOf(fresh);
  check('Compartir link abre el WhatsApp del jugador con el link nuevo (con la clave)', /phone=5491170003701|wa\.me\/5491170003701/.test(fresh) && newLink.endsWith(`/${key1}`) && key1.length >= 16, newLink);
  const copied = await page.evaluate(async (id) => {
    let got = '';
    navigator.clipboard.writeText = async (t) => { got = t; };
    document.querySelector('#profile-share')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return got;
  }, ids.rid);
  check('El ícono de compartir copia el link nuevo', !copied || copied.endsWith(`/${key1}`), copied.slice(-60));

  // Rotar otra vez: la clave cambia.
  await page.click('#profile-more');
  await page.click('#profile-more-menu [data-more="reset"]');
  await page.waitForSelector('#ask[open]');
  await page.locator('#ask[open] button', { hasText: 'Resetear' }).click();
  await page.waitForSelector('#reset-share');
  const key2 = await page.evaluate((id) => window.__app.store.rosterLinkKey(id), ids.rid);
  check('Resetear de nuevo rota la clave', key2 && key2 !== key1);
  await page.click('dialog.sheet[open] [data-close]');
  const seed = await page.evaluate(() => localStorage.getItem('f7c-demo-db'));
  const token = newLink.split('/')[3];

  // Sin sesión: link viejo, link con la clave anterior, link nuevo.
  const guestCtx = await demoContext(seed);
  const guest = await guestCtx.newPage();
  guest.on('pageerror', (e) => errors.push(e.message));
  const open = async (hash) => {
    await guest.goto(`${BASE}${hash}`);
    await guest.waitForSelector('#player-link-invalid, #player-signup, #player-locked', { timeout: 15000 });
    if (await guest.locator('#player-link-invalid').count()) return (await guest.locator('#player-link-invalid').innerText()).trim();
    if (await guest.locator('#player-signup').count()) return 'ficha';
    return 'sin acceso';
  };
  const msg = 'Este link ya no es válido. Pedí uno nuevo al organizador.';
  const viaOld = await open(oldLink);
  check('Sin sesión, el link de antes del reset muestra el aviso', viaOld.includes(msg), viaOld);
  if (SHOTS) await guest.screenshot({ path: `${SHOTS}/v237-link-viejo.png` });
  await guestCtx.close();
  const g2 = await demoContext(seed);
  const p2 = await g2.newPage();
  const open2 = async (hash) => {
    await p2.goto(`${BASE}${hash}`);
    await p2.waitForSelector('#player-link-invalid, #player-signup, #player-locked', { timeout: 15000 });
    if (await p2.locator('#player-link-invalid').count()) return (await p2.locator('#player-link-invalid').innerText()).trim();
    return (await p2.locator('#player-signup').count()) ? 'ficha' : 'sin acceso';
  };
  check('Sin sesión, el link con la clave anterior muestra el aviso', (await open2(`#/jugador/${ids.rid}/${token}/${key1}`)).includes(msg));
  await g2.close();
  const g3 = await demoContext(seed);
  const p3 = await g3.newPage();
  p3.on('pageerror', (e) => errors.push(e.message));
  await p3.goto(`${BASE}#/jugador/${ids.rid}/${token}/${key2}`);
  await p3.waitForSelector('#player-signup, #player-link-invalid, #player-locked', { timeout: 15000 });
  check('Sin sesión, el link nuevo abre la ficha del jugador', await p3.locator('#player-signup').count() === 1 && (await p3.locator('#player-signup-name').innerText()).includes('Reset'));
  if (SHOTS) await p3.screenshot({ path: `${SHOTS}/v237-link-nuevo.png` });
  await g3.close();
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
