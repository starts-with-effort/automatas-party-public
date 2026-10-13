// Duración de la partida (scripts/lib/duration.js, sección 9.3): estimación con la configuración y
// medición con el log de eventos.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HOST_SCREENS_MS, estimateDuration, measureDuration } from '../scripts/lib/duration.js';
import { buildRoundPlan } from '../server/core/RoundPlan.js';
import { testConfig, testQuestions } from './support/helpers.js';

const LEAD = 1000;
const config = testConfig({
  timings: { leadMs: LEAD, draft: 45_000, itemUse: 45_000, roulette: 5000, minigameIntro: 13_000, autoAdvanceMs: null },
  questions: { readingMs: 3000, answerGraceMs: 300 },
  questionBank: testQuestions({ timeLimitMs: 20_000 }),
});
const rowOf = (result, key) => result.rows.find((row) => row.key === key);

describe('estimación con la configuración', () => {
  const estimate = estimateDuration(config);

  test('filas de la tabla 9.3, en su orden y con cuántas veces ocurre cada una', () => {
    assert.deepEqual(estimate.rows.map((row) => [row.key, row.count]), [
      ['lobby', 1], ['question', 11], ['draft', 5], ['roulette', 5],
      ['minigame:memoria', 1], ['minigame:traza', 1], ['minigame:clicker', 1], ['minigame:flappy', 1], ['minigame:arena', 1],
      ['minigameResult', 5], ['itemUse', 5], ['duel', 0], ['ranking', 11],
    ]);
    assert.equal(estimate.phases, buildRoundPlan(config).length);
  });

  test('preguntas: lectura + T + margen, más el resultado; cada fase con su anticipación', () => {
    const question = rowOf(estimate, 'question');
    assert.equal(question.maxMs, 11 * (LEAD + 3000 + 20_000 + 300) + 11 * (LEAD + HOST_SCREENS_MS.questionResult));
    assert.equal(question.fixedMs, 11 * (LEAD + 3000) + 11 * (LEAD + HOST_SCREENS_MS.questionResult));
  });

  test('los Duelos no suman tiempo fijo (se saltan si no hay empate ni Desafío); el máximo, un duelo de 2 manos cada uno', () => {
    const { introMs, pickMs, revealMs, resultMs } = config.duel;
    assert.deepEqual(rowOf(estimate, 'duel'), {
      ...rowOf(estimate, 'duel'), count: 0, fixedMs: 0, maxMs: 10 * (LEAD + introMs + 2 * (pickMs + revealMs) + resultMs),
    });
  });

  test('draft y uso pueden terminar al instante; ruleta, grupos e instrucciones duran siempre lo mismo', () => {
    assert.deepEqual(rowOf(estimate, 'draft'), { ...rowOf(estimate, 'draft'), fixedMs: 5 * LEAD, maxMs: 5 * (LEAD + 45_000) });
    const roulette = rowOf(estimate, 'roulette');
    // «Formando grupos» (fase 5) solo en la Memoria y el Clicker.
    const groupsMs = config.timings.minigameGroups;
    assert.equal(roulette.fixedMs, 5 * (LEAD + 5000) + 2 * (LEAD + groupsMs) + 5 * (LEAD + 13_000));
    assert.equal(roulette.maxMs, roulette.fixedMs);
    const use = rowOf(estimate, 'itemUse');
    assert.equal(use.maxMs, 5 * (LEAD + 45_000) + 5 * (LEAD + HOST_SCREENS_MS.resolution));
  });

  test('minijuegos: el Clicker dura siempre lo mismo; la Memoria puede acabar antes de su máximo', () => {
    const { clicker, memoria } = config.minigameRules;
    const clickerRow = rowOf(estimate, 'minigame:clicker');
    assert.equal(clickerRow.fixedMs, LEAD + clicker.durationMs);
    assert.equal(clickerRow.maxMs, LEAD + clicker.durationMs + clicker.graceMs);
    const memoriaRow = rowOf(estimate, 'minigame:memoria');
    assert.equal(memoriaRow.fixedMs, LEAD);
    assert.equal(memoriaRow.maxMs, LEAD + memoria.maxDurationMs);
  });

  test('los totales suman las filas e incluyen la anticipación de cada fase', () => {
    assert.equal(estimate.maxMs, estimate.rows.reduce((total, row) => total + row.maxMs, 0));
    assert.equal(estimate.fixedMs, estimate.rows.reduce((total, row) => total + row.fixedMs, 0));
    assert.equal(estimate.leadMs, LEAD * estimate.phases);
  });

  test('con autoAdvanceMs, las pantallas de resultados usan ese valor y no el supuesto', () => {
    const auto = estimateDuration(testConfig({ ...config, timings: { ...config.timings, autoAdvanceMs: 4000 } }));
    assert.equal(rowOf(auto, 'minigameResult').maxMs, 5 * (LEAD + 4000));
    // El ranking final cierra la partida: no avanza solo, usa el supuesto.
    assert.equal(rowOf(auto, 'ranking').maxMs, 10 * (LEAD + 4000) + LEAD + HOST_SCREENS_MS.ranking);
  });
});

