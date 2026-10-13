// El taller (docs/TALLER.md): dos ejercicios que cada equipo hace a su ritmo antes del quiz.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { WORKSHOP_PDAS, canAccept, initialId, isAccepting, moves, runTrace } from '../server/domain/pda.js';
import { workshopTable } from '../server/domain/stats.js';
import {
  CHIPS, EXTRA_COUNT, EXTRA_RUNS, LEVELS, RUNS, evaluateLevel, expectedStep, newWorkshop, workshopAct, workshopSummary, workshopView,
} from '../server/domain/workshop.js';
import { HostBot, PlayerBot } from '../scripts/lib/bots.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';

// Todas las cadenas sobre un alfabeto hasta cierto largo.
function words(alphabet, maxLength) {
  let level = [''];
  const all = [''];
  for (let n = 1; n <= maxLength; n += 1) {
    level = level.flatMap((w) => alphabet.map((c) => w + c));
    all.push(...level);
  }
  return all;
}

// Aplica una acción con el número de estado al día, como hace el celular.
const act = (state, action, now = 5000) => workshopAct(state, { ...action, seq: state.seq }, { now, random: () => 0.5 });

// Resuelve la cadena en curso del ejercicio 1 con las respuestas correctas. Devuelve lo que tocó.
function solveRun(state) {
  const taps = [];
  while (state.e1?.phase === 'step') {
    const expected = expectedStep(state.e1.runs[state.e1.run], state.e1.id).act;
    taps.push(expected);
    assert.equal(act(state, { type: 'stack', act: expected }).reply.correct, true);
  }
  const run = state.e1.runs[state.e1.run];
  const accept = isAccepting(WORKSHOP_PDAS[run.pda], state.e1.id, run.mode);
  taps.push(accept ? 'accept' : 'reject');
  assert.equal(act(state, { type: 'verdict', accept }).reply.correct, true);
  return taps;
}

function solveExercise1(state) {
  while (state.stage === 'e1') {
    solveRun(state);
    assert.equal(act(state, { type: 'next' }).ok, true);
  }
}

function solveExercise2(state) {
  while (state.stage === 'e2') {
    LEVELS[state.e2.level].answer.forEach((value, slot) => act(state, { type: 'chip', slot, value }));
    assert.equal(state.e2.solved, true);
    assert.equal(act(state, { type: 'next' }).ok, true);
  }
}

