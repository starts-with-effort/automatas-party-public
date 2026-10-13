// Arena: jefes y retadores, posiciones validadas, disparos, impactos, reaparición, premios, cajas de
// poder, poderes y estados del jefe.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TICK_MS, angleOf, tickAt, ticksOf } from '../client/shared/arena-physics.js';
import { GameEngine } from '../server/core/GameEngine.js';
import { loadConfig } from '../server/core/config.js';
import { projectView } from '../server/core/ViewProjector.js';
import { bossHp, pickBosses } from '../server/minigames/arena.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

const RULES = loadConfig().minigameRules.arena; // reglas reales: 75 s, oleadas a los 8, 25, 42 y 58 s…
const UP = angleOf(-Math.PI / 2);
const DOWN = angleOf(Math.PI / 2);
const teamsWith = (...scores) => scores.map((score, order) => ({ id: `t${order + 1}`, score, order }));
const bossIds = (scores) => pickBosses(teamsWith(...scores), 2000).map((team) => team.id);

describe('quién es jefe', () => {
  test('si el 1.º le saca 2000 al 2.º, es jefe solo el 1.º', () => {
    assert.deepEqual(bossIds([6000, 4000, 3900]), ['t1']);
  });

  test('si no, pero el 2.º le saca 2000 al 3.º, son jefes el 1.º y el 2.º', () => {
    assert.deepEqual(bossIds([6000, 5000, 3000]), ['t1', 't2']);
  });

  test('en cualquier otro caso, solo el 1.º', () => {
    assert.deepEqual(bossIds([6000, 5000, 4000]), ['t1']);
    assert.deepEqual(bossIds([6000, 5000]), ['t1']);
  });

  test('los empatados con el líder también son jefes, pero siempre queda un retador', () => {
    assert.deepEqual(bossIds([5000, 5000, 1000]), ['t1', 't2']);
    assert.deepEqual(bossIds([0, 0, 0]), ['t1']);
  });
});

// Partida en la Arena de la ronda 5 con 3 equipos llenos; los puntajes se fijan antes de formar los
// grupos. Por defecto t1 lidera por más de 2000 y es el único jefe (sus dos vehículos).
function atArena({ scores = [6000, 3000, 1000], rules = {} } = {}) {
  const clock = createFakeClock();
  const config = testConfig({ minigameRules: { arena: { ...RULES, ...rules } } });
  const engine = new GameEngine({ config, clock, logger: silentLogger });
  engine.createRoom({ teamCount: scores.length });
  const devices = {};
  for (const team of engine.room.teams) {
    for (const slot of ['A', 'B']) {
      const { deviceId } = engine.registerDevice();
      engine.join(deviceId, team.id);
      engine.setPresence(deviceId, { connected: true });
      devices[`${team.id}${slot}`] = deviceId;
    }
  }
  engine.start();
  const advanceTo = (id) => {
    while (engine.room.phase.id !== id) {
      const { phase } = engine.room;
      if (phase.waitingHost) engine.next();
      else clock.advance((phase.closeAt ?? phase.endsAt) - clock.now());
    }
  };
  advanceTo('r5.roulette');
  engine.room.teams.forEach((team, i) => {
    team.score = scores[i];
    team.streak = 0;
  });
  advanceTo('r5.mg');
  const frames = [];
  engine.on('frame', (frame) => frames.push(frame));
  const state = () => engine.room.phase.data.state;
  const vehicle = (teamId, slot) => state().vehicles.find((v) => v.teamId === teamId && v.slot === slot);
  const nowTick = () => tickAt(clock.now(), engine.room.phase.playStartsAt);
  // Lleva el reloj hasta el tick `tick` (los fotogramas corren solos con el reloj falso).
  const toTick = (tick) => clock.advance(Math.max(0, engine.room.phase.playStartsAt + tick * TICK_MS - clock.now()) + 1);
  // Lo que informa el celular: `hold` repite la posición actual hasta ese tick; `pos` son posiciones
  // desde el tick siguiente al último conocido.
  const drive = (teamId, slot, { hold = null, pos = null, shots = [], life = null, from = null } = {}) => {
    const v = vehicle(teamId, slot);
    const first = from ?? v.tick + 1;
    const list = pos ?? (hold === null ? [] : Array.from({ length: Math.max(0, hold - v.tick) }, () => [Math.round(v.x), Math.round(v.y)]).flat());
    return engine.action(devices[`${teamId}${slot}`], {
      type: 'input',
      input: { type: 'drive', life: life ?? v.life, from: first, pos: list, f: 0, shots },
    });
  };
  // Pone un vehículo en un lugar (preparación de la prueba, sin pasar por el celular).
  const place = (teamId, slot, x, y) => Object.assign(vehicle(teamId, slot), { x, y, hist: [[vehicle(teamId, slot).tick, x, y]] });
  const team = (id) => engine.room.teams.find((t) => t.id === id);
  return { engine, clock, devices, frames, state, vehicle, nowTick, toTick, drive, place, team };
}

