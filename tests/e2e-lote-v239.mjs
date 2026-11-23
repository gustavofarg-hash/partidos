// v239: lote (#2, #6, #9, #13, #16, #17). En modo demo, sin Firebase. Datos ficticios.
// python3 -m http.server 18439 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-lote-v239.mjs http://127.0.0.1:18439/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18439/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/v239-${name}.png` }); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Buenos_Aires', hasTouch: true });
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
const goHash = (hash) => page.evaluate((h) => { location.hash = h; }, hash);
const closeSheet = async () => {
  await page.evaluate(() => { const s = document.querySelector('#sheet'); if (s?.open) s.close(); });
};
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who);

  // Un partido que empezó hace 20 minutos (o, cerca de medianoche, uno de mañana).
  const ids = await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(Date.now() - 20 * 60e3)).map((p) => [p.type, p.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const time = `${parts.hour}:${parts.minute}`;
    const rPedro = await s.addRoster({ name: 'Pedro Lote Prueba', shortName: 'Pedrito Lo', phone: '5491170003901' }, who);
    const rLink = await s.addRoster({ name: 'Linkero Sin Organizador', phone: '5491170003902' }, who);
    const rPago = await s.addRoster({ name: 'Pago Nojugo', phone: '5491170003903' }, who);
    const mid = await s.addMatch({ date, time, capacity: 14, court: '2' }, who);
    const match = window.__app.matches.find((m) => m.id === mid) || { id: mid, date, time, capacity: 14 };
    const pPedro = await s.addPlayer(match, { name: 'Pedro Lote Prueba', rosterId: rPedro, phone: '5491170003901' }, who);
    // Como un alta por un link viejo sin organizador: «Agregó» es el mismo jugador.
    const pLink = await s.addPlayer(match, { name: 'Linkero Sin Organizador', rosterId: rLink, phone: '5491170003902', signedUpWith: '', signedUpWithName: '' }, 'Linkero Sin Organizador', { addedByUid: 'anonPrueba', selfSignup: true });
    const pPago = await s.addPlayer(match, { name: 'Pago Nojugo', rosterId: rPago, phone: '5491170003903' }, who);
    return { mid, date, time, pPedro, pLink, pPago };
  });

  // #13 búsqueda con varias palabras
  await goHash('#/jugadores');
  await page.waitForSelector('#roster-q');
  await page.fill('#roster-q', 'prueba pedro');
  await page.waitForTimeout(300);
  const hits = (await page.locator('#roster-list').innerText()).replace(/\s+/g, ' ');
  check('#13 «prueba pedro» encuentra a Pedro Lote Prueba', hits.includes('Pedro Lote Prueba') && !hits.includes('Linkero'), hits.slice(0, 160));
  await page.fill('#roster-q', 'pedro lopez');
  await page.waitForTimeout(300);
  const none = (await page.locator('#roster-list').innerText()).replace(/\s+/g, ' ');
  check('#13 una palabra que no está deja la lista vacía', !none.includes('Pedro Lote Prueba'), none.slice(0, 160));
  await shot(page, 'busqueda');
  await page.fill('#roster-q', '');

  // #2 + #17 Enviar recordatorios
  await goHash(`#/partido/${encodeURIComponent(ids.mid)}`);
  await page.waitForSelector('#btn-remind');
  await page.click('#btn-remind');
  await page.waitForSelector('#remind-list');
  const mine = (await page.locator('#remind-list').innerText()).replace(/\s+/g, ' ');
  check('#2 el alta por link sin organizador sale en «Mis jugadores»', mine.includes('Linkero Sin Organizador'), mine.slice(0, 200));
  const pedroHref = await page.locator('#remind-list .remind-row', { hasText: 'Pedro Lote Prueba' }).locator('a[data-send]').getAttribute('href').catch(() => '');
  const pedroText = decodeURIComponent(pedroHref || '');
  check('#17 el recordatorio saluda con la primera palabra del Nombre corto', pedroText.includes('¡Hola Pedrito!') && !pedroText.includes('Hola Pedro '), pedroText.slice(0, 120));
  await shot(page, 'recordatorios');
  await closeSheet();

  // #17 la página de confirmar
  const card = await page.evaluate((pid) => {
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    const p = db.players[pid];
    return { token: p.confirmToken, matchId: p.matchId, shortName: db.confirmations?.[p.confirmToken]?.shortName };
  }, ids.pPedro);
  check('#17 el documento de confirmación lleva el Nombre corto', card.shortName === 'Pedrito Lo', String(card.shortName));
  const confirm = await ctx.newPage();
  confirm.on('pageerror', (e) => errors.push(e.message));
  await confirm.goto(`${BASE}confirmar.html?m=${encodeURIComponent(card.matchId)}&p=${encodeURIComponent(ids.pPedro)}&t=${encodeURIComponent(card.token)}`);
  await confirm.waitForSelector('h1');
  const h1 = (await confirm.locator('h1').first().innerText()).trim();
  check('#17 la página de confirmar saluda con «Pedrito»', h1.includes('Pedrito') && !h1.includes('Pedro'), h1);
  await confirm.close();

  // #9 atajo del ícono
  await goHash('#/');
  await page.waitForTimeout(200);
  const expected = await page.evaluate(async () => {
    const { shortcutMatch } = await import('./js/shortcut.js');
    return shortcutMatch(window.__app.matches, Date.now())?.id || '';
  });
  check('#9 el partido del atajo es el que empezó hace 20 minutos', expected === ids.mid, `${expected} vs ${ids.mid}`);
  await page.click('#brand img');
  await page.waitForFunction((id) => location.hash === `#/partido/${encodeURIComponent(id)}`, ids.mid, { timeout: 3000 }).catch(() => {});
  check('#9 un toque en el ícono abre el partido', await page.evaluate((id) => location.hash === `#/partido/${encodeURIComponent(id)}`, ids.mid), await page.evaluate(() => location.hash));
  await goHash('#/');
  await page.waitForTimeout(200);
  await page.dblclick('#brand img');
  await page.waitForFunction((id) => location.hash === `#/partido/${encodeURIComponent(id)}/equipos`, ids.mid, { timeout: 3000 }).catch(() => {});
  check('#9 dos toques abren los Equipos del partido', await page.evaluate((id) => location.hash === `#/partido/${encodeURIComponent(id)}/equipos`, ids.mid), await page.evaluate(() => location.hash));
  await page.waitForTimeout(600);
  check('#9 el doble toque no vuelve al partido después', await page.evaluate(() => location.hash.endsWith('/equipos')));
  await goHash('#/');
  await page.waitForTimeout(200);
  await page.click('.brand-title');
  await page.waitForTimeout(500);
  check('#9 el texto del saludo sigue llevando al inicio', await page.evaluate(() => location.hash === '#/' || location.hash === ''));

  // #6 goles: un toque suma, deslizar no
  await goHash(`#/partido/${encodeURIComponent(ids.mid)}/equipos`);
  await page.waitForSelector('#team-unassigned .team-row');
  await page.locator('#team-unassigned .team-row', { hasText: 'Pedrito' }).locator('[data-assign="bib"]').click();
  await page.waitForSelector('#team-bib .team-row:has-text("Pedrito")');
  const goalsOf = () => page.evaluate((pid) => Number(JSON.parse(localStorage.getItem('f7c-demo-db')).players[pid].goals || 0), ids.pPedro);
  const row = () => page.locator('#team-bib .team-row', { hasText: 'Pedrito' });
  await row().locator('[data-goal="1"]').click();
  await page.waitForTimeout(400);
  await row().locator('[data-goal="1"]').click();
  await page.waitForTimeout(1200);
  check('#6 dos toques en + suman 2 goles', (await goalsOf()) === 2, String(await goalsOf()));
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (sel) => {
    const box = await row().locator(sel).boundingBox();
    const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe('[data-goal="1"]');
  await page.waitForTimeout(1200);
  check('#6 deslizar el dedo sobre + no suma', (await goalsOf()) === 2, String(await goalsOf()));
  await swipe('[data-goal="-1"]');
  await page.waitForTimeout(1200);
  check('#6 deslizar el dedo sobre − no resta', (await goalsOf()) === 2, String(await goalsOf()));
  {
    const box = await row().locator('[data-goal="-1"]').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1200);
  }
  check('#6 un toque con el dedo en − resta uno', (await goalsOf()) === 1, String(await goalsOf()));
  await shot(page, 'equipos');

  // #16 No jugó pero pagó abre Cargar pago
  await goHash(`#/partido/${encodeURIComponent(ids.mid)}`);
  await page.waitForSelector(`[data-menu="${ids.pPago}"]`);
  await page.click(`[data-menu="${ids.pPago}"]`);
  await page.waitForSelector('#pm-no-play');
  await page.click('#pm-no-play');
  const payOpen = await page.waitForSelector('#pay-form', { timeout: 4000 }).then(() => true).catch(() => false);
  check('#16 «No jugó pero pagó» abre Cargar pago', payOpen);
  const noPlay = await page.evaluate((pid) => JSON.parse(localStorage.getItem('f7c-demo-db')).players[pid].noPlay === true, ids.pPago);
  check('#16 el jugador quedó en «No jugó pero pagó»', noPlay);
  await shot(page, 'no-jugo-pago');
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