describe('contenido del taller', () => {
  test('en cada paso de cada cadena hay una sola respuesta', () => {
    for (const run of [...RUNS, ...EXTRA_RUNS]) {
      const pda = WORKSHOP_PDAS[run.pda];
      let id = initialId(pda, run.word);
      for (let guard = 0; guard < 40; guard += 1) {
        const all = moves(pda, id);
        const good = all.filter((m) => canAccept(pda, m.next, run.mode));
        assert.ok(all.length <= 1 || good.length === 1, `${run.word} en ${JSON.stringify(id)}: paso ambiguo`);
        const expected = expectedStep(run, id);
        if (expected.act === 'halt') break;
        id = expected.move.next;
      }
      assert.equal(moves(pda, id).length, 0, `${run.word}: la ejecución termina`);
    }
  });

  test('las tres cadenas del ejercicio 1 piden 9, 5 y 7 toques', () => {
    const state = newWorkshop(0);
    act(state, { type: 'begin' });
    const taps = [];
    while (state.stage === 'e1') {
      taps.push(solveRun(state));
      act(state, { type: 'next' });
    }
    assert.deepEqual(taps, [
      ['push', 'push', 'push', 'pop', 'pop', 'pop', 'same', 'halt', 'accept'],
      ['push', 'pop', 'same', 'halt', 'reject'],
      ['push', 'pop', 'push', 'pop', 'pop', 'halt', 'accept'],
    ]);
    assert.deepEqual(state.summary.e1, { first: 21, total: 21, slips: [] });
  });

  test('cada reto tiene una sola solución entre las 30 combinaciones de fichas', () => {
    LEVELS.forEach((level, index) => {
      const solutions = [];
      for (let r = 0; r < CHIPS.read.length; r += 1) {
        for (let t = 0; t < CHIPS.top.length; t += 1) {
          for (let l = 0; l < CHIPS.leave.length; l += 1) {
            if (evaluateLevel(index, [r, t, l]).solved) solutions.push([r, t, l]);
          }
        }
      }
      assert.deepEqual(solutions, [level.answer], `reto ${index + 1}`);
      assert.equal(evaluateLevel(index, [null, null, null]).solved, false, 'sin fichas no está resuelto');
      assert.equal(evaluateLevel(index, [level.answer[0], null, null]).custom, null, 'con fichas de menos no hay transición');
    });
  });

  test('el autómata reparado acepta exactamente aⁿbⁿ, por estado final y por pila vacía', () => {
    const anbn = (w) => /^a+b+$/.test(w) && w.indexOf('b') * 2 === w.length;
    LEVELS.forEach((level, index) => {
      const { base, custom } = evaluateLevel(index, level.answer);
      const pda = { ...base, transitions: [...base.transitions, custom] };
      for (const w of words(['a', 'b'], 8)) assert.equal(runTrace(pda, w, level.mode).accepted, anbn(w), `reto ${index + 1}: «${w}»`);
    });
  });

  test('antes de reparar, las pruebas dicen qué falta', () => {
    const light = (test) => `${test.word}${test.got === test.want ? '+' : '-'}`;
    assert.equal(evaluateLevel(0, [null, null, null]).tests.map(light).join(' '), 'ab+ aabb- aaabbb- aab+ abb+');
    assert.equal(evaluateLevel(1, [null, null, null]).tests.map(light).join(' '), 'ab- aabb- aab+ abb+ ba+');
    const aabb = evaluateLevel(0, [null, null, null]).tests[1];
    assert.equal(aabb.end, 'Se detiene: en q₁ no hay transición para «b» con A en el tope.');
    assert.deepEqual(aabb.steps.at(-1).id, { state: 'q1', input: 'b', stack: ['A', 'Z0'] });
    const ab = evaluateLevel(1, [null, null, null]).tests[0];
    assert.equal(ab.end, 'Leyó todo, pero la pila no quedó vacía: no acepta.');
    assert.equal(ab.steps.at(-1).id.state, 'q2', 'llega hasta donde puede');
    const solved = evaluateLevel(1, LEVELS[1].answer).tests[0];
    assert.equal(solved.end, 'Acepta: leyó todo y la pila quedó vacía.');
    assert.deepEqual(solved.steps.at(-1), { from: 'q2', to: 'q2', label: 'ε, Z₀ / ε', read: '', custom: true, id: { state: 'q2', input: '', stack: [] } });
  });

  test('una ejecución que no acepta llega hasta donde más lee', () => {
    const pda = WORKSHOP_PDAS.anbn;
    const run = runTrace(pda, 'abb', 'final');
    assert.equal(run.accepted, false);
    assert.deepEqual(run.steps.at(-1).next, { state: 'q2', input: 'b', stack: ['Z0'] });
    assert.equal(runTrace(pda, 'aabb', 'final').accepted, true);
    assert.equal(runTrace(pda, 'aabb', 'final').steps.length, 5);
    assert.equal(runTrace(WORKSHOP_PDAS.parens, '()()', 'empty').steps.length, 5);
    assert.deepEqual(runTrace(pda, '', 'final'), { accepted: false, steps: [] });
  });
});