const gameView = (engine, viewer) => projectView(engine, viewer).phase.data.game;

describe('la Arena en la partida', () => {
  test('la ronda 5 es la Arena: el líder es el jefe y hay un vehículo por celular', () => {
    const { engine, devices, state } = atArena();
    assert.equal(engine.room.phase.minigame, 'arena');
    assert.deepEqual(engine.room.phase.data.groups, [['t1'], ['t2', 't3']]);
    const { vehicles } = state();
    assert.equal(vehicles.length, 6);
    const bosses = vehicles.filter((v) => v.boss);
    assert.deepEqual(bosses.map((v) => `${v.teamId}${v.slot}`), ['t1A', 't1B']);
    // 4 retadores conectados contra 2 vehículos jefe: 42 × 4 × (1 ÷ (1 + 1,5 × 2 ÷ 4)) ÷ 2 = 48 cada uno.
    assert.ok(bosses.every((v) => v.hp === bossHp(RULES.boss, 4, 2) && v.radius === RULES.boss.radius));
    assert.ok(bosses.every((v) => Math.hypot(v.x - 1500, v.y - 1500) < 300), 'los jefes empiezan en el centro');
    const challengers = vehicles.filter((v) => !v.boss);
    assert.ok(challengers.every((v) => v.hp === RULES.challenger.hp && Math.hypot(v.x - 1500, v.y - 1500) > 1000));
    assert.equal(new Set(challengers.map((v) => `${v.x},${v.y}`)).size, 4, 'cada retador en su punto de aparición');

    const mine = gameView(engine, { role: 'play', deviceId: devices.t2B });
    assert.deepEqual([mine.role, vehicles[mine.me].teamId, vehicles[mine.me].slot], ['challenger', 't2', 'B']);
    assert.equal(gameView(engine, { role: 'play', deviceId: devices.t1A }).role, 'boss');
    const screen = gameView(engine, { role: 'screen' });
    assert.equal(screen.me, undefined);
    assert.equal(screen.obstacles.length, 20);
    assert.deepEqual(screen.vehicles.map((v) => v.boss), [true, true, false, false, false, false]);
  });

  test('el celular informa su posición: se acepta, se limita a la velocidad máxima y se saca de los obstáculos', () => {
    const { vehicle, drive, place, toTick } = atArena();
    toTick(5);
    place('t2', 'A', 590, 380); // justo sobre la L de la esquina (y = 420)
    assert.equal(drive('t2', 'A', { pos: [590, 390] }).fix, undefined, 'una posición válida se acepta tal cual');
    assert.deepEqual([vehicle('t2', 'A').x, vehicle('t2', 'A').y], [590, 390]);
    const inside = drive('t2', 'A', { pos: [590, 398] });
    assert.ok(inside.fix && inside.fix.y < 398, 'dentro del obstáculo: la saca');
    const before = { ...vehicle('t2', 'A') };
    const jump = drive('t2', 'A', { pos: [before.x - 300, before.y] });
    assert.ok(jump.fix, 'demasiado rápido: la corrige');
    assert.ok(before.x - vehicle('t2', 'A').x < 25, 'solo avanza lo que se puede en un tick');
  });

  test('posiciones del futuro, mal formadas o de otra vida no cuentan', () => {
    const { drive, vehicle, nowTick } = atArena();
    assert.equal(drive('t2', 'A', { from: nowTick() + 30, pos: [100, 100] }).error, 'implausible_progress');
    assert.equal(drive('t2', 'A', { pos: [100] }).error, 'invalid_input');
    const res = drive('t2', 'A', { life: 7, pos: [200, 200] });
    assert.deepEqual([res.ok, res.life], [true, 1]);
    assert.equal(vehicle('t2', 'A').tick, 0);
  });

  test('un golpe al jefe le quita 1 de vida y cuenta para quien disparó; no hay fuego amigo', () => {
    const { vehicle, drive, place, toTick, frames } = atArena();
    place('t2', 'A', 1500, 900); // arriba del jefe A (1500, 1320)
    place('t3', 'A', 1500, 1050); // otro retador en medio: la bala lo atraviesa
    toTick(3);
    assert.equal(drive('t2', 'A', { hold: 3, shots: [[3, DOWN]] }).ok, true);
    toTick(40);
    const boss = vehicle('t1', 'A');
    assert.equal(boss.hp, boss.maxHp - 1);
    assert.equal(vehicle('t2', 'A').damage, 1);
    assert.equal(vehicle('t3', 'A').hp, RULES.challenger.hp);
    const hit = frames.flatMap((frame) => frame.h).find((row) => row[0] === vehicle('t2', 'A').idx);
    assert.deepEqual([hit[3], hit[5]], [boss.idx, 1], 'el fotograma avisa el impacto');
  });

  test('cada vehículo dispara a su cadencia', () => {
    const { state, vehicle, drive, toTick } = atArena();
    const fireTicks = ticksOf(RULES.challenger.fireMs);
    toTick(fireTicks + 5);
    drive('t2', 'A', { hold: fireTicks + 4, shots: [[2, UP], [4, UP], [2 + fireTicks, UP]] });
    const owner = vehicle('t2', 'A').idx;
    assert.deepEqual(state().bullets.filter((b) => b.owner === owner).map((b) => b.tick0), [2, 2 + fireTicks]);
  });

  test('un retador destruido vuelve a los 3 s con vida completa, escudo y una vida nueva', () => {
    const { vehicle, drive, place, toTick } = atArena();
    place('t2', 'A', 1500, 1000); // arriba del jefe A
    const every = ticksOf(RULES.boss.fireMs);
    for (const shot of [2, 2 + every, 2 + 2 * every]) {
      toTick(shot);
      drive('t1', 'A', { hold: shot, shots: [[shot, UP]] });
    }
    toTick(2 + 2 * every + 30);
    const down = vehicle('t2', 'A');
    assert.deepEqual([down.status, down.deaths, vehicle('t1', 'A').kills], ['dead', 1, 1]);
    assert.equal(drive('t2', 'A', { pos: [1500, 1000] }).status, 'dead', 'su celular se entera en la respuesta');

    toTick(down.respawnTick + 20);
    const back = vehicle('t2', 'A');
    assert.deepEqual([back.status, back.life, back.hp], ['alive', 2, RULES.challenger.hp]);
    assert.ok(back.shieldUntil > back.aliveFrom);
    assert.ok(Math.hypot(back.x - 1500, back.y - 1500) > 1000, 'reaparece lejos del jefe');
    const stale = drive('t2', 'A', { life: 1, pos: [back.x + 5, back.y] });
    assert.deepEqual([stale.life, vehicle('t2', 'A').x], [2, back.x], 'lo de la vida anterior no cuenta');
  });

  test('el escudo de reaparición absorbe los golpes', () => {
    const { vehicle, drive, place, toTick, frames } = atArena();
    place('t2', 'A', 1500, 1000);
    vehicle('t2', 'A').shieldUntil = 1000;
    toTick(2);
    drive('t1', 'A', { hold: 2, shots: [[2, UP]] });
    toTick(40);
    const target = vehicle('t2', 'A').idx;
    assert.equal(vehicle('t2', 'A').hp, RULES.challenger.hp);
    assert.ok(frames.flatMap((frame) => frame.h).some((row) => row[3] === target && row[5] === 0), 'el golpe se ve, pero no quita vida');
    assert.equal(vehicle('t1', 'A').damage, 0);
  });

  // Premios: los de game.json son de la ronda 1; la Arena es la ronda 5 (×3) y cada equipo tiene
  // además su compensación por ir atrás (+0,1 por cada 1000 puntos detrás del líder, hasta +0,5).
  test('si derriban al jefe termina antes: cada retador que le dio suma golpes + bono, escalados', () => {
    const { engine, vehicle, drive, place, toTick, team } = atArena();
    vehicle('t1', 'A').hp = 1;
    vehicle('t1', 'B').hp = 1;
    place('t2', 'A', 1500, 900); // dispara hacia abajo al jefe A (1500, 1320)
    place('t2', 'B', 1500, 2100); // dispara hacia arriba al jefe B (1500, 1680)
    toTick(3);
    drive('t2', 'A', { hold: 3, shots: [[3, DOWN]] });
    drive('t2', 'B', { hold: 3, shots: [[3, UP]] });
    toTick(40);
    assert.equal(engine.room.phase.kind, 'minigameResult', 'sin jefes en pie, el minijuego cierra');
    const result = engine.room.minigameResults[5];
    assert.equal(result.headline, '¡Vaciaron la pila del jefe!');
    // t2: 2 golpes × 10 + 300 de bono = 320, ×3 por la ronda y ×1,3 por ir 3000 detrás del líder.
    const [award] = result.awards;
    assert.deepEqual([result.awards.length, award.teamId, award.base, award.points], [1, 't2', 320, 1248]);
    assert.ok(Math.abs(award.catchUp - 1.3) < 1e-9);
    assert.equal(team('t2').score, 3000 + 1248);
    assert.equal(team('t1').streak, 0);
    // El fragmento es para quien más daño hizo: t2, el único que acertó.
    assert.deepEqual(result.fragments.map((f) => f.teamId), ['t2']);
    assert.equal(team('t2').fragments, 1);
    const summary = engine.events.find((e) => e.type === 'arena_summary');
    assert.deepEqual([summary.challengers, summary.bossVehicles, summary.bossHp], [4, 2, 0]);
    assert.ok(summary.downAtMs > 0 && summary.downAtMs < 2000, 'el resumen dice cuándo cayó el jefe');
  });

  test('si el jefe resiste: premio y +3 de racha, más 25 por derribo; los retadores suman sus golpes', () => {
    const { engine, drive, place, toTick, team } = atArena({ rules: { durationMs: 5000 } });
    place('t3', 'A', 1500, 900);
    toTick(3);
    drive('t3', 'A', { hold: 3, shots: [[3, DOWN]] });
    toTick(Math.ceil(5000 / TICK_MS) + 20);
    assert.equal(engine.room.phase.kind, 'minigameResult');
    const result = engine.room.minigameResults[5];
    assert.equal(result.headline, 'El jefe resistió');
    assert.deepEqual(result.awards.map(({ teamId, base, points, streak, catchUp }) => [teamId, base, points, streak, catchUp]), [
      ['t1', 500, 1500, 3, 1], // el líder: 500 × 3, sin compensación
      ['t3', 10, 45, 0, 1.5], // 1 golpe × 10 × 3 × 1,5 (va 5000 detrás: el tope)
    ]);
    assert.deepEqual(result.fragments.map((f) => f.teamId), ['t3']);
    assert.equal(team('t1').streak, 3);
    assert.ok(result.groups.some((row) => row.teamIds[0] === 't2' && row.score === 0), 't2 aparece aunque no sumó');
    const summary = engine.events.find((e) => e.type === 'arena_summary');
    const max = 2 * bossHp(RULES.boss, 4, 2);
    assert.deepEqual([summary.bossHp, summary.bossMaxHp, summary.downAtMs], [max - 1, max, null], 'resistió con un golpe menos');
  });

  test('un celular atrasado no detiene los impactos más de maxLagMs', () => {
    const { state, toTick, nowTick } = atArena();
    toTick(90);
    assert.ok(state().resolved >= nowTick() - ticksOf(RULES.maxLagMs) - 2, 'nadie informó, pero se avanza');
    assert.ok(state().resolved <= nowTick());
  });

  test('la pausa congela el tiempo de la Arena', () => {
    const { engine, clock, toTick, nowTick, frames } = atArena();
    toTick(30);
    engine.pause();
    const count = frames.length;
    clock.advance(5000);
    assert.equal(frames.length, count, 'en pausa no salen fotogramas');
    engine.resume();
    assert.equal(nowTick(), 30);
  });

  test('los fotogramas llevan el estado de cada vehículo, el número de la fase y la hora', () => {
    const { engine, clock, toTick, frames } = atArena();
    toTick(10);
    assert.ok(frames.length >= 5);
    const last = frames.at(-1);
    assert.equal(last.seq, engine.room.phase.seq);
    assert.ok(Math.abs(last.t - clock.now()) < 60, 'lleva la hora del servidor');
    assert.equal(last.v.length, 6);
    assert.equal(last.v[0].length, 15);
    assert.ok(last.n >= 9 && last.r <= last.n);
    assert.deepEqual([last.p.length, last.w], [8, [0, 0]], 'ocho cajas, vacías hasta la primera oleada');
  });
});

