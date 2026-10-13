import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { Persistence } from '../server/core/Persistence.js';
import { buildRoundPlan } from '../server/core/RoundPlan.js';
import { projectView } from '../server/core/ViewProjector.js';
import { rankTeams } from '../server/domain/ranking.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

function setup({ config = testConfig(), persistence = null, clock = createFakeClock() } = {}) {
  const engine = new GameEngine({ config, clock, persistence, logger: silentLogger });
  return { engine, clock };
}

// Crea una sala con `teamCount` equipos llenos (2 dispositivos cada uno).
function fullRoom(engine, teamCount = 3) {
  engine.createRoom({ teamCount });
  const devices = [];
  for (const team of engine.room.teams) {
    for (let i = 0; i < 2; i += 1) {
      const { deviceId, token } = engine.registerDevice();
      assert.equal(engine.join(deviceId, team.id).ok, true);
      devices.push({ deviceId, token, teamId: team.id });
    }
  }
  return devices;
}

const phaseId = (engine) => engine.room.phase.id;

describe('plan de rondas', () => {
  // Rediseño, fase 4: un ranking más en cada ronda, justo antes del uso de objetos. Fase 5:
  // «Formando grupos» antes de las instrucciones, solo en los minijuegos en equipos (Memoria y Clicker).
  test('5 rondas de 15 fases (16 con «Formando grupos») y una ronda final de 3', () => {
    const plan = buildRoundPlan(testConfig());
    assert.equal(plan.length, 5 * 15 + 2 + 3);
    assert.deepEqual(plan.slice(0, 16).map((step) => step.kind), [
      'question', 'questionResult', 'draft', 'question', 'questionResult', 'roulette', 'minigameGroups',
      'minigameIntro', 'minigame', 'duel', 'minigameResult', 'ranking', 'itemUse', 'resolution', 'duel', 'ranking',
    ]);
    assert.deepEqual(plan.slice(11, 16).map((step) => step.id), ['r1.ranking.before', 'r1.use', 'r1.resolution', 'r1.duel', 'r1.ranking']);
    assert.equal(plan[11].before, true);
    assert.deepEqual(plan.filter((step) => step.kind === 'minigameGroups').map((step) => step.minigame), ['memoria', 'clicker']);
    assert.deepEqual(plan.slice(-3).map((step) => step.id), ['final.q11', 'final.q11.result', 'final.ranking']);
    assert.deepEqual(plan.filter((step) => step.kind === 'minigame').map((step) => step.minigame),
      ['memoria', 'traza', 'clicker', 'flappy', 'arena']);
  });

  test('un minijuego desactivado se reemplaza por el Clicker', () => {
    const base = testConfig();
    const minigames = base.minigames.map((entry) => ({ ...entry, enabled: entry.id !== 'memoria' }));
    const plan = buildRoundPlan(testConfig({ minigames }));
    assert.equal(plan.find((step) => step.id === 'r1.mg').minigame, 'clicker');
  });
});

describe('sala y lobby', () => {
  test('crea los equipos con nombres y colores por defecto', () => {
    const { engine } = setup();
    assert.equal(engine.createRoom({ teamCount: 6, names: ['Los Autómatas'] }).ok, true);
    assert.equal(engine.room.teams.length, 6);
    assert.equal(engine.room.teams[0].name, 'Los Autómatas');
    assert.equal(engine.room.teams[1].name, 'Equipo 2');
    assert.equal(engine.createRoom({ teamCount: 9 }).error, 'invalid_team_count');
  });

  test('un equipo admite 2 dispositivos: A y luego B', () => {
    const { engine } = setup();
    engine.createRoom({ teamCount: 2 });
    const [a, b, c] = [engine.registerDevice(), engine.registerDevice(), engine.registerDevice()];
    assert.deepEqual(engine.join(a.deviceId, 't1'), { ok: true, slot: 'A' });
    assert.deepEqual(engine.join(b.deviceId, 't1'), { ok: true, slot: 'B' });
    assert.equal(engine.join(c.deviceId, 't1').error, 'team_full');
  });

  test('cambiar de equipo libera el puesto anterior; salir también', () => {
    const { engine } = setup();
    engine.createRoom({ teamCount: 2 });
    const a = engine.registerDevice();
    engine.join(a.deviceId, 't1');
    engine.join(a.deviceId, 't2');
    assert.deepEqual(engine.room.teams[0].slots, { A: null, B: null });
    assert.equal(engine.teamOf(a.deviceId).team.id, 't2');
    engine.leave(a.deviceId);
    assert.equal(engine.teamOf(a.deviceId), null);
  });

  test('con el ingreso cerrado no se puede entrar', () => {
    const { engine } = setup();
    engine.createRoom({ teamCount: 2 });
    engine.setLobbyOpen(false);
    assert.equal(engine.join(engine.registerDevice().deviceId, 't1').error, 'lobby_closed');
  });

  test('el token identifica al dispositivo; al expulsarlo deja de valer', () => {
    const { engine } = setup();
    const [device] = fullRoom(engine, 2);
    assert.equal(engine.authenticate(device.token), device.deviceId);
    assert.equal(engine.authenticate('otro'), null);
    engine.kick(device.deviceId);
    assert.equal(engine.authenticate(device.token), null);
    assert.equal(engine.room.teams[0].slots.A, null);
  });
});

