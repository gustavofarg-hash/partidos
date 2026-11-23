// v240: Estadísticas Día desde el 1 y Mes con todo el mes (más de 30 partidos pasados). Modo demo, sin Firebase. Datos ficticios.
// python3 -m http.server 18441 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-estadisticas-v240.mjs http://127.0.0.1:18441/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18441/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/v240-${name}.png` }); };

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
  // 40 partidos pasados en el mes (más que la página de 30 del historial).
  const seeded = await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
    const today = fmt.format(new Date());
    const [y, m, d] = today.split('-').map(Number);
    if (d < 6) return { skip: true, today };
    const days = [];
    for (let day = 1; day < d; day += 1) days.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    let n = 0;
    const times = ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00'];
    for (let i = 0; n < 40; i += 1) {
      const date = days[i % days.length];
      const time = times[Math.floor(i / days.length) % times.length];
      const mid = await s.addMatch({ date, time, capacity: 14 }, who);
      const match = window.__app.matches.find((row) => row.id === mid) || { id: mid, date, time, capacity: 14 };
      await s.addPlayer(match, { name: `Jugador Est ${n}` }, who);
      n += 1;
    }
    return { skip: false, first: days[0], count: n, ym: today.slice(0, 7) };
  });
  if (seeded.skip) {
    check('Hoy es antes del 6 del mes: la prueba de 40 partidos no aplica', true, seeded.today);
  } else {
    await page.evaluate(() => { location.hash = '#/estadisticas/dia'; });
    await page.waitForSelector('#stats-days');
    const days = await page.locator('#stats-days [data-date]').evaluateAll((rows) => rows.map((row) => row.dataset.date));
    check('Día lista desde el 1 del mes', days.at(-1) === seeded.first, `${days.at(-1)} · ${days.length} días`);
    await shot(page, 'dia');
    await page.evaluate((ym) => { location.hash = `#/estadisticas/mes/${ym}`; }, seeded.ym);
    await page.waitForSelector('#stats-period-count');
    const count = (await page.textContent('#stats-period-count')).replace(/\s+/g, ' ');
    const n = Number((count.match(/(\d+) partidos/) || [])[1] || 0);
    check('Mes cuenta todos los partidos del mes (40 o más)', n >= 40, count);
    await shot(page, 'mes');
    check('En demo no hay botón de meses anteriores (todo está en memoria)', (await page.locator('#stats-older').count()) === 0);
  }
  check('Sin cartel de error', await page.locator('#error-banner').isHidden());
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
