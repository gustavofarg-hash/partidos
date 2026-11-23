// v241: marcar el arco no cambia a nadie de equipo. Datos ficticios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextInGoalAt, orderTeamsByGoal, teamDragDrop } from '../js/teams.js';

const teams = { bib: ['b1', 'b2', 'b3', 'b4', 'b5'], plain: ['p1', 'p2', 'p3', 'p4', 'p5'] };
const base = () => [
  { id: 'b1', inGoal: true, inGoalAt: 100 },
  { id: 'b2' }, { id: 'b3' }, { id: 'b4' }, { id: 'b5' },
  { id: 'p1', inGoal: true, inGoalAt: 110 },
  { id: 'p2', inGoal: true, inGoalAt: 120 },
  { id: 'p3' }, { id: 'p4' }, { id: 'p5' },
];
const mark = (players, id, on) => players.map((p) => {
  if (p.id !== id) return p;
  return on ? { ...p, inGoal: true, inGoalAt: nextInGoalAt(players.filter((row) => row.id !== id), 200) } : { ...p, inGoal: false, inGoalAt: undefined };
});

test('arco con pechera: queda debajo del último de su equipo que fue al arco, nadie cambia de equipo', () => {
  const out = orderTeamsByGoal(teams, mark(base(), 'b4', true));
  assert.deepEqual(out.bib, ['b1', 'b4', 'b2', 'b3', 'b5']);
  assert.deepEqual(out.plain, ['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('arco sin pechera: queda debajo del último de su equipo que fue al arco', () => {
  const out = orderTeamsByGoal(teams, mark(base(), 'p4', true));
  assert.deepEqual(out.plain, ['p1', 'p2', 'p4', 'p3', 'p5']);
  assert.deepEqual(out.bib, ['b1', 'b2', 'b3', 'b4', 'b5']);
});

test('desmarcar: vuelve con los que no fueron, sin cambiar de equipo', () => {
  const marked = mark(base(), 'b4', true);
  const out = orderTeamsByGoal(orderTeamsByGoal(teams, marked), mark(marked, 'b4', false));
  assert.deepEqual(out.bib.slice(0, 1), ['b1']);
  assert.deepEqual([...out.bib].sort(), [...teams.bib].sort());
  assert.deepEqual(out.plain, ['p1', 'p2', 'p3', 'p4', 'p5']);
});

test('un scroll desde un nombre no deja un arrastre abierto', () => {
  // Mismo dedo, se movió: es arrastre.
  assert.equal(teamDragDrop({ id: 'p2', x: 10, y: 300, pointerId: 3 }, { x: 10, y: 100, pointerId: 3 }), 'p2');
  // Otro toque (el del arco) no cierra el arrastre de un gesto anterior.
  assert.equal(teamDragDrop({ id: 'p2', x: 10, y: 300, pointerId: 3 }, { x: 300, y: 100, pointerId: 4 }), '');
  // Si la pantalla scrolleó en el medio, fue scroll.
  assert.equal(teamDragDrop({ id: 'p2', x: 10, y: 300, pointerId: 3, scrolled: true }, { x: 10, y: 100, pointerId: 3 }), '');
  // Sin moverse no es arrastre; sin inicio tampoco.
  assert.equal(teamDragDrop({ id: 'p2', x: 10, y: 300, pointerId: 3 }, { x: 14, y: 305, pointerId: 3 }), '');
  assert.equal(teamDragDrop(null, { x: 10, y: 100, pointerId: 3 }), '');
});

test('la pantalla de Equipos cierra el arrastre con pointercancel y al empezar otro toque', () => {
  const src = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(src, /addEventListener\('pointercancel', dropPointer\)/);
  assert.match(src, /addEventListener\('pointerdown', \(e\) => \{\n\s*dropPointer\(\);/);
  assert.match(src, /teamDragDrop\(start, \{ x: e\.clientX, y: e\.clientY, pointerId: e\.pointerId \}\)/);
});