describe('inicio', () => {
  test('exige equipos completos salvo que se fuerce; los equipos vacíos no juegan', () => {
    const { engine } = setup();
    engine.createRoom({ teamCount: 3 });
    engine.join(engine.registerDevice().deviceId, 't1');
    assert.equal(engine.start().error, 'teams_incomplete');
    assert.equal(engine.start({ force: true }).ok, true);
    assert.deepEqual(engine.room.teams.map((team) => team.id), ['t1']);
    assert.equal(engine.room.lobbyOpen, false);
    assert.equal(phaseId(engine), 'r1.q1');
  });

  test('sin jugadores no se puede iniciar', () => {
    const { engine } = setup();
    engine.createRoom({ teamCount: 2 });
    assert.equal(engine.start({ force: true }).error, 'no_players');
  });
});

describe('fases', () => {
  test('las fases con tiempo avanzan solas al vencer el plazo', () => {
    const { engine, clock } = setup();
    fullRoom(engine);
    engine.start();
    clock.advance(999);
    assert.equal(phaseId(engine), 'r1.q1');
    clock.advance(1);
    assert.equal(phaseId(engine), 'r1.q1.result');
  });

  test('startsAt común: cada fase se anuncia leadMs antes de empezar', () => {
    const { engine, clock } = setup({ config: testConfig({ timings: { leadMs: 1200 } }) });
    fullRoom(engine);
    engine.start();
    const { startsAt, endsAt } = engine.room.phase;
    assert.equal(startsAt, clock.now() + 1200);
    assert.equal(endsAt, startsAt + 1000);
  });

  test('las pantallas de resultados esperan al host', () => {
    const { engine, clock } = setup();
    fullRoom(engine);
    engine.start();
    assert.equal(engine.next().error, 'not_waiting_host');
    clock.advance(1000);
    clock.advance(60_000);
    assert.equal(phaseId(engine), 'r1.q1.result');
    assert.equal(engine.next().ok, true);
    assert.equal(phaseId(engine), 'r1.draft');
  });

  test('con avance automático, los resultados avanzan solos', () => {
    const { engine, clock } = setup({ config: testConfig({ timings: { autoAdvanceMs: 5000 } }) });
    fullRoom(engine);
    engine.start();
    clock.advance(1000);
    assert.equal(phaseId(engine), 'r1.q1.result');
    clock.advance(5000);
    assert.equal(phaseId(engine), 'r1.draft');
  });

  test('la fase termina antes si todos los equipos completan su acción', () => {
    const { engine, clock } = setup();
    const devices = fullRoom(engine, 2);
    engine.start();
    runUntil(engine, clock, 'r1.use');
    assert.equal(engine.action(devices[0].deviceId, { type: 'confirm' }).ok, true);
    assert.equal(engine.action(devices[1].deviceId, { type: 'confirm' }).error, 'already_confirmed'); // mismo equipo
    assert.equal(phaseId(engine), 'r1.use');
    engine.action(devices[2].deviceId, { type: 'confirm' });
    assert.equal(phaseId(engine), 'r1.resolution');
  });

  test('no se aceptan acciones antes de startsAt, de quien no está en un equipo ni de otro tipo', () => {
    const { engine, clock } = setup({ config: testConfig({ timings: { leadMs: 1200 } }) });
    const devices = fullRoom(engine, 2);
    engine.start();
    const answer = { type: 'answer', questionId: 'q1', option: 0, tClient: 0 };
    assert.equal(engine.action(devices[0].deviceId, answer).error, 'phase_not_started');
    clock.advance(1200);
    assert.equal(engine.action(engine.registerDevice().deviceId, answer).error, 'not_in_team');
    assert.equal(engine.action(devices[0].deviceId, { type: 'confirm' }).error, 'invalid_action');
    assert.equal(engine.action(devices[0].deviceId, answer).ok, true);
  });

  test('saltar fase cierra la fase actual', () => {
    const { engine } = setup();
    fullRoom(engine);
    engine.start();
    engine.skip();
    assert.equal(phaseId(engine), 'r1.q1.result');
  });
});

