// Traza a ciegas (ronda 2): el autómata de pila, los papeles, los toques, el cambio de papel y los
// premios por tiempo.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import {
  ACCEPT_MODES, TRAZA_PDA as PDA, acceptingTrace, canAccept, initialId, isAccepting, tapMove, trazaWords,
} from '../server/domain/pda.js';
import { timePrize } from '../server/minigames/traza.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

// { aⁿbⁿ w wᴿ | n ≥ 1, w ∈ {0,1}* }
function inLanguage(word) {
  const match = word.match(/^(a+)(b+)([01]*)$/);
  if (!match) return false;
  const [, as, bs, rest] = match;
  return as.length === bs.length && rest.length % 2 === 0 && rest === [...rest].reverse().join('');
}

const accepts = (word, mode) => canAccept(PDA, initialId(PDA, word), mode);

describe('el autómata', () => {
  test('acepta exactamente aⁿbⁿ w wᴿ, por estado final y por pila vacía (cadenas de hasta 7 símbolos)', () => {
    let layer = [''];
    for (let length = 0; length <= 7; length += 1) {
      for (const word of layer) {
        for (const mode of ACCEPT_MODES) assert.equal(accepts(word, mode), inLanguage(word), `${word || 'ε'} (${mode})`);
      }
      layer = layer.flatMap((word) => PDA.input.map((symbol) => word + symbol));
    }
  });

  test('las 24 cadenas del juego son del lenguaje y tienen 8 o 10 símbolos', () => {
    const words = trazaWords();
    assert.equal(words.length, 24);
    assert.equal(new Set(words).size, 24);
    for (const word of words) {
      assert.ok(inLanguage(word), word);
      assert.ok([8, 10].includes(word.length), word);
    }
  });

  test('en cada paso de cada cadena hay un solo estado correcto, y se acepta con largo + 3 toques', () => {
    for (const word of trazaWords()) {
      for (const mode of ACCEPT_MODES) {
        let id = initialId(PDA, word);
        let taps = 0;
        while (!isAccepting(PDA, id, mode)) {
          const good = PDA.states.filter((to) => tapMove(PDA, id, to, mode));
          assert.equal(good.length, 1, `${word} (${mode}) desde ${id.state}`);
          id = tapMove(PDA, id, good[0], mode).next;
          taps += 1;
        }
        assert.equal(taps, word.length + 3, `${word} (${mode}): tres pasos ε`);
        assert.equal(acceptingTrace(PDA, word, mode).length, taps);
      }
    }
  });

  test('la salida depende de la forma de aceptar: q₄ por estado final, q₅ por pila vacía', () => {
    const end = (mode) => PDA.transitions[acceptingTrace(PDA, 'ab0110', mode).at(-1).transition].to;
    assert.equal(end('final'), 'q4');
    assert.equal(end('empty'), 'q5');
  });
});

