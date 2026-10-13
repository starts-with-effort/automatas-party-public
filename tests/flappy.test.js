// Flappy (RF-MJ4): física compartida, verificación en el servidor y premios por llegada.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HEIGHT, TICK_MS, generateLevel, initialState, simulate, step } from '../client/shared/flappy-physics.js';
import { shouldFlap } from '../scripts/lib/flappy-autopilot.js';
import { GameEngine } from '../server/core/GameEngine.js';
import { loadConfig } from '../server/core/config.js';
import { projectView } from '../server/core/ViewProjector.js';
import { createRng } from '../server/domain/random.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

const SETTINGS = loadConfig().minigameRules.flappy;

// Vuelo completo con el piloto automático: aleteos y estado final.
function flight(level, { quitAt = Infinity } = {}) {
  const s = initialState(level);
  const flaps = [];
  while (s.status === 'playing') {
    const flap = s.tick < quitAt && shouldFlap(level, s);
    if (flap) flaps.push(s.tick);
    step(level, s, flap);
  }
  return { flaps, final: s };
}

describe('física', () => {
  test('el nivel de 60 s se genera con semilla y tiene tubos hasta cerca de la meta', () => {
    const level = generateLevel(SETTINGS, createRng(7));
    assert.deepEqual(generateLevel(SETTINGS, createRng(7)), level);
    assert.notDeepEqual(generateLevel(SETTINGS, createRng(8)).pipes, level.pipes);
    assert.equal(level.ticks, 3600);
    assert.ok(level.pipes.length >= 25);
    assert.ok(level.pipes.at(-1).x < level.length);
  });

  test('la apertura se angosta rápido al principio y despacio al final, sin bajar de gapMin', () => {
    const gaps = generateLevel(SETTINGS, createRng(7)).pipes.map((pipe) => pipe.gap);
    const n = gaps.length;
    assert.equal(gaps[0], SETTINGS.gapStart);
    assert.equal(gaps[n - 1], SETTINGS.gapEnd, 'el último tubo no es estrecho');
    assert.ok(gaps.every((gap) => gap >= SETTINGS.gapMin));
    // Tubos estrechos: desde narrowFrom, uno de cada tres contando hacia atrás desde el penúltimo.
    const narrow = gaps.map((_, i) => i / (n - 1) >= SETTINGS.narrowFrom && (n - 1 - i) % 3 === 1);
    assert.ok(narrow.filter(Boolean).length >= 3);
    narrow.forEach((isNarrow, i) => {
      if (isNarrow) assert.ok(gaps[i] < gaps[i - 1] && gaps[i] < gaps[i + 1], `tubo ${i + 1}`);
    });
    // Sin contar los estrechos, la apertura nunca crece y cae más en la primera mitad que en la segunda.
    const plain = gaps.filter((_, i) => !narrow[i]);
    assert.ok(plain.every((gap, i) => i === 0 || gap <= plain[i - 1]));
    const half = Math.floor(n / 2);
    assert.ok(gaps[0] - gaps[half] > 2 * (gaps[half] - gaps[n - 1]));
  });

  test('es determinista: los mismos aleteos dan el mismo resultado, también tras pasar por JSON', () => {
    const level = generateLevel(SETTINGS, createRng(3));
    const { flaps, final } = flight(level);
    const again = simulate(JSON.parse(JSON.stringify(level)), initialState(level), flaps, Infinity);
    assert.deepEqual(again, final);
  });

  test('simular por partes (como llegan los informes) da lo mismo que de una vez', () => {
    const level = generateLevel(SETTINGS, createRng(4));
    const { flaps, final } = flight(level);
    const s = initialState(level);
    for (let until = 12; s.status === 'playing'; until += 12) {
      simulate(level, s, flaps.filter((tick) => tick >= s.tick && tick < until), until);
    }
    assert.deepEqual(s, final);
  });

  test('sin aletear cae al suelo; aleteando siempre choca con el techo', () => {
    const level = generateLevel(SETTINGS, createRng(1));
    const falling = simulate(level, initialState(level), [], 1000);
    assert.equal(falling.status, 'crashed');
    assert.ok(falling.y > HEIGHT / 2 && falling.tick < 60);
    const always = Array.from({ length: 1000 }, (_, tick) => tick);
    const rising = simulate(level, initialState(level), always, 1000);
    assert.equal(rising.status, 'crashed');
    assert.ok(rising.y < HEIGHT / 2);
  });

  test('los niveles se pueden completar: el piloto automático llega en 200 semillas', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const level = generateLevel(SETTINGS, createRng(seed));
      const { final } = flight(level);
      assert.equal(final.status, 'arrived', `semilla ${seed}`);
      assert.equal(final.tick, level.ticks);
    }
  });

  test('con 2 vidas, el primer choque quita una y deja seguir', () => {
    const level = generateLevel({ ...SETTINGS, lives: 2 }, createRng(1));
    const s = simulate(level, initialState(level), [], 60);
    assert.equal(s.status, 'playing');
    assert.equal(s.lives, 1);
    assert.ok(s.safeUntil > s.tick);
  });
});