describe('pausa', () => {
  test('congela el plazo y al reanudar conserva el tiempo restante', () => {
    const { engine, clock } = setup({ config: testConfig({ timings: { leadMs: 200 } }) });
    fullRoom(engine);
    engine.start();
    clock.advance(200 + 400); // 400 ms dentro de la pregunta
    engine.pause();
    assert.equal(engine.next().error, 'paused');
    clock.advance(10_000);
    assert.equal(phaseId(engine), 'r1.q1');
    engine.resume();
    const { endsAt, resumeAt } = engine.room.phase;
    assert.equal(resumeAt, clock.now() + 200);
    assert.equal(endsAt - resumeAt, 600); // los 600 ms que quedaban
    clock.advance(799);
    assert.equal(phaseId(engine), 'r1.q1');
    clock.advance(1);
    assert.equal(phaseId(engine), 'r1.q1.result');
  });
});

// Rediseño, fase 5: «Formando grupos» forma los grupos y las instrucciones usan los mismos.
const PHASE_VIEW = (engine) => projectView(engine, { role: 'screen' }).phase.data;

describe('formando grupos', () => {
  test('los grupos se forman una vez y las instrucciones muestran los mismos, con el tipo', () => {
    const { engine, clock } = setup();
    fullRoom(engine, 4);
    engine.start();
    runUntil(engine, clock, 'r1.mg.groups');
    const groups = engine.room.minigameSetup.groups;
    assert.equal(groups.length, 2);
    assert.ok(groups.every((group) => group.length === 2));
    runUntil(engine, clock, 'r1.mg.intro');
    const data = PHASE_VIEW(engine);
    assert.deepEqual(data.groups, groups);
    assert.equal(data.grouping, 'pairs');
    assert.equal(engine.events.filter((e) => e.type === 'minigame_groups' && e.round === 1).length, 1);
    // La Traza a ciegas (cada equipo solo) no tiene «Formando grupos».
    runUntil(engine, clock, 'r2.mg.intro');
    assert.equal(PHASE_VIEW(engine).grouping, 'teams');
    assert.ok(!engine.plan.some((step) => step.id === 'r2.mg.groups'));
  });
});