describe('vida del jefe', () => {
  const rules = { hpPerChallenger: 42, pressure: 1.5, minHp: 10 };

  test('crece con los retadores y se corrige por cuántos jefes hay por retador', () => {
    assert.equal(bossHp(rules, 12, 2), 202); // 42 × 12 × 0,8 ÷ 2
    assert.equal(bossHp(rules, 14, 2), 242);
    assert.equal(bossHp(rules, 12, 1), 448);
    assert.equal(bossHp(rules, 10, 4), 66);
  });

  test('con pocos retadores por jefe baja (en 2 contra 2 el jefe era casi imposible) y nunca de minHp', () => {
    assert.equal(bossHp(rules, 2, 2), 17);
    assert.equal(bossHp({ ...rules, minHp: 20 }, 2, 2), 20);
    assert.equal(bossHp(rules, 0, 1), 17, 'sin retadores conectados se cuenta uno');
  });

  test('con pressure 0 es la regla anterior: hpPerChallenger por retador, repartida entre los jefes', () => {
    assert.equal(bossHp({ ...rules, hpPerChallenger: 20, pressure: 0 }, 12, 2), 120);
  });
});

// Un poder dado a mano (preparación de la prueba): dura hasta el tick 5000.
// Sin celulares que informen, los impactos y las cajas se deciden hasta maxLagMs atrás: LAG de margen.
const LAG = ticksOf(RULES.maxLagMs) + 2;
const give = (v, id, charges = 0) => Object.assign(v, { power: { id, from: 0, until: 5000, charges } });