// Partida en el minijuego de la ronda 2 con equipos llenos y conectados.
const LIMIT_MS = 30_000;
const TAP_MS = 400; // por encima del tope de toque doble (300 ms)
function atTraza({ teamCount = 3, rules = {} } = {}) {
  const config = testConfig({ minigameRules: { traza: { maxDurationMs: LIMIT_MS, swapMs: 3000, ...rules } } });
  const clock = createFakeClock();
  const engine = new GameEngine({ config, clock, logger: silentLogger });
  engine.createRoom({ teamCount });
  const slots = {};
  for (const team of engine.room.teams) {
    for (const slot of ['A', 'B']) {
      const { deviceId } = engine.registerDevice();
      engine.join(deviceId, team.id);
      engine.setPresence(deviceId, { connected: true });
      slots[`${team.id}${slot}`] = deviceId;
    }
  }
  engine.start();
  while (engine.room.phase.id !== 'r2.mg') {
    const { phase } = engine.room;
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
  const game = () => engine.room.phase.data.state;
  const tap = (deviceId, state) => engine.action(deviceId, { type: 'input', input: { type: 'tap', state } });
  // Recorre la traza que acepta (o los primeros `count` pasos), un toque cada TAP_MS.
  const walk = (deviceId, count = Infinity) => {
    const trace = acceptingTrace(PDA, game().word, game().mode).slice(0, count);
    return trace.map((step) => {
      clock.advance(TAP_MS);
      return tap(deviceId, PDA.transitions[step.transition].to);
    });
  };
  // Un estado al que no lleva la traza correcta desde donde está el equipo.
  const wrongState = (teamId) => {
    const { id } = game().teams[teamId];
    return PDA.states.find((to) => !tapMove(PDA, id, to, game().mode));
  };
  return { engine, clock, slots, game, tap, walk, wrongState, team: (id) => engine.room.teams.find((t) => t.id === id) };
}

const data = (engine, viewer) => projectView(engine, viewer).phase.data.game;

describe('papeles y lo que ve cada uno', () => {
  test('la ronda 2 es la Traza a ciegas y cada equipo juega solo con la misma cadena', () => {
    const { engine, game } = atTraza();
    assert.equal(engine.room.phase.minigame, 'traza');
    assert.deepEqual(engine.room.phase.data.groups, [['t1'], ['t2'], ['t3']]);
    assert.ok(trazaWords().includes(game().word));
    assert.ok(ACCEPT_MODES.includes(game().mode));
  });

  test('A tiene el diagrama (sin la cadena) y B la cadena (sin estado, pila ni pasos)', () => {
    const { engine, slots } = atTraza();
    const diagram = data(engine, { role: 'play', deviceId: slots.t1A });
    assert.equal(diagram.role, 'diagram');
    assert.ok(diagram.pda.edges.length > 0);
    assert.deepEqual(diagram.current, { state: 'q0', stack: ['Z0'] });
    assert.equal(diagram.word, null);
    assert.equal(diagram.mode, null, 'la forma de aceptar la dice el de la cadena');
    const string = data(engine, { role: 'play', deviceId: slots.t1B });
    assert.equal(string.role, 'string');
    assert.ok(string.word && string.mode);
    for (const key of ['pda', 'current', 'last', 'steps']) assert.equal(string[key], null, key);
  });

  test('el proyector no recibe ni la cadena ni el autómata; el host sí', () => {
    const { engine, game } = atTraza();
    const screen = JSON.stringify(data(engine, { role: 'screen' }));
    assert.ok(!screen.includes(game().word) && !screen.includes('stack') && !screen.includes('edges'));
    assert.equal(data(engine, { role: 'host' }).word, game().word);
  });

  test('si el compañero no está conectado, el celular ve el diagrama y la cadena', () => {
    const { engine, slots } = atTraza();
    engine.setPresence(slots.t1B, { connected: false });
    const both = data(engine, { role: 'play', deviceId: slots.t1A });
    assert.equal(both.role, 'both');
    assert.ok(both.pda && both.word && both.current);
  });
});

describe('toques', () => {
  test('el de la cadena no puede tocar', () => {
    const { clock, slots, tap } = atTraza();
    clock.advance(TAP_MS);
    assert.equal(tap(slots.t1B, 'q0').error, 'not_diagram');
  });

  test('un paso ε cambia el estado sin leer: la entrada queda igual', () => {
    const { clock, slots, game, tap, walk } = atTraza();
    game().word = 'aabb0110';
    for (const t of Object.values(game().teams)) t.id = initialId(PDA, game().word);
    walk(slots.t1A, 4); // a, a, b, b
    assert.deepEqual(game().teams.t1.id, { state: 'q1', input: '0110', stack: ['Z0'] });
    clock.advance(TAP_MS);
    assert.equal(tap(slots.t1A, 'q2').correct, true);
    assert.deepEqual(game().teams.t1.id, { state: 'q2', input: '0110', stack: ['Z0'] });
  });

  test('un toque doble muy seguido se ignora', () => {
    const { clock, slots, game, tap } = atTraza();
    clock.advance(TAP_MS);
    assert.equal(tap(slots.t1A, 'q0').correct, true);
    clock.advance(100);
    assert.equal(tap(slots.t1A, 'q0').error, 'too_fast');
    assert.equal(game().teams.t1.steps, 1);
  });

  test('la traza correcta acepta la cadena: queda el tiempo y la vista lo dice', () => {
    const { engine, slots, game, walk } = atTraza();
    const replies = walk(slots.t1A);
    assert.ok(replies.slice(0, -1).every((reply) => reply.correct && !reply.accepted));
    assert.equal(replies.at(-1).accepted, true);
    const steps = acceptingTrace(PDA, game().word, game().mode).length;
    assert.equal(game().teams.t1.acceptedMs, steps * TAP_MS);
    const view = data(engine, { role: 'play', deviceId: slots.t1B });
    assert.equal(view.place, 1);
    assert.equal(view.acceptedMs, steps * TAP_MS);
    assert.ok(engine.events.some((e) => e.type === 'traza_accepted' && e.teamId === 't1' && e.place === 1));
  });
});

describe('error y cambio de papel', () => {
  test('un error: cambian de papel, vuelven a q₀ con la misma cadena y la pantalla dura swapMs', () => {
    const { engine, clock, slots, game, tap, walk, wrongState } = atTraza();
    walk(slots.t1A, 3);
    const word = game().word;
    clock.advance(TAP_MS);
    const reply = tap(slots.t1A, wrongState('t1'));
    assert.equal(reply.swap, true);
    const team = game().teams.t1;
    assert.equal(team.attempt, 2);
    assert.equal(team.diagram, 'B');
    assert.deepEqual(team.id, initialId(PDA, word));

    const diagram = data(engine, { role: 'play', deviceId: slots.t1B });
    assert.equal(diagram.role, 'diagram', 'ahora B tiene el diagrama');
    assert.ok(diagram.swapUntil > clock.now());
    assert.ok(diagram.error.correct, 'muestra el paso correcto');
    assert.equal(data(engine, { role: 'play', deviceId: slots.t1A }).role, 'string');

    clock.advance(1000);
    assert.equal(tap(slots.t1B, 'q0').error, 'swapping', 'durante la pantalla del cambio no se toca');
    clock.advance(2000);
    const after = data(engine, { role: 'play', deviceId: slots.t1B });
    assert.equal(after.swapUntil, null);
    assert.equal(after.error, null);
    assert.equal(walk(slots.t1B).at(-1).accepted, true, 'B acepta en el segundo intento');
    assert.equal(game().teams.t1.attempt, 2);
  });

  test('adivinar la mitad antes de tiempo es un error (la rama no acepta)', () => {
    const { clock, slots, game, tap, walk } = atTraza();
    game().word = 'ab0110';
    for (const t of Object.values(game().teams)) t.id = initialId(PDA, game().word);
    walk(slots.t1A, 4); // a, b, ε hacia q2, lee 0
    clock.advance(TAP_MS);
    const reply = tap(slots.t1A, 'q3'); // la mitad es después del 1
    assert.equal(reply.swap, true);
    assert.equal(game().teams.t1.errors[0].deadBranch, true);
    assert.equal(game().teams.t1.errors[0].correct.to, 'q2');
  });

  test('con la otra forma de aceptar, la salida equivocada es un error', () => {
    const { clock, slots, game, tap, walk } = atTraza();
    game().mode = 'empty';
    const steps = acceptingTrace(PDA, game().word, 'empty').length;
    walk(slots.t1A, steps - 1);
    clock.advance(TAP_MS);
    assert.equal(tap(slots.t1A, 'q4').swap, true, 'q₄ es final, pero la pila no queda vacía');
  });

  test('el segundo error deja al equipo sin intentos, sin mostrar el paso correcto', () => {
    const { engine, clock, slots, game, tap, wrongState } = atTraza();
    clock.advance(TAP_MS);
    tap(slots.t1A, wrongState('t1'));
    clock.advance(3000);
    const reply = tap(slots.t1B, wrongState('t1'));
    assert.equal(reply.out, true);
    for (const deviceId of [slots.t1A, slots.t1B]) {
      const view = data(engine, { role: 'play', deviceId });
      assert.equal(view.out, true);
      assert.equal(view.error.correct, null);
    }
    clock.advance(TAP_MS);
    assert.equal(tap(slots.t1B, 'q0').error, 'no_attempts');
    assert.ok(game().teams.t1.outMs !== null);
  });
});

describe('final y premios', () => {
  test('1000 y el fragmento al primero; a los demás según el tiempo (×1,5 en la ronda 2)', () => {
    const { engine, clock, slots, game, tap, walk, wrongState, team } = atTraza({ teamCount: 3 });
    walk(slots.t2A);
    const t2Ms = game().teams.t2.acceptedMs;
    walk(slots.t1A);
    const t1Ms = game().teams.t1.acceptedMs;
    clock.advance(TAP_MS);
    tap(slots.t3A, wrongState('t3'));
    clock.advance(3000);
    tap(slots.t3B, wrongState('t3'));
    assert.equal(engine.room.phase.kind, 'minigameResult', 'termina cuando todos aceptaron o se quedaron sin intentos');

    const settings = engine.config.minigameRules.traza;
    assert.ok(t2Ms < t1Ms);
    assert.deepEqual([team('t2').score, team('t1').score, team('t3').score],
      [1500, timePrize(settings, t1Ms) * 1.5, 0]);
    assert.deepEqual([team('t2').fragments, team('t1').fragments, team('t3').fragments], [1, 0, 0]);
    const result = projectView(engine, { role: 'screen' }).phase.data;
    assert.deepEqual(result.groups.map((g) => [g.teamIds[0], g.rank]), [['t1', 2], ['t2', 1], ['t3', null]]);
    assert.match(result.groups[1].label, /^1\.º · [\d.]+ s · 1\.er intento$/);
    assert.equal(result.groups[2].label, 'Sin intentos');
  });

  test('el resultado trae la traza que acepta, para repasarla en el proyector', () => {
    const { engine, clock, game } = atTraza({ teamCount: 2 });
    const { word, mode } = game();
    clock.advance(LIMIT_MS);
    const { replay } = projectView(engine, { role: 'screen' }).phase.data;
    assert.equal(replay.word, word);
    assert.equal(replay.mode, mode);
    assert.equal(replay.steps.length, word.length + 3);
    assert.ok(isAccepting(PDA, replay.steps.at(-1).id, mode));
    assert.equal(replay.steps[0].label, 'a, Z₀ / AZ₀');
  });

  test('los puntos por tiempo van de 800 a 200 y se redondean a la decena', () => {
    const settings = { maxDurationMs: 120_000, prizeBase: 200, prizeByTime: 600 };
    assert.equal(timePrize(settings, 0), 800);
    assert.equal(timePrize(settings, 38_500), 610);
    assert.equal(timePrize(settings, 60_000), 500);
    assert.equal(timePrize(settings, 120_000), 200);
  });

  test('el tiempo no incluye las pausas', () => {
    const { engine, clock, slots, game, walk } = atTraza({ teamCount: 2 });
    engine.pause();
    clock.advance(60_000);
    engine.resume();
    walk(slots.t1A);
    const steps = acceptingTrace(PDA, game().word, game().mode).length;
    assert.equal(game().teams.t1.acceptedMs, steps * TAP_MS);
  });

  test('sin aceptar a tiempo no hay puntos', () => {
    const { engine, clock, slots, walk, team } = atTraza({ teamCount: 2 });
    walk(slots.t1A, 3);
    clock.advance(LIMIT_MS);
    assert.equal(engine.room.phase.kind, 'minigameResult');
    assert.deepEqual([team('t1').score, team('t2').score], [0, 0]);
    const result = projectView(engine, { role: 'screen' }).phase.data;
    assert.equal(result.groups[0].label, 'No terminó');
  });
});
