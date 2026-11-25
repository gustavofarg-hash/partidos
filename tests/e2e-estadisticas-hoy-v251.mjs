// v251: Estadísticas (Día y Mes) suma hoy sin esperar al cambio de día cuando
// terminó el último partido de hoy y el día está cerrado: cálculo de compensación
// guardado (varios organizadores) o todos con cómo pagan (uno solo).
// Modo demo, sin Firebase (toda la red de Firebase cortada). Reloj fijo. Datos ficticios.
// python3 -m http.server 18450 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-estadisticas-hoy-v251.mjs http://127.0.0.1:18450/
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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/v251-${name}.png` }); };
const TODAY = '2027-03-17';
const at = (hhmm) => new Date(`${TODAY}T${hhmm}:00-03:00`);
try {
  const ctx = await demoContext();
  const page = await ctx.newPage();
  await page.clock.setFixedTime(at('12:00'));
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'gustavo@demo.local', 'demo-gustavo');
  const ids = await page.evaluate(async (today) => {
    const s = window.__app.store; const who = window.__app.who;
    const prev = await s.addMatch({ date: '2027-03-10', time: '20:00', capacity: 14 }, who);
    const early = await s.addMatch({ date: today, time: '19:00', capacity: 14 }, who);
    const late = await s.addMatch({ date: today, time: '21:00', capacity: 14 }, who);
    const find = (id, date, time) => window.__app.matches.find((row) => row.id === id) || { id, date, time, capacity: 14 };
    await s.addPlayer(find(prev, '2027-03-10', '20:00'), { name: 'Ficticio Pasado' }, who);
    await s.addPlayer(find(early, today, '19:00'), { name: 'Ficticio Uno' }, who);
    await s.addPlayer(find(late, today, '21:00'), { name: 'Ficticio Dos' }, who);
    const players = Object.entries(JSON.parse(localStorage.getItem('f7c-demo-db')).players).map(([id, p]) => ({ id, ...p }));
    const pid = (name) => players.find((p) => p.name === name).id;
    const pay = (id) => s.setPayment(id, { paid: true, split: true, cash: 5000, cashTo: 'Gustavo', transfer: 0, pendingTransfer: 0, fromCredit: 0 }, who);
    await pay(pid('Ficticio Pasado'));
    await pay(pid('Ficticio Uno'));
    return { prev, early, late, dos: pid('Ficticio Dos') };
  }, TODAY);
  const dayRows = async () => {
    await page.evaluate(() => { location.hash = '#/estadisticas'; });
    await page.evaluate(() => { location.hash = '#/estadisticas/dia'; });
    await page.waitForSelector('#stats-days');
    return page.locator('#stats-days [data-date]').evaluateAll((rows) => rows.map((row) => row.dataset.date));
  };
  const monthCount = async () => {
    await page.evaluate(() => { location.hash = '#/estadisticas'; });
    await page.evaluate(() => { location.hash = '#/estadisticas/mes/2027-03'; });
    await page.waitForSelector('#stats-period-count');
    return {
      count: (await page.textContent('#stats-period-count')).replace(/\s+/g, ' '),
      collected: (await page.textContent('#stats-collected')).replace(/\s+/g, ' '),
      entitled: (await page.textContent('#stats-entitled')).replace(/\s+/g, ' '),
    };
  };

  // Mediodía: los partidos de hoy no se jugaron.
  let days = await dayRows();
  check('Antes de jugarse, hoy no está en Día', !days.includes(TODAY) && days.includes('2027-03-10'), days.join(','));
  let month = await monthCount();
  check('Antes de jugarse, Mes cuenta solo el día anterior', /^1 partido\b/.test(month.count), month.count);

  // 23:00, pero falta cómo paga uno de hoy (o el cálculo).
  await page.clock.setFixedTime(at('23:00'));
  days = await dayRows();
  check('Terminado pero sin cerrar el día: hoy todavía no entra', !days.includes(TODAY), days.join(','));

  await page.evaluate(async (id) => {
    await window.__app.store.setPayment(id, { paid: true, split: true, cash: 5000, cashTo: 'Gustavo', transfer: 0, pendingTransfer: 0, fromCredit: 0 }, window.__app.who);
  }, ids.dos);
  // Con varios organizadores hace falta además el cálculo guardado.
  await page.evaluate((mid) => { location.hash = `#/partido/${encodeURIComponent(mid)}`; }, ids.late);
  await page.waitForSelector('#btn-teams');
  const multi = (await page.locator('#btn-comp').count()) === 1;
  if (multi) {
    days = await dayRows();
    check('Varios organizadores: todos pagaron pero sin cálculo, hoy no entra', !days.includes(TODAY), days.join(','));
    // Antes de que termine el último partido, aunque haya cálculo, tampoco.
    await page.clock.setFixedTime(at('21:30'));
    await page.evaluate((mid) => { location.hash = '#/estadisticas'; location.hash = `#/partido/${encodeURIComponent(mid)}`; }, ids.late);
    await page.waitForSelector('#btn-comp');
    await page.click('#btn-comp');
    await page.waitForSelector('#comp-detail');
    const saved = await page.evaluate((d) => !!JSON.parse(localStorage.getItem('f7c-demo-db')).compensations?.[d], TODAY);
    check('Se guardó el cálculo de compensación de hoy', saved);
    days = await dayRows();
    check('Con cálculo pero sin terminar el último partido: hoy no entra', !days.includes(TODAY), days.join(','));
    await page.clock.setFixedTime(at('23:00'));
  } else {
    check('Un solo organizador (sin botón de compensación)', true);
  }
  days = await dayRows();
  check('Día cerrado y terminado: hoy aparece primero en Día', days[0] === TODAY, days.join(','));
  const label = await page.locator(`#stats-days [data-date="${TODAY}"] .stats-entitled`).innerText();
  check('Hoy muestra Te correspondió', /Te correspondió: \$/.test(label) && !/\$\s?0$/.test(label), label);
  await shot(page, 'dia');
  month = await monthCount();
  check('Mes suma los dos partidos de hoy', /^3 partidos\b/.test(month.count), month.count);
  check('Mes suma lo cobrado de hoy', /15\.000/.test(month.collected), month.collected);
  await shot(page, 'mes');
  await page.evaluate(() => { location.hash = '#/estadisticas'; location.hash = '#/estadisticas/anio/2027'; });
  await page.waitForSelector('#stats-period-count');
  const year = (await page.textContent('#stats-period-count')).replace(/\s+/g, ' ');
  check('Año también suma hoy', /^3 partidos\b/.test(year), year);
  // Otro día con todo cancelado: entra enseguida, como cancelado.
  await page.clock.setFixedTime(new Date('2027-04-14T10:00:00-03:00'));
  await page.evaluate(async () => {
    const s = window.__app.store; const who = window.__app.who;
    const id = await s.addMatch({ date: '2027-04-14', time: '21:00', capacity: 14 }, who);
    await s.updateMatch(id, { cancelled: true }, who);
  });
  await page.evaluate(() => { location.hash = '#/estadisticas'; location.hash = '#/estadisticas/mes/2027-04'; });
  await page.waitForSelector('#stats-period-count');
  const cancelledMonth = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  check('Todo cancelado hoy: Mes ya muestra «1 cancelado, no suma»', /1 cancelado, no suma/.test(cancelledMonth) && /0 partidos/.test(cancelledMonth), cancelledMonth.slice(0, 200));
  check('Sin cartel de error', await page.locator('#error-banner').isHidden());
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
