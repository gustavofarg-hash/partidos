// v264: a 412px, un teléfono corto no deja «Agregó» a la derecha.
// Sin emulador: solo la hoja y una ficha con el markup de las tres listas.
// node tests/agrego-linea-v264.mjs http://127.0.0.1:18640/
import { createRequire } from 'node:module';
import { refuseRealTarget } from './no-real-firebase.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || 'playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:18640/';
refuseRealTarget(BASE);

const results = [];
const check = (name, cond, extra = '') => {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
};

const sameLine = (a, b) => a.top < b.bottom - 1 && b.top < a.bottom - 1;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
  timezoneId: 'America/Buenos_Aires',
  serviceWorkers: 'block',
});
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
await page.goto(new URL('tests/agrego-linea-v264.html', BASE).href, { waitUntil: 'load' });

const rows = await page.$$eval('li.slot', (els) => els.map((el) => {
  const list = el.closest('ul')?.id || '';
  const cse = el.getAttribute('data-case') || '';
  const box = (sel) => {
    const node = el.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, text: (node.textContent || '').trim() };
  };
  const phone = box('.phone-line') || (el.querySelector('.sub > span:not(.added-line):not(.tag):not(.confirm-tag)') && (() => {
    const node = [...el.querySelector('.sub').children].find((n) => n.textContent.trim() === 'Sin número');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height, text: 'Sin número' };
  })());
  return {
    list,
    cse,
    phone,
    added: box('.added-line .tag') || box('.added-line'),
    signed: box('.signed-up'),
    status: box('.confirm-tag'),
  };
}));

for (const row of rows) {
  const label = `${row.list} ${row.cse}`;
  const { phone, added, signed, status } = row;
  check(`${label}: hay teléfono o «Sin número» y Agregó y Se anotó con`, !!(phone && added && signed), JSON.stringify({ phone: phone?.text, added: added?.text, signed: signed?.text }));
  if (!phone || !added || !signed) continue;
  check(`${label}: Agregó no comparte línea con el teléfono`, !sameLine(phone, added), `phone=${JSON.stringify(phone)} added=${JSON.stringify(added)}`);
  check(`${label}: Agregó queda debajo del teléfono`, added.top >= phone.bottom - 1, `phone.bottom=${phone.bottom} added.top=${added.top}`);
  check(`${label}: Agregó no comparte línea con Se anotó con`, !sameLine(added, signed), `added=${JSON.stringify(added)} signed=${JSON.stringify(signed)}`);
  check(`${label}: Se anotó con queda debajo de Agregó`, signed.top >= added.bottom - 1, `added.bottom=${added.bottom} signed.top=${signed.top}`);
  if (status) {
    check(`${label}: el estado queda debajo o al nivel de Se anotó con`, status.top >= signed.top - 1);
  }
}

check('Sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));

await ctx.close();
await browser.close();
const ok = results.length && results.every(Boolean);
console.log(`${results.filter(Boolean).length}/${results.length} ${ok ? 'OK' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