// Partida en el minijuego de la ronda 4 (Flappy) con equipos llenos y conectados.
function atFlappy({ teamCount = 2, config = testConfig() } = {}) {
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
  while (engine.room.phase.id !== 'r4.mg') {
    const { phase } = engine.room;
    if (phase.waitingHost) engine.next();
    else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
  }
  const { level } = engine.room.phase.data.state;
  const fly = (deviceId, tick, flaps) => engine.action(deviceId, { type: 'input', input: { type: 'fly', tick, flaps } });
  // Juega como un celular: cada 200 ms informa hasta dónde llegó, con los aleteos aún sin confirmar.
  const play = (deviceIds, { quitAt } = {}) => {
    const runs = deviceIds.map((deviceId) => ({ deviceId, ...flight(level, { quitAt }), acked: 0 }));
    for (let tick = 12; runs.some((run) => run.acked < run.final.tick); tick += 12) {
      clock.advance(200);
      for (const run of runs) {
        if (run.acked >= run.final.tick) continue;
        const upTo = Math.min(tick, run.final.tick);
        const res = fly(run.deviceId, upTo, run.flaps.filter((t) => t >= run.acked && t < upTo));
        assert.equal(res.ok, true, res.error);
        run.acked = res.tick;
      }
    }
  };
  const team = (id) => engine.room.teams.find((t) => t.id === id);
  return { engine, clock, slots, level, fly, play, team };
}

const gameView = (engine, viewer) => projectView(engine, viewer).phase.data.game;

describe('Flappy en la partida', () => {
  test('la ronda 4 es el Flappy y todos los celulares juegan el mismo nivel', () => {
    const { engine, slots } = atFlappy();
    assert.equal(engine.room.phase.minigame, 'flappy');
    const a = gameView(engine, { role: 'play', deviceId: slots.t1A });
    const b = gameView(engine, { role: 'play', deviceId: slots.t2B });
    assert.ok(a.level.pipes.length > 0);
    assert.deepEqual(a.level, b.level);
  });

  test('el proyector ve el avance de los 4 jugadores y no recibe el nivel', () => {
    const { engine } = atFlappy();
    const screen = gameView(engine, { role: 'screen' });
    assert.equal(screen.players.length, 4);
    assert.equal(screen.level, undefined);
  });

  test('premio por jugador que llega (500 × 2,5 en la ronda 4); el fragmento, al equipo con más llegadas', () => {
    const { engine, slots, play, team } = atFlappy();
    play([slots.t1A, slots.t2A, slots.t2B]);
    play([slots.t1B], { quitAt: 0 }); // deja de aletear: choca
    assert.equal(engine.room.phase.kind, 'minigameResult', 'terminan todos: no espera al plazo');
    assert.deepEqual([team('t1').score, team('t2').score], [1250, 2500]);
    assert.deepEqual([team('t1').fragments, team('t2').fragments], [0, 1]);
    const result = projectView(engine, { role: 'screen' }).phase.data;
    assert.deepEqual(result.groups.map((g) => g.label), ['Llegó 1 de 2', 'Llegaron 2 de 2']);
  });

  test('lo que cuenta es la re-simulación del servidor, no lo que diga el celular', () => {
    const { engine, clock, slots, fly, level } = atFlappy();
    clock.advance(level.ticks * TICK_MS);
    const res = fly(slots.t1A, level.ticks, []); // "llegué", pero sin aletear nunca
    assert.equal(res.status, 'crashed');
    assert.ok(res.x < level.pipes[0].x, `cayó en x = ${res.x}, antes del primer tubo`);
    assert.equal(gameView(engine, { role: 'play', deviceId: slots.t1A }).me.status, 'crashed');
  });

  test('no puede avanzar más rápido que el reloj (RF-MJ4-06)', () => {
    const { clock, slots, fly, level } = atFlappy();
    clock.advance(200);
    const res = fly(slots.t1A, level.ticks, flight(level).flaps);
    assert.equal(res.error, 'implausible_progress');
  });

  test('aleteos desordenados o posteriores al tick informado se rechazan', () => {
    const { clock, slots, fly } = atFlappy();
    clock.advance(500);
    assert.equal(fly(slots.t1A, 20, [5, 3]).error, 'invalid_input');
    assert.equal(fly(slots.t1A, 20, [20]).error, 'invalid_input');
  });

  test('un informe repetido o viejo no cambia nada', () => {
    const { engine, clock, slots, fly, level } = atFlappy();
    const { flaps } = flight(level);
    clock.advance(1000);
    const first = fly(slots.t1A, 40, flaps.filter((t) => t < 40));
    assert.deepEqual(fly(slots.t1A, 40, flaps.filter((t) => t < 40)), first);
    assert.deepEqual(fly(slots.t1A, 30, []), first);
    // Repetir aleteos ya confirmados junto con los nuevos no los aplica dos veces.
    fly(slots.t1A, 50, flaps.filter((t) => t < 50));
    const sim = engine.room.phase.data.state.players['t1:A'].sim;
    assert.deepEqual(sim, simulate(level, initialState(level), flaps, 50));
  });

  test('al recargar la página, el celular recibe el estado de su pájaro', () => {
    const { engine, clock, slots, fly, level } = atFlappy();
    const { flaps } = flight(level);
    clock.advance(1000);
    fly(slots.t1A, 40, flaps.filter((t) => t < 40));
    const { me } = gameView(engine, { role: 'play', deviceId: slots.t1A });
    assert.deepEqual(me, simulate(level, initialState(level), flaps, 40));
    assert.equal(gameView(engine, { role: 'play', deviceId: slots.t1B }).me, null);
  });

  test('la pausa no cuenta como tiempo de vuelo', () => {
    const { engine, clock, slots, fly, level } = atFlappy();
    engine.pause();
    clock.advance(60_000);
    engine.resume();
    clock.advance(100);
    assert.equal(fly(slots.t1A, 120, flight(level).flaps.filter((t) => t < 120)).error, 'implausible_progress');
  });

  test('quien no llega antes del plazo no gana nada', () => {
    const { engine, clock, team } = atFlappy();
    clock.advance(10_000);
    assert.equal(engine.room.phase.kind, 'minigameResult');
    assert.deepEqual([team('t1').score, team('t2').score], [0, 0]);
  });
});
