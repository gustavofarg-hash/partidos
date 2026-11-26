// v256: el aviso de un guardado que falló dice el paso y el documento (solo el admin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { saveStep, saveStepText, tagSaveStep, withSaveStep } from '../js/save-step.js';
import { writeFailureFor } from '../js/db-notice.js';

const denied = () => Object.assign(new Error('PERMISSION_DENIED'), { code: 'permission-denied' });

test('saveStep deja el paso y el documento; el de afuera se lee primero', async () => {
  const err = await saveStep('con el invitado 1', '', () => saveStep('al actualizar el partido', 'matches/mA', async () => { throw denied(); })).catch((e) => e);
  assert.equal(err.code, 'permission-denied');
  assert.deepEqual(err.saveSteps, ['con el invitado 1', 'al actualizar el partido']);
  assert.equal(err.savePath, 'matches/mA');
  assert.equal(saveStepText(err), 'con el invitado 1 › al actualizar el partido (matches/mA)');
});

test('el documento más adentro gana; un paso vacío solo deja el documento', async () => {
  const err = await saveStep('al anotar a Ficticio Repetido', 'players (nuevo)', () => saveStep('en la confirmación', 'confirmations (de players/x)', () => saveStep('', 'confirmations (de players/viejo, partido mZ, que no está cargado)', async () => { throw denied(); }))).catch((e) => e);
  assert.equal(saveStepText(err), 'al anotar a Ficticio Repetido › en la confirmación (confirmations (de players/viejo, partido mZ, que no está cargado))');
});

test('sin falla devuelve el valor y no toca nada', async () => {
  assert.equal(await saveStep('x', 'y', async () => 7), 7);
  assert.equal(saveStepText(new Error('x')), '');
  assert.equal(saveStepText(null), '');
});

test('el mismo paso dos veces seguidas no se repite', () => {
  const err = denied();
  tagSaveStep(err, 'al anotar a Ficticio Repetido');
  tagSaveStep(err, 'al anotar a Ficticio Repetido');
  assert.deepEqual(err.saveSteps, ['al anotar a Ficticio Repetido']);
  assert.equal(tagSaveStep('texto', 'a'), 'texto');
});

test('el aviso del admin intercala el paso; el texto de los demás no cambia', () => {
  const err = tagSaveStep(tagSaveStep(denied(), 'en el Registro', 'log'), 'al anotar a Ficticio Repetido');
  assert.equal(withSaveStep('No se pudo guardar: Firebase rechazó el permiso', err), 'No se pudo guardar al anotar a Ficticio Repetido › en el Registro (log): Firebase rechazó el permiso');
  assert.equal(withSaveStep('No se pudo guardar: Firebase rechazó el permiso', denied()), 'No se pudo guardar: Firebase rechazó el permiso');
  assert.equal(writeFailureFor('No se pudo guardar: Firebase rechazó el permiso', false), 'No se pudo guardar: Firebase rechazó el permiso');
  assert.equal(writeFailureFor('No se pudo guardar: aborted: x', false), 'No se pudo guardar. Probá de nuevo.');
});

test('la app marca cada paso de Agregar jugador y solo el admin ve el detalle', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  for (const step of ['al anotar a ${host.name}', 'con el invitado ${index + 1}', "'al descontar saldo'", "'al guardar en Jugadores'", "'al sumar los invitados a sus otros partidos del día'"]) assert.ok(app.includes(step), step);
  for (const step of ["'al guardar el jugador'", "'al actualizar el partido'", "'con el teléfono'", "'en la confirmación'", "'en el Registro'"]) assert.ok(store.includes(step), step);
  assert.match(app, /else if \(isAdminUser\(\) && saveStepText\(e\)\) toast\(withSaveStep\(/);
  assert.match(app, /console\.error\('Guardado: falló ' \+ saveStepText\(e\)\)/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'js/save-step.js'"));
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.toast\.detail \{[^}]*border-radius: 14px/);
});