describe('ejercicio 1: sé la pila', () => {
  test('un toque equivocado se explica, no avanza y no cuenta como a la primera', () => {
    const state = newWorkshop(0);
    assert.equal(act(state, { type: 'stack', act: 'push' }).error, 'invalid_action', 'primero las instrucciones');
    assert.deepEqual(act(state, { type: 'begin' }).events, [{ type: 'workshop_begin', exercise: 1 }]);
    const before = structuredClone(state.e1.id);
    const wrong = act(state, { type: 'stack', act: 'pop' });
    assert.deepEqual(wrong.reply, { correct: false });
    assert.deepEqual(state.e1.id, before);
    assert.equal(state.e1.feedback.text, 'Aplica «a, Z₀ / AZ₀»: lee «a», sale Z₀ y entra AZ₀. La pila queda con un símbolo más.');
    assert.deepEqual(wrong.events[0], { type: 'workshop_step', exercise: 1, run: 0, word: 'aaabbb', at: '(q₀, aaabbb, Z₀)', tapped: 'pop', expected: 'push', correct: false });
    act(state, { type: 'stack', act: 'halt' }); // otro intento fallido en el mismo paso: un solo tropiezo
    assert.equal(state.e1.feedback.text, 'Sí hay una transición que aplica: «a, Z₀ / AZ₀».');
    assert.equal(act(state, { type: 'stack', act: 'push' }).reply.correct, true);
    assert.deepEqual([state.e1.first, state.e1.total, state.e1.slips.length, state.e1.feedback], [0, 1, 1, null]);
    assert.deepEqual(state.e1.id, { state: 'q0', input: 'aabbb', stack: ['A', 'Z0'] });
    act(state, { type: 'stack', act: 'push' });
    assert.deepEqual([state.e1.first, state.e1.total], [1, 2]);
  });

  test('abb: el paso ε, la detención con entrada sin leer y el veredicto', () => {
    const state = newWorkshop(0);
    act(state, { type: 'begin' });
    solveRun(state);
    act(state, { type: 'next' });
    assert.equal(state.e1.runs[state.e1.run].word, 'abb');
    act(state, { type: 'stack', act: 'push' });
    act(state, { type: 'stack', act: 'pop' });
    // (q₁, b, Z₀): no hay transición con «b», pero la ε sí aplica.
    act(state, { type: 'stack', act: 'halt' });
    assert.equal(state.e1.feedback.text, 'Sí hay una transición que aplica: «ε, Z₀ / Z₀», que no lee nada.');
    act(state, { type: 'stack', act: 'same' });
    assert.deepEqual(state.e1.id, { state: 'q2', input: 'b', stack: ['Z0'] });
    act(state, { type: 'stack', act: 'pop' });
    assert.equal(state.e1.feedback.text, 'En q₂ no hay transición para «b» con Z₀ en el tope, ni con ε. El autómata se detiene.');
    act(state, { type: 'stack', act: 'halt' });
    assert.equal(state.e1.phase, 'verdict');
    assert.equal(act(state, { type: 'stack', act: 'halt' }).error, 'invalid_action');
    assert.equal(act(state, { type: 'verdict', accept: true }).reply.correct, false);
    assert.equal(state.e1.feedback.text, 'No acepta: quedó «b» sin leer, aunque q₂ sea final.');
    assert.equal(act(state, { type: 'verdict', accept: false }).reply.correct, true);
    assert.deepEqual([state.e1.phase, state.e1.feedback.kind, state.e1.feedback.accepted], ['solved', 'verdict', false]);
  });

  test('()(): la rama ε que muere y la aceptación por pila vacía', () => {
    const state = newWorkshop(0);
    act(state, { type: 'begin' });
    for (let i = 0; i < 2; i += 1) {
      solveRun(state);
      act(state, { type: 'next' });
    }
    act(state, { type: 'stack', act: 'push' });
    act(state, { type: 'stack', act: 'pop' });
    // (q, (), Z₀): «ε, Z₀ / ε» existe, pero vaciaría la pila con entrada sin leer.
    act(state, { type: 'stack', act: 'pop' });
    assert.equal(state.e1.feedback.text, '«ε, Z₀ / ε» existe, pero por ahí la cadena ya no se acepta. La que sirve es «(, Z₀ / PZ₀».');
    act(state, { type: 'stack', act: 'push' });
    act(state, { type: 'stack', act: 'pop' });
    act(state, { type: 'stack', act: 'pop' });
    assert.deepEqual(state.e1.id, { state: 'q', input: '', stack: [] });
    act(state, { type: 'stack', act: 'same' });
    assert.equal(state.e1.feedback.text, 'La pila está vacía: sin tope no aplica ninguna transición. El autómata se detiene.');
    act(state, { type: 'stack', act: 'halt' });
    act(state, { type: 'verdict', accept: true });
    assert.equal(state.e1.feedback.text, 'Acepta: leyó toda la cadena y la pila quedó vacía.');
    const done = act(state, { type: 'next' });
    assert.equal(state.stage, 'intro2');
    assert.deepEqual(done.events, [{ type: 'workshop_exercise', exercise: 1, first: 19, total: 21, slips: 2 }]);
    assert.deepEqual(state.summary.e1.slips.map((slip) => [slip.word, slip.at, slip.tapped, slip.expected]),
      [['()()', '(q, (), Z₀)', 'pop', 'push'], ['()()', '(q, ε, ε)', 'same', 'halt']]);
  });

  test('una acción con un número de estado viejo se descarta', () => {
    const state = newWorkshop(0);
    act(state, { type: 'begin' });
    const seq = state.seq;
    assert.equal(workshopAct(state, { type: 'stack', act: 'push', seq }, { now: 1 }).ok, true);
    // El segundo toque (doble toque, o el otro celular) llega con el mismo número: no cuenta.
    assert.equal(workshopAct(state, { type: 'stack', act: 'push', seq }, { now: 1 }).error, 'stale_action');
    assert.equal(state.e1.steps, 1);
  });
});