describe('cajas de poder', () => {
  test('cada oleada llena los ocho puntos con un poder del grupo de ese punto; el retador que pasa se lo lleva', () => {
    const { state, vehicle, place, toTick, frames, engine } = atArena();
    const first = state().waves[0];
    assert.equal(first, ticksOf(RULES.powers.waves[0]));
    const [axis, corner] = state().pads;
    assert.deepEqual([axis.ring, axis.x, axis.y, corner.ring, corner.x, corner.y], ['axis', 1500, 960, 'corner', 290, 290]);
    place('t2', 'A', axis.x, axis.y + 30);
    give(vehicle('t2', 'A'), 'shield', 2); // lo tenía: el nuevo lo reemplaza
    toTick(first - 1);
    assert.ok(state().pads.every((pad) => pad.power === null), 'antes de la oleada no hay cajas');
    toTick(first + LAG);
    const wave = engine.events.find((e) => e.type === 'arena_wave');
    assert.deepEqual([wave.wave, wave.strong, wave.tick], [1, false, first]);
    state().pads.forEach((pad, i) => {
      if (i === 0) return;
      assert.ok(RULES.powers.pools[pad.ring].includes(pad.power), `la caja ${i} trae un poder de su grupo`);
    });
    const mine = vehicle('t2', 'A').power;
    assert.deepEqual([mine.id, mine.from, mine.until], [wave.powers[0], first, first + ticksOf(RULES.powers[mine.id].ms)]);
    assert.equal(state().pads[0].power, null, 'la caja tomada queda vacía');
    const got = engine.events.find((e) => e.type === 'arena_power');
    assert.deepEqual([got.teamId, got.slot, got.pad, got.power], ['t2', 'A', 0, mine.id]);
    const last = frames.at(-1);
    assert.equal(last.p[0], 0);
    assert.ok(last.p.slice(1).every((code) => code > 0));
    assert.deepEqual(last.w, [1, 0]);
    assert.equal(last.v[vehicle('t2', 'A').idx][10], ['freeze', 'blast', 'double', 'fan', 'shield', 'turbo'].indexOf(mine.id) + 1);
  });

  test('el jefe aplasta la caja que pisa: no se lleva el poder', () => {
    const { state, vehicle, place, toTick, engine } = atArena();
    const pad = state().pads[2]; // eje derecho
    place('t1', 'B', pad.x, pad.y);
    toTick(state().waves[0] + LAG);
    assert.equal(state().pads[2].power, null);
    assert.equal(vehicle('t1', 'B').power, null);
    assert.equal(engine.events.find((e) => e.type === 'arena_crushed').pad, 2);
  });

  test('una caja que nadie toma se reemplaza en la oleada siguiente', () => {
    const { state, toTick } = atArena();
    state().waves = [2, 30, 100, 200];
    toTick(2 + LAG);
    const before = state().rng;
    toTick(30 + LAG);
    assert.notEqual(state().rng, before, 'la segunda oleada vuelve a sortear');
    assert.ok(state().pads.every((pad) => pad.power !== null));
    assert.equal(state().wave, 2);
  });

  test('última oleada: si los jefes conservan más de la mitad de su vida, todos los puntos traen poderes fuertes', () => {
    const strong = atArena();
    strong.state().waves = [2, 3, 4, 5];
    strong.toTick(5 + LAG);
    assert.ok(strong.state().strong);
    assert.ok(strong.state().pads.every((pad) => RULES.powers.pools.axis.includes(pad.power)));

    const weak = atArena();
    weak.state().waves = [2, 3, 4, 5];
    for (const slot of ['A', 'B']) weak.vehicle('t1', slot).hp = 10; // 20 de 96
    weak.toTick(5 + LAG);
    assert.equal(weak.state().strong, false);
    assert.ok(weak.state().pads.filter((pad) => pad.ring === 'corner').every((pad) => RULES.powers.pools.corner.includes(pad.power)));
  });

  test('al caer, el retador pierde su poder', () => {
    const { vehicle, drive, place, toTick } = atArena();
    place('t2', 'A', 1500, 1000);
    give(vehicle('t2', 'A'), 'turbo');
    vehicle('t2', 'A').hp = 1;
    toTick(2);
    drive('t1', 'A', { hold: 2, shots: [[2, UP]] });
    toTick(30);
    assert.deepEqual([vehicle('t2', 'A').status, vehicle('t2', 'A').power], ['dead', null]);
  });
});