describe('medición con el log de eventos', () => {
  // Una partida en la que cada fase dura 1 s, con una pausa de 4 s en la primera pregunta y la
  // ronda 3 repetida tras un reinicio del servidor.
  const plan = buildRoundPlan(config);
  const events = [{ ts: 0, type: 'room_created' }, { ts: 60_000, type: 'game_started' }];
  let ts = 60_000;
  for (const step of plan) {
    events.push({ ts, type: 'phase_entered', phase: step.id });
    if (step.id === 'r1.q1') events.push({ ts: ts + 200, type: 'game_paused' }, { ts: ts + 4200, type: 'game_resumed' });
    if (step.id === 'r3.mg.intro') events.push({ ts: ts + 300, type: 'minigame_groups', round: 3, minigame: 'memoria' });
    if (step.id === 'r3.draft') {
      events.push({ ts: ts + 500, type: 'game_recovered' }, { ts: ts + 1000, type: 'phase_entered', phase: step.id });
      ts += 1000;
    }
    if (step.kind !== 'finalRanking') events.push({ ts: ts + 900, type: 'phase_closed', phase: step.id, reason: step.kind === 'roulette' ? 'skip' : 'timeout' });
    ts += step.id === 'r1.q1' ? 5000 : 1000;
  }
  const measured = measureDuration(events, config);

  test('cada fase dura hasta que se anuncia la siguiente; el ranking final cierra el log', () => {
    assert.equal(measured.finished, true);
    assert.equal(measured.lobbyMs, 60_000);
    // 72 fases de 1 s (aquí se juegan los 10 Duelos), la pregunta 1 con 4 s más de pausa y el draft
    // repetido de la ronda 3 (1 s más).
    assert.equal(measured.gameMs, (plan.length - 1) * 1000 + 4000 + 1000);
    assert.equal(rowOf(measured, 'duel').count, 10);
    const total = measured.rows.reduce((sum, row) => sum + row.realMs, 0);
    assert.equal(total, measured.lobbyMs + measured.gameMs);
    assert.equal(rowOf(measured, 'question').realMs, 22_000 + 4000);
    assert.equal(rowOf(measured, 'question').count, 11);
  });

  test('una fase repetida tras un reinicio cuenta una vez; el minijuego es el que se jugó', () => {
    assert.equal(rowOf(measured, 'draft').count, 5);
    assert.equal(rowOf(measured, 'draft').realMs, 6000);
    assert.equal(measured.phasesPlayed, plan.length);
    assert.equal(measured.recovered, 1);
    // En la ronda 3 se jugó la Memoria (p. ej. con el Clicker desactivado): suma en su fila.
    assert.equal(rowOf(measured, 'minigame:memoria').count, 2);
    assert.equal(rowOf(measured, 'minigame:clicker'), undefined);
  });

  test('pausas y fases saltadas', () => {
    assert.equal(measured.pausedMs, 4000);
    assert.equal(measured.skipped, 5);
  });

  test('una partida sin terminar se cuenta hasta el último evento', () => {
    const cut = events.slice(0, events.findIndex((e) => e.phase === 'r2.q3') + 1);
    cut.push({ ts: cut.at(-1).ts + 700, type: 'answer_received' });
    const partial = measureDuration(cut, config);
    assert.equal(partial.finished, false);
    assert.equal(partial.gameMs, null);
    assert.equal(rowOf(partial, 'question').count, 3);
  });
});
