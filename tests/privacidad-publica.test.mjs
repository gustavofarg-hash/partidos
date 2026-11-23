// Punto 18 (v232): toda consulta de anotados de la página del jugador fija la ficha
// con rosterId ==. Las reglas rechazan cualquier listado sin eso (sin sesión).
import test from 'node:test';
import assert from 'node:assert/strict';
import { guestListenPlan } from '../js/profile.js';

const pinned = (plan) => plan.filters.some((f) => f.field === 'rosterId' && f.op === '==' && String(f.value || '').length >= 16);

test('punto 18: las consultas de anotados del jugador siempre fijan su ficha', () => {
  const cases = [
    { rosterId: 'RosterJuanAbcdef0001', today: '2026-11-23' },
    { rosterId: 'RosterJuanAbcdef0001', today: '2026-11-23', shareToken: 'abcdefghijklmnopqrstuvwx' },
    { rosterId: 'RosterJuanAbcdef0001', today: '2026-11-23', organizerUid: 'orgGustavoUid123456', shareToken: 'abcdefghijklmnopqrstuvwx' },
  ];
  for (const input of cases) {
    const plan = guestListenPlan(input);
    for (const key of ['players', 'linkPlayers']) {
      const q = plan[key];
      if (!q) continue;
      assert.equal(q.collection, 'players');
      assert.ok(pinned(q), `${key} sin rosterId ==`);
    }
    assert.ok(plan.players, 'falta la consulta propia');
  }
});

test('punto 18: sin ficha no se arma ninguna consulta de anotados', () => {
  const plan = guestListenPlan({ rosterId: '', today: '2026-11-23', shareToken: 'abcdefghijklmnopqrstuvwx' });
  assert.equal(plan.players, null);
  assert.equal(plan.linkPlayers, null);
});

test('punto 18: las reglas exigen la ficha para listar sin sesión', async () => {
  const { readFileSync } = await import('node:fs');
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = rules.slice(rules.indexOf('match /players/{playerId}'), rules.indexOf('allow create', rules.indexOf('match /players/{playerId}')));
  assert.ok(!/allow list: if resource\.data\.viewers\.hasAny\(\['\*'\]\);/.test(block), 'queda el listado abierto sin ficha');
  assert.match(block, /allow list: if resource\.data\.viewers\.hasAny\(\['\*'\]\)\s*&& resource\.data\.rosterId is string\s*&& resource\.data\.rosterId\.size\(\) >= 16/);
});
