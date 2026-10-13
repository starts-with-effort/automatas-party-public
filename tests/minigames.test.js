// Minijuegos: grupos, ruleta, Clicker y Memoria (secciones 4.7 y 4.8).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { groupResults, makePairs } from '../server/domain/Grouping.js';
import { createRng } from '../server/domain/random.js';
import { clicker } from '../server/minigames/clicker.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

// Partida con equipos llenos y conectados, avanzada hasta la fase indicada.
function gameAt(phaseId, { teamCount = 4, config = testConfig() } = {}) {
  const clock = createFakeClock();
  const engine = new GameEngine({ config, clock, logger: silentLogger });
  engine.createRoom({ teamCount });
  const slots = {};
  for (const team of engine.room.teams) {
    for (const slot of ['A', 'B']) {
      const { deviceId } = engine.registerDevice();
      engine.join(deviceId, team.id);
      engine.setPresence(deviceId, { connected: true, rtt: 50 });
      slots[`${team.id}${slot}`] = deviceId;
    }
  }
  engine.start();
  for (;;) {
    const { phase } = engine.room;
    if (phase.id === phaseId) break;
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
  return { engine, clock, slots, team: (id) => engine.room.teams.find((t) => t.id === id) };
}

const input = (engine, deviceId, payload) => engine.action(deviceId, { type: 'input', input: payload });
const playView = (engine, deviceId) => projectView(engine, { role: 'play', deviceId }).phase.data;
const screenView = (engine) => projectView(engine, { role: 'screen' }).phase.data;

describe('grupos', () => {
  test('parejas al azar; con un número impar, un equipo queda solo', () => {
    const random = createRng(5);
    const even = makePairs(['a', 'b', 'c', 'd'], random);
    assert.deepEqual(even.map((g) => g.length), [2, 2]);
    const odd = makePairs(['a', 'b', 'c', 'd', 'e', 'f', 'g'], random);
    assert.deepEqual(odd.map((g) => g.length), [2, 2, 2, 1]);
    assert.deepEqual(odd.flat().sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  test('el grupo con más puntaje gana premio y fragmentos; un empate se desempata con un Duelo; sin puntaje no hay ganador', () => {
    const groups = [['a', 'b'], ['c', 'd'], ['e']];
    const single = groupResults(groups, [9, 5, 0], 1000);
    assert.deepEqual([single.awards.map((a) => a.teamId), single.fragments, single.tie], [['a', 'b'], ['a', 'b'], null]);
    const tied = groupResults(groups, [5, 9, 9], 1000);
    assert.deepEqual([tied.tie, tied.awards, tied.fragments], [[['c', 'd'], ['e']], [], []]);
    const decided = groupResults(groups, [5, 9, 9], 1000, ['e']);
    assert.deepEqual([decided.awards.map((a) => a.teamId), decided.fragments, decided.tie], [['e'], ['e'], null]);
    assert.deepEqual(decided.groups.map((g) => g.winner), [false, false, true]);
    assert.deepEqual(groupResults(groups, [0, 0, 0], 1000).awards, []);
  });

  test('los grupos se forman en las instrucciones y se mantienen en el minijuego', () => {
    const { engine, clock } = gameAt('r1.mg.intro', { teamCount: 5 });
    const { groups } = screenView(engine);
    assert.deepEqual(groups.map((g) => g.length).sort(), [1, 2, 2]);
    clock.advance(1000);
    assert.deepEqual(screenView(engine).groups, groups);
  });
});

describe('ruleta', () => {
  test('siempre se detiene en el minijuego fijo de la ronda, entre señuelos', () => {
    const { engine } = gameAt('r1.roulette');
    const { reel, targetIndex } = screenView(engine);
    assert.equal(reel[targetIndex], 'Memoria de parejas');
    assert.ok(reel.some((name) => engine.config.minigameRules.roulette.decoys.includes(name)));
  });
});

describe('Clicker', () => {
  const at = (options) => gameAt('r3.mg', options);

  test('los clics se suman por grupo; gana el grupo con más clics', () => {
    const { engine, clock, slots, team } = at();
    const [g1, g2] = screenView(engine).groups;
    clock.advance(500);
    input(engine, slots[`${g1[0]}A`], { type: 'clicks', count: 4 });
    input(engine, slots[`${g1[1]}B`], { type: 'clicks', count: 3 });
    input(engine, slots[`${g2[0]}A`], { type: 'clicks', count: 5 });
    clock.advance(250); // la vista se difunde con un tope de 4 Hz
    assert.deepEqual(screenView(engine).game.totals, [7, 5]);
    clock.advance(1000);
    assert.equal(engine.room.phase.kind, 'minigameResult');
    const result = screenView(engine);
    assert.deepEqual(result.groups.map((g) => [g.score, g.winner]), [[7, true], [5, false]]);
    // Ronda 3: el 1.er puesto vale 2000 (1000 + 2 × 500); cada equipo del grupo gana un fragmento.
    for (const id of g1) assert.deepEqual([team(id).score, team(id).fragments], [2000, 1]);
    for (const id of g2) assert.deepEqual([team(id).score, team(id).fragments], [0, 0]);
  });

  test('con un número impar de equipos, los clics del que queda sin pareja cuentan con clics adicionales', () => {
    const { engine, clock, slots, team } = at({ teamCount: 3 });
    const { groups } = screenView(engine);
    const [solo] = groups.find((g) => g.length === 1);
    const pair = groups.find((g) => g.length === 2);
    clock.advance(500);
    input(engine, slots[`${solo}A`], { type: 'clicks', count: 6 });
    input(engine, slots[`${solo}B`], { type: 'clicks', count: 4 });
    input(engine, slots[`${pair[0]}A`], { type: 'clicks', count: 8 });
    input(engine, slots[`${pair[1]}B`], { type: 'clicks', count: 8 });
    clock.advance(250);
    const { soloFactor } = engine.config.minigameRules.clicker;
    const totals = Object.fromEntries(groups.map((g, index) => [g.join('+'), screenView(engine).game.totals[index]]));
    assert.deepEqual(totals, { [solo]: Math.round(10 * soloFactor), [pair.join('+')]: 16 }); // 10 clics le ganan a 16
    assert.equal(screenView(engine).game.teamClicks[solo], 10, 'los toques reales no cambian');
    clock.advance(1000);
    assert.deepEqual(screenView(engine).groups.find((g) => g.winner).teamIds, [solo]);
    assert.deepEqual([team(solo).score, team(solo).fragments], [2000, 1]);
  });

  test('si ningún grupo tiene dos equipos, nadie recibe clics adicionales', () => {
    const settings = testConfig().minigameRules.clicker;
    const state = { teamClicks: { a: 10, b: 7 } };
    assert.deepEqual(clicker.scores(state, { groups: [['a'], ['b']], settings }), [10, 7]);
  });

  test('cada dispositivo suma como mucho 20 clics por segundo de juego', () => {
    const { engine, clock, slots } = at();
    clock.advance(500); // 0,5 s de juego → hasta 10 (+2 de holgura)
    assert.deepEqual(input(engine, slots.t1A, { type: 'clicks', count: 50 }), { ok: true, accepted: 12 });
    assert.deepEqual(input(engine, slots.t1A, { type: 'clicks', count: 5 }), { ok: true, accepted: 0 });
    assert.deepEqual(input(engine, slots.t1B, { type: 'clicks', count: 5 }), { ok: true, accepted: 5 }, 'el tope es por dispositivo');
  });

  test('se descartan los clics fuera de la ventana de juego', () => {
    const { engine, clock, slots } = at({ config: testConfig({ minigameRules: { countdownMs: 3000 } }) });
    assert.equal(input(engine, slots.t1A, { type: 'clicks', count: 3 }).error, 'game_not_started');
    clock.advance(3000 + 500);
    assert.equal(input(engine, slots.t1A, { type: 'clicks', count: 3 }).ok, true);
  });

  test('la cuenta 3-2-1: playStartsAt va countdownMs después de startsAt', () => {
    const { engine } = at({ config: testConfig({ minigameRules: { countdownMs: 3000 } }) });
    const { phase } = engine.room;
    assert.equal(phase.playStartsAt, phase.startsAt + 3000);
    assert.equal(phase.endsAt, phase.playStartsAt + 1000);
  });
});

describe('Memoria', () => {
  const at = (options) => gameAt('r1.mg', options);
  const facesOf = (engine) => engine.room.phase.data.state.cards.map((card) => card.face);
  const turnOf = (engine) => screenView(engine).game.turn;
  // Pareja y no pareja para la primera carta.
  const pairFor = (engine, index) => facesOf(engine).findIndex((face, i) => i !== index && face === facesOf(engine)[index]);
  const missFor = (engine, index) => facesOf(engine).findIndex((face) => face !== facesOf(engine)[index]);
  const devicesOf = (slots, teamId) => [slots[`${teamId}A`], slots[`${teamId}B`]];

  test('nadie recibe el contenido de una carta boca abajo', () => {
    const { engine, slots } = at();
    for (const viewer of [{ role: 'screen' }, { role: 'host' }, { role: 'play', deviceId: slots.t1A }]) {
      const { cards } = projectView(engine, viewer).phase.data.game;
      assert.ok(cards.every((card) => card.face === undefined), viewer.role);
    }
  });

  test('en el turno de un grupo, un equipo voltea la primera y el otro la segunda', () => {
    const { engine, slots } = at();
    const turn = turnOf(engine);
    const [first, second] = screenView(engine).groups[turn.group];
    assert.equal(turn.flipper.teamId, first);
    assert.equal(turn.cardMs, engine.config.minigameRules.memoria.cardTimeMs, 'el anillo del turno sabe cuánto dura');
    const otherGroup = screenView(engine).groups.find((g) => !g.includes(first));
    assert.equal(input(engine, slots[`${otherGroup[0]}A`], { type: 'flip', card: 0 }).error, 'not_your_turn');
    assert.equal(input(engine, slots[`${second}A`], { type: 'flip', card: 0 }).error, 'not_your_turn');
    assert.ok(playView(engine, slots[`${first}B`]).game.canFlip, 'cualquiera de los dos dispositivos del equipo');
    assert.equal(input(engine, slots[`${first}B`], { type: 'flip', card: 0 }).ok, true);
    assert.equal(screenView(engine).game.cards[0].face, facesOf(engine)[0], 'volteada, todos la ven');
    assert.equal(turnOf(engine).flipper.teamId, second);
    assert.equal(input(engine, slots[`${second}A`], { type: 'flip', card: 0 }).error, 'card_unavailable');
  });

  test('pareja: +1 para el grupo y las cartas desaparecen; el turno pasa e invierte el orden del grupo', () => {
    const { engine, clock, slots } = at({ config: testConfig({ minigameRules: { memoria: { pairs: 4 } } }) });
    const { group } = turnOf(engine);
    const [first, second] = screenView(engine).groups[group];
    input(engine, devicesOf(slots, first)[0], { type: 'flip', card: 0 });
    input(engine, devicesOf(slots, second)[0], { type: 'flip', card: pairFor(engine, 0) });
    assert.equal(turnOf(engine).match, true);
    clock.advance(50); // revealMs
    const { game } = screenView(engine);
    assert.equal(game.pairs[group], 1);
    assert.equal(game.cards[0].state, 'gone');
    assert.notEqual(game.turn.group, group);
    // El otro grupo falla; en el siguiente turno de este grupo empieza el otro equipo.
    const [otherFirst, otherSecond] = screenView(engine).groups[turnOf(engine).group];
    const down = game.cards.findIndex((card) => card.state === 'down');
    const miss = facesOf(engine).findIndex((face, i) => game.cards[i].state === 'down' && face !== facesOf(engine)[down]);
    input(engine, devicesOf(slots, otherFirst)[0], { type: 'flip', card: down });
    input(engine, devicesOf(slots, otherSecond)[0], { type: 'flip', card: miss });
    clock.advance(50);
    assert.equal(turnOf(engine).group, group);
    assert.equal(turnOf(engine).flipper.teamId, second);
  });

  test('sin pareja: se muestran y vuelven boca abajo', () => {
    const { engine, clock, slots } = at();
    const { group } = turnOf(engine);
    const [first, second] = screenView(engine).groups[group];
    const miss = missFor(engine, 0);
    input(engine, devicesOf(slots, first)[0], { type: 'flip', card: 0 });
    input(engine, devicesOf(slots, second)[0], { type: 'flip', card: miss });
    assert.equal(screenView(engine).game.cards[miss].state, 'up');
    clock.advance(50);
    assert.equal(screenView(engine).game.cards[0].state, 'down');
    assert.equal(screenView(engine).game.pairs[group], 0);
  });

  test('si vence el tiempo de una carta, el grupo pierde el turno', () => {
    const { engine, clock, slots } = at();
    const { group } = turnOf(engine);
    const [first] = screenView(engine).groups[group];
    input(engine, devicesOf(slots, first)[0], { type: 'flip', card: 3 });
    clock.advance(500); // cardTimeMs
    const { game } = screenView(engine);
    assert.notEqual(game.turn.group, group);
    assert.equal(game.cards[3].state, 'down');
  });

  test('termina al encontrar todas las parejas; gana el grupo con más', () => {
    const { engine, clock, slots, team } = at();
    const groups = screenView(engine).groups;
    const winner = turnOf(engine).group; // solo este grupo encuentra parejas: sin empate
    while (engine.room.phase.kind === 'minigame') {
      const { group } = turnOf(engine);
      if (group !== winner) {
        clock.advance(500); // los demás pierden el turno por tiempo
        continue;
      }
      const [first, second] = groups[group];
      const down = screenView(engine).game.cards.findIndex((card) => card.state === 'down');
      input(engine, devicesOf(slots, first)[0], { type: 'flip', card: down });
      input(engine, devicesOf(slots, second)[0], { type: 'flip', card: pairFor(engine, down) });
      clock.advance(50);
    }
    assert.equal(engine.room.phase.kind, 'minigameResult');
    const result = screenView(engine);
    assert.equal(result.metric, 'parejas');
    assert.ok(result.groups[winner].winner);
    for (const id of groups[winner]) assert.deepEqual([team(id).score, team(id).fragments], [1000, 1]);
  });

  test('grupo de un solo equipo: A voltea la primera y B la segunda', () => {
    const { engine, clock, slots } = at({ teamCount: 3 });
    const groups = screenView(engine).groups;
    const solo = groups.findIndex((g) => g.length === 1);
    while (turnOf(engine).group !== solo) clock.advance(500); // los demás pierden el turno por tiempo
    const [teamId] = groups[solo];
    assert.deepEqual(turnOf(engine).flipper, { teamId, slot: 'A' });
    assert.equal(input(engine, slots[`${teamId}B`], { type: 'flip', card: 0 }).error, 'not_your_turn');
    input(engine, slots[`${teamId}A`], { type: 'flip', card: 0 });
    assert.deepEqual(turnOf(engine).flipper, { teamId, slot: 'B' });
    engine.setPresence(slots[`${teamId}B`], { connected: false });
    assert.equal(input(engine, slots[`${teamId}A`], { type: 'flip', card: 1 }).ok, true, 'si B no está, voltea A');
  });

  test('la pausa congela el tiempo por carta', () => {
    const { engine, clock } = at();
    const { group } = turnOf(engine);
    clock.advance(300);
    engine.pause();
    clock.advance(10_000);
    engine.resume();
    clock.advance(199);
    assert.equal(turnOf(engine).group, group);
    clock.advance(1);
    assert.notEqual(turnOf(engine).group, group);
  });
});
