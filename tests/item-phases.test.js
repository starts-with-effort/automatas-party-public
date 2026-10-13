// Draft, uso de objetos y efectos sobre la pregunta, dentro de una partida (secciones 4.5, 4.6 y 5.5).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { poolFor } from '../server/domain/Luck.js';
import { giveItem } from '../server/domain/teams.js';
import { createFakeClock, silentLogger, testConfig, testQuestions } from './support/helpers.js';

// Partida con equipos llenos y conectados. `effects` se cargan antes de iniciar: llegan a la
// pregunta 1 como si vinieran de una resolución anterior.
function startGame({ teamCount = 2, config = testConfig(), effects = [] } = {}) {
  const clock = createFakeClock();
  const engine = new GameEngine({ config, clock, logger: silentLogger });
  engine.createRoom({ teamCount });
  const slots = {};
  for (const team of engine.room.teams) {
    for (const slot of ['A', 'B']) {
      const { deviceId } = engine.registerDevice();
      engine.join(deviceId, team.id);
      engine.setPresence(deviceId, { connected: true, rtt: 100 });
      slots[`${team.id}${slot}`] = deviceId;
    }
  }
  engine.room.activeEffects = effects.map(([code, sourceTeamId, targetTeamId]) =>
    ({ code, sourceTeamId, targetTeamId, appliesTo: code === 'TD' ? 'draft' : 'question' }));
  engine.start();
  return { engine, clock, slots, team: (id) => engine.room.teams.find((t) => t.id === id) };
}

