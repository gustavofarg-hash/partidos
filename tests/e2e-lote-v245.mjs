// v245: pedidos 4 y 12, y el suspendido (Autoservicio y nombres). Modo demo, sin Firebase. Datos ficticios.
// python3 -m http.server 18445 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-lote-v245.mjs http://127.0.0.1:18445/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18445/';
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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/v245-${name}.png` }); };
try {
  await page.goto(BASE);
  await page.waitForSelector('#login-form');
  await page.fill('#login-email', 'gustavo@demo.local');
  await page.fill('#login-password', 'demo-gustavo');
  await page.click('#login-form button[type=submit]');
  await page.waitForFunction(() => window.__app?.who && window.__app.store?.actor?.uid);
  const ids = await page.evaluate(async () => {
    const s = window.__app.store;
    const gus = { ...s.actor };
    const mar = (window.__app.users || []).find((u) => /mart/i.test(u.name || '')) || null;
    const marUid = mar?.uid || mar?.id || 'martin';
    const day = '2099-11-25';
    const gusMatch = await s.addMatch({ date: day, time: '20:00', capacity: 2 }, 'Gustavo');
    const rid = await s.addRoster({ name: 'Ficticio Suspendido', phone: '5491100000051' }, 'Gustavo');
    const bajado = await s.addRoster({ name: 'Ficticio Bajado', phone: '5491100000052' }, 'Gustavo');
    await s.addPlayer({ id: gusMatch, date: day, capacity: 2 }, { name: 'Ficticio Uno' }, 'Gustavo');
    await s.addPlayer({ id: gusMatch, date: day, capacity: 2 }, { name: 'Ficticio Dos' }, 'Gustavo');
    await s.addPlayer({ id: gusMatch, date: day, capacity: 2 }, { name: 'Ficticio Espera' }, 'Gustavo');
    // Un partido solo de Martín, con el suspendido anotado.
    s.setActor({ uid: marUid, name: 'Martín', role: 'organizer' });
    const marMatch = await s.addMatch({ date: day, time: '22:00', capacity: 14 }, 'Martín');
    await s.addPlayer({ id: marMatch, date: day, capacity: 14 }, { name: 'Ficticio Suspendido', rosterId: rid }, 'Martín');
    const marToken = await s.ensureShareToken(marUid, 'Martín');
    s.setActor(gus);
    await s.setSuspension(rid, { note: 'Faltó sin avisar', date: '2099-11-20' });
    const gusToken = await s.ensureShareToken(gus.uid, 'Gustavo');
    return { gusMatch, marMatch, rid, bajado, gusToken, marToken, marUid };
  });

  // ── Pedido 12 ──
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, ids.gusMatch);
  await page.waitForSelector('#no-play-add');
  check('El partido ofrece «Agregar a No jugó pero pagó»', true);
  await page.click('#no-play-add');
  await page.waitForSelector('#no-play-name');
  await page.fill('#no-play-name', 'Ficticio Baj');
  await page.waitForSelector('#no-play-hits [data-pick]');
  await page.click('#no-play-hits [data-pick]');
  await page.click('#no-play-save');
  await page.waitForSelector('#no-play-list .slot', { timeout: 10000 });
  check('Queda en No jugó pero pagó', (await page.locator('#no-play-list').innerText()).includes('Ficticio Bajado'));
  const state = await page.evaluate((mid) => {
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    const rows = Object.values(db.players).filter((p) => p.matchId === mid);
    return {
      bajado: rows.find((p) => p.name === 'Ficticio Bajado') || null,
      espera: rows.find((p) => p.name === 'Ficticio Espera')?.waiting === true,
      main: rows.filter((p) => p.waiting !== true && p.noPlay !== true).length,
    };
  }, ids.gusMatch);
  check('No ocupa lugar ni va a la espera', state.bajado?.noPlay === true && state.bajado?.waiting === false, JSON.stringify(state.bajado && { noPlay: state.bajado.noPlay, waiting: state.bajado.waiting }));
  check('El de la espera sigue en la espera y los titulares no cambian', state.espera && state.main === 2);
  await page.waitForSelector('#pay-form', { timeout: 5000 }).catch(() => {});
  check('Se abre Cargar pago', (await page.locator("#pay-form").count()) > 0);
  await shot(page, 'no-jugo-pago');
  await page.evaluate(() => { const s = document.querySelector('dialog.sheet[open], #sheet[open]'); if (s?.open) s.close(); });

  // ── Suspendido: rojo y (suspendido) también en un partido de Martín, y en Equipos ──
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, ids.marMatch);
  await page.waitForSelector('.slot:has-text("Ficticio Suspendido") .name');
  check('En el partido de otro organizador dice (suspendido) en rojo', (await page.locator('.slot:has-text("Ficticio Suspendido") .name.suspended').count()) > 0
    && (await page.locator('.slot:has-text("Ficticio Suspendido") .name').innerText()).includes('(suspendido)'));
  await page.evaluate(async (mid) => {
    const s = window.__app.store;
    const p = window.__app.players.find((row) => row.matchId === mid && row.name === 'Ficticio Suspendido');
    await s.setTeams(mid, { bib: [p.id], plain: [] }, window.__app.who);
  }, ids.marMatch);
  await page.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}/equipos`; }, ids.marMatch);
  await page.waitForSelector('#team-bib .team-name');
  const team = await page.locator('#team-bib .team-name').first();
  check('En Equipos dice (suspendido) en rojo', (await team.innerText()).includes('(suspendido)') && (await team.evaluate((el) => el.classList.contains('suspended'))));
  await shot(page, 'equipos-suspendido');
  await page.evaluate((rid) => { location.hash = `#/estadisticas/jugador/${encodeURIComponent(rid)}`; }, ids.rid);
  await page.waitForSelector('#stats-player');
  check('En Estadísticas dice (suspendido) en rojo', (await page.locator('#stats-player').innerText()).includes('(suspendido)') && (await page.locator('#stats-player.suspended').count()) > 0);

  // ── Suspendido: Autoservicio ──
  // El demo no guarda createdByUid en los partidos (Firebase sí): se lo ponemos como en producción.
  const seed = await page.evaluate(({ gusMatch, marMatch, marUid }) => {
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    db.matches[gusMatch].createdByUid = window.__app.store.actor.uid;
    // Compartido con Martín: sin el bloqueo aparecería en el link de Martín.
    db.matches[gusMatch].adders = [marUid];
    db.matches[marMatch].createdByUid = marUid;
    return JSON.stringify(db);
  }, ids);
  const open = async (hash) => {
    const g = await demoContext(seed);
    const p = await g.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}${hash}`);
    await p.waitForSelector('#player-link-invalid, #player-signup, #player-locked', { timeout: 15000 });
    const out = {
      locked: (await p.locator('#player-locked').count()) > 0,
      text: (await p.locator('#view').innerText()),
    };
    return { g, p, out };
  };
  const viaGus = await open(`#/jugador/${ids.rid}/${ids.gusToken}`);
  check('Con el link de quien lo suspendió: NO TENÉS ACCESO', viaGus.out.locked && /NO TENÉS ACCESO/.test(viaGus.out.text), viaGus.out.text.slice(0, 80));
  await shot(viaGus.p, 'autoservicio-sin-acceso');
  await viaGus.g.close();
  const viaMar = await open(`#/jugador/${ids.rid}/${ids.marToken}`);
  check('Con el link de otro organizador sí entra', !viaMar.out.locked && (await viaMar.p.locator('#player-signup').count()) > 0);
  const listed = await viaMar.p.locator('#self-list').innerText().catch(() => '');
  check('Ve el partido de Martín y no los de quien lo suspendió', listed.includes('22') && !listed.includes('20:00'), JSON.stringify(listed.slice(0, 160)));
  await viaMar.g.close();

  // Levantar la suspensión: vuelve a entrar.
  await page.evaluate(async (rid) => { await window.__app.store.setSuspended(rid, false, 'Pidió disculpas'); }, ids.rid);
  const seed2 = await page.evaluate(({ gusMatch, marMatch, marUid }) => {
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    db.matches[gusMatch].createdByUid = window.__app.store.actor.uid;
    db.matches[marMatch].createdByUid = marUid;
    return JSON.stringify(db);
  }, ids);
  const g3 = await demoContext(seed2);
  const p3 = await g3.newPage();
  await p3.goto(`${BASE}#/jugador/${ids.rid}/${ids.gusToken}`);
  await p3.waitForSelector('#player-link-invalid, #player-signup, #player-locked', { timeout: 15000 });
  check('Levantada la suspensión, el link vuelve a andar', (await p3.locator('#player-signup').count()) > 0);
  check('Y vuelve a ver los partidos de ese organizador', (await p3.locator('#self-list').innerText().catch(() => '')).includes('20:00'));
  await g3.close();
  // ── Pedido 4: «Pagó» de la ficha con todos los organizadores ──
  const pay = await page.evaluate(async () => {
    const s = window.__app.store;
    const gus = { ...s.actor };
    const mar = (window.__app.users || []).find((u) => /mart/i.test(u.name || '')) || null;
    const marUid = mar?.uid || mar?.id || 'martin';
    const day = '2099-11-27';
    const rid = await s.addRoster({ name: 'Ficticio Pago', phone: '5491100000053' }, 'Gustavo');
    const gm = await s.addMatch({ date: day, time: '19:00', capacity: 14, price: 5000 }, 'Gustavo');
    await s.addPlayer({ id: gm, date: day, capacity: 14 }, { name: 'Ficticio Pago', rosterId: rid }, 'Gustavo');
    s.setActor({ uid: marUid, name: 'Martín', role: 'organizer' });
    const mm = await s.addMatch({ date: day, time: '21:00', capacity: 14, price: 5000 }, 'Martín');
    await s.addPlayer({ id: mm, date: day, capacity: 14 }, { name: 'Ficticio Pago', rosterId: rid }, 'Martín');
    s.setActor(gus);
    // Le pagó a Martín su partido (como lo guarda Cargar pago).
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    const row = Object.values(db.players).find((p) => p.matchId === mm && p.rosterId === rid);
    Object.assign(row, { paid: true, amount: 5000, cash: 5000, cashTo: 'Martín', transfer: 0, receivedBy: 'Martín' });
    localStorage.setItem('f7c-demo-db', JSON.stringify(db));
    return { rid };
  });
  await page.reload();
  await page.waitForFunction(() => window.__app?.who && window.__app.store?.actor?.uid);
  await page.evaluate((rid) => { location.hash = `#/jugador/${encodeURIComponent(rid)}`; }, pay.rid);
  await page.waitForSelector('#stat-pay');
  const paidText = (await page.locator('#stat-pay').innerText()).replace(/\s+/g, ' ');
  const byOrg = (await page.locator('#stat-pay-by').innerText().catch(() => '')).replace(/\s+/g, ' ');
  check('«Pagó $X en N partidos» incluye lo pagado a otro organizador', /^Pagó \$\s?5\.000 en 1 partido/.test(paidText), paidText);
  const mineDebt = ((await page.locator('#debt-total').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
  const owedMine = (paidText.match(/Debe (\$\s?[\d.]+) en 1 partido$/) || [])[1] || '';
  check('Y lo que va a pagar, igual que su deuda con el logueado', !!owedMine && mineDebt.includes(owedMine), `${owedMine} / ${mineDebt}`);
  check('Con dos organizadores, una línea por cada uno', /Martín: pagó \$\s?5\.000/.test(byOrg) && byOrg.includes(`Gustavo: pagó $0 · debe ${owedMine}`), byOrg);
  check('Sin el bloque aparte', (await page.locator('#profile-paid').count()) === 0);
  await page.locator('#stat-pay').scrollIntoViewIfNeeded();
  await shot(page, 'ficha-pago');
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
