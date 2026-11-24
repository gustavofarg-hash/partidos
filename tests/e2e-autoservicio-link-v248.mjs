// v248: el link de Autoservicio (autoservicio/#/jugador/...) en un navegador de verdad.
// Levanta su propio servidor con el repo en /partidos/ y en /partidos/prueba/, en modo
// demo (config.js sin proyecto) y con toda la red de afuera cortada. Datos ficticios.
// Uso: node tests/e2e-autoservicio-link-v248.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseRealTarget } from './no-real-firebase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// El config.js del repo con el proyecto en blanco («TU_…»): la app queda en modo demo.
const DEMO_CONFIG = (await readFile(new URL('../config.js', import.meta.url), 'utf8'))
  .replace(/export const firebaseConfig = \{[\s\S]*?\};/, 'export const firebaseConfig = { apiKey: "TU_API_KEY", authDomain: "TU_PROYECTO", projectId: "TU_PROYECTO", storageBucket: "TU_PROYECTO", messagingSenderId: "TU_ID", appId: "TU_APP_ID" };');
if (/futbol-partidos|mis-partidos-prueba/.test(DEMO_CONFIG.replace(/\/\/.*$/gm, ''))) throw new Error('config de demo con proyecto real');

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rest = path.startsWith('/partidos/prueba/') ? path.slice('/partidos/prueba/'.length)
    : path.startsWith('/partidos/') ? path.slice('/partidos/'.length) : null;
  if (rest == null) { res.writeHead(404); res.end(); return; }
  if (/(^|\/)config(\.prueba)?\.js$/.test(rest)) { res.writeHead(200, { 'content-type': TYPES['.js'] }); res.end(DEMO_CONFIG); return; }
  let file = normalize(join(ROOT, rest));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!path.endsWith('/')) { res.writeHead(301, { location: `${path}/` }); res.end(); return; }
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/`;
refuseRealTarget(BASE);

const results = [];
const check = (name, cond, extra = '') => { results.push(!!cond); console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); };
const RID = 'FichaFicticiaV248abc';
const TOKEN = 'tokenFicticioV248abcdefg';
const KEY = 'claveFicticiaV248_abcdefghijklmn';
const HASH = `#/jugador/${RID}/${TOKEN}/${KEY}`;

const browser = await chromium.launch();
try {
  for (const app of ['partidos/', 'partidos/prueba/']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
    // Nada sale de 127.0.0.1 (ni Firebase ni gstatic).
    await context.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await context.newPage();
    const seen = [];
    if (process.env.DEBUG_E2E) { page.on('console', (m) => console.log('console:', m.type(), m.text())); page.on('pageerror', (e) => console.log('pageerror:', e.message)); }
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) seen.push(frame.url()); });

    // La vista previa: lo que lee WhatsApp (el HTML tal cual, sin JavaScript).
    const raw = await (await context.request.get(`${BASE}${app}autoservicio/`)).text();
    check(`${app}: la vista previa dice Autoservicio`, raw.includes('<meta property="og:title" content="Autoservicio">') && raw.includes('<title>Autoservicio</title>'));

    // Sin sesión: salta a la app con el mismo #, clave incluida.
    await page.goto(`${BASE}${app}autoservicio/${HASH}`);
    await page.waitForURL(`${BASE}${app}${HASH}`, { timeout: 10000 });
    check(`${app}: salta a la app con el mismo # (con la clave)`, page.url() === `${BASE}${app}${HASH}`, page.url());
    const cls = await page.evaluate(() => document.documentElement.className);
    check(`${app}: sin sesión, la app abre bloqueada como un link de jugador (anon-lock, sin menús)`, /\banon-lock\b/.test(cls) && /\bsigned-out\b/.test(cls), cls);
    const tabsShown = await page.evaluate(() => [...document.querySelectorAll('.topbar .actions, nav.tabs, #tabs')].some((el) => el.offsetParent !== null));
    check(`${app}: no se ven pestañas ni menús`, tabsShown === false);
    check(`${app}: solo pasó por autoservicio/ y la app`, seen.every((u) => u.startsWith(`${BASE}${app}`)) && seen.at(-1) === `${BASE}${app}${HASH}`, seen.join(' → '));

    // Con el service worker ya instalado (la app abierta antes), el link sigue andando.
    await page.goto(`${BASE}${app}`);
    const ready = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(() => 'ok'),
      new Promise((ok) => setTimeout(() => ok('timeout'), 20000)),
    ]));
    if (ready !== 'ok') console.log('sw:', ready, await page.evaluate(async () => JSON.stringify((await navigator.serviceWorker.getRegistrations()).map((r) => [r.scope, !!r.installing, !!r.waiting, !!r.active]))));
    await page.reload();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
    const cached = await page.evaluate(async (url) => !!(await caches.match(url)), `${BASE}${app}autoservicio/`);
    check(`${app}: el service worker controla la app y guardó autoservicio/`, controlled && cached);
    await page.goto(`${BASE}${app}autoservicio/#/jugador/${RID}/${TOKEN}`);
    await page.waitForURL(`${BASE}${app}#/jugador/${RID}/${TOKEN}`, { timeout: 10000 });
    check(`${app}: con el service worker, salta igual`, page.url() === `${BASE}${app}#/jugador/${RID}/${TOKEN}`, page.url());

    // Sin conexión (desde la caché del worker), también.
    await context.setOffline(true);
    await page.goto(`${BASE}${app}autoservicio/${HASH}`);
    await page.waitForURL(`${BASE}${app}${HASH}`, { timeout: 10000 });
    check(`${app}: sin conexión, salta igual desde la caché`, page.url() === `${BASE}${app}${HASH}`, page.url());
    await context.setOffline(false);

    // «Atrás» desde la app no vuelve a la página intermedia (location.replace).
    await page.goto(`${BASE}${app}`);
    await page.goto(`${BASE}${app}autoservicio/#/jugador/${RID}`);
    await page.waitForURL(`${BASE}${app}#/jugador/${RID}`, { timeout: 10000 });
    await page.goBack();
    check(`${app}: Atrás no vuelve a autoservicio/`, !page.url().includes('/autoservicio/'), page.url());

    // El link viejo (sin autoservicio/) sigue abriendo igual.
    await page.goto(`${BASE}${app}#/jugador/${RID}/${TOKEN}`);
    check(`${app}: el link viejo sigue abriendo la app con el #`, page.url() === `${BASE}${app}#/jugador/${RID}/${TOKEN}`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} OK`);
process.exit(failed ? 1 : 0);