describe('ejercicio 2 y recorrido completo', () => {
  test('las fichas arman la transición; al quedar las pruebas en verde se pasa al siguiente reto', () => {
    const state = newWorkshop(1000);
    act(state, { type: 'begin' });
    solveExercise1(state);
    assert.equal(act(state, { type: 'chip', slot: 0, value: 0 }).error, 'invalid_action', 'primero las instrucciones');
    act(state, { type: 'begin' });
    assert.equal(state.stage, 'e2');
    assert.equal(act(state, { type: 'chip', slot: 1, value: 2 }).error, 'invalid_action', 'esa ficha no existe');
    act(state, { type: 'chip', slot: 0, value: 1 });
    act(state, { type: 'chip', slot: 1, value: 0 });
    let view = workshopView(state);
    assert.equal(view.pda.edges.at(-1).labels[0], 'b, A / ?');
    assert.deepEqual([view.pda.edges.at(-1).hole, view.pda.edges.at(-1).set, view.solved], [true, false, false]);
    assert.equal(act(state, { type: 'next' }).error, 'invalid_action');
    act(state, { type: 'chip', slot: 2, value: 1 }); // b, A / A: no era
    assert.equal(state.e2.solved, false);
    const solved = act(state, { type: 'chip', slot: 2, value: 0 });
    assert.deepEqual(solved.reply, { solved: true });
    assert.deepEqual(solved.events, [{ type: 'workshop_level', exercise: 2, level: 0, changes: 4, transition: 'b, A / ε' }]);
    view = workshopView(state);
    assert.deepEqual([view.pda.edges.at(-1).labels[0], view.pda.edges.at(-1).set, view.solved], ['b, A / ε', true, true]);
    assert.ok(view.tests.every((t) => t.got === t.want));
    assert.equal(act(state, { type: 'chip', slot: 0, value: 0 }).error, 'invalid_action', 'ya resuelto: no se cambia');
    act(state, { type: 'next' });
    assert.deepEqual([state.e2.level, state.e2.sel, state.e2.solved], [1, [null, null, null], false]);
    assert.equal(workshopView(state).level.mode, 'empty');
  });

  test('al terminar los dos ejercicios el equipo queda en el repaso, con su resumen', () => {
    const state = newWorkshop(1000);
    act(state, { type: 'begin' });
    act(state, { type: 'stack', act: 'pop' }); // un tropiezo
    solveExercise1(state);
    act(state, { type: 'begin' });
    LEVELS[0].answer.forEach((value, slot) => act(state, { type: 'chip', slot, value }));
    act(state, { type: 'next' });
    LEVELS[1].answer.forEach((value, slot) => act(state, { type: 'chip', slot, value }));
    const done = act(state, { type: 'next' }, 61_000);
    assert.equal(state.stage, 'done');
    assert.deepEqual(done.events.map((e) => e.type), ['workshop_exercise', 'workshop_done']);
    assert.deepEqual(done.events[1], { type: 'workshop_done', first: 20, total: 21, slips: 1, ms: 60_000 });
    const view = workshopView(state);
    assert.deepEqual([view.stage, view.finished, view.summary.e1.first, view.summary.e2.levels.map((l) => l.changes)], ['done', true, 20, [3, 3]]);
    assert.deepEqual(view.review.map((r) => [r.word, r.accepted, r.steps.length]), [['aaabbb', true, 7], ['abb', false, 3], ['()()', true, 5]]);
    assert.equal(view.review[1].verdict, 'No acepta: quedó «b» sin leer, aunque q₂ sea final.');
    assert.deepEqual(workshopSummary(state), {
      stage: 'done', where: 'En el repaso', finished: true, first: 20, total: 21, slips: 1, changes: [3, 3], practices: 0, ms: 60_000,
    });
  });

  test('desde el repaso se practica otra vez sin tocar el resumen, y se puede volver a medias', () => {
    const state = newWorkshop(0);
    act(state, { type: 'begin' });
    assert.equal(act(state, { type: 'back' }).error, 'invalid_action', 'la primera vez se termina');
    assert.equal(act(state, { type: 'again', exercise: 1 }).error, 'invalid_action');
    solveExercise1(state);
    act(state, { type: 'begin' });
    solveExercise2(state);
    const summary = structuredClone(state.summary);

    assert.deepEqual(act(state, { type: 'again', exercise: 1 }).events, [{ type: 'workshop_begin', exercise: 1, again: true }]);
    assert.deepEqual([state.stage, state.e1.again, state.e1.runs.length], ['e1', true, EXTRA_COUNT]);
    assert.ok(state.e1.runs.every((run) => EXTRA_RUNS.includes(run)));
    assert.ok(state.e1.runs.some((run) => run.pda === 'parens'), 'al menos una de paréntesis');
    assert.equal(new Set(state.e1.runs.map((run) => run.word)).size, EXTRA_COUNT, 'sin repetir');
    act(state, { type: 'stack', act: 'halt' });
    assert.equal(act(state, { type: 'back' }).ok, true);
    assert.equal(state.stage, 'done');

    act(state, { type: 'again', exercise: 1 });
    solveExercise1(state);
    assert.equal(state.stage, 'done', 'al terminar la práctica vuelve al repaso');
    act(state, { type: 'again', exercise: 2 });
    assert.equal(workshopSummary(state).where, 'Practicando · reto 1 de 2');
    solveExercise2(state);
    assert.deepEqual([state.stage, state.practices], ['done', 3]);
    assert.deepEqual(state.summary, summary, 'el resumen es el de la primera vez');
    assert.equal(state.finishedAt, 5000, 'terminó la primera vez');
  });

  test('la vista de cada etapa trae lo que dibuja el celular', () => {
    const state = newWorkshop(0);
    assert.deepEqual(workshopView(state), { stage: 'intro1', seq: 0, finished: false });
    assert.equal(workshopSummary(state).where, 'Leyendo las instrucciones');
    act(state, { type: 'begin' });
    act(state, { type: 'stack', act: 'push' });
    const view = workshopView(state);
    assert.deepEqual(view.run, {
      index: 0, count: 3, word: 'aaabbb', mode: 'final', pdaName: 'aⁿbⁿ', pushSymbol: 'A',
      pda: {
        id: 'anbn', states: ['q0', 'q1', 'q2'], start: 'q0', final: ['q2'],
        edges: [
          { from: 'q0', to: 'q0', labels: ['a, Z₀ / AZ₀', 'a, A / AA'] },
          { from: 'q0', to: 'q1', labels: ['b, A / ε'] },
          { from: 'q1', to: 'q1', labels: ['b, A / ε'] },
          { from: 'q1', to: 'q2', labels: ['ε, Z₀ / Z₀'] },
        ],
      },
    });
    assert.deepEqual([view.id, view.last, view.phase, view.steps, view.score], [
      { state: 'q0', input: 'aabbb', stack: ['A', 'Z0'] }, { from: 'q0', to: 'q0', label: 'a, Z₀ / AZ₀', read: 'a' }, 'step', 1, { first: 1, total: 1 },
    ]);
    assert.equal(workshopSummary(state).where, 'Ejercicio 1 · cadena 1 de 3');
    solveExercise1(state);
    act(state, { type: 'begin' });
    const second = workshopView(state);
    assert.deepEqual(second.options, { read: ['a', 'b', 'ε'], top: ['A', 'Z₀'], leave: ['ε', 'A', 'AA', 'Z₀', 'AZ₀'] });
    assert.deepEqual(second.level, { index: 0, count: 2, mode: 'final', goal: LEVELS[0].goal, solvedText: LEVELS[0].solved });
    assert.equal(second.pda.edges.some((e) => e.from === 'q1' && e.to === 'q1' && !e.hole), false, 'el bucle de q₁ no viene');
    assert.equal(second.pda.edges.at(-1).labels[0], '?, ? / ?');
    assert.deepEqual(second.tests.map((t) => t.word), ['ab', 'aabb', 'aaabbb', 'aab', 'abb']);
  });
});

