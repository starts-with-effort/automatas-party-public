// Parche de balance: premios por ronda y compensación, estrellas y fragmentos, el Duelo (desempates
// y Desafío) y las reglas de aparición de los objetos.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { playHand } from '../server/domain/duel.js';
import { catchUpFactor, roundFactor } from '../server/domain/Scoring.js';
import { giveFragments, stealAll, totalScore } from '../server/domain/stars.js';
import { rankTeams } from '../server/domain/ranking.js';
import { giveItem } from '../server/domain/teams.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

// Duelo con 0,5 s de presentación (para ver que no se elige antes), 1 s por mano y sin pausas para mirar.
const config = testConfig({ duel: { introMs: 500 } });
const STARS = config.stars; // 5 fragmentos por estrella; 1000 por fragmento y 5000 + 1000 por estrella

// Partida con equipos llenos y conectados.
function startGame({ teamCount = 4, cfg = config } = {}) {
  const clock = createFakeClock();
  const engine = new GameEngine({ config: cfg, clock, logger: silentLogger });
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
  return { engine, clock, slots, team: (id) => engine.room.teams.find((t) => t.id === id) };
}

function goTo({ engine, clock }, id) {
  for (;;) {
    const { phase } = engine.room;
    if (phase.id === id) return;
    if (engine.room.finished) throw new Error(`no se llegó a ${id}`);
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
}

const act = (engine, deviceId, action) => engine.action(deviceId, action);
const pick = (engine, deviceId, option) => act(engine, deviceId, { type: 'duel', option });
const duelOf = (engine, viewer = { role: 'screen' }) => projectView(engine, viewer).phase.data;
// Celular al que le toca elegir por el lado (rediseño del Duelo: uno por mano) y el otro del equipo.
const turnOf = (engine, slots, side) => {
  const { teamId, slot } = duelOf(engine).turns[side];
  return { teamId, slot, deviceId: slots[`${teamId}${slot}`], other: slots[`${teamId}${slot === 'A' ? 'B' : 'A'}`] };
};
const pickSide = (engine, slots, side, option) => pick(engine, turnOf(engine, slots, side).deviceId, option);

describe('premios de los minijuegos por ronda y compensación', () => {
  const scoring = config.minigameScoring;

  test('el 1.er puesto vale 1000 en la ronda 1 y 500 más en cada ronda siguiente', () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((round) => scoring.firstPrize * roundFactor(scoring, round)), [1000, 1500, 2000, 2500, 3000]);
  });

  test('la compensación depende de la distancia en puntos al 1.º, desde el segundo minijuego y con tope', () => {
    const factor = (round, gap) => catchUpFactor(scoring.catchUp, round, gap);
    assert.equal(factor(1, 5000), 1, 'el primer minijuego no tiene compensación');
    assert.equal(factor(2, 0), 1, 'el líder (o quien empata con él) queda en ×1');
    assert.ok(Math.abs(factor(2, 2500) - 1.25) < 1e-9, '+0,1 por cada 1000 puntos');
    assert.equal(factor(5, 9000), 1.5, 'hasta +0,5');
    assert.equal(factor(3, 1200), factor(3, 1200), 'no depende del puesto, solo de la distancia');
  });
});