function goTo(engine, clock, id) {
  for (;;) {
    const { phase } = engine.room;
    if (phase.id === id) return;
    if (engine.room.finished) throw new Error(`no se llegó a ${id}`);
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
}

const act = (engine, deviceId, action) => engine.action(deviceId, action);
const playData = (engine, deviceId) => projectView(engine, { role: 'play', deviceId }).phase.data;
const answer = (engine, deviceId, option, tClient = 0) =>
  act(engine, deviceId, { type: 'answer', questionId: engine.room.phase.data.questionId, option, tClient });
const correctOf = (number) => (number - 1) % 4; // preguntas de prueba

// Responde la pregunta 1 con todos los equipos (B tiene las opciones en las impares) y llega al
// draft: así nadie recibe el objeto adicional por no responder.
function draftAfterAnswering(game) {
  for (const team of game.engine.room.teams) answer(game.engine, game.slots[`${team.id}B`], correctOf(1));
  goTo(game.engine, game.clock, 'r1.draft');
  return game;
}

describe('draft', () => {
  test('cada equipo recibe 3 objetos de la pool de su suerte; los empatados comparten suerte', () => {
    const { engine, clock, slots } = startGame({ teamCount: 3 });
    goTo(engine, clock, 'r1.draft');
    for (const id of ['t1', 't2', 't3']) {
      const { offer } = playData(engine, slots[`${id}A`]);
      assert.equal(offer.luck, 1); // todos en 0 puntos: empatados en el 1.º
      assert.equal(offer.codes.length, 3);
      // El Desafío no está en las pools: el draft lo reparte aparte.
      assert.ok(offer.codes.every((code) => code === 'DS' || poolFor(engine.config, 1).includes(code)));
    }
  });

  test('cualquiera de los dos elige; la primera elección es la definitiva', () => {
    const { engine, clock, slots, team } = draftAfterAnswering(startGame());
    const { offer } = playData(engine, slots.t1A);
    assert.equal(act(engine, slots.t1B, { type: 'pick', offerId: offer.offerId, codes: ['X'] }).error, 'invalid_pick');
    assert.equal(act(engine, slots.t1B, { type: 'pick', offerId: offer.offerId, codes: [offer.codes[1]] }).ok, true);
    assert.equal(act(engine, slots.t1A, { type: 'pick', offerId: offer.offerId, codes: [offer.codes[0]] }).error, 'already_picked');
    assert.deepEqual(playData(engine, slots.t1A).chosen, [offer.codes[1]]);
    clock.advance(1000);
    assert.deepEqual(team('t1').inventory.map((i) => i.code), [offer.codes[1]]);
  });

  test('si no elige a tiempo, recibe uno de los ofrecidos al azar', () => {
    const { engine, clock, slots, team } = draftAfterAnswering(startGame());
    const { offer } = playData(engine, slots.t2A);
    clock.advance(1000);
    assert.equal(team('t2').inventory.length, 1);
    assert.ok(offer.codes.includes(team('t2').inventory[0].code));
  });

  test('el draft termina cuando todos eligen', () => {
    const { engine, clock, slots } = startGame();
    goTo(engine, clock, 'r1.draft');
    for (const id of ['t1', 't2']) {
      const { offer } = playData(engine, slots[`${id}A`]);
      act(engine, slots[`${id}A`], { type: 'pick', offerId: offer.offerId, codes: [offer.codes[0]] });
    }
    assert.equal(engine.room.phase.id, 'r1.q2');
  });

  test('Ticket Dorado: 4 objetos, elige 2, suerte +1; se gasta en ese draft', () => {
    const { engine, clock, slots, team } = draftAfterAnswering(startGame({ effects: [['TD', 't1', 't1']] }));
    const { offer } = playData(engine, slots.t1A);
    assert.deepEqual([offer.codes.length, offer.picks, offer.luck], [4, 2, 2]);
    assert.equal(act(engine, slots.t1A, { type: 'pick', offerId: offer.offerId, codes: [offer.codes[0]] }).error, 'invalid_pick');
    act(engine, slots.t1A, { type: 'pick', offerId: offer.offerId, codes: offer.codes.slice(0, 2) });
    clock.advance(1000);
    assert.equal(team('t1').inventory.length, 2);
    assert.deepEqual(engine.room.activeEffects, []);
  });

  test('quien no respondió la pregunta recibe además un objeto al azar distinto de los ofrecidos', () => {
    const { engine, clock, slots, team } = startGame();
    answer(engine, slots.t1B, correctOf(1)); // t2 no responde
    clock.advance(1000);
    goTo(engine, clock, 'r1.draft');
    const { offer } = playData(engine, slots.t2A);
    assert.ok(offer.extra && !offer.codes.includes(offer.extra));
    assert.equal(playData(engine, slots.t1A).offer.extra, null);
    clock.advance(1000);
    assert.equal(team('t2').inventory.length, 2);
    assert.equal(team('t2').pendingExtraItem, false);
  });
});

describe('uso de objetos', () => {
  // Llega a la fase de uso de la ronda 1 con inventarios conocidos.
  function atItemUse(inventories, options) {
    const game = startGame(options);
    goTo(game.engine, game.clock, 'r1.use');
    for (const [teamId, codes] of Object.entries(inventories)) {
      const team = game.team(teamId);
      team.inventory = [];
      for (const code of codes) giveItem(game.engine.room, team, code, 1);
    }
    return game;
  }
  const itemId = (team, code) => team.inventory.find((i) => i.code === code).id;

  test('validaciones: objeto propio, objetivo cuando hace falta y nunca uno mismo', () => {
    const { engine, slots, team } = atItemUse({ t1: ['CV', 'P', 'DN', 'DN'], t2: ['CP'] });
    const t1 = team('t1');
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: itemId(team('t2'), 'CP') }).error, 'unknown_item');
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: itemId(t1, 'CV') }).error, 'target_required');
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: itemId(t1, 'CV'), targetTeamId: 't1' }).error, 'self_target');
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: itemId(t1, 'CV'), targetTeamId: 't2' }).ok, true);
    assert.equal(act(engine, slots.t1B, { type: 'declare', itemId: itemId(t1, 'CV'), targetTeamId: 't2' }).error, 'already_declared');
    const [dn1, dn2] = t1.inventory.filter((i) => i.code === 'DN');
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: dn1.id }).ok, true);
    assert.equal(act(engine, slots.t1A, { type: 'declare', itemId: dn2.id }).error, 'duplicate_effect');
  });

  test('las declaraciones son secretas: cada equipo ve solo las suyas', () => {
    const { engine, slots, team } = atItemUse({ t1: ['CV'], t2: [] });
    act(engine, slots.t1A, { type: 'declare', itemId: itemId(team('t1'), 'CV'), targetTeamId: 't2' });
    assert.equal(playData(engine, slots.t1B).declared.length, 1); // el compañero sí lo ve
    for (const viewer of [{ role: 'play', deviceId: slots.t2A }, { role: 'screen' }, { role: 'host' }]) {
      assert.ok(!JSON.stringify(projectView(engine, viewer).phase.data).includes('CV'), viewer.role);
    }
  });

  // Rediseño, fase 4: el selector de objetivo muestra los datos de cada equipo al empezar la fase.
  test('el selector ve la foto del inicio (racha, puntos, fragmentos y estrellas) y solo la ve el celular', () => {
    const game = startGame();
    goTo(game.engine, game.clock, 'r1.ranking.before');
    Object.assign(game.team('t2'), { streak: 4, score: 1200, fragments: 2 });
    goTo(game.engine, game.clock, 'r1.use');
    const t1 = game.team('t1');
    t1.inventory = [];
    giveItem(game.engine.room, t1, 'GL', 1);
    assert.equal(act(game.engine, game.slots.t1A, { type: 'declare', itemId: t1.inventory[0].id, targetTeamId: 't2' }).ok, true);
    game.team('t2').streak = 0; // aunque cambiara durante la fase, el selector sigue con la de antes
    assert.deepEqual(playData(game.engine, game.slots.t1B).snapshot.t2, { streak: 4, score: 1200, fragments: 2, stars: 0 });
    assert.equal(projectView(game.engine, { role: 'screen' }).phase.data.snapshot, undefined);
  });

  test('cuando todos confirman se resuelve: el objeto se gasta y lo no declarado se queda', () => {
    const { engine, slots, team } = atItemUse({ t1: ['CV', 'P'], t2: ['EF'] });
    team('t2').score = 1000;
    act(engine, slots.t1A, { type: 'declare', itemId: itemId(team('t1'), 'CV'), targetTeamId: 't2' });
    act(engine, slots.t1A, { type: 'confirm' });
    assert.equal(act(engine, slots.t1B, { type: 'undeclare', itemId: team('t1').inventory[0].id }).error, 'already_confirmed');
    act(engine, slots.t2A, { type: 'confirm' });
    assert.equal(engine.room.phase.id, 'r1.resolution');
    assert.equal(team('t2').score, 930); // va 1.º: el Caparazón le quita el 7 %
    assert.deepEqual(team('t1').inventory.map((i) => i.code), ['P']);
    assert.deepEqual(team('t2').inventory.map((i) => i.code), ['EF']);
    const { events } = projectView(engine, { role: 'screen' }).phase.data;
    assert.deepEqual(events.map((e) => [e.kind, e.code, e.source, e.target]), [['hit', 'CV', 't1', 't2']]);
  });

  test('retirar una declaración antes de confirmar la devuelve al inventario', () => {
    const { engine, slots, team, clock } = atItemUse({ t1: ['P'], t2: [] });
    const id = itemId(team('t1'), 'P');
    act(engine, slots.t1A, { type: 'declare', itemId: id });
    act(engine, slots.t1A, { type: 'undeclare', itemId: id });
    clock.advance(1000);
    assert.equal(team('t1').score, 0);
    assert.equal(team('t1').inventory.length, 1);
  });

  test('el Ticket Dorado no se puede usar en la ronda 5: no queda draft', () => {
    const game = startGame();
    goTo(game.engine, game.clock, 'r5.use');
    giveItem(game.engine.room, game.team('t1'), 'TD', 5);
    assert.equal(act(game.engine, game.slots.t1A, { type: 'declare', itemId: game.team('t1').inventory.at(-1).id }).error, 'no_next_draft');
  });

  test('los efectos diferidos llegan a la primera pregunta de la ronda siguiente', () => {
    const { engine, clock, slots, team } = atItemUse({ t1: ['RR'], t2: [] });
    act(engine, slots.t1A, { type: 'declare', itemId: itemId(team('t1'), 'RR'), targetTeamId: 't2' });
    clock.advance(1000);
    goTo(engine, clock, 'r2.q3');
    assert.deepEqual(playData(engine, slots.t2A).effects, [{ code: 'RR', sourceTeamId: 't1', targetTeamId: 't2' }]);
    clock.advance(2000);
    goTo(engine, clock, 'r2.q4');
    assert.deepEqual(playData(engine, slots.t2A).effects, []);
  });
});

