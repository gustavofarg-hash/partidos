// v235 (punto 7): el acortador de links se retiró. Los mensajes llevan el link
// completo; /c/?k= sigue abriendo los links cortos que ya se mandaron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('punto 7: no queda el acortador externo ni el link corto en los mensajes', () => {
  assert.equal(existsSync(new URL('../js/shorten.js', import.meta.url)), false);
  for (const file of ['js/app.js', 'js/store.js', 'js/reminders.js', 'sw.js']) {
    const src = read(file);
    assert.equal(/shorten|spoo\.me|da\.gd|ExternalShort/.test(src), false, `${file} todavía nombra el acortador`);
  }
  const app = read('js/app.js');
  assert.equal(app.includes('shortConfirmUrl'), false);
  assert.equal(app.includes('ensureShortLink'), false);
  assert.equal(app.includes('data-short-code'), false);
  assert.equal(read('js/reminders.js').includes('shortConfirmUrl'), false);
  const store = read('js/store.js');
  assert.equal(store.includes('ensureShortLink('), false);
  assert.equal(store.includes('_mintShortLink'), false);
});

test('punto 7: la página /c/ sigue abriendo los links cortos viejos', async () => {
  assert.equal(existsSync(new URL('../c/index.html', import.meta.url)), true);
  const { confirmTarget, isShortCode } = await import('../js/short.js');
  assert.equal(isShortCode('Ab3x9Zk2'), true);
  const landing = confirmTarget({ m: '2026-10-22_2100', p: 'abc', t: 't'.repeat(24), href: 'http://127.0.0.1:18431/confirmar.html' });
  assert.ok(String(landing).includes('confirmar.html'));
});

test('punto 7: el demo no crea links cortos al guardar', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const { createDemoStore } = await import('../js/store.js');
  const store = createDemoStore();
  const mid = await store.addMatch({ date: '2099-01-10', time: '21:00', capacity: 14 }, 'Gustavo');
  const pid = await store.addPlayer({ id: mid, date: '2099-01-10', capacity: 14 }, { name: 'Juan Pérez', phone: '5491112345678' }, 'Gustavo');
  await store.ensureConfirmToken(pid);
  const db = JSON.parse(mem.get('f7c-demo-db'));
  assert.ok(db.players[pid].confirmToken);
  assert.equal('shortCode' in db.players[pid], false);
  assert.equal(Object.keys(db.links || {}).length, 0);
});
