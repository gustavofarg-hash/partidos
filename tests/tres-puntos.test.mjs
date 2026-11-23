// v236 (punto 1): tres puntos a la derecha del ícono de compartir del jugador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playerMoreItems, playerShareTarget } from '../js/player-more.js';
import { playerLink } from '../js/share.js';

test('tres puntos: Compartir link siempre; Cargar y Devolver con los permisos del panel', () => {
  assert.deepEqual(playerMoreItems().map((i) => i.label), ['Compartir link']);
  assert.deepEqual(playerMoreItems({ canCredit: false, creditAmount: 5000 }).map((i) => i.key), ['share']);
  const withCredit = playerMoreItems({ canCredit: true, creditAmount: 5000 });
  assert.deepEqual(withCredit.map((i) => i.label), ['Compartir link', 'Cargar Crédito', 'Devolver Crédito']);
  assert.deepEqual(withCredit.map((i) => i.disabled), [false, false, false]);
  // Igual que el botón Devolver: con $0 queda deshabilitado.
  assert.equal(playerMoreItems({ canCredit: true, creditAmount: 0 })[2].disabled, true);
  assert.equal(playerMoreItems({ canCredit: true, creditAmount: -10 })[2].disabled, true);
  assert.equal(playerMoreItems({ canCredit: true })[2].disabled, true);
});

test('tres puntos: Compartir link manda el link completo, al chat del jugador si se ve su número', () => {
  const url = playerLink('RosterJuanAbcdef0001', 'abcdefghijklmnopqrstuvwx');
  assert.ok(url.endsWith('#/jugador/RosterJuanAbcdef0001/abcdefghijklmnopqrstuvwx'));
  assert.deepEqual(playerShareTarget({ phone: '5491112345678', url }), { phone: '5491112345678', text: url });
  assert.deepEqual(playerShareTarget({ phone: '', url }), { phone: '', text: url });
  assert.equal(playerShareTarget({ phone: '5491112345678', url: '' }), null);
  assert.equal(/spoo\.me|da\.gd|\/c\/\?k=/.test(playerShareTarget({ url }).text), false);
});

test('tres puntos: están en el menú del jugador y en el perfil, al lado de compartir, y reusan las funciones de siempre', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$\{playerShareButton\('pm-share'\)\}\s*\$\{playerMoreControl\('pm-more', panel, shareRosterId\(p\)\)\}/);
  assert.match(app, /\$\{playerShareButton\('profile-share'\)\}\s*\$\{playerMoreControl\('profile-more', money\.panel, person\.id\)\}/);
  assert.match(app, /kind === 'credit'\) openCreditForm\(\{ player, person, panel \}\)/);
  assert.match(app, /kind === 'refund' && Number\(panel\?\.shownAmount\) > 0\) openCreditReturnForm\(\{ player, person, panel \}\)/);
  assert.match(app, /kind === 'share'\) sharePlayerLink\(rosterId, phone\)/);
  // El ícono de compartir sigue copiando el link.
  assert.match(app, /menuShare\.onclick = \(\) => copyPlayerLink\(shareRosterId\(p\)\)/);
  assert.match(app, /profileShare\.onclick = \(\) => copyPlayerLink\(person\.id\)/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'js/player-more.js'"));
});
