// Arena: cada celular maneja un vehículo y dispara hacia donde mira. El líder (o los dos primeros,
// con la regla de umbral que tenía Death Race) es el jefe: un vehículo grande que empieza en el
// centro. Los demás equipos lo atacan: cada golpe suma puntos, más para quien va más atrás en el
// ranking, y si lo derriban hay bono. Si el jefe resiste hasta el final, gana su premio.
//
// Para que el minuto y medio no sea igual de principio a fin: en oleadas aparecen cajas de poder en
// puntos fijos (el retador que pasa encima se lleva el poder; el jefe las aplasta) y el jefe cambia
// de estado al perder vida (dispara distinto y, al cambiar, lanza un anillo de balas).
//
// Red: cada celular mueve su vehículo al instante y cada `reportMs` informa su posición en cada tick
// (30 por segundo) y sus disparos. El servidor valida la posición (velocidad máxima, obstáculos,
// bordes) y decide los impactos, las cajas y los poderes: cada `frameMs` avanza tick a tick hasta
// donde ya conoce la posición de todos, o hasta `maxLagMs` atrás si algún celular se atrasa (su
// vehículo se toma quieto), y difunde un fotograma compacto a todas las pantallas (mg:frame). No hay
// choques entre vehículos ni fuego amigo: así el movimiento de cada uno depende solo de su celular.
import { totalScore } from '../domain/stars.js';
import {
  TICK_MS, angleOf, angleTo, blocked, bossStage, bulletAt, effectiveRules, makeBullet, perTick, powerCode, pushOut,
  segmentDistance2, shotAngles, tickAt, ticksOf,
} from '../../client/shared/arena-physics.js';
import { bossStarts, buildMap } from '../domain/arenaMap.js';
import { settleTop, topTeams } from '../domain/Grouping.js';

const SLOTS = ['A', 'B'];
const AHEAD_TICKS = 10; // adelanto aceptado sobre el reloj del servidor (error de sincronización)
const SPEED_SLACK = 1.25; // margen sobre la velocidad máxima: el redondeo y los tirones de la red
const WALL_SLACK = 2; // las posiciones llegan redondeadas: pueden rozar un obstáculo por menos de 1
const HISTORY_TICKS = 60; // posiciones guardadas por vehículo, para los disparos que llegan tarde
const RECENT_TICKS = 8; // balas e impactos que repite cada fotograma, por si se pierde alguno
const SPAWN_CHOICES = 6; // se reaparece en uno de los puntos más lejanos del jefe, por turnos
const TURBO_GRACE_TICKS = 10; // el celular se entera tarde de que se acabó la Transición ε
const RING_K = 10; // las balas del anillo van con k desde aquí: no chocan con las del disparo normal
export const STATUS = { dead: 0, alive: 1, out: 2 };
const fail = (error) => ({ ok: false, error });
const reply = (v) => ({ ok: true, quiet: true, tick: v.tick, life: v.life, status: v.status });

// Jefes (mismo criterio que AMB-23), por el total con el pozo de estrellas: el 1.º; el 1.º y el 2.º si el 1.º no le saca U al 2.º pero el
// 2.º sí se la saca al 3.º. Los empatados con el último jefe también lo son, salvo que eso deje la
// partida sin retadores: entonces es jefe solo el primero del ranking.
export function pickBosses(teams, threshold) {
  const ranked = [...teams].sort((a, b) => totalScore(b) - totalScore(a) || a.order - b.order);
  const [s1, s2, s3] = ranked.map(totalScore);
  const cut = s2 !== undefined && s3 !== undefined && s1 - s2 < threshold && s2 - s3 >= threshold ? s2 : s1;
  const bosses = ranked.filter((team) => totalScore(team) >= cut);
  return bosses.length === ranked.length && ranked.length > 1 ? ranked.slice(0, 1) : bosses;
}

// Vida de cada vehículo jefe con N celulares retadores y B vehículos jefe. Crece con N, pero cuantos
// más jefes por retador, menos tiempo puede dedicar cada retador a pegarle: `p` (la parte del tiempo
// que puede disparar) baja con B ÷ N. Así, si el modelo acierta, el jefe cae más o menos en el mismo
// segundo con 2 o con 14 retadores. Los valores se calibran con personas (docs/ARENA.md).
export function bossHp({ hpPerChallenger, pressure, minHp }, challengers, bosses) {
  const n = Math.max(1, challengers);
  const b = Math.max(1, bosses);
  const p = 1 / (1 + (pressure * b) / n);
  return Math.max(minHp, Math.round((hpPerChallenger * n * p) / b));
}

