// v240: las lecturas de Estadísticas (partidos del mes que faltan y sus
// jugadores) pasan las reglas reales, sin índices nuevos. Datos ficticios.
//   firebase emulators:exec --project demo-f7c --only firestore "node --test tests/rules-estadisticas-mes.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GUS = 'gusEstadisticas';
const OTRO = 'otroEstadisticas';

test('Estadísticas lee los días que faltan del mes con las reglas reales', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('sin emulador de Firestore');
    return;
  }
  const { initializeTestEnvironment } = await import('@firebase/rules-unit-testing');
  const fs = await import('firebase/firestore');
  const { doc, setDoc } = fs;
  const { FirebaseStore } = await import('../js/store.js');
  const [hostname, portRaw] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-estadisticas-mes',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: hostname, port: Number(portRaw) },
  });
  try {
    await env.clearFirestore();
    const ids = [];
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', GUS), { role: 'organizer', name: 'Gustavo', email: 'g@demo.local', active: true, createdAt: 1 });
      await setDoc(doc(db, 'users', OTRO), { role: 'organizer', name: 'Otro', email: 'o@demo.local', active: true, createdAt: 1 });
      for (let day = 1; day <= 12; day += 1) {
        const date = `2026-11-${String(day).padStart(2, '0')}`;
        const id = `${date}_2000`;
        ids.push(id);
        await setDoc(doc(db, 'matches', id), {
          date, time: '20:00', capacity: 14, createdByUid: GUS,
          viewers: day % 2 ? ['*'] : [GUS], adders: ['*'], cancelled: day === 4,
        });
        for (let k = 0; k < 3; k += 1) {
          await setDoc(doc(db, 'players', `${id}-p${k}`), {
            matchId: id, matchDate: date, name: `Jugador ${k}`, viewers: day % 2 ? ['*'] : [GUS],
            addedBy: 'Gustavo', addedByUid: GUS, createdAt: 1, updatedAt: 1, paid: true,
          });
        }
      }
      // Uno que Gustavo no ve.
      await setDoc(doc(db, 'matches', '2026-11-03_2200'), { date: '2026-11-03', time: '22:00', capacity: 14, createdByUid: OTRO, viewers: [OTRO], adders: [OTRO] });
      await setDoc(doc(db, 'players', 'ajeno-p'), { matchId: '2026-11-03_2200', matchDate: '2026-11-03', name: 'Ajeno', viewers: [OTRO], addedBy: 'Otro', addedByUid: OTRO, createdAt: 1, updatedAt: 1 });
    });
    const store = new FirebaseStore();
    store.fs = fs;
    store.db = env.authenticatedContext(GUS, { email: 'g@demo.local' }).firestore();
    store.actor = { uid: GUS, name: 'Gustavo', role: 'organizer' };
    store._historyBounds = { mode: 'recent', before: '2026-11-23', limit: 30, empty: false };
    store._historySeen = true;
    store.state.historyHasMore = true;
    store._historyCursor = '2026-11-09';
    store._emit = () => {};
    const ok = await store.loadStatsRange('2026-11-01', '2026-11-22');
    assert.equal(store.state.statsError, '', 'sin error de reglas ni de índice');
    assert.equal(ok, true);
    const got = store.state.statsMatches.map((m) => m.id).sort();
    assert.deepEqual(got, ids.filter((id) => id < '2026-11-09'));
    // Jugadores de los 7 no cancelados, 3 cada uno; nada del partido ajeno.
    assert.equal(store.state.statsPlayers.length, 7 * 3);
    assert.equal(store.state.statsPlayers.some((p) => p.id === 'ajeno-p'), false);
  } finally {
    await env.cleanup();
  }
});