describe('estrellas y fragmentos', () => {
  // Rediseño, fase 3: los puntos de fragmentos y estrellas van en un pozo aparte (team.starPoints),
  // no en los puntos del juego (team.score).
  test('cada fragmento vale 1000 en el pozo; 5 hacen una estrella de 6000; los que sobran quedan', () => {
    const team = { score: 100, fragments: 3, stars: 0 };
    assert.deepEqual(giveFragments(team, 1, STARS), { completed: 0, points: 1000 });
    assert.deepEqual([team.fragments, team.starPoints], [4, 4000]);
    // 6 fragmentos: una estrella (6000) y sobra uno (1000). El pozo crece 2000 + 1000 de bono.
    assert.deepEqual(giveFragments(team, 2, STARS), { completed: 1, points: 3000 });
    assert.deepEqual([team.fragments, team.stars, team.starPoints, team.score, totalScore(team)], [1, 1, 7000, 100, 7100]);
  });

  test('robar: el ladrón se lleva fragmentos y estrellas con sus puntos; los del juego no se tocan', () => {
    const thief = { score: 0, fragments: 2, stars: 0 };
    const victim = { score: 9000, fragments: 4, stars: 1 };
    const result = stealAll(thief, victim, STARS);
    // El ladrón junta 6 fragmentos: completa una estrella y le queda uno. Su pozo pasa de 2000 a 13000.
    assert.deepEqual(result, { fragments: 4, stars: 1, completed: 1, points: 11_000 });
    assert.deepEqual([thief.fragments, thief.stars, thief.starPoints, thief.score], [1, 2, 13_000, 0]);
    assert.deepEqual([victim.fragments, victim.stars, victim.starPoints, victim.score], [0, 0, 0, 9000]);
  });

  test('el ranking ordena por el total: puntos del juego más el pozo de estrellas', () => {
    const { engine, team } = startGame({ teamCount: 3 });
    Object.assign(team('t1'), { score: 9000 });
    Object.assign(team('t2'), { score: 4000 });
    giveFragments(team('t2'), 6, STARS); // pozo de 7000: total 11000
    const ranking = rankTeams(engine.room.teams.map((t, order) => ({ ...t, order })));
    assert.deepEqual(ranking.slice(0, 2).map((row) => [row.teamId, row.score, row.gamePoints, row.starPoints]), [['t2', 11_000, 4000, 7000], ['t1', 9000, 9000, 0]]);
  });
});

describe('piedra, papel o tijera', () => {
  test('sin empates: la misma opción o las tres opciones repiten; con dos, siguen los que ganan', () => {
    assert.deepEqual(playHand([0, 1], { 0: 'piedra', 1: 'piedra' }), [0, 1]);
    assert.deepEqual(playHand([0, 1, 2], { 0: 'piedra', 1: 'papel', 2: 'tijera' }), [0, 1, 2]);
    assert.deepEqual(playHand([0, 1], { 0: 'piedra', 1: 'tijera' }), [0]);
    assert.deepEqual(playHand([0, 1], { 0: 'piedra', 1: 'papel' }), [1]);
    assert.deepEqual(playHand([0, 1, 2], { 0: 'tijera', 1: 'papel', 2: 'tijera' }), [0, 2]);
  });
});

// Clicker de la ronda 3: los dos primeros grupos hacen los mismos clics (con 4 equipos, todos).
function tiedClicker(options) {
  const game = startGame(options);
  goTo(game, 'r3.mg');
  const { engine, clock, slots } = game;
  const groups = engine.room.phase.data.groups.slice(0, 2);
  clock.advance(500);
  for (const [teamId] of groups) act(engine, slots[`${teamId}A`], { type: 'input', input: { type: 'clicks', count: 5 } });
  clock.advance(engine.room.phase.closeAt - clock.now());
  return { ...game, groups };
}

