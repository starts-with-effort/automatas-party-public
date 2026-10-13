// Sala de práctica: un solo minijuego en bucle, para probarlo con celulares sin jugar la partida.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

function practiceRoom({ minigame = 'arena', teamCount = 3 } = {}) {
  const clock = createFakeClock();
  const engine = new GameEngine({ config: testConfig(), clock, logger: silentLogger });
  const created = engine.createRoom({ teamCount, practice: minigame });
  assert.equal(created.ok, true);
  const slots = {};
  for (const team of engine.room.teams) {
    const { deviceId } = engine.registerDevice();
    engine.join(deviceId, team.id);
    engine.setPresence(deviceId, { connected: true });
    slots[team.id] = deviceId;
  }
  // Avanza hasta la fase `kind` (pulsa «Siguiente» en el resultado o deja vencer el plazo).
  const advanceTo = (kind) => {
    do {
      const { phase } = engine.room;
      if (phase.waitingHost) engine.next();
      else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
    } while (engine.room.phase.kind !== kind);
  };
  return { engine, clock, slots, advanceTo };
}

describe('sala de práctica', () => {
  test('juega solo el minijuego, con su ronda, y vuelve a las instrucciones tras el resultado', () => {
    const { engine, advanceTo } = practiceRoom();
    assert.equal(engine.plan.length, 4); // instrucciones, juego, duelo (si hay empate) y resultado
    assert.equal(engine.start({ force: true }).ok, true);
    const { phase } = engine.room;
    assert.deepEqual([phase.kind, phase.minigame, phase.round, phase.practice, phase.attempt], ['minigameIntro', 'arena', 5, true, 1]);
    advanceTo('minigameResult');
    assert.equal(engine.room.finished, false);
    advanceTo('minigameIntro');
    assert.equal(engine.room.phase.attempt, 2);
    assert.equal(engine.room.practice.attempt, 2);
  });

  test('las vistas dicen que es una práctica y el host ve las fases que siguen dando la vuelta', () => {
    const { engine, advanceTo } = practiceRoom();
    engine.start({ force: true });
    advanceTo('minigameResult');
    const host = projectView(engine, { role: 'host' });
    assert.equal(host.room.practice.minigame, 'arena');
    assert.deepEqual(host.upcoming.map((step) => step.kind), ['minigameIntro', 'minigame', 'minigameResult']);
    assert.ok(host.minigames.some((m) => m.id === 'arena'));
    assert.equal(projectView(engine, { role: 'screen' }).phase.practice, true);
  });

  test('el host elige quién es jefe en el próximo intento; vacío vuelve a la regla del puntaje', () => {
    const { engine, advanceTo } = practiceRoom();
    engine.start({ force: true });
    assert.deepEqual(engine.room.minigameSetup.groups, [['t1'], ['t2', 't3']], 'con todos en 0 el jefe es el primero');
    assert.equal(engine.setBosses(['t2', 't3']).ok, true);
    assert.deepEqual(engine.room.minigameSetup.groups[0], ['t1'], 'el intento en curso no cambia');
    advanceTo('minigameIntro');
    assert.deepEqual(engine.room.minigameSetup.groups, [['t2', 't3'], ['t1']]);
    advanceTo('minigame');
    const bosses = engine.room.phase.data.state.vehicles.filter((v) => v.boss).map((v) => v.teamId);
    assert.deepEqual(bosses, ['t2', 't3']);
    assert.equal(engine.setBosses([]).ok, true);
    assert.equal(engine.room.practice.bosses, null);
  });

  test('siempre queda un retador y solo vale en la práctica de la Arena', () => {
    const { engine } = practiceRoom();
    assert.equal(engine.setBosses(['t1', 't2', 't3']).error, 'no_challengers');
    assert.equal(engine.setBosses(['t9']).error, 'unknown_team');
    const memoria = practiceRoom({ minigame: 'memoria' });
    assert.equal(memoria.engine.setBosses(['t1']).error, 'invalid_minigame');
    const full = new GameEngine({ config: testConfig(), clock: createFakeClock(), logger: silentLogger });
    full.createRoom({ teamCount: 2 });
    assert.equal(full.setBosses(['t1']).error, 'not_practice');
    assert.equal(full.plan.length, 80);
  });

  test('cualquier minijuego se puede practicar; uno desconocido se rechaza', () => {
    const { engine, advanceTo } = practiceRoom({ minigame: 'memoria', teamCount: 2 });
    engine.start({ force: true });
    assert.equal(engine.room.phase.round, 1);
    advanceTo('minigame');
    assert.equal(engine.room.phase.minigame, 'memoria');
    const other = new GameEngine({ config: testConfig(), clock: createFakeClock(), logger: silentLogger });
    assert.equal(other.createRoom({ teamCount: 2, practice: 'tetris' }).error, 'unknown_minigame');
  });

  test('crear una sala normal después de una práctica vuelve a la partida completa', () => {
    const { engine } = practiceRoom();
    engine.createRoom({ teamCount: 2, confirm: true });
    assert.equal(engine.room.practice, null);
    assert.equal(engine.plan.length, 80);
  });
});
