// v249: cada organizador agenda al jugador compartido con su propio nombre y apodo.
// Modo demo, sin Firebase (toda la red de Firebase cortada). Datos ficticios.
// python3 -m http.server 18449 --bind 127.0.0.1  (en la raíz) y después:
// node tests/e2e-nombre-propio-v249.mjs http://127.0.0.1:18449/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18449/';
refuseRealTarget(BASE);
const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const SHOTS = process.env.SHOTS || '';
const PHONE = '5491155550199'; // ficticio

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
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/v249-${name}.png` }); };
const rosterText = async (p) => {
  await p.evaluate(() => { location.hash = '#/jugadores'; });
  await p.waitForSelector('[data-roster]');
  return (await p.locator('#view').innerText()).replace(/\s+/g, ' ');
};
const matchNames = async (p, mid) => {
  await p.evaluate((id) => { location.hash = `#/partido/${encodeURIComponent(id)}`; }, mid);
  await p.waitForSelector('.slot .name');
  return p.locator('.slot .name').allInnerTexts();
};
try {
  const ctx = await demoContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'gustavo@demo.local', 'demo-gustavo');
  const ids = await page.evaluate(async (phone) => {
    const s = window.__app.store;
    const gus = { ...s.actor };
    const marUid = (window.__app.users || []).find((u) => /mart/i.test(u.name || ''))?.uid || 'martin';
    const day = '2099-12-10';
    const rid = await s.addRoster({ name: 'Juan Ficticio', phone, shortName: 'Juancho' }, 'Gustavo');
    const gusMatch = await s.addMatch({ date: day, time: '20:00', capacity: 14, price: 9000 }, 'Gustavo');
    await s.addPlayer({ id: gusMatch, date: day, capacity: 14 }, { name: 'Juan Ficticio', shortName: 'Juancho', phone, rosterId: rid }, 'Gustavo');
    const gusToken = await s.ensureShareToken(gus.uid, 'Gustavo');
    // Martín agenda el mismo WhatsApp con su nombre y su apodo.
    s.setActor({ uid: marUid, name: 'Martín', role: 'organizer' });
    const linked = await s.addRoster({ name: 'Juani Ficticio', phone: '11 5555-0199', shortName: 'Pibe' }, 'Martín');
    const marMatch = await s.addMatch({ date: day, time: '22:00', capacity: 14, price: 9000 }, 'Martín');
    await s.addPlayer({ id: marMatch, date: day, capacity: 14 }, { name: 'Juani Ficticio', shortName: 'Pibe', phone, rosterId: rid }, 'Martín');
    const marToken = await s.ensureShareToken(marUid, 'Martín');
    s.setActor(gus);
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    db.matches[gusMatch].createdByUid = gus.uid;
    db.matches[marMatch].createdByUid = marUid;
    localStorage.setItem('f7c-demo-db', JSON.stringify(db));
    return { rid, linked, gusMatch, marMatch, gusToken, marToken, marUid };
  }, PHONE);
  check('El mismo WhatsApp es el mismo jugador (una sola ficha)', ids.linked === ids.rid);
  await page.reload();
  await page.waitForFunction(() => window.__app?.who && window.__app.store?.actor?.uid);

  // ── Gustavo ──
  let text = await rosterText(page);
  check('Gustavo: en su agenda sigue «Juan Ficticio» “Juancho”', text.includes('Juan Ficticio') && text.includes('“Juancho”') && !text.includes('Juani'), text.slice(0, 200));
  await shot(page, 'agenda-gustavo');
  let names = await matchNames(page, ids.marMatch);
  check('Gustavo: en el partido de Martín lo ve con su apodo', names.some((n) => n.includes('Juancho')) && !names.some((n) => n.includes('Pibe')), names.join(' | '));
  names = await matchNames(page, ids.gusMatch);
  check('Gustavo: en su partido también', names.some((n) => n.includes('Juancho')), names.join(' | '));

  // Gustavo lo renombra desde Jugadores (el formulario de siempre).
  await rosterText(page);
  await page.click(`[data-roster-edit="${ids.rid}"]`);
  await page.waitForSelector('#roster-form');
  check('El formulario muestra el nombre de su agenda', (await page.inputValue('#roster-form input[name=name]')) === 'Juan Ficticio');
  await page.fill('#roster-form input[name=name]', 'Juan Carlos Ficticio');
  await page.fill('#roster-form input[name=shortName]', 'Juanca');
  await page.click('#roster-form button[type=submit]');
  await page.waitForFunction(() => (document.querySelector('#toast')?.textContent || '').includes('Jugador actualizado'));
  const saved = await page.evaluate((rid) => JSON.parse(localStorage.getItem('f7c-demo-db')).roster[rid], ids.rid);
  check('La base de la ficha no cambia (es compartida)', saved.name === 'Juan Ficticio' && saved.shortName === 'Juancho', JSON.stringify({ name: saved.name, shortName: saved.shortName }));
  const gusUid = await page.evaluate(() => window.__app.store.actor.uid);
  check('Gustavo: su nombre y apodo nuevos quedan como suyos', saved.names?.[gusUid]?.name === 'Juan Carlos Ficticio' && saved.names?.[gusUid]?.shortName === 'Juanca', JSON.stringify(saved.names));
  check('Martín: su nombre y apodo no cambiaron', saved.names?.[ids.marUid]?.name === 'Juani Ficticio' && saved.names?.[ids.marUid]?.shortName === 'Pibe', JSON.stringify(saved.names));
  text = await rosterText(page);
  check('Gustavo: la agenda muestra lo nuevo', text.includes('Juan Carlos Ficticio') && text.includes('“Juanca”'));
  const seed = await page.evaluate(() => localStorage.getItem('f7c-demo-db'));

  // ── Martín ──
  const mctx = await demoContext(seed);
  const mpage = await mctx.newPage();
  mpage.on('pageerror', (e) => errors.push(e.message));
  await login(mpage, 'martin@demo.local', 'demo-martin');
  text = await rosterText(mpage);
  check('Martín: en su agenda está «Juani Ficticio» “Pibe”', text.includes('Juani Ficticio') && text.includes('“Pibe”') && !text.includes('Juan Carlos'), text.slice(0, 200));
  await shot(mpage, 'agenda-martin');
  names = await matchNames(mpage, ids.gusMatch);
  check('Martín: en el partido de Gustavo lo ve con su apodo', names.some((n) => n.includes('Pibe')) && !names.some((n) => n.includes('Juanca') || n.includes('Juancho')), names.join(' | '));
  await shot(mpage, 'partido-gustavo-visto-por-martin');
  // Martín le manda el WhatsApp (con el link de confirmar) desde la lista: la página de confirmar lo saluda con su agenda.
  const waLink = mpage.locator('.slot .wa-btn[data-confirm-sender]').first();
  check('El WhatsApp del jugador lleva el link de confirmar', (await waLink.count()) === 1 && decodeURIComponent(await waLink.getAttribute('href')).includes('confirmar.html'));
  const [popup] = await Promise.all([mctx.waitForEvent('page').catch(() => null), waLink.click()]);
  if (popup) await popup.close().catch(() => {});
  await mpage.waitForFunction((rid) => {
    const db = JSON.parse(localStorage.getItem('f7c-demo-db'));
    return Object.values(db.confirmations || {}).some((card) => card.sentByUid && card.name === 'Juani Ficticio');
  }, ids.rid, { timeout: 5000 }).catch(() => {});
  const card = await mpage.evaluate((mid) => Object.values(JSON.parse(localStorage.getItem('f7c-demo-db')).confirmations || {}).find((row) => row.matchId === mid) || null, ids.gusMatch);
  check('Confirmar: la tarjeta queda a nombre de Martín (quien mandó el link)', card?.sentByUid === ids.marUid && card?.name === 'Juani Ficticio' && card?.shortName === 'Pibe', JSON.stringify(card && { sentByUid: card.sentByUid, name: card.name, shortName: card.shortName }));

  // Identidad: misma persona en los dos partidos del día (promo, deuda).
  const keys = await mpage.evaluate(async ({ rid }) => {
    const { personKey } = await import('./js/roster.js');
    const rows = window.__app.players.filter((p) => p.rosterId === rid);
    return [...new Set(rows.map((p) => personKey(p, window.__app.players)))];
  }, ids);
  check('Los dos partidos son de la misma persona (por WhatsApp)', keys.length === 1 && keys[0].startsWith('p:'), keys.join(','));

  // ── Autoservicio: el saludo según la agenda de quien compartió el link ──
  const greet = async (token) => {
    const g = await demoContext(seed);
    const p = await g.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(`${BASE}#/jugador/${ids.rid}/${token}`);
    await p.waitForSelector('#player-signup-name', { timeout: 15000 });
    const out = await p.locator('#player-signup-name').innerText();
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/v249-autoservicio-${token === ids.gusToken ? 'gus' : 'mar'}.png` });
    await g.close();
    return out;
  };
  const viaGus = await greet(ids.gusToken);
  const viaMar = await greet(ids.marToken);
  check('Autoservicio con el link de Gustavo: «Hola, Juanca»', viaGus === 'Hola, Juanca', viaGus);
  check('Autoservicio con el link de Martín: «Hola, Pibe»', viaMar === 'Hola, Pibe', viaMar);
  check('Sin errores en la página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