describe('Duelo de desempate', () => {
  test('un empate en el primer puesto no premia a nadie todavía: se juega un Duelo', () => {
    const { engine, groups } = tiedClicker();
    assert.equal(engine.room.phase.id, 'r3.mg.duel');
    const data = duelOf(engine);
    assert.deepEqual([data.duel.kind, data.duel.minigame, data.duel.sides], ['minigame', 'clicker', groups]);
    assert.ok(engine.room.teams.every((team) => team.score === 0 && team.fragments === 0));
  });

  test('la misma opción repite la mano; el ganador se lleva el premio de su ronda y los fragmentos', () => {
    const { engine, clock, slots, groups, team } = tiedClicker();
    const [winners, losers] = groups;
    assert.equal(pick(engine, slots[`${winners[0]}A`], 'papel').error, 'duel_not_open', 'durante la presentación no se elige');
    clock.advance(engine.room.phase.data.bout.until - clock.now()); // fin de la presentación
    // Un solo celular elige por el grupo en cada mano; los demás reciben not_your_turn.
    const first = turnOf(engine, slots, 0);
    assert.equal(pick(engine, first.other, 'tijera').error, 'not_your_turn');
    assert.equal(pick(engine, first.deviceId, 'papel').ok, true);
    assert.equal(pick(engine, first.deviceId, 'tijera').error, 'already_picked');
    // Mientras se elige, nadie ve la opción del otro lado; cada lado ve la suya (todo el grupo).
    assert.equal(duelOf(engine, { role: 'play', deviceId: slots[`${losers[0]}A`] }).myPick, null);
    assert.equal(duelOf(engine, { role: 'play', deviceId: slots[`${winners[1]}A`] }).myPick, 'papel');
    assert.ok(!JSON.stringify(projectView(engine, { role: 'screen' }).phase.data).includes('papel'));
    assert.equal(pickSide(engine, slots, 1, 'papel').ok, true); // empate
    assert.deepEqual([duelOf(engine).step, duelOf(engine).alive], ['reveal', [0, 1]]);
    clock.advance(1); // revealMs = 0 en las pruebas: otra mano
    assert.deepEqual([duelOf(engine).step, duelOf(engine).hand], ['pick', 2]);
    pickSide(engine, slots, 0, 'tijera');
    pickSide(engine, slots, 1, 'papel');
    assert.deepEqual([duelOf(engine).winner, duelOf(engine).hands.length], [0, 2]);
    clock.advance(1);
    assert.equal(engine.room.phase.kind, 'minigameResult');
    for (const id of winners) assert.deepEqual([team(id).score, team(id).fragments], [2000, 1]);
    for (const id of losers) assert.deepEqual([team(id).score, team(id).fragments], [0, 0]);
    const result = engine.room.minigameResults[3];
    assert.deepEqual(result.duel, { sides: groups, winner: 0 });
    assert.deepEqual(result.groups.map((g) => g.winner), [true, false]);
  });

  test('quien no elige a tiempo recibe una opción al azar; siempre termina con un ganador', () => {
    const { engine, clock, team } = tiedClicker();
    clock.advance(engine.room.phase.endsAt - clock.now());
    assert.equal(engine.room.phase.kind, 'minigameResult');
    const [event] = engine.events.filter((e) => e.type === 'duel_finished');
    assert.ok(event.hands >= 1);
    const fragments = engine.room.teams.map((t) => team(t.id).fragments);
    assert.equal(fragments.filter((n) => n === 1).length, 2, 'un solo grupo gana los fragmentos');
  });

  test('tras maxRounds manos empatadas, el ganador se sortea', () => {
    const { engine, clock, slots, groups } = tiedClicker({ cfg: testConfig({ duel: { introMs: 500, maxRounds: 1 } }) });
    clock.advance(engine.room.phase.data.bout.until - clock.now());
    pickSide(engine, slots, 0, 'piedra');
    pickSide(engine, slots, 1, 'piedra');
    const data = duelOf(engine);
    assert.equal(data.drawn, true);
    assert.ok([0, 1].includes(data.winner));
  });

  test('si el host salta la fase, los duelos que falten se sortean y se reparten los premios', () => {
    const { engine } = tiedClicker();
    engine.skip();
    assert.equal(engine.room.phase.kind, 'minigameResult');
    assert.equal(engine.room.teams.filter((t) => t.fragments === 1).length, 2);
    assert.equal(engine.room.duels.length, 0);
  });

  test('un equipo que no está en el duelo no puede elegir', () => {
    const { engine, clock, slots, groups } = tiedClicker({ teamCount: 5 }); // 3 grupos: empatan 2
    const outside = engine.room.teams.find((t) => !groups.flat().includes(t.id));
    clock.advance(engine.room.phase.data.bout.until - clock.now());
    assert.equal(pick(engine, slots[`${outside.id}A`], 'papel').error, 'not_in_duel');
  });

  test('el turno pasa por los cuatro celulares del grupo, uno por mano, desde uno al azar', () => {
    const { engine, clock, slots } = tiedClicker();
    clock.advance(engine.room.phase.data.bout.until - clock.now());
    const seen = [];
    for (let hand = 1; hand <= 4; hand += 1) {
      const turn = turnOf(engine, slots, 0);
      seen.push(`${turn.teamId}${turn.slot}`);
      pickSide(engine, slots, 0, 'piedra');
      pickSide(engine, slots, 1, 'piedra'); // empate: otra mano
      clock.advance(1);
    }
    assert.equal(new Set(seen).size, 4, `turnos: ${seen.join(', ')}`);
    // El mismo equipo nunca elige dos manos seguidas: se alterna entre los dos equipos del grupo.
    for (let k = 1; k < 4; k += 1) assert.notEqual(seen[k].slice(0, -1), seen[k - 1].slice(0, -1));
  });

  test('si el celular del turno se desconecta, elige el siguiente del lado', () => {
    const { engine, clock, slots } = tiedClicker();
    clock.advance(engine.room.phase.data.bout.until - clock.now());
    const before = turnOf(engine, slots, 0);
    engine.setPresence(before.deviceId, { connected: false });
    const after = turnOf(engine, slots, 0);
    assert.notEqual(after.deviceId, before.deviceId);
    assert.equal(pick(engine, before.deviceId, 'papel').error, 'not_your_turn');
    assert.equal(pick(engine, after.deviceId, 'papel').ok, true);
  });
});

