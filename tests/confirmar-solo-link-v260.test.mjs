// v260: la anotación pendiente del Autoservicio la confirma solo el organizador
// del link («Confirmar lugar» y el ✅ de «A confirmar»), también para el admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canConfirmSpot, linkOrganizerUid, pendingSelfSignups } from '../js/self-signup.js';

const auto = { id: 'a', matchId: 'm', selfSignup: true, tentative: true, waiting: false, addedByUid: 'mar', signedUpWith: 'mar', createdAt: 1 };

test('Confirmar lugar: Autoservicio pendiente solo el del link; lo demás como antes', () => {
  assert.equal(linkOrganizerUid(auto), 'mar');
  assert.equal(linkOrganizerUid({ signedUpWith: 'gus' }), 'gus');
  assert.equal(canConfirmSpot(auto, 'mar'), true);
  assert.equal(canConfirmSpot(auto, 'gus'), false);
  assert.equal(canConfirmSpot(auto, ''), false);
  // Reserva del organizador (no Autoservicio): cualquiera, como antes.
  assert.equal(canConfirmSpot({ tentative: true, addedByUid: 'mar' }, 'gus'), true);
  // Autoservicio sin organizador del link guardado: como antes.
  assert.equal(canConfirmSpot({ ...auto, addedByUid: '', signedUpWith: '' }, 'gus'), true);
  // Ya confirmado o en espera: no aplica.
  assert.equal(canConfirmSpot({ ...auto, tentative: null }, 'gus'), true);
});

test('«A confirmar»: solo el organizador del link, tampoco el admin', () => {
  const matches = [{ id: 'm', createdByUid: 'gus', adders: ['gus', 'mar'] }];
  assert.deepEqual(pendingSelfSignups({ players: [auto], matches, uid: 'mar' }).map((r) => r.player.id), ['a']);
  assert.equal(pendingSelfSignups({ players: [auto], matches, uid: 'gus', admin: true }).length, 0);
  // Sin organizador del link: los del partido, como antes.
  const loose = { ...auto, addedByUid: '' };
  assert.equal(pendingSelfSignups({ players: [loose], matches, uid: 'gus' }).length, 1);
});

test('la app usa canConfirmSpot en el partido, el menú y el ✅', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const spot = app.slice(app.indexOf('function confirmSpotButton('), app.indexOf('function confirmPlayerPlace('));
  assert.match(spot, /if \(!canConfirmSpot\(p, actor\(\)\.uid\)\) return '';/);
  assert.match(spot, /function clearReservedSpot\(player\) \{\n  if \(!player \|\| player\.tentative !== true \|\| !canConfirmSpot\(player, actor\(\)\.uid\)\) return;/);
  assert.match(app, /p\.tentative === true && canConfirmSpot\(p, actor\(\)\.uid\) \? '<button class="btn" id="pm-confirm-spot">/);
  assert.match(app, /if \(!player \|\| !canConfirmSpot\(player, actor\(\)\.uid\)\) return;\n      return confirmPlayerPlace\(player, 'Aceptado'\);/);
});
