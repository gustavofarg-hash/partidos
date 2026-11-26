// v248: el link de Autoservicio va por autoservicio/ para que la vista previa de WhatsApp
// diga «Autoservicio». La página salta a la app con el mismo #. Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_INSTALL_URL, AUTOSERVICIO_PATH, appShareMessage, isPlayerDeepLink, playerLink, playerLinkParts } from '../js/share.js';
import { appBasePath } from '../js/trial.js';

const RID = 'FichaFicticiaV248abc';
const TOKEN = 'tokenFicticioV248abcdefg';
const KEY = 'claveFicticiaV248_abcdefghijklmn';
const page = readFileSync(new URL('../autoservicio/index.html', import.meta.url), 'utf8');
const TEXT = 'Acá podés ver y anotarte en los partidos de la semana';

function withLocation(loc, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: loc, configurable: true, writable: true });
  try { return fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'location', had);
    else delete globalThis.location;
  }
}

test('producción: el link compartido va por /partidos/autoservicio/ con el mismo #', () => {
  assert.equal(AUTOSERVICIO_PATH, 'autoservicio/');
  assert.equal(playerLink(RID, TOKEN), `https://gustavofarg-hash.github.io/partidos/autoservicio/#/jugador/${RID}/${TOKEN}`);
  assert.equal(playerLink(RID, TOKEN, KEY), `${APP_INSTALL_URL}autoservicio/#/jugador/${RID}/${TOKEN}/${KEY}`);
  assert.equal(playerLink(RID, '', KEY), `${APP_INSTALL_URL}autoservicio/#/jugador/${RID}/-/${KEY}`);
  const url = playerLink(RID, TOKEN, KEY);
  assert.deepEqual(playerLinkParts(url.slice(url.indexOf('#'))), { id: RID, token: TOKEN, key: KEY });
  // Desde la app publicada, igual.
  withLocation({ pathname: '/partidos/', origin: 'https://gustavofarg-hash.github.io' }, () => {
    assert.equal(playerLink(RID, TOKEN), `https://gustavofarg-hash.github.io/partidos/autoservicio/#/jugador/${RID}/${TOKEN}`);
  });
});

test('prueba: el link compartido va por /partidos/prueba/autoservicio/', () => {
  withLocation({ pathname: '/partidos/prueba/', origin: 'https://gustavofarg-hash.github.io' }, () => {
    assert.equal(playerLink(RID, TOKEN, KEY), `https://gustavofarg-hash.github.io/partidos/prueba/autoservicio/#/jugador/${RID}/${TOKEN}/${KEY}`);
  });
  withLocation({ pathname: '/partidos/prueba/index.html', origin: 'https://gustavofarg-hash.github.io' }, () => {
    assert.equal(playerLink(RID, TOKEN), `https://gustavofarg-hash.github.io/partidos/prueba/autoservicio/#/jugador/${RID}/${TOKEN}`);
  });
});

test('la app de los organizadores no cambia: mismo título, descripción y link para instalar', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<title>Mis Partidos<\/title>/);
  assert.match(index, /<meta name="description" content="Organizá los partidos de fútbol 7 del Polideportivo Colegiales">/);
  assert.equal(appShareMessage().includes('autoservicio'), false);
  assert.ok(appShareMessage().endsWith(APP_INSTALL_URL));
  // Con la app servida en la raíz (local), autoservicio/ no se toma por la carpeta de la app.
  assert.equal(appBasePath('/autoservicio/'), '');
  assert.equal(appBasePath('/partidos/autoservicio/'), '/partidos');
  assert.equal(appBasePath('/partidos/prueba/autoservicio/'), '/partidos/prueba');
});

test('los links viejos (sin autoservicio/) se siguen leyendo igual', () => {
  assert.deepEqual(playerLinkParts(`#/jugador/${RID}/${TOKEN}`), { id: RID, token: TOKEN, key: '' });
  assert.deepEqual(playerLinkParts(`#/jugador/${RID}/${TOKEN}/${KEY}`), { id: RID, token: TOKEN, key: KEY });
  assert.equal(isPlayerDeepLink(`#/jugador/${RID}`), true);
});

test('la página: «Autoservicio», el texto decidido, sin nombre de organizador, rutas relativas', () => {
  assert.match(page, /<title>Autoservicio<\/title>/);
  assert.ok(page.includes(`<meta name="description" content="${TEXT}">`));
  assert.ok(page.includes('<meta property="og:title" content="Autoservicio">'));
  assert.ok(page.includes(`<meta property="og:description" content="${TEXT}">`));
  assert.equal(/Gus|Gustavo|Martín|Organizá|Mis Partidos<\/title>/.test(page.replace(/<!--[\s\S]*?-->/g, '').replace(/<noscript>[\s\S]*?<\/noscript>/, '')), false);
  // Mismos íconos que la app, relativos (anda en /partidos/ y en /partidos/prueba/).
  assert.ok(page.includes('href="../icons/apple-touch-icon.png?v=f7c-v254"'));
  assert.equal(/(href|src|content)="(https?:)?\/\//.test(page), false);
  // No carga la app, la hoja de estilos ni Firebase: solo salta.
  assert.equal(/styles\.css|app\.js|config\.js|firebase/i.test(page), false);
});

function runRedirect(href) {
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  const url = new URL(href);
  let target = null;
  const loc = { href, hash: url.hash, replace: (to) => { target = to; } };
  new Function('location', 'URL', script)(loc, URL);
  return target;
}

test('la página salta a la app con el mismo #, clave incluida (producción y prueba)', () => {
  const prod = 'https://gustavofarg-hash.github.io/partidos/';
  const trial = 'https://gustavofarg-hash.github.io/partidos/prueba/';
  const hash = `#/jugador/${RID}/${TOKEN}/${KEY}`;
  assert.equal(runRedirect(`${prod}autoservicio/${hash}`), `${prod}${hash}`);
  assert.equal(runRedirect(`${trial}autoservicio/${hash}`), `${trial}${hash}`);
  assert.equal(runRedirect(`${prod}autoservicio/index.html${hash}`), `${prod}${hash}`);
  assert.equal(runRedirect(`${prod}autoservicio/#/jugador/${RID}/-/${KEY}`), `${prod}#/jugador/${RID}/-/${KEY}`);
  assert.equal(runRedirect(`${prod}autoservicio/#/jugador/${RID}`), `${prod}#/jugador/${RID}`);
  assert.equal(runRedirect(`${prod}autoservicio/`), prod);
});

test('el service worker guarda la página: abre al toque y sin conexión no cae en index.html con rutas rotas', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'autoservicio/'"));
  assert.ok(sw.includes("'autoservicio/index.html'"));
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.scope, './'); // autoservicio/ queda dentro del alcance de la app instalada
});