describe('poderes', () => {
  test('Estado trampa: el golpe congela al jefe 0,5 s (no se mueve ni dispara) y después queda inmune 2 s', () => {
    const { state, vehicle, drive, place, toTick } = atArena();
    place('t2', 'A', 1500, 900); // arriba del jefe A (1500, 1320)
    give(vehicle('t2', 'A'), 'freeze', 3);
    toTick(3);
    drive('t2', 'A', { hold: 3, shots: [[3, DOWN]] });
    toTick(40);
    const boss = vehicle('t1', 'A');
    const hitTick = boss.frozenFrom;
    assert.ok(hitTick > 3 && hitTick < 20, 'se congela en el tick del golpe');
    assert.equal(boss.frozenUntil, hitTick + ticksOf(RULES.powers.freeze.freezeMs));
    assert.equal(vehicle('t2', 'A').power.charges, 2, 'gasta una carga');

    // Su celular informa que se movió: hasta el golpe se acepta; congelado, queda donde estaba.
    const pos = Array.from({ length: 35 }, (_, i) => [1500 + 2 * (i + 1), 1320]).flat();
    const res = drive('t1', 'A', { pos, shots: [[hitTick + 3, UP]] });
    assert.ok(res.fix, 'se le corrige la posición');
    const anchor = 1500 + 2 * hitTick;
    const at = (tick) => boss.hist.find((row) => row[0] === tick);
    assert.deepEqual([at(hitTick)[1], at(hitTick + 5)[1], at(boss.frozenUntil)[1]], [anchor, anchor, anchor]);
    assert.ok(at(boss.frozenUntil + 1)[1] > anchor, 'después se vuelve a mover');
    assert.equal(state().bullets.filter((b) => b.owner === boss.idx).length, 0, 'congelado no dispara');

    // Otro golpe con el poder dentro de la inmunidad no lo congela ni gasta carga.
    const again = 45;
    toTick(again);
    drive('t2', 'A', { hold: again, shots: [[again, DOWN]] });
    toTick(again + 30);
    assert.equal(boss.hp, boss.maxHp - 2);
    assert.equal(boss.frozenFrom, hitTick);
    assert.equal(vehicle('t2', 'A').power.charges, 2);
  });

  test('Desbordamiento: el retador que cae con él explota y daña a los jefes cercanos; cuenta como golpes suyos', () => {
    const { engine, vehicle, drive, place, toTick, frames } = atArena();
    place('t2', 'A', 1500, 1150); // a 100 del borde del jefe A; el jefe B queda lejos
    give(vehicle('t2', 'A'), 'blast');
    vehicle('t2', 'A').hp = 1;
    toTick(2);
    drive('t1', 'A', { hold: 2, shots: [[2, UP]] });
    toTick(30);
    const { damage } = RULES.powers.blast;
    assert.equal(vehicle('t2', 'A').status, 'dead');
    assert.equal(vehicle('t1', 'A').hp, vehicle('t1', 'A').maxHp - damage);
    assert.equal(vehicle('t1', 'B').hp, vehicle('t1', 'B').maxHp);
    assert.equal(vehicle('t2', 'A').damage, damage);
    assert.equal(engine.events.find((e) => e.type === 'arena_blast').damage, damage);
    assert.ok(frames.some((frame) => frame.v[vehicle('t2', 'A').idx][10] === 2), 'el fotograma mostró que lo llevaba');
  });

  test('Apilar doble: cada golpe al jefe cuenta 2', () => {
    const { vehicle, drive, place, toTick } = atArena();
    place('t2', 'A', 1500, 900);
    give(vehicle('t2', 'A'), 'double');
    toTick(3);
    drive('t2', 'A', { hold: 3, shots: [[3, DOWN]] });
    toTick(40);
    assert.equal(vehicle('t1', 'A').hp, vehicle('t1', 'A').maxHp - 2);
    assert.equal(vehicle('t2', 'A').damage, 2);
  });

  test('No determinismo: cada disparo sale en tres balas en abanico', () => {
    const { state, vehicle, drive, toTick } = atArena();
    give(vehicle('t2', 'A'), 'fan');
    toTick(5);
    drive('t2', 'A', { hold: 4, shots: [[4, UP]] });
    const mine = state().bullets.filter((b) => b.owner === vehicle('t2', 'A').idx);
    assert.deepEqual(mine.map((b) => b.k), [0, 1, 2]);
    assert.equal(new Set(mine.map((b) => b.angle)).size, 3);
  });

  test('Lazo: absorbe un golpe del jefe por carga', () => {
    const { vehicle, drive, place, toTick, frames } = atArena();
    place('t2', 'A', 1500, 1000);
    give(vehicle('t2', 'A'), 'shield', 2);
    toTick(2);
    drive('t1', 'A', { hold: 2, shots: [[2, UP]] });
    toTick(40);
    assert.equal(vehicle('t2', 'A').hp, RULES.challenger.hp);
    assert.equal(vehicle('t2', 'A').power.charges, 1);
    assert.ok(frames.flatMap((frame) => frame.h).some((row) => row[3] === vehicle('t2', 'A').idx && row[5] === 0));
  });

  test('Transición ε: se aceptan posiciones más rápidas sin corregirlas', () => {
    const run = (turbo) => {
      const { vehicle, drive, place, toTick } = atArena();
      place('t2', 'A', 1350, 1900);
      if (turbo) give(vehicle('t2', 'A'), 'turbo');
      toTick(8);
      const pos = Array.from({ length: 6 }, (_, i) => [1350 + 25 * (i + 1), 1900]).flat();
      return { res: drive('t2', 'A', { pos }), x: vehicle('t2', 'A').x };
    };
    const normal = run(false);
    assert.ok(normal.res.fix && normal.x < 1500, 'sin el poder, 25 por tick es demasiado');
    const fast = run(true);
    assert.deepEqual([fast.res.fix, fast.x], [undefined, 1500]);
  });
});