describe('el taller en la sala', () => {
  function setup() {
    const clock = createFakeClock();
    const engine = new GameEngine({ config: testConfig(), clock, logger: silentLogger });
    engine.createRoom({ teamCount: 4, workshop: true });
    const device = () => engine.registerDevice().deviceId;
    const [a, b, c] = [device(), device(), device()];
    engine.registerTeam(a, { name: 'Los Pilas', members: ['Ana', 'Luis'] });
    engine.join(b, 't1');
    engine.registerTeam(c, { name: 'Otro', members: ['x', 'y'] });
    const send = (deviceId, action) => engine.workshopAction(deviceId, { ...action, seq: engine.teamOf(deviceId).team.workshop.seq });
    return { engine, clock, a, b, c, device, send };
  }

  test('los dos celulares del equipo actúan sobre el mismo taller y ven lo mismo', () => {
    const { engine, a, b, c, send } = setup();
    assert.equal(send(a, { type: 'begin' }).ok, true);
    assert.deepEqual(send(b, { type: 'stack', act: 'push' }), { ok: true, correct: true });
    assert.deepEqual(send(a, { type: 'stack', act: 'pop' }), { ok: true, correct: false });
    const [viewA, viewB, viewC] = [a, b, c].map((deviceId) => projectView(engine, { role: 'play', deviceId }).workshop);
    assert.deepEqual(viewA, viewB);
    assert.deepEqual([viewA.stage, viewA.steps, viewA.feedback.kind], ['e1', 1, 'wrong']);
    assert.equal(viewC.stage, 'intro1', 'el otro equipo va por su lado');
    const events = engine.events.filter((e) => e.type === 'workshop_step');
    assert.deepEqual(events.map((e) => [e.teamId, e.deviceId, e.correct]), [['t1', b, true], ['t1', a, false]]);
    assert.equal(engine.workshopAction(a, { type: 'stack', act: 'push', seq: 0 }).error, 'stale_action');
  });

  test('solo en la sala con registro, con equipo y antes de empezar', () => {
    const { engine, a, b, device, send } = setup();
    assert.equal(engine.workshopAction(device(), { type: 'begin', seq: 0 }).error, 'not_in_team');
    assert.equal(projectView(engine, { role: 'play', deviceId: device() }).workshop, null);
    engine.setLobbyOpen(false);
    assert.equal(send(a, { type: 'begin' }).ok, true, 'el taller no depende del ingreso');
    engine.join(device(), 't2');
    engine.setLobbyOpen(true);
    engine.join(device(), 't2');
    assert.equal(engine.start().ok, true);
    assert.equal(engine.workshopAction(b, { type: 'stack', act: 'push', seq: 1 }).error, 'game_started');
    assert.equal('workshop' in projectView(engine, { role: 'play', deviceId: a }), false, 'en la partida ya no viaja el taller');
    const fixed = new GameEngine({ config: testConfig(), clock: createFakeClock(), logger: silentLogger });
    fixed.createRoom({ teamCount: 2 });
    const { deviceId } = fixed.registerDevice();
    fixed.join(deviceId, 't1');
    assert.equal(fixed.workshopAction(deviceId, { type: 'begin', seq: 0 }).error, 'no_registration');
  });

  test('el proyector solo sabe si un equipo terminó; el host ve por dónde va cada uno', () => {
    const { engine, clock, a, send } = setup();
    send(a, { type: 'begin' });
    const state = engine.room.teams[0].workshop;
    clock.advance(90_000);
    // Lo termina por el motor, con las respuestas correctas.
    while (state.stage !== 'done') {
      if (state.stage === 'intro2') send(a, { type: 'begin' });
      else if (state.stage === 'e1' && state.e1.phase === 'step') send(a, { type: 'stack', act: expectedStep(state.e1.runs[state.e1.run], state.e1.id).act });
      else if (state.stage === 'e1' && state.e1.phase === 'verdict') {
        const run = state.e1.runs[state.e1.run];
        send(a, { type: 'verdict', accept: isAccepting(WORKSHOP_PDAS[run.pda], state.e1.id, run.mode) });
      } else if (state.stage === 'e2' && !state.e2.solved) {
        LEVELS[state.e2.level].answer.forEach((value, slot) => send(a, { type: 'chip', slot, value }));
      } else send(a, { type: 'next' });
    }
    const screen = projectView(engine, { role: 'screen' });
    assert.deepEqual(screen.teams.map((t) => [t.workshopDone, 'workshop' in t]), [[true, false], [false, false]]);
    const play = projectView(engine, { role: 'play', deviceId: a });
    assert.equal(play.teams.some((t) => 'workshopDone' in t || 'workshop' in t), false, 'un celular no ve el taller de los demás');
    const host = projectView(engine, { role: 'host' });
    assert.deepEqual(host.teams.map((t) => [t.workshop.where, t.workshop.first, t.workshop.ms]), [['En el repaso', 21, 90_000], ['Leyendo las instrucciones', null, null]]);
    const done = engine.events.find((e) => e.type === 'workshop_done');
    assert.deepEqual([done.teamId, done.first, done.total, done.ms], ['t1', 21, 21, 90_000]);
  });
});