describe('efectos sobre la pregunta (5.5)', () => {
  // Preguntas de 30 s; B = 1500 (intermedia) para comparar con los ejemplos de la sección 5.
  const config = () => testConfig({ questionBank: testQuestions({ timeLimitMs: 30_000, difficulty: 'intermedia' }) });

  test('Reloj Roto: el objetivo tiene 2T/3 para responder, pero P(t) usa la T original', () => {
    const { engine, clock, slots } = startGame({ config: config(), effects: [['RR', 't2', 't1']] });
    assert.equal(playData(engine, slots.t1B).deadline, engine.room.phase.answersAt + 20_001);
    assert.equal(playData(engine, slots.t2B).deadline, engine.room.phase.endsAt);
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 12_000);
    engine.skip();
    assert.equal(engine.room.questionResults[1].results[0].points, 900);
  });

  test('Reloj Roto: después de su plazo el equipo ya no puede responder', () => {
    const { engine, clock, slots } = startGame({ config: config(), effects: [['RR', 't2', 't1']] });
    clock.advance(21_000);
    assert.equal(answer(engine, slots.t1B, correctOf(1), 21_000).error, 'question_closed');
    assert.equal(answer(engine, slots.t2B, correctOf(1), 21_000).ok, true);
    assert.equal(engine.room.phase.id, 'r1.q1.result', 'cierra: el único equipo que podía responder ya lo hizo');
  });

  test('Contrarreloj: en T/4, T/2 y 3T/4 desaparece una opción incorrecta', () => {
    const { engine, clock, slots } = startGame({ config: config(), effects: [['CR', 't1', 't1']] });
    const eliminated = () => playData(engine, slots.t1B).eliminated;
    clock.advance(7499);
    assert.deepEqual(eliminated(), []);
    clock.advance(1);
    assert.equal(eliminated().length, 1);
    clock.advance(7500);
    assert.equal(eliminated().length, 2);
    clock.advance(7500);
    assert.equal(eliminated().length, 3);
    assert.ok(!eliminated().includes(correctOf(1)), 'nunca elimina la correcta');
    assert.equal(answer(engine, slots.t1B, eliminated()[0]).error, 'option_eliminated');
    assert.deepEqual(playData(engine, slots.t2B).eliminated, [], 'solo afecta a quien lo usó');
  });

  test('Segunda Vida: el primer error elimina la opción, permite otra respuesta y no corta la racha', () => {
    const { engine, clock, slots, team } = startGame({ config: config(), effects: [['SV', 't1', 't1']] });
    team('t1').streak = 2;
    const wrong = (correctOf(1) + 1) % 4;
    assert.deepEqual(answer(engine, slots.t1B, wrong, 100), { ok: true, secondChance: true });
    assert.deepEqual(playData(engine, slots.t1B).eliminated, [wrong]);
    assert.equal(answer(engine, slots.t1B, wrong, 200).error, 'option_eliminated');
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 12_000);
    engine.skip();
    const [row] = engine.room.questionResults[1].results;
    assert.deepEqual([row.correct, row.streak, row.secondChance], [true, 3, true]);
  });

  test('Segunda Vida: un segundo error cuenta como fallo', () => {
    const { engine, slots, team } = startGame({ config: config(), effects: [['SV', 't1', 't1']] });
    team('t1').streak = 4;
    answer(engine, slots.t1B, (correctOf(1) + 1) % 4);
    assert.deepEqual(answer(engine, slots.t1B, (correctOf(1) + 2) % 4), { ok: true });
    engine.skip();
    assert.equal(team('t1').streak, 0);
  });

  test('Doble o nada: acierto × 2 (ejemplo 5.2: 2050); fallo o sin respuesta: −0,5·B', () => {
    const { engine, clock, slots, team } = startGame({ config: config(), effects: [['DN', 't1', 't1'], ['DN', 't2', 't2']] });
    team('t1').streak = 3;
    team('t2').score = 1000;
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 12_000);
    engine.skip();
    const [t1, t2] = engine.room.questionResults[1].results;
    assert.equal(t1.points, 2050);
    assert.deepEqual(t2.adjustments, [{ code: 'DN', points: -750 }]);
    assert.equal(team('t2').score, 250);
  });

  test('Chupa-Sangre: si el objetivo acierta, el usuario gana el 50 % de sus puntos', () => {
    const { engine, clock, slots, team } = startGame({ config: config(), effects: [['CS', 't1', 't2']] });
    clock.advance(12_050);
    answer(engine, slots.t2B, correctOf(1), 12_000);
    engine.skip();
    assert.equal(team('t2').score, 900, 'el objetivo no pierde nada');
    assert.equal(team('t1').score, 450);
    assert.deepEqual(engine.room.questionResults[1].results[0].adjustments, [{ code: 'CS', points: 450, teamId: 't2' }]);
  });

  test('Chupa-Sangre: si el objetivo falla o no responde, el usuario pierde el 10 % de su total', () => {
    const { engine, team } = startGame({ config: config(), effects: [['CS', 't1', 't2']] });
    team('t1').score = 2000;
    engine.skip();
    assert.equal(team('t1').score, 1800);
  });

  test('Doble o nada se aplica antes que Chupa-Sangre', () => {
    const { engine, team } = startGame({ config: config(), effects: [['DN', 't1', 't1'], ['CS', 't1', 't2']] });
    team('t1').score = 2750;
    engine.skip(); // nadie responde: DN −750 → 2000; CS −10 % → 1800
    assert.equal(team('t1').score, 1800);
  });

  test('Calamar: los dos celulares del equipo afectado reciben la tinta', () => {
    const { engine, slots } = startGame({ config: config(), effects: [['C', 't2', 't1']] });
    const { startsAt, answersAt } = engine.room.phase;
    assert.deepEqual(playData(engine, slots.t1A).ink, { startsAt, answersAt, endsAt: answersAt + 6000, fadeMs: 3000 });
    assert.ok(playData(engine, slots.t1B).ink);
    assert.equal(playData(engine, slots.t2A).ink, null);
  });

  test('los efectos se consumen al cerrar la pregunta', () => {
    const { engine } = startGame({ config: config(), effects: [['DN', 't1', 't1']] });
    engine.skip();
    assert.deepEqual(engine.room.activeEffects, []);
  });
});