describe('estados del jefe', () => {
  test('al bajar de 66 % pasa a q₁: escudo breve, anillo de 12 balas y dispara 5 en abanico', () => {
    const { engine, state, vehicle, drive, place, toTick, frames } = atArena();
    const boss = vehicle('t1', 'A');
    boss.hp = Math.ceil(boss.maxHp * 0.66); // un golpe más y cruza el umbral
    place('t2', 'A', 1500, 900);
    toTick(3);
    drive('t2', 'A', { hold: 3, shots: [[3, DOWN]] });
    toTick(40);
    assert.equal(boss.stage, 1);
    const change = engine.events.find((e) => e.type === 'arena_stage');
    assert.deepEqual([change.teamId, change.slot, change.stage], ['t1', 'A', 1]);
    assert.equal(boss.shieldUntil, change.tick + ticksOf(RULES.boss.ring.shieldMs));
    const ring = new Set(frames.flatMap((frame) => frame.b).filter((row) => row[0] === boss.idx && row[1] === change.tick).map((row) => row[2]));
    assert.deepEqual([...ring].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => 10 + i), 'los fotogramas mostraron las 12');

    // Su disparo ahora sigue las reglas de q₁ (5 balas).
    const tick = 41;
    toTick(tick + 1);
    drive('t1', 'A', { hold: tick, shots: [[tick, UP]] });
    assert.equal(state().bullets.filter((b) => b.owner === boss.idx && b.tick0 === tick).length, 5);
  });

  test('con mucho daño de una vez cruza dos umbrales, pero el anillo sale una sola vez', () => {
    const { engine, vehicle, drive, place, toTick } = atArena();
    const boss = vehicle('t1', 'A');
    boss.hp = Math.round(boss.maxHp * 0.36); // la explosión (6) lo deja bajo 33 % sin pasar por q₁
    place('t2', 'A', 1500, 1150);
    give(vehicle('t2', 'A'), 'blast');
    vehicle('t2', 'A').hp = 1;
    toTick(2);
    drive('t1', 'A', { hold: 2, shots: [[2, UP]] });
    toTick(30);
    assert.equal(boss.stage, 2);
    assert.equal(engine.events.filter((e) => e.type === 'arena_stage').length, 1);
  });
});