describe('el taller por la red', () => {
  const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';
  let server;
  let baseUrl;
  const sockets = [];

  before(async () => {
    server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger });
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  });

  after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  test('taller:act valida el mensaje, responde si fue correcto y la vista nueva llega a los dos celulares', async () => {
    server.engine.createRoom({ teamCount: 2, workshop: true });
    const open = () => new Promise((resolve) => {
      const socket = connectClient(baseUrl, { auth: { role: 'play' }, transports: ['websocket'], forceNew: true, reconnection: false });
      sockets.push(socket);
      socket.latest = null;
      socket.on('state:sync', (view) => { socket.latest = view; });
      socket.once('connect', () => resolve(socket));
    });
    const ask = (socket, event, payload) => socket.timeout(2000).emitWithAck(event, payload);
    const until = async (socket, predicate) => {
      for (let i = 0; i < 100 && !(socket.latest && predicate(socket.latest)); i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
      assert.ok(socket.latest && predicate(socket.latest), 'la vista esperada no llegó');
      return socket.latest;
    };
    const [first, second] = [await open(), await open()];
    await ask(first, 'lobby:register', { name: 'Los Pilas', members: ['Ana', 'Luis'] });
    await ask(second, 'lobby:join', { teamId: 't1' });
    await until(second, (view) => view.workshop?.stage === 'intro1');
    assert.equal((await ask(first, 'taller:act', { type: 'stack', act: 'apilar', seq: 0 })).error, 'invalid_payload');
    assert.equal((await ask(first, 'taller:act', { type: 'begin' })).error, 'invalid_payload', 'falta seq');
    assert.deepEqual(await ask(first, 'taller:act', { type: 'begin', seq: 0 }), { ok: true });
    assert.deepEqual(await ask(second, 'taller:act', { type: 'stack', act: 'push', seq: 1 }), { ok: true, correct: true });
    const view = await until(first, (v) => v.workshop?.steps === 1);
    assert.deepEqual(view.workshop.id, { state: 'q0', input: 'aabbb', stack: ['A', 'Z0'] });
    assert.equal((await ask(first, 'taller:act', { type: 'stack', act: 'push', seq: 1 })).error, 'stale_action');
  });

  test('con bots: los equipos se registran, hacen el taller con tropiezos y la partida empieza', async () => {
    const host = await new HostBot(baseUrl, HOST_TOKEN).open();
    const created = await host.command('createRoom', { teamCount: 2, workshop: true, confirm: true });
    assert.equal(created.ok, true);
    const bots = await Promise.all(Array.from({ length: 4 }, (_, i) => {
      const pair = Math.floor(i / 2) + 1;
      return new PlayerBot(baseUrl, {
        label: `bot${i + 1}`, team: { name: `Bots ${pair}`, members: [`Bot ${2 * pair - 1}`, `Bot ${2 * pair}`] },
        workshopMistakeRate: 0.3, workshopStepMs: [130, 150],
      }).open();
    }));
    try {
      await host.waitFor(({ teams }) => teams.length === 2 && teams.every((team) => team.workshopDone && team.slots.A && team.slots.B), 30_000);
      const { teams } = server.engine.room;
      assert.deepEqual(teams.map((team) => [team.name, team.members]).sort(), [['Bots 1', ['Bot 1', 'Bot 2']], ['Bots 2', ['Bot 3', 'Bot 4']]]);
      for (const team of teams) {
        assert.equal(team.workshop.stage, 'done');
        assert.equal(team.workshop.summary.e1.total, 21);
        assert.deepEqual(team.workshop.summary.e2.levels.map((level) => level.level), [0, 1]);
      }
      // Entre los dos equipos son 42 pasos con un 30 % de tropiezo: alguno hubo, y quedó explicado.
      const slips = teams.flatMap((team) => team.workshop.summary.e1.slips);
      assert.ok(slips.length > 0 && slips.every((slip) => slip.text.length > 10));
      assert.equal(server.engine.events.filter((e) => e.type === 'workshop_done').length, 2);
      assert.equal((await host.command('start')).ok, true);
      await Promise.all(bots.map((bot) => bot.waitFor(({ phase }) => phase?.kind === 'question')));
      assert.deepEqual(bots.flatMap((bot) => bot.errors), []);
    } finally {
      for (const client of [...bots, host]) client.close();
    }
  });

  test('la exportación trae el taller de cada equipo y sus integrantes', async () => {
    const auth = { headers: { Authorization: `Bearer ${HOST_TOKEN}` } };
    assert.equal((await fetch(`${baseUrl}/api/export?format=csv&table=taller`)).status, 401);
    const csv = await (await fetch(`${baseUrl}/api/export?format=csv&table=taller&sep=,`, auth)).text();
    const [header, ...rows] = csv.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(header, 'equipo,integrantes,termino,etapa,minutos,pasos_a_la_primera,pasos,tropiezos,donde,fichas_reto_1,fichas_reto_2,practicas');
    assert.equal(rows.length, 2);
    assert.match(rows.find((row) => row.startsWith('Bots 1')), /^Bots 1,"Bot 1, Bot 2",Sí,repaso,/);
    const full = await (await fetch(`${baseUrl}/api/export?format=json`, auth)).json();
    assert.deepEqual(full.room.teams.map((team) => team.members).sort(), [['Bot 1', 'Bot 2'], ['Bot 3', 'Bot 4']]);
    assert.deepEqual(full.summary.workshop.map((row) => [row.termino, row.pasos]), [[true, 21], [true, 21]]);
    assert.deepEqual(full.summary.teams.map((row) => row.integrantes).sort(), ['Bot 1, Bot 2', 'Bot 3, Bot 4']);
  });
});