describe('ranking', () => {
  test('los empatados comparten puesto', () => {
    const teams = [
      { id: 'a', order: 0, score: 100, streak: 0 },
      { id: 'b', order: 1, score: 300, streak: 0 },
      { id: 'c', order: 2, score: 100, streak: 0 },
      { id: 'd', order: 3, score: 50, streak: 0 },
    ];
    assert.deepEqual(rankTeams(teams).map((row) => [row.teamId, row.position]), [['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
  });

  test('el ranking de la ronda muestra el cambio de puesto respecto a la anterior', () => {
    const { engine, clock } = setup();
    fullRoom(engine, 2);
    engine.start();
    // El primer ranking es el de antes de los objetos de la ronda 1: no hay puesto anterior.
    runUntil(engine, clock, 'r1.ranking.before');
    assert.deepEqual(engine.room.phase.data.ranking.map((row) => row.delta), [null, null]);
    // El del final de la ronda compara con el de antes de los objetos.
    runUntil(engine, clock, 'r1.ranking');
    assert.deepEqual(engine.room.phase.data.ranking.map((row) => row.delta), [0, 0]);
    engine.room.teams[1].score = 500; // en la Fase 2 los puntos vendrán de las preguntas
    runUntil(engine, clock, 'r2.ranking.before');
    // Ambos estaban empatados en el 1.º: t2 se queda 1.º (0) y t1 baja al 2.º (−1).
    assert.deepEqual(engine.room.phase.data.ranking.map((row) => [row.teamId, row.delta]), [['t2', 0], ['t1', -1]]);
    assert.equal(engine.room.phase.before, true);
  });
});

describe('partida completa', () => {
  // Nadie juega: no hay empates ni Desafíos, así que los 10 Duelos se saltan sin anunciarse.
  test('recorre las 80 fases (sin los Duelos que no hacen falta) y termina en el ranking final', () => {
    const { engine, clock } = setup();
    fullRoom(engine, 3);
    engine.start();
    const seen = [phaseId(engine)];
    while (!engine.room.finished) {
      if (engine.room.phase.waitingHost) engine.next();
      else clock.advance(1000);
      if (seen.at(-1) !== phaseId(engine)) seen.push(phaseId(engine));
    }
    assert.equal(engine.plan.length, 80);
    assert.deepEqual(seen, engine.plan.filter((step) => step.kind !== 'duel').map((step) => step.id));
    assert.equal(engine.events.filter((e) => e.type === 'phase_skipped').length, 10);
    assert.equal(engine.next().error, 'game_finished');
  });
});

describe('ajuste manual de puntos (RF-HOST-03)', () => {
  test('suma o resta sin bajar de 0 y queda en el log', () => {
    const { engine } = setup();
    fullRoom(engine, 2);
    assert.equal(engine.adjustScore('t1', 500).error, 'not_started');
    engine.start();
    assert.deepEqual(engine.adjustScore('t1', 500, 'pregunta anulada'), { ok: true, applied: 500, score: 500 });
    assert.deepEqual(engine.adjustScore('t1', -800), { ok: true, applied: -500, score: 0 });
    assert.equal(engine.adjustScore('t9', 100).error, 'unknown_team');
    const logged = engine.events.filter((e) => e.type === 'score_adjusted');
    assert.deepEqual(logged.map((e) => [e.teamId, e.requested, e.applied, e.reason]), [['t1', 500, 500, 'pregunta anulada'], ['t1', -800, -500, '']]);
  });
});

describe('snapshot', () => {
  test('tras un reinicio la partida queda en pausa y se reanuda en la misma fase', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'automatas-'));
    try {
      const clock = createFakeClock();
      const first = setup({ persistence: new Persistence(dir), clock }).engine;
      const devices = fullRoom(first, 2);
      first.start();
      runUntil(first, clock, 'r1.draft');
      const before = first.room.phase;
      const events = structuredClone(first.events);
      await first.persistence.close();
      first.stop();

      const second = setup({ persistence: new Persistence(dir), clock }).engine;
      assert.equal(second.room.recovered, true);
      // El log de la sala se recupera del archivo: las estadísticas no pierden nada.
      assert.deepEqual(second.events.slice(0, events.length), events);
      assert.equal(second.events.at(-1).type, 'game_recovered');
      assert.ok(second.room.paused);
      assert.equal(second.room.phase.id, 'r1.draft');
      assert.equal(second.authenticate(devices[0].token), devices[0].deviceId);
      assert.equal(second.teamOf(devices[3].deviceId).team.id, 't2');
      assert.equal(second.next().error, 'paused');

      assert.equal(second.resume().ok, true);
      assert.equal(second.room.phase.id, 'r1.draft');
      assert.ok(second.room.phase.seq > before.seq, 'la fase empieza de nuevo');
      clock.advance(1000);
      assert.equal(second.room.phase.id, 'r1.q2');
      second.stop();
      await second.persistence.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Avanza la partida (timeouts y "Siguiente") hasta llegar a la fase indicada.
function runUntil(engine, clock, targetId) {
  while (engine.room.phase.id !== targetId) {
    if (engine.room.finished) throw new Error(`no se llegó a ${targetId}`);
    if (engine.room.phase.waitingHost) engine.next();
    else clock.advance(1000);
  }
}
