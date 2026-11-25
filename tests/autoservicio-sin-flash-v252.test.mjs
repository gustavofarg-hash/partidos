// v252: un link #/jugador/{id} con sesión no muestra «NO TENÉS ACCESO» mientras
// Jugadores no llegó; lo muestra solo cuando ya llegó y la ficha no está.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { playerLinkView } from '../js/profile.js';

const person = { id: 'FicticioJugador0001', name: 'Ficticio' };

test('Jugadores todavía no llegó: «Cargando…», nunca «NO TENÉS ACCESO»', () => {
  assert.equal(playerLinkView({ person: null, rosterReady: false }), 'loading');
});

test('Jugadores ya llegó y la ficha no está: «NO TENÉS ACCESO», como siempre', () => {
  assert.equal(playerLinkView({ person: null, rosterReady: true }), 'denied');
  assert.equal(playerLinkView({ person: null }), 'denied', 'sin el campo (demo) está listo');
});

test('la ficha es de otro organizador: Autoservicio; es suya o viene de un partido: la ficha', () => {
  assert.equal(playerLinkView({ person, held: false, rosterReady: true }), 'signup');
  assert.equal(playerLinkView({ person, held: false, rosterReady: false }), 'signup');
  assert.equal(playerLinkView({ person, held: true }), 'profile');
  assert.equal(playerLinkView({ person: null, fromMatch: true, rosterReady: false }), 'profile');
});

test('el store con sesión arranca con rosterReady en false y lo pone en true al llegar Jugadores (o al fallar)', () => {
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  assert.match(src, /statsError: '', rosterReady: false \};/);
  assert.equal((src.match(/this\.state\.rosterReady = true;/g) || []).length, 2);
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /app\.rosterReady = view\.rosterReady !== false;/);
});