const holds = (v, id, t) => v.power !== null && v.power.id === id && t >= v.power.from && t < v.power.until;
const frozenAt = (v, t) => t > v.frozenFrom && t <= v.frozenUntil;
const currentTick = (state, { now, window }) => Math.min(tickAt(now, window.start), state.endTick);

// Reglas de un vehículo en el tick `t`: las del jefe según su estado y las del retador según su poder.
function rulesAt(v, settings, t) {
  if (v.boss) return effectiveRules(settings.boss, { stage: v.stage });
  return effectiveRules(settings.challenger, { power: v.power, tick: t, powers: settings.powers });
}

// Números al azar con semilla dentro del estado (mulberry32, como domain/random.js): así el estado se
// puede guardar en el snapshot y la partida se reproduce con la semilla del log.
function nextRandom(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const arena = {
  id: 'arena',
  grouping: 'roles',
  metric: 'golpes',
  fragmentRule: 'El equipo que más daño haga (sumando sus golpes) gana un fragmento de estrella.',
  playMs: (settings) => settings.durationMs,
  graceMs: (settings) => settings.reportMs + 200, // el último informe puede venir en camino
  frameMs: (settings) => settings.frameMs,

  // Grupo 0: jefes; grupo 1: retadores. En una sala de práctica el host puede fijar los jefes
  // (`chosen`); se ignoran los equipos que ya no juegan.
  makeGroups({ teams, settings, chosen = null }) {
    const ids = new Set(teams.map((team) => team.id));
    const forced = (chosen ?? []).filter((id) => ids.has(id));
    const bosses = forced.length > 0 && (forced.length < teams.length || teams.length === 1)
      ? forced
      : pickBosses(teams, settings.threshold).map((team) => team.id);
    return [bosses, teams.map((team) => team.id).filter((id) => !bosses.includes(id))];
  },

  // Un vehículo por celular del equipo. La vida del jefe depende de los retadores conectados al
  // empezar y de cuántos vehículos jefe hay (bossHp).
  init({ groups, settings, random, slotTaken, slotConnected }) {
    const map = buildMap(settings.size);
    const [bossIds, challengerIds] = groups;
    const roster = [];
    for (const [ids, boss] of [[bossIds, true], [challengerIds, false]]) {
      for (const teamId of ids) for (const slot of SLOTS) if (slotTaken(teamId, slot)) roster.push({ teamId, slot, boss });
    }
    const bosses = roster.filter((v) => v.boss);
    const challengers = roster.filter((v) => !v.boss);
    const fighting = challengers.filter((v) => slotConnected(v.teamId, v.slot)).length;
    const hpOfBoss = bossHp(settings.boss, fighting, bosses.length);
    const starts = bossStarts(bosses.length, map.size);
    const center = { x: map.size / 2, y: map.size / 2 };
    const first = Math.floor(random() * map.spawns.length);
    const seed = Math.floor(random() * 2 ** 31);
    const vehicles = roster.map((v, idx) => {
      const n = challengers.indexOf(v);
      const spot = v.boss
        ? starts[bosses.indexOf(v)]
        : map.spawns[(first + Math.floor((n * map.spawns.length) / challengers.length)) % map.spawns.length];
      const hp = v.boss ? hpOfBoss : settings.challenger.hp;
      return {
        idx,
        ...v,
        radius: (v.boss ? settings.boss : settings.challenger).radius,
        maxHp: hp,
        hp,
        status: 'alive',
        life: 1,
        aliveFrom: 0,
        tick: 0, // último tick con posición conocida
        x: spot.x,
        y: spot.y,
        f: v.boss ? angleOf(-Math.PI / 2) : angleTo(spot, center),
        hist: [[0, spot.x, spot.y]],
        shieldUntil: 0,
        respawnTick: null,
        lastShot: -1e9,
        damage: 0, // golpes que dio
        kills: 0,
        deaths: 0,
        power: null, // retador: { id, from, until, charges }
        stage: 0, // jefe: su estado (0, 1, 2…)
        frozenFrom: -1, // jefe: congelado en los ticks (frozenFrom, frozenUntil], quieto en frozenPos
        frozenUntil: -1,
        frozenPos: null,
        immuneUntil: 0, // jefe: no se puede volver a congelar hasta aquí
      };
    });
    return {
      seed, // queda en el log (minigame_started): qué poder sale en cada caja
      rng: seed,
      size: map.size,
      obstacles: map.obstacles,
      spawns: map.spawns,
      pads: map.pads.map((pad, id) => ({ id, ...pad, power: null })),
      waves: settings.powers.waves.map((ms) => ticksOf(ms)),
      wave: 0, // oleadas que ya salieron
      strong: false, // la última fue la de remontada
      endTick: Math.floor(settings.durationMs / TICK_MS),
      resolved: 0, // hasta este tick ya se decidieron los impactos
      now: 0, // tick del reloj del servidor la última vez que se miró
      vehicles,
      bullets: [],
      hits: [], // impactos recientes: [dueño, tick0, k, objetivo, tick, daño]
      spawnTurn: 0,
      fighting, // para el resumen de calibración
      taken: 0, // poderes recogidos
      downTick: null, // tick en que cayó el último jefe
    };
  },

  onInput(state, ctx) {
    if (ctx.input.type !== 'drive') return fail('invalid_input');
    return drive(state, ctx);
  },

  onFrame(state, ctx) {
    const nowTick = currentTick(state, ctx);
    state.now = nowTick;
    let events = [];
    if (nowTick > state.resolved) {
      // Se espera a los celulares conectados que van atrasados, pero no más de maxLagMs.
      const known = state.vehicles
        .filter((v) => v.status === 'alive' && ctx.slotConnected(v.teamId, v.slot))
        .map((v) => v.tick);
      const target = Math.max(nowTick - ticksOf(ctx.settings.maxLagMs), Math.min(nowTick, ...known));
      if (target > state.resolved) events = resolveTo(state, target, ctx);
    }
    prune(state, nowTick);
    return { frame: frameOf(state, nowTick), events };
  },

  // Al cerrar: se decide lo que falte hasta el final y queda en el log un resumen para calibrar la
  // vida del jefe con partidas reales (docs/ARENA.md).
  settle(state, ctx) {
    const events = resolveTo(state, currentTick(state, ctx), ctx);
    const bosses = state.vehicles.filter((v) => v.boss);
    return [...events, {
      type: 'arena_summary',
      challengers: state.fighting,
      bossVehicles: bosses.length,
      bossHp: bosses.reduce((acc, v) => acc + Math.max(0, v.hp), 0),
      bossMaxHp: bosses.reduce((acc, v) => acc + v.maxHp, 0),
      downAtMs: state.downTick === null ? null : Math.round(state.downTick * TICK_MS),
      waves: state.wave,
      powersTaken: state.taken,
    }];
  },

  // Termina antes si derribaron a todos los jefes.
  isFinished(state) {
    const bosses = state.vehicles.filter((v) => v.boss);
    return bosses.length > 0 && bosses.every((v) => v.status === 'out');
  },

  scores(state, { groups }) {
    const sum = (ids, key) => state.vehicles.filter((v) => ids.includes(v.teamId)).reduce((acc, v) => acc + v[key], 0);
    return [sum(groups[0], 'kills'), sum(groups[1], 'damage')];
  },

  // Retadores: pointsPerHit por golpe y, si derriban al jefe, defeatBonus para cada equipo que le
  // hizo daño. Jefes: bossPointsPerKill por cada retador que destruyeron y, si alguno resiste,
  // bossSurvivePrize y +bossSurviveStreak de racha. Son valores de la ronda 1: el MinigameManager
  // los escala con la ronda y les aplica el multiplicador de compensación de cada equipo.
  // El fragmento es para el equipo que más daño hizo (golpes que acertó, jefe o retador); si varios
  // empatan, se desempata con un Duelo (`tie`, o `tiebreak` ya jugado).
  results(state, ctx) {
    const { groups, settings, tiebreak = null } = ctx;
    const [bossIds, challengerIds] = groups;
    const bossesWin = state.vehicles.some((v) => v.boss && v.status !== 'out');
    const teamSum = (teamId, key) => state.vehicles.filter((v) => v.teamId === teamId).reduce((acc, v) => acc + v[key], 0);
    const { tied } = topTeams(groups.flat(), (teamId) => teamSum(teamId, 'damage'));
    const { winner, tie } = settleTop(tied, tiebreak);
    const rows = [
      ...bossIds.map((teamId) => {
        const kills = teamSum(teamId, 'kills');
        const points = kills * settings.bossPointsPerKill + (bossesWin ? settings.bossSurvivePrize : 0);
        const detail = [`${kills} ${kills === 1 ? 'derribo' : 'derribos'}`, bossesWin ? 'resistió' : 'derribado'];
        return {
          teamIds: [teamId],
          score: points,
          winner: bossesWin,
          label: `Jefe · ${detail.join(' · ')}`,
          streak: bossesWin ? settings.bossSurviveStreak : 0,
        };
      }),
      ...challengerIds.map((teamId) => {
        const hits = teamSum(teamId, 'damage');
        const bonus = !bossesWin && hits > 0 ? settings.defeatBonus : 0;
        const points = hits * settings.pointsPerHit + bonus;
        const detail = [`${hits} ${hits === 1 ? 'golpe' : 'golpes'}`, bonus > 0 && 'bono'];
        return {
          teamIds: [teamId],
          score: points,
          winner: !bossesWin && hits > 0,
          label: detail.filter(Boolean).join(' · '),
          streak: 0,
        };
      }),
    ];
    const several = bossIds.length > 1; // un equipo jefe es «el jefe», aunque maneje dos vehículos
    return {
      headline: bossesWin ? (several ? 'Los jefes resistieron' : 'El jefe resistió') : (several ? '¡Vaciaron las pilas de los jefes!' : '¡Vaciaron la pila del jefe!'),
      everyoneScores: true, // los perdedores también pueden sumar: el celular no dice «Esta vez no» si sumó
      groups: rows.map(({ streak, ...row }) => row),
      awards: rows
        .filter((row) => row.score > 0 || row.streak > 0)
        .map((row) => ({ teamId: row.teamIds[0], points: row.score, streak: row.streak })),
      fragments: winner ? [winner] : [],
      tie,
    };
  },

  // Lo que no cambia durante el juego: el mapa, los puntos de caja, las reglas y quién maneja qué
  // vehículo. Lo que se mueve (posiciones, vidas, balas, impactos, cajas, poderes) llega en los
  // fotogramas (mg:frame).
  view(state, ctx) {
    const { settings, viewer, groups } = ctx;
    const vehicleRules = ({ hp, hpPerChallenger, pressure, minHp, ...rules }) => rules;
    const { pools, ...powers } = settings.powers;
    const base = {
      size: state.size,
      obstacles: state.obstacles,
      pads: state.pads.map(({ x, y, ring }) => ({ x, y, ring })),
      waves: state.waves,
      endTick: state.endTick,
      view: settings.view,
      reportMs: settings.reportMs,
      aimConeDeg: settings.aimConeDeg,
      respawnMs: settings.respawnMs,
      rules: { boss: vehicleRules(settings.boss), challenger: vehicleRules(settings.challenger) },
      powers,
      vehicles: state.vehicles.map(({ idx, teamId, slot, boss, maxHp }) => ({ idx, teamId, slot, boss, maxHp })),
    };
    if (viewer.role !== 'play' || !viewer.teamId) return base;
    const mine = state.vehicles.find((v) => v.teamId === viewer.teamId && v.slot === viewer.slot);
    return { ...base, me: mine ? mine.idx : null, role: groups[0].includes(viewer.teamId) ? 'boss' : 'challenger' };
  },
};

// input = { type: 'drive', life, from, pos: [x, y, x, y…], f, shots: [[tick, ángulo]…] }: la posición
// del vehículo en los ticks from, from + 1…, hacia dónde mira y los disparos (de esta vida).
function drive(state, ctx) {
  const { teamId, slot, input, settings } = ctx;
  const v = state.vehicles.find((x) => x.teamId === teamId && x.slot === slot);
  if (!v) return fail('not_in_arena');
  if (input.pos.length % 2 !== 0) return fail('invalid_input');
  const count = input.pos.length / 2;
  if (input.from + count - 1 > currentTick(state, ctx) + AHEAD_TICKS) return fail('implausible_progress');
  // Lo que llega de una vida anterior (antes de que el celular se enterara del choque) no cuenta: la
  // respuesta le dice en qué vida va.
  if (input.life !== v.life || v.status !== 'alive') return reply(v);
  state.now = Math.max(state.now, currentTick(state, ctx));
  const base = v.boss ? settings.boss : settings.challenger;
  let fix = null;
  for (let i = 0; i < count; i += 1) {
    const tick = input.from + i;
    if (tick <= v.tick) continue; // ya conocida
    if (tick > state.endTick) break;
    let x = input.pos[2 * i];
    let y = input.pos[2 * i + 1];
    let moved = false;
    if (v.boss && frozenAt(v, tick)) {
      // Congelado: queda donde estaba al congelarse (si su celular iba atrasado, donde esté al llegar
      // a ese momento).
      v.frozenPos ??= { x: v.x, y: v.y };
      moved = Math.abs(v.frozenPos.x - x) + Math.abs(v.frozenPos.y - y) > 0.5;
      x = v.frozenPos.x;
      y = v.frozenPos.y;
    }
    // Más rápido de lo posible: se acerca hasta donde alcanzaba. Dentro de un obstáculo: se saca.
    const turbo = !v.boss && v.power?.id === 'turbo' && tick >= v.power.from && tick < v.power.until + TURBO_GRACE_TICKS;
    const speed = effectiveRules(base, { stage: v.stage }).speed * (turbo ? settings.powers.turbo.speed : 1);
    const dx = x - v.x;
    const dy = y - v.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const max = (perTick(speed) * SPEED_SLACK + 2) * (tick - v.tick);
    if (d > max) {
      x = v.x + (dx / d) * max;
      y = v.y + (dy / d) * max;
    }
    const safe = pushOut(x, y, base.radius - WALL_SLACK, state);
    if (moved || d > max || Math.abs(safe.x - x) + Math.abs(safe.y - y) > 0.5) fix = { tick, x: Math.round(safe.x), y: Math.round(safe.y) };
    v.tick = tick;
    v.x = safe.x;
    v.y = safe.y;
    v.hist.push([tick, v.x, v.y]);
  }
  if (v.hist.length > HISTORY_TICKS) v.hist.splice(0, v.hist.length - HISTORY_TICKS);
  v.f = input.f;
  for (const [tick, angle] of input.shots) shoot(state, v, tick, angle, settings);
  return fix ? { ...reply(v), fix } : reply(v);
}

// Un disparo vale si el vehículo estaba vivo en ese tick (en esta vida), ya se conoce su posición,
// respeta la cadencia y el jefe no estaba congelado. Si llega tarde (su tick ya se resolvió), la bala
// sigue su camino solo contra los obstáculos: no golpea a nadie en el pasado.
function shoot(state, v, tick, angle, settings) {
  const rules = rulesAt(v, settings, tick);
  if (tick > v.tick || tick < v.aliveFrom || tick > state.endTick || tick - v.lastShot < ticksOf(rules.fireMs)) return;
  if (v.boss && frozenAt(v, tick)) return;
  v.lastShot = tick;
  const at = positionAt(v, tick);
  shotAngles(angle, rules).forEach((a, k) => addBullet(state, v, tick, k, at, a, rules));
}

// Cada bala se repite en los fotogramas RECENT_TICKS desde que el servidor la conoce (`shownUntil`):
// un disparo que llega tarde o el anillo, que nace al decidir los impactos (hasta maxLagMs atrás),
// igual llegan a las pantallas.
function addBullet(state, v, tick, k, at, angle, rules) {
  const b = {
    ...makeBullet({ owner: v.idx, tick0: tick, k, x: at.x, y: at.y, angle, rules }),
    end: null,
    cancelled: false,
    shownUntil: Math.max(tick, state.now) + RECENT_TICKS,
  };
  if (blocked(b.x0, b.y0, b.radius, state)) b.end = tick;
  for (let t = tick + 1; t <= state.resolved && b.end === null; t += 1) advance(state, b, t, null);
  state.bullets.push(b);
}

function positionAt(v, tick) {
  if (tick >= v.tick) return { x: v.x, y: v.y };
  for (let i = v.hist.length - 1; i >= 0; i -= 1) {
    if (v.hist[i][0] <= tick) return { x: v.hist[i][1], y: v.hist[i][2] };
  }
  return { x: v.hist[0]?.[1] ?? v.x, y: v.hist[0]?.[2] ?? v.y };
}

// Avanza los ticks (resolved, target]: reapariciones, oleadas, poderes que vencen, cajas y balas, en
// ese orden.
function resolveTo(state, target, ctx) {
  const { settings } = ctx;
  const events = [];
  for (let t = state.resolved + 1; t <= target; t += 1) {
    for (const v of state.vehicles) {
      if (v.status === 'dead' && v.respawnTick !== null && v.respawnTick <= t) respawn(state, v, t, settings);
      if (v.power && t >= v.power.until) v.power = null;
    }
    while (state.wave < state.waves.length && state.waves[state.wave] <= t) events.push(wave(state, t, settings));
    events.push(...pickUps(state, t, settings));
    for (const b of state.bullets) {
      if (b.end !== null || b.tick0 >= t) continue;
      events.push(...advance(state, b, t, ctx));
    }
    state.resolved = t;
  }
  return events;
}

// Oleada: cada punto recibe un poder al azar de su grupo (el de un punto que nadie tomó se
// reemplaza). En la última, si los jefes conservan más de `comebackAbove` de su vida, todos los
// puntos traen poderes fuertes (los de los ejes): es la última oportunidad de remontar.
function wave(state, t, settings) {
  const { pools, comebackAbove } = settings.powers;
  const bosses = state.vehicles.filter((v) => v.boss);
  const share = bosses.reduce((acc, v) => acc + Math.max(0, v.hp), 0) / Math.max(1, bosses.reduce((acc, v) => acc + v.maxHp, 0));
  state.wave += 1;
  state.strong = state.wave === state.waves.length && share > comebackAbove;
  for (const pad of state.pads) {
    const pool = state.strong ? pools.axis : pools[pad.ring];
    pad.power = pool[Math.floor(nextRandom(state) * pool.length)];
  }
  return { type: 'arena_wave', tick: t, wave: state.wave, strong: state.strong, powers: state.pads.map((pad) => pad.power) };
}

// Cajas: la toma el vehículo vivo más cercano a su centro entre los que la tocan. Un retador se
// lleva el poder (reemplaza al que tenía); el jefe la aplasta.
function pickUps(state, t, settings) {
  const events = [];
  const { padRadius } = settings.powers;
  for (const pad of state.pads) {
    if (!pad.power) continue;
    let best = null;
    let nearest = Infinity;
    for (const v of state.vehicles) {
      if (v.status !== 'alive' || t < v.aliveFrom) continue;
      const p = positionAt(v, t);
      const d2 = (p.x - pad.x) ** 2 + (p.y - pad.y) ** 2;
      if (d2 <= (v.radius + padRadius) ** 2 && d2 < nearest) {
        nearest = d2;
        best = v;
      }
    }
    if (!best) continue;
    const power = pad.power;
    pad.power = null;
    const who = { tick: t, teamId: best.teamId, slot: best.slot, pad: pad.id, power };
    if (best.boss) {
      events.push({ type: 'arena_crushed', ...who });
      continue;
    }
    const rules = settings.powers[power];
    best.power = { id: power, from: t, until: t + ticksOf(rules.ms), charges: rules.charges ?? 0 };
    state.taken += 1;
    events.push({ type: 'arena_power', ...who });
  }
  return events;
}

// La bala va de su posición en t − 1 a la de t. Golpea al primer enemigo vivo que cruza (con ctx;
// sin él, solo mira obstáculos) y se detiene en obstáculos, bordes y al final de su alcance.
function advance(state, b, t, ctx) {
  if (t > b.lastTick) {
    b.end = b.lastTick;
    return [];
  }
  const from = bulletAt(b, t - 1);
  const to = bulletAt(b, t);
  if (ctx) {
    const shooter = state.vehicles[b.owner];
    let target = null;
    let nearest = Infinity;
    for (const v of state.vehicles) {
      if (v.status !== 'alive' || v.boss === shooter.boss || t < v.aliveFrom) continue;
      const p = positionAt(v, t);
      const reach = v.radius + b.radius;
      if (segmentDistance2(from, to, p) > reach * reach) continue;
      const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2;
      if (d < nearest) {
        nearest = d;
        target = v;
      }
    }
    if (target) {
      b.end = t;
      return hit(state, b, target, t, ctx);
    }
  }
  if (blocked(to.x, to.y, b.radius, state)) b.end = t;
  return [];
}

// Un golpe quita 1 de vida (2 con Apilar doble), salvo con el escudo de reaparición o del cambio de
// estado, o si el retador lleva Lazo (gasta una carga). Con Estado trampa, el golpe además congela al
// jefe. Sin vida, el retador queda fuera respawnMs y el jefe, derribado hasta el final.
function hit(state, b, v, t, ctx) {
  const { settings } = ctx;
  const shooter = state.vehicles[b.owner];
  let shielded = t < v.shieldUntil;
  if (!shielded && holds(v, 'shield', t)) {
    spend(v);
    shielded = true;
  }
  const damage = shielded ? 0 : Math.min(v.hp, v.boss && holds(shooter, 'double', t) ? 2 : 1);
  state.hits.push([b.owner, b.tick0, b.k, v.idx, t, damage]);
  if (shielded) return [];
  const events = [];
  wound(state, v, shooter, damage, t, ctx, events);
  if (v.boss && v.status === 'alive' && holds(shooter, 'freeze', t) && freeze(v, t, settings.powers.freeze)) spend(shooter);
  return events;
}

// Gasta una carga del poder; sin cargas, se acaba.
function spend(v) {
  v.power.charges -= 1;
  if (v.power.charges <= 0) v.power = null;
}

// Quita `damage` de vida a `v` (golpe o explosión) y lo anota para quien lo hizo. El jefe puede
// cambiar de estado; sin vida, el vehículo cae.
function wound(state, v, by, damage, t, ctx, events) {
  v.hp -= damage;
  by.damage += damage;
  if (v.hp > 0) {
    if (v.boss) changeStage(state, v, t, ctx.settings, events);
    return;
  }
  destroy(state, v, by, t, ctx, events);
}

// El jefe congelado no se mueve ni dispara durante freezeMs, desde el golpe o desde su última posición
// conocida si su celular ya iba más adelante; después queda inmune immuneMs.
function freeze(v, t, rules) {
  if (t < v.immuneUntil) return false;
  v.frozenFrom = Math.max(t, v.tick);
  v.frozenUntil = v.frozenFrom + ticksOf(rules.freezeMs);
  v.frozenPos = v.tick >= t ? { x: v.x, y: v.y } : null; // si no, se fija al llegar su posición
  v.immuneUntil = v.frozenUntil + ticksOf(rules.immuneMs);
  return true;
}

// Cambio de estado del jefe (al cruzar un umbral de vida): escudo breve y un anillo de balas en
// todas direcciones. Si cruza dos umbrales de una vez, el anillo sale una sola vez.
function changeStage(state, v, t, settings, events) {
  const stage = bossStage(v.hp, v.maxHp, settings.boss.states);
  if (stage <= v.stage) return;
  v.stage = stage;
  const { bullets, shieldMs } = settings.boss.ring;
  v.shieldUntil = Math.max(v.shieldUntil, t + ticksOf(shieldMs));
  const at = positionAt(v, t);
  shotAngles(v.f, { bullets, spreadDeg: 360 / Math.max(1, bullets) })
    .forEach((a, k) => addBullet(state, v, t, RING_K + k, at, a, settings.boss));
  events.push({ type: 'arena_stage', tick: t, teamId: v.teamId, slot: v.slot, stage });
}

function destroy(state, v, by, t, ctx, events) {
  const { settings } = ctx;
  v.status = v.boss ? 'out' : 'dead';
  v.respawnTick = v.boss ? null : t + ticksOf(settings.respawnMs);
  v.deaths += 1;
  by.kills += 1;
  // Los disparos que su celular hizo después del choque no existen.
  for (const other of state.bullets) {
    if (other.owner === v.idx && other.tick0 > t) Object.assign(other, { end: other.tick0, cancelled: true });
  }
  events.push({
    type: 'arena_destroyed',
    tick: t,
    teamId: v.teamId,
    slot: v.slot,
    boss: v.boss,
    byTeamId: by.teamId,
    bySlot: by.slot,
  });
  if (v.boss && state.downTick === null && state.vehicles.every((x) => !x.boss || x.status === 'out')) state.downTick = t;
  const blast = holds(v, 'blast', t);
  v.power = null;
  if (blast) explode(state, v, t, ctx, events);
}

// Desbordamiento: el retador que cae con él explota y les quita `damage` a los jefes a menos de
// `radius` del borde de su vehículo (no a los que tienen escudo). Cuenta como golpes suyos.
function explode(state, v, t, ctx, events) {
  const { radius, damage } = ctx.settings.powers.blast;
  const at = positionAt(v, t);
  let total = 0;
  for (const boss of state.vehicles) {
    if (!boss.boss || boss.status !== 'alive' || t < boss.shieldUntil) continue;
    const p = positionAt(boss, t);
    if (Math.hypot(p.x - at.x, p.y - at.y) - boss.radius > radius) continue;
    const dealt = Math.min(boss.hp, damage);
    total += dealt;
    wound(state, boss, v, dealt, t, ctx, events);
  }
  events.push({ type: 'arena_blast', tick: t, teamId: v.teamId, slot: v.slot, x: Math.round(at.x), y: Math.round(at.y), damage: total });
}

// Reaparece con vida completa, un escudo breve, sin poder y lejos de los jefes (en uno de los puntos
// más lejanos, por turnos, para que no reaparezcan todos en el mismo).
function respawn(state, v, t, settings) {
  const bosses = state.vehicles.filter((x) => x.boss && x.status === 'alive');
  const distance = (spot) => Math.min(Infinity, ...bosses.map((x) => (x.x - spot.x) ** 2 + (x.y - spot.y) ** 2));
  const far = [...state.spawns].sort((a, b) => distance(b) - distance(a)).slice(0, SPAWN_CHOICES);
  const spot = far[state.spawnTurn % far.length];
  state.spawnTurn += 1;
  Object.assign(v, {
    status: 'alive',
    hp: v.maxHp,
    life: v.life + 1,
    aliveFrom: t,
    tick: t,
    x: spot.x,
    y: spot.y,
    f: angleTo(spot, { x: state.size / 2, y: state.size / 2 }),
    hist: [[t, spot.x, spot.y]],
    shieldUntil: t + ticksOf(settings.shieldMs),
    respawnTick: null,
    lastShot: -1e9,
    power: null,
  });
}

function prune(state, nowTick) {
  state.bullets = state.bullets.filter((b) => b.end === null || b.shownUntil > nowTick);
  state.hits = state.hits.filter((row) => row[4] > state.resolved - RECENT_TICKS);
}

// Fotograma (mg:frame), compacto porque sale 20 veces por segundo a todas las pantallas:
//   n: tick actual · r: hasta dónde se decidieron los impactos
//   v: por vehículo (en el orden de la vista) [tick, x, y, mira, vida, estado, n.º de vida,
//      reaparece en (si está fuera) o escudo hasta, golpes dados, derribos, poder (código de
//      POWERS, 0 = ninguno), poder hasta, cargas del poder, congelado hasta, estado del jefe]
//   b: balas disparadas en los últimos ticks [dueño, tick0, k, x0, y0, ángulo]
//   h: impactos recientes [dueño, tick0, k, objetivo, tick, daño]
//   p: poder de cada caja (código, 0 = vacía) · w: [oleadas que salieron, la última fue de remontada]
function frameOf(state, nowTick) {
  return {
    n: nowTick,
    r: state.resolved,
    v: state.vehicles.map((v) => [
      v.tick, Math.round(v.x), Math.round(v.y), v.f, v.hp, STATUS[v.status], v.life,
      v.status === 'dead' ? v.respawnTick : v.shieldUntil, v.damage, v.kills,
      powerCode(v.power?.id), v.power?.until ?? 0, v.power?.charges ?? 0, Math.max(0, v.frozenUntil), v.stage,
    ]),
    b: state.bullets
      .filter((b) => !b.cancelled && b.shownUntil > nowTick)
      .map((b) => [b.owner, b.tick0, b.k, Math.round(b.x0), Math.round(b.y0), b.angle]),
    h: state.hits,
    p: state.pads.map((pad) => powerCode(pad.power)),
    w: [state.wave, state.strong ? 1 : 0],
  };
}
