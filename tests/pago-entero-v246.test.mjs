// v246: en «No jugó pero pagó» la línea del pago no se corta con «…» (como el partido y la espera).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('las listas del partido dejan el pago entero', () => {
  for (const list of ['#slots', '#wait-list', '#no-play-list']) {
    const rule = new RegExp(`${list} \\.pay-line,[\\s\\S]*?${list} \\.tag \\{([^}]*)\\}`);
    const hit = css.match(rule);
    assert.ok(hit, `${list} tiene su regla para el pago`);
    assert.match(hit[1], /white-space: normal/);
    assert.match(hit[1], /text-overflow: unset/);
    assert.match(hit[1], /overflow: visible/);
  }
  // El menú del jugador ya lo hacía.
  assert.match(css, /\.menu-pay \.pay-line \{ white-space: normal; \}/);
});