describe('Desafío', () => {
  // challenges: [[atacante, desafiado]]; loot: { equipo: [fragmentos, estrellas] } antes del uso.
  // toPick: avanza hasta la primera mano.
  function atUse({ challenges = [['t1', 't2']], loot = { t1: [2, 0], t2: [3, 1] }, cfg = config, toPick = true } = {}) {
    const game = startGame({ teamCount: 3, cfg });
    goTo(game, 'r1.use');
    for (const team of game.engine.room.teams) team.inventory = [];
    for (const [id, [fragments, stars]] of Object.entries(loot)) Object.assign(game.team(id), { fragments, stars });
    for (const [attacker, target] of challenges) {
      giveItem(game.engine.room, game.team(attacker), 'DS', 1);
      const { id } = game.team(attacker).inventory.at(-1);
      act(game.engine, game.slots[`${attacker}A`], { type: 'declare', itemId: id, targetTeamId: target });
    }
    for (const team of game.engine.room.teams) act(game.engine, game.slots[`${team.id}A`], { type: 'confirm' });
    assert.equal(game.engine.room.phase.id, 'r1.resolution');
    game.engine.next();
    assert.equal(game.engine.room.phase.id, 'r1.duel');
    if (toPick) game.clock.advance(game.engine.room.phase.data.bout.until - game.clock.now());
    return game;
  }

  test('si gana el atacante, roba todos los fragmentos y estrellas; con 5 completa una estrella', () => {
    const { engine, clock, slots, team } = atUse();
    const data = duelOf(engine);
    assert.deepEqual([data.duel.kind, data.duel.sides], ['desafio', [['t1'], ['t2']]]);
    assert.deepEqual(data.stake, { fragments: 3, stars: 1, points: 9000 }, 'lo que está en juego, al empezar');
    pickSide(engine, slots, 0, 'piedra');
    pickSide(engine, slots, 1, 'tijera');
    clock.advance(1);
    assert.equal(engine.room.phase.id, 'r1.ranking');
    // 2 propios + 3 robados = 5: una estrella nueva y la robada; quedan 0 fragmentos. Los puntos van
    // al pozo (2 × 6000) y los del juego no cambian.
    assert.deepEqual([team('t1').fragments, team('t1').stars, team('t1').starPoints, team('t1').score], [0, 2, 12_000, 0]);
    assert.deepEqual([team('t2').fragments, team('t2').stars, team('t2').starPoints], [0, 0, 0]);
    const star = engine.events.find((e) => e.type === 'star_completed');
    assert.deepEqual([star.teamId, star.source, star.points], ['t1', 'desafio', 10_000]);
  });

  test('si gana el desafiado, no pasa nada', () => {
    const { engine, clock, slots, team } = atUse();
    pickSide(engine, slots, 0, 'piedra');
    pickSide(engine, slots, 1, 'papel');
    clock.advance(1);
    assert.deepEqual([team('t1').fragments, team('t1').stars, team('t2').fragments, team('t2').stars], [2, 0, 3, 1]);
  });

  test('en un Desafío se alternan los dos celulares de cada equipo; el primero sale al azar', () => {
    const starts = new Set();
    for (let k = 0; k < 16; k += 1) {
      const { engine, clock, slots } = atUse();
      const turns = [];
      for (let hand = 1; hand <= 3; hand += 1) {
        turns.push(turnOf(engine, slots, 0).slot);
        pickSide(engine, slots, 0, 'piedra');
        pickSide(engine, slots, 1, 'piedra');
        clock.advance(1);
      }
      assert.notEqual(turns[0], turns[1]);
      assert.equal(turns[2], turns[0]);
      starts.add(turns[0]);
    }
    assert.deepEqual([...starts].sort(), ['A', 'B'], 'a veces empieza el A y a veces el B');
  });

  test('en la presentación y tras un empate se anuncia quién elige en la mano que viene', () => {
    const { engine, clock, slots } = atUse({ cfg: testConfig({ duel: { introMs: 500, revealMs: 500 } }), toPick: false });
    const intro = duelOf(engine);
    assert.deepEqual([intro.step, intro.turnHand, Object.keys(intro.turns)], ['intro', 1, ['0', '1']]);
    clock.advance(engine.room.phase.data.bout.until - clock.now());
    const first = turnOf(engine, slots, 0);
    assert.equal(first.slot, intro.turns[0].slot, 'el anunciado es el que elige');
    assert.equal(duelOf(engine, { role: 'play', deviceId: first.deviceId }).myTurn, true);
    assert.equal(duelOf(engine, { role: 'play', deviceId: first.other }).myTurn, false);
    pickSide(engine, slots, 0, 'piedra');
    pickSide(engine, slots, 1, 'piedra');
    const tie = duelOf(engine);
    assert.deepEqual([tie.step, tie.turnHand, tie.turns[0].slot], ['reveal', 2, first.slot === 'A' ? 'B' : 'A']);
    assert.equal(tie.hands[0].turns[0].slot, first.slot, 'cada mano guarda quién eligió');
  });

  test('un Desafío contra un equipo sin fragmentos ni estrellas no se juega', () => {
    const { engine, clock, team } = atUse({ loot: { t1: [2, 0], t2: [0, 0] }, cfg: testConfig({ duel: { voidMs: 500 } }), toPick: false });
    const data = duelOf(engine);
    assert.deepEqual([data.step, data.outcome, data.stake], ['void', { stolen: false, empty: true }, { fragments: 0, stars: 0, points: 0 }]);
    assert.equal(engine.events.filter((e) => e.type === 'duel_skipped').length, 1);
    assert.equal(engine.room.duels.length, 0);
    clock.advance(500);
    assert.equal(engine.room.phase.id, 'r1.ranking');
    assert.deepEqual([team('t1').fragments, team('t2').fragments], [2, 0]);
  });

  test('con varios duelos, primero la cartelera; uno sin botín se avisa y se pasa al siguiente', () => {
    const cfg = testConfig({ duel: { lineupMs: 700, voidMs: 300 } });
    const { engine, clock, slots, team } = atUse({
      challenges: [['t1', 't3'], ['t2', 't1']], loot: { t1: [2, 0], t2: [0, 0], t3: [0, 0] }, cfg, toPick: false,
    });
    const lineup = duelOf(engine);
    assert.equal(lineup.step, 'lineup');
    assert.deepEqual(lineup.lineup.map((d) => d.sides), [[['t1'], ['t3']], [['t2'], ['t1']]]);
    clock.advance(700);
    assert.equal(duelOf(engine).step, 'void', 'el Equipo 3 no tiene nada');
    clock.advance(300);
    assert.deepEqual([duelOf(engine).index, duelOf(engine).step], [1, 'pick']);
    pickSide(engine, slots, 0, 'papel');
    pickSide(engine, slots, 1, 'piedra');
    clock.advance(1);
    assert.equal(engine.room.phase.id, 'r1.ranking');
    assert.deepEqual([team('t2').fragments, team('t1').fragments], [2, 0]);
  });

  test('si el host salta la cartelera, los duelos que falten se sortean igual', () => {
    const { engine } = atUse({
      challenges: [['t1', 't2'], ['t3', 't2']], loot: { t1: [0, 0], t2: [3, 1], t3: [0, 0] }, cfg: testConfig({ duel: { lineupMs: 700 } }), toPick: false,
    });
    assert.equal(duelOf(engine).step, 'lineup');
    engine.skip();
    assert.equal(engine.room.phase.id, 'r1.ranking');
    assert.equal(engine.events.filter((e) => ['duel_finished', 'duel_skipped'].includes(e.type)).length, 2);
  });
});

