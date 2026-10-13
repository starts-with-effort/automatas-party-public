// Fase de pregunta: roles, respuestas, validación del tiempo, puntos, racha y vistas (sección 4.3).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { createFakeClock, silentLogger, testConfig, testQuestions } from './support/helpers.js';

// Partida con `teamCount` equipos llenos y conectados (RTT 100 ms), ya iniciada en la pregunta 1.
function startGame({ teamCount = 2, config = testConfig() } = {}) {
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
  engine.start();
  return { engine, clock, slots };
}

const playView = (engine, deviceId) => projectView(engine, { role: 'play', deviceId }).phase;
const phaseId = (engine) => engine.room.phase.id;
const answer = (engine, deviceId, option, tClient) =>
  engine.action(deviceId, { type: 'answer', questionId: engine.room.phase.data.questionId, option, tClient });

// Con las preguntas de prueba, la correcta de la pregunta n es la opción (n − 1) % 4.
const correctOf = (number) => (number - 1) % 4;

// Avanza fase por fase (plazos y "Siguiente") hasta la pregunta indicada.
function goToQuestion(engine, clock, number) {
  for (;;) {
    const { phase } = engine.room;
    if (phase.kind === 'question' && phase.question === number) return;
    if (engine.room.finished) throw new Error(`no se llegó a la pregunta ${number}`);
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
}

describe('roles de los dispositivos', () => {
  test('en las preguntas impares A ve el enunciado y B las opciones; en las pares, al revés', () => {
    const { engine, clock, slots } = startGame();
    const a = playView(engine, slots.t1A).data;
    const b = playView(engine, slots.t1B).data;
    assert.equal(a.role, 'statement');
    assert.equal(a.statement.text, 'Enunciado 1');
    assert.equal(a.options, null);
    assert.equal(b.role, 'options');
    assert.equal(b.statement, null);
    assert.equal(b.options.length, 4);

    goToQuestion(engine, clock, 2);
    assert.equal(playView(engine, slots.t1A).data.role, 'options');
    assert.equal(playView(engine, slots.t1B).data.role, 'statement');
  });

  test('si el compañero se desconecta, el dispositivo ve enunciado y opciones', () => {
    const { engine, slots } = startGame();
    engine.setPresence(slots.t1B, { connected: false });
    const a = playView(engine, slots.t1A).data;
    assert.equal(a.role, 'both');
    assert.ok(a.statement && a.options);
  });

  test('solo responde el dispositivo de opciones (o el que cumple ambos roles)', () => {
    const { engine, slots } = startGame();
    assert.equal(answer(engine, slots.t1A, 0, 100).error, 'not_options_device');
    engine.setPresence(slots.t1B, { connected: false });
    assert.equal(answer(engine, slots.t1A, 0, 100).ok, true);
  });
});

describe('lo que ve cada dispositivo', () => {
  test('nadie recibe la opción correcta mientras la pregunta está abierta', () => {
    const { engine, slots } = startGame();
    for (const viewer of [
      { role: 'play', deviceId: slots.t1A },
      { role: 'play', deviceId: slots.t1B },
      { role: 'screen' },
      { role: 'host' },
    ]) {
      const json = JSON.stringify(projectView(engine, viewer).phase.data);
      assert.ok(!json.includes('"correct"'), `${viewer.role} recibió la respuesta correcta`);
    }
  });

  test('el proyector no ve el enunciado ni las opciones hasta que la pregunta cierra', () => {
    const { engine, slots } = startGame();
    const screen = projectView(engine, { role: 'screen' }).phase.data;
    assert.equal(screen.statement, undefined);
    assert.equal(screen.options, undefined);
    assert.equal(screen.number, 1);
    assert.equal(screen.difficultyLabel, 'Básica');

    answer(engine, slots.t1B, 0, 100);
    answer(engine, slots.t2B, 1, 100);
    assert.equal(phaseId(engine), 'r1.q1.result');
    const result = projectView(engine, { role: 'screen' }).phase.data;
    assert.equal(result.statement.text, 'Enunciado 1');
    assert.equal(result.correct, 0);
    assert.deepEqual(result.results.map((r) => [r.teamId, r.correct]), [['t1', true], ['t2', false]]);
  });

  test('el equipo ve qué opción eligió, pero no si acertó', () => {
    const { engine, slots } = startGame();
    answer(engine, slots.t1B, 3, 100);
    const data = playView(engine, slots.t1A).data;
    assert.deepEqual(data.myAnswer, { option: 3 });
    assert.deepEqual(data.answeredTeamIds, ['t1']);
  });
});

describe('respuestas', () => {
  test('las opciones se habilitan después del tiempo de lectura', () => {
    const { engine, clock, slots } = startGame({ config: testConfig({ questions: { readingMs: 3000 } }) });
    assert.equal(engine.room.phase.answersAt, engine.room.phase.startsAt + 3000);
    assert.equal(answer(engine, slots.t1B, 0, 0).error, 'answers_not_open');
    clock.advance(3000);
    assert.equal(answer(engine, slots.t1B, 0, 0).ok, true);
  });

  test('una sola respuesta por equipo y de la pregunta actual', () => {
    const { engine, slots } = startGame();
    assert.equal(engine.action(slots.t1B, { type: 'answer', questionId: 'q7', option: 0 }).error, 'wrong_question');
    assert.equal(answer(engine, slots.t1B, 0, 100).ok, true);
    assert.equal(answer(engine, slots.t1B, 1, 200).error, 'already_answered');
  });

  test('la confirmación no revela si la respuesta es correcta', () => {
    const { engine, slots } = startGame();
    assert.deepEqual(answer(engine, slots.t1B, correctOf(1), 100), { ok: true });
  });

  test('la pregunta cierra cuando todos los equipos responden', () => {
    const { engine, slots } = startGame({ teamCount: 3 });
    answer(engine, slots.t1B, 0, 100);
    answer(engine, slots.t2B, 0, 100);
    assert.equal(phaseId(engine), 'r1.q1');
    answer(engine, slots.t3B, 0, 100);
    assert.equal(phaseId(engine), 'r1.q1.result');
  });

  test('una respuesta que llega dentro del margen tras el plazo cuenta para la racha', () => {
    const { engine, clock, slots } = startGame({ config: testConfig({ questions: { answerGraceMs: 300 } }) });
    clock.advance(1000 + 100); // T = 1000 ms; llega 100 ms tarde
    assert.equal(answer(engine, slots.t1B, correctOf(1), 1000).ok, true);
    clock.advance(200);
    assert.equal(phaseId(engine), 'r1.q1.result');
    const team = engine.room.teams[0];
    assert.equal(team.streak, 1);
    assert.equal(team.score, 0); // P(T) = 0
  });
});

describe('puntos y racha', () => {
  // Pregunta intermedia de 30 s, como en los ejemplos de la sección 5.
  const intermedia = () => testConfig({ questionBank: testQuestions({ timeLimitMs: 30_000, difficulty: 'intermedia' }) });

  test('ejemplo 5.1: t = 12 s en una intermedia de 30 s → 900 puntos y racha 1', () => {
    const { engine, clock, slots } = startGame({ config: intermedia() });
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 12_000);
    engine.skip();
    const [t1] = engine.room.questionResults[1].results;
    assert.deepEqual([t1.t, t1.points, t1.streak, t1.multiplier], [12_000, 900, 1, 1]);
    assert.equal(engine.room.teams[0].score, 900);
  });

  test('ejemplo 5.2: con racha previa de 3, el acierto da r = 4 → 1025', () => {
    const { engine, clock, slots } = startGame({ config: intermedia() });
    engine.room.teams[0].streak = 3;
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 12_000);
    engine.skip();
    assert.equal(engine.room.questionResults[1].results[0].points, 1025);
    assert.equal(engine.room.teams[0].streak, 4);
  });

  test('si el tiempo del cliente no cuadra, se usa el del servidor', () => {
    const { engine, clock, slots } = startGame({ config: intermedia() });
    clock.advance(12_050);
    answer(engine, slots.t1B, correctOf(1), 2000); // dice 2 s, pero el servidor vio 12,05 s
    engine.skip();
    assert.equal(engine.room.questionResults[1].results[0].t, 12_000); // 12 050 − RTT/2
  });

  test('fallar deja la racha en 0; no responder, además, da un objeto adicional', () => {
    const { engine, slots } = startGame();
    engine.room.teams.forEach((team) => { team.streak = 5; });
    answer(engine, slots.t1B, correctOf(1) + 1, 100);
    engine.skip();
    const [wrong, silent] = engine.room.teams;
    assert.deepEqual([wrong.streak, wrong.score, wrong.pendingExtraItem], [0, 0, false]);
    assert.deepEqual([silent.streak, silent.score, silent.pendingExtraItem], [0, 0, true]);
    assert.deepEqual(engine.room.questionResults[1].results[1], {
      teamId: 't2', answered: false, option: null, correct: false, t: null, points: 0, streak: 0, multiplier: 1,
      modifiers: [], secondChance: false, adjustments: [],
    });
  });

  test('tres aciertos seguidos activan el multiplicador', () => {
    const { engine, clock, slots } = startGame({ teamCount: 2 });
    for (const number of [1, 2, 3]) {
      goToQuestion(engine, clock, number);
      const options = number % 2 === 1 ? slots.t1B : slots.t1A;
      answer(engine, options, correctOf(number), 0);
      engine.skip();
    }
    const results = engine.room.questionResults;
    assert.deepEqual([1, 2, 3].map((n) => results[n].results[0].streak), [1, 2, 3]);
    assert.equal(results[2].results[0].multiplier, 1);
    assert.equal(results[3].results[0].multiplier.toFixed(3), '1.110');
  });

  test('la pausa no cuenta en el tiempo de respuesta', () => {
    const { engine, clock, slots } = startGame({ config: intermedia() });
    clock.advance(1000);
    engine.pause();
    clock.advance(20_000);
    engine.resume();
    assert.equal(answer(engine, slots.t1B, correctOf(1), 1000).ok, true);
    engine.skip();
    assert.equal(engine.room.questionResults[1].results[0].t, 1000);
  });
});
