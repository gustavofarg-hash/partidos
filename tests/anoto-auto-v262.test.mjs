// v262: en el partido, «Se anotó con» lleva « (auto)» si el jugador
// se anotó por Autoservicio. La lista que se copia no cambia.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  signedUpAutoMark,
  signedUpWithFieldLabel,
  signedUpWithLine,
} from '../js/self-signup.js';

const autoPlayer = {
  signedUpWithName: 'Gus',
  signedUpWith: 'orgA',
  selfSignup: true,
};
const addedPlayer = {
  signedUpWithName: 'Gus',
  signedUpWith: 'orgA',
};

test('el sufijo (auto) solo si selfSignup es verdadero', () => {
  assert.equal(signedUpAutoMark(autoPlayer), ' (auto)');
  assert.equal(signedUpAutoMark(addedPlayer), '');
  assert.equal(signedUpAutoMark({ selfSignup: false, signedUpWithName: 'Gus' }), '');
  assert.equal(signedUpAutoMark({}), '');
  assert.equal(signedUpAutoMark(null), '');
});

test('Se anotó con: Gus (auto) si vino del Autoservicio, también después de cambiar el organizador o de aceptar', () => {
  assert.equal(signedUpWithLine(autoPlayer), 'Se anotó con: Gus (auto)');
  assert.equal(signedUpWithLine(addedPlayer), 'Se anotó con: Gus');
  // Sigue el mark si cambia «Se anotó con» o si ya lo aceptaron.
  assert.equal(signedUpWithLine({
    ...autoPlayer,
    signedUpWith: 'orgB',
    signedUpWithName: 'Martín',
  }), 'Se anotó con: Martín (auto)');
  assert.equal(signedUpWithLine({
    ...autoPlayer,
    tentative: null,
    acceptedBy: 'Gus',
  }), 'Se anotó con: Gus (auto)');
  assert.equal(signedUpWithLine({ selfSignup: true, signedUpWithName: '  ' }), '');
  assert.equal(signedUpWithLine({ selfSignup: true }), '');
});

test('la etiqueta del campo lleva el sufijo; no va en el nombre del organizador', () => {
  assert.equal(signedUpWithFieldLabel(autoPlayer), 'Se anotó con: (auto)');
  assert.equal(signedUpWithFieldLabel(addedPlayer), 'Se anotó con:');
  assert.equal(signedUpWithFieldLabel(null), 'Se anotó con:');
});

test('la app usa esas funciones en el tag, el menú y el formulario; la lista copiada no cambia', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /signedUpWithLine\(/);
  assert.match(app, /signedUpWithFieldLabel\(/);
  const tagAt = app.indexOf('function signedUpTag(player)');
  assert.ok(tagAt >= 0);
  assert.match(app.slice(tagAt, tagAt + 280), /signedUpWithLine\(player\)/);
  const fieldsAt = app.indexOf('function signupFields(player, match)');
  assert.ok(fieldsAt >= 0);
  const fields = app.slice(fieldsAt, fieldsAt + 600);
  assert.match(fields, /signedUpWithFieldLabel\(player\)/);
  assert.doesNotMatch(fields, /<option[^>]*>\$\{esc\(item\.name\)\} \$\{/);
  const menuAt = app.indexOf('id="signed-up-line"');
  assert.ok(menuAt >= 0);
  assert.match(app.slice(menuAt - 80, menuAt + 80), /signedUpWithLine\(p\)/);

  const listAt = app.indexOf('function listText(m)');
  assert.ok(listAt >= 0);
  const nextFn = app.indexOf('\nfunction ', listAt + 1);
  const listText = app.slice(listAt, nextFn > listAt ? nextFn : listAt + 2500);
  assert.doesNotMatch(listText, /signedUpWithLine|signedUpAutoMark|signedUpWithFieldLabel/);
  assert.doesNotMatch(listText, /\(auto\)/);
  assert.doesNotMatch(listText, /selfSignup/);
  assert.match(listText, /shownName\(p\) \+ suspended \+ friendSuffix\(p\)/);
});