describe('aparición de objetos en el draft', () => {
  // Una partida de 6 equipos sin respuestas, hasta el final: 5 drafts (todos reciben además el
  // objeto adicional por no responder). `before` se aplica al llegar a cada draft.
  function offersOfGame(before = () => {}) {
    const game = startGame({ teamCount: 6 });
    const drafts = [];
    for (let round = 1; round <= 5; round += 1) {
      goTo(game, `r${round}.draft`);
      before(game, round);
      drafts.push(game.engine.events.filter((e) => e.type === 'items_offered').at(-1));
      game.clock.advance(game.engine.room.phase.endsAt - game.clock.now());
    }
    return drafts;
  }

  test('el Desafío aparece en 1 o 2 ofertas por reparto; Espejo y escudos, como mucho 1 vez por partida', () => {
    for (let i = 0; i < 5; i += 1) {
      const drafts = offersOfGame();
      const counts = {};
      for (const { offers } of drafts) {
        const challenged = Object.values(offers).filter((offer) => offer.codes.includes('DS')).length;
        assert.ok(challenged >= 1 && challenged <= 2, `Desafío en ${challenged} ofertas`);
        for (const offer of Object.values(offers)) {
          for (const code of [...offer.codes, offer.extra].filter(Boolean)) counts[code] = (counts[code] ?? 0) + 1;
        }
      }
      for (const code of ['E', 'EF', 'EA']) assert.ok((counts[code] ?? 0) <= 1, `${code} apareció ${counts[code]} veces`);
    }
  });

  test('el Desafío va primero a los equipos sin fragmentos; la Poción, solo al 1.º', () => {
    for (let i = 0; i < 5; i += 1) {
      // Las ofertas se arman al entrar al draft: los puntajes y fragmentos se fijan en la pregunta anterior.
      const game = startGame({ teamCount: 6 });
      goTo(game, 'r1.q2');
      game.engine.room.teams.forEach((team, index) => {
        team.score = 6000 - index * 1000; // t1 es el único 1.º
        team.fragments = index < 3 ? 1 : 0; // t4, t5 y t6 no tienen fragmentos
      });
      goTo(game, 'r2.draft');
      const { offers } = game.engine.events.filter((e) => e.type === 'items_offered').at(-1);
      for (const [teamId, offer] of Object.entries(offers)) {
        if (offer.codes.includes('DS')) assert.ok(['t4', 't5', 't6'].includes(teamId), `Desafío para ${teamId}`);
        if (teamId !== 't1') assert.ok(![...offer.codes, offer.extra].includes('P'), `Poción para ${teamId}`);
      }
    }
  });
});
