// v241: marcar el arco no cambia de equipo a nadie, aunque antes se haya scrolleado desde un nombre. Modo demo, sin Firebase. Datos ficticios.
// python3 -m http.server 18442 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-arco-equipo.mjs http://127.0.0.1:18442/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18442/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/v241-${name}.png` }); };

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
  const ids = await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const mid = await s.addMatch({ date: '2099-11-23', time: '20:00', capacity: 14, perTeam: 7 }, who);
    const match = window.__app.matches.find((row) => row.id === mid) || { id: mid, date: '2099-11-23', time: '20:00', capacity: 14 };
    const names = ['Pech Uno', 'Pech Dos', 'Pech Tres', 'Pech Cuatro', 'Pech Cinco', 'Pech Seis', 'Pech Siete',
      'Sin Uno', 'Sin Dos', 'Sin Tres', 'Sin Cuatro', 'Sin Cinco', 'Sin Seis', 'Sin Siete'];
    const pid = {};
    for (const name of names) pid[name] = await s.addPlayer(match, { name }, who);
    await s.setTeams(mid, { bib: names.slice(0, 7).map((n) => pid[n]), plain: names.slice(7).map((n) => pid[n]) }, who);
    // Ya fueron al arco: Pech Uno; Sin Uno y Sin Dos.
    await s.setInGoal(pid['Pech Uno'], true);
    await s.setInGoal(pid['Sin Uno'], true);
    await s.setInGoal(pid['Sin Dos'], true);
    return { mid, pid };
  });
  const teamsNow = () => page.evaluate((mid) => JSON.parse(localStorage.getItem('f7c-demo-db')).matches[mid].teams, ids.mid);
  const shown = (side) => page.locator(`#team-${side} .team-row .team-name`).allInnerTexts();
  await page.evaluate((mid) => { location.hash = `#/partido/${encodeURIComponent(mid)}/equipos`; }, ids.mid);
  await page.waitForSelector('#team-bib .team-row');
  const before = await teamsNow();
  const cdp = await ctx.newCDPSession(page);
  const swipeFromName = async (name) => {
    const box = await page.locator('.team-name', { hasText: name }).boundingBox();
    const x = box.x + 8; const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 12 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const tapArco = async (name) => {
    const btn = page.locator('.team-row', { hasText: name }).locator('[data-arco]');
    await btn.scrollIntoViewIfNeeded();
    const box = await btn.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
  };
  const sameSides = (a, b) => JSON.stringify([...a.bib].sort()) === JSON.stringify([...b.bib].sort()) && JSON.stringify([...a.plain].sort()) === JSON.stringify([...b.plain].sort());

  // El caso de Gustavo: scrollea arrastrando desde un nombre de sin pechera y toca el arco de uno con pechera.
  await swipeFromName('Sin Dos');
  await tapArco('Pech Cuatro');
  let after = await teamsNow();
  check('Arco con pechera: nadie cambia de equipo', sameSides(before, after), JSON.stringify(after));
  check('Arco con pechera: queda marcado', await page.evaluate((id) => JSON.parse(localStorage.getItem('f7c-demo-db')).players[id].inGoal === true, ids.pid['Pech Cuatro']));
  let bib = await shown('bib');
  check('Arco con pechera: va debajo del último de su equipo que fue al arco', bib[0] === 'Pech Uno' && bib[1] === 'Pech Cuatro', bib.join(', '));
  let plain = await shown('plain');
  check('Sin pechera sigue igual', plain[0] === 'Sin Uno' && plain[1] === 'Sin Dos' && !plain.includes('Pech Cuatro'), plain.join(', '));
  await shot(page, 'arco-pechera');

  // Lo mismo del otro lado.
  await swipeFromName('Pech Uno');
  await tapArco('Sin Cinco');
  after = await teamsNow();
  check('Arco sin pechera: nadie cambia de equipo', sameSides(before, after), JSON.stringify(after));
  plain = await shown('plain');
  check('Arco sin pechera: va debajo del último de su equipo que fue al arco', plain.slice(0, 3).join(',') === 'Sin Uno,Sin Dos,Sin Cinco', plain.join(', '));
  bib = await shown('bib');
  check('Con pechera sigue igual', bib.slice(0, 2).join(',') === 'Pech Uno,Pech Cuatro' && !bib.includes('Sin Cinco'), bib.join(', '));

  // Desmarcar: vuelve con los que no fueron, sin cambiar de equipo.
  await swipeFromName('Sin Uno');
  await tapArco('Pech Cuatro');
  after = await teamsNow();
  check('Desmarcar: nadie cambia de equipo', sameSides(before, after), JSON.stringify(after));
  bib = await shown('bib');
  check('Desmarcar: deja de estar arriba con los que fueron al arco', bib[0] === 'Pech Uno' && bib[1] !== 'Pech Cuatro' && bib.includes('Pech Cuatro'), bib.join(', '));
  check('Desmarcar: ya no está marcado', await page.evaluate((id) => JSON.parse(localStorage.getItem('f7c-demo-db')).players[id].inGoal !== true, ids.pid['Pech Cuatro']));

  // Arrastrar sigue funcionando: soltar un nombre sobre otro los intercambia.
  await page.locator('#team-bib .team-row', { hasText: 'Pech Siete' }).dragTo(page.locator('#team-plain .team-row', { hasText: 'Sin Siete' }));
  await page.waitForTimeout(700);
  after = await teamsNow();
  check('Arrastrar un jugador sobre otro sigue intercambiando', after.plain.includes(ids.pid['Pech Siete']) && after.bib.includes(ids.pid['Sin Siete']), JSON.stringify(after));
  await shot(page, 'arco-final');
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