describe('estadísticas del taller', () => {
  test('una fila por equipo registrado: integrantes, avance y dónde tropezó', () => {
    const done = newWorkshop(0);
    act(done, { type: 'begin' });
    act(done, { type: 'stack', act: 'halt' });
    solveExercise1(done);
    act(done, { type: 'begin' });
    solveExercise2(done);
    workshopAct(done, { type: 'again', exercise: 2, seq: done.seq }, { now: 400_000 });
    const started = newWorkshop(0);
    act(started, { type: 'begin' });
    const teams = [
      { name: 'Los Pilas', members: ['Ana', 'Luis'], workshop: done },
      { name: 'Otro', members: ['x', 'y'], workshop: started },
      { name: 'Equipo fijo', members: [] }, // sala de equipos fijos: sin taller
    ];
    assert.deepEqual(workshopTable({ teams }), [
      {
        equipo: 'Los Pilas', integrantes: 'Ana, Luis', termino: true, etapa: 'ejercicio 2', minutos: 0.1, pasos_a_la_primera: 20, pasos: 21, tropiezos: 1,
        donde: 'aaabbb (q₀, aaabbb, Z₀): Se detiene en vez de Apilar', fichas_reto_1: 3, fichas_reto_2: 3, practicas: 1,
      },
      {
        equipo: 'Otro', integrantes: 'x, y', termino: false, etapa: 'ejercicio 1', minutos: '', pasos_a_la_primera: '', pasos: '', tropiezos: '',
        donde: '', fichas_reto_1: '', fichas_reto_2: '', practicas: 0,
      },
    ]);
  });
});
