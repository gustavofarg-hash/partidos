// v264: «Agregó» va en su propia línea, debajo del teléfono y arriba
// de «Se anotó con», en titulares, espera y «No jugó pero pagó».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

test('addedTag envuelve el chip en added-line', () => {
  const fn = app.match(/function addedTag\([\s\S]*?\n\}/);
  assert.ok(fn, 'está addedTag');
  assert.match(fn[0], /class="added-line"/);
  assert.match(fn[0], /Agregó:/);
  assert.match(fn[0], /class="tag \$\{organizerTagClass\(player\.addedBy\)\}"/);
});

test('el CSS fuerza la línea en titulares, espera y no jugó', () => {
  assert.match(css, /#slots \.sub > \.added-line/);
  assert.match(css, /#wait-list \.sub > \.added-line/);
  assert.match(css, /#no-play-list \.sub > \.added-line/);
  const block = css.match(/#slots \.sub > \.added-line,[\s\S]*?\}/);
  assert.ok(block, 'hay un bloque para added-line');
  assert.match(block[0], /flex:\s*1 1 100%/);
});

test('las tres listas del partido siguen pintando addedTag en ese orden', () => {
  const slots = app.match(/<ul class="slots" id="slots">[\s\S]*?slots\.join/);
  // the template is pushed earlier; check the three .sub templates
  const subs = [...app.matchAll(/<div class="sub">\$\{phoneSub\(p\)\}[\s\S]*?<\/div>/g)].map((m) => m[0]);
  assert.ok(subs.length >= 3, `se esperaban 3 bloques .sub, hay ${subs.length}`);
  for (const sub of subs) {
    const added = sub.indexOf('${addedTag(p)}');
    const signed = sub.indexOf('${signedUpTag(p)}');
    assert.ok(added >= 0, 'está addedTag');
    assert.ok(signed > added, 'Se anotó con va después de Agregó');
  }
});
