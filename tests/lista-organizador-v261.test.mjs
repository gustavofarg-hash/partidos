// v261: en el Autoservicio, con token en el link no se muestra una lista vacía
// hasta saber el organizador; si el navegador ya bloqueó avisos, el texto se ve
// sin tocar el botón.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  guestLinkSignupState,
  SHARE_TOKEN_LOAD_ERROR,
  SHARE_TOKEN_WAIT_MS,
  shareTokenSnapshotState,
} from '../js/self-signup.js';
import { playerPushDeniedNotice } from '../js/push.js';

test('un exists:false de la caché no cierra el token; el del servidor sí', () => {
  assert.equal(shareTokenSnapshotState({ exists: false, fromCache: true }), 'pending');
  assert.equal(shareTokenSnapshotState({ exists: true, fromCache: true, uid: '' }), 'pending');
  assert.equal(shareTokenSnapshotState({ exists: false, fromCache: false }), 'missing');
  assert.equal(shareTokenSnapshotState({ exists: true, fromCache: false, uid: 'orgA' }), 'ready');
  assert.equal(shareTokenSnapshotState({ exists: true, fromCache: true, uid: 'orgA' }), 'ready');
  assert.equal(SHARE_TOKEN_WAIT_MS, 12_000);
  assert.equal(SHARE_TOKEN_LOAD_ERROR, 'No se pudieron cargar los partidos.');
});

test('con token y sin organizador: cargar o error, no lista vacía', () => {
  assert.equal(guestLinkSignupState({ token: '', organizer: null }), 'ready');
  assert.equal(guestLinkSignupState({ token: 'tokFicticio00000000001', organizer: { uid: 'orgA' } }), 'ready');
  assert.equal(guestLinkSignupState({ token: 'tokFicticio00000000001', organizer: null }), 'loading');
  assert.equal(guestLinkSignupState({ token: 'tokFicticio00000000001', organizer: {}, shareError: '' }), 'loading');
  assert.equal(guestLinkSignupState({
    token: 'tokFicticio00000000001',
    organizer: null,
    shareError: SHARE_TOKEN_LOAD_ERROR,
  }), 'error');
});

test('si las notificaciones ya están bloqueadas, el aviso se arma sin un toque', () => {
  assert.equal(playerPushDeniedNotice('denied'), 'El navegador no deja mostrar avisos.');
  assert.equal(playerPushDeniedNotice('default'), '');
  assert.equal(playerPushDeniedNotice('granted'), '');
  assert.equal(playerPushDeniedNotice(''), '');
});

test('la app redibuja cuando llega el organizador y no pinta la lista vacía', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /app\.guestShareError, app\.shareOrganizer, app\.rosterReady/);
  assert.match(app, /if \(!app\.session\?\.user\) \{/);
  assert.match(app, /if \(linkState === 'loading'\) \{ showGuestLoading\(\); return; \}/);
  assert.match(app, /if \(linkState === 'error'\) \{ showGuestShareError\(\); return; \}/);
  assert.match(app, /id="player-share-retry">Reintentar/);
  assert.match(app, /playerPushDeniedNotice\(\)/);
  const store = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  assert.match(store, /includeMetadataChanges: true/);
  assert.match(store, /shareTokenSnapshotState\(/);
  assert.match(store, /fromCache === true/);
  const failAt = store.indexOf('const failShare = () => {');
  assert.ok(failAt >= 0, 'falta failShare');
  assert.match(store.slice(failAt, failAt + 500), /this\._emit\(\)/);
  const renderAt = app.indexOf('function render()');
  const signupAt = app.indexOf('function renderPlayerSignup');
  const renderGuest = app.slice(renderAt, signupAt > renderAt ? signupAt : renderAt + 2500);
  assert.match(renderGuest, /linkState === 'error'/);
  assert.ok(renderGuest.indexOf("linkState === 'error'") < renderGuest.indexOf('app.guestReady === false'), 'el error del token se ve aunque guestReady siga en falso');
});
