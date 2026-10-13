// MinigameManager (sección 3.3): ruleta, instrucciones, minijuego y resultado. Forma los grupos,
// enruta las entradas al plugin de la ronda (server/minigames/) y reparte los premios: puntos
// escalados con la ronda y con la compensación de cada equipo, y fragmentos de estrella. Un empate
// por el primer puesto o por el fragmento se desempata en la fase siguiente, el Duelo.
import { queueDuel } from '../domain/duel.js';
import { groupResults, makePairs } from '../domain/Grouping.js';
import { pickDistinct } from '../domain/random.js';
import { catchUpFactor, roundFactor } from '../domain/Scoring.js';
import { giveFragments, totalScore } from '../domain/stars.js';
import { addPoints, setStreak } from '../domain/teams.js';
import { MINIGAMES } from '../minigames/index.js';

const fail = (error) => ({ ok: false, error });
const REEL_LENGTH = 22; // nombres que pasan antes de detenerse

const rulesFor = (config, id) => config.minigameRules[id];

export function minigameName(config, id) {
  return config.minigames.find((entry) => entry.id === id)?.name ?? id;
}

// Ruleta vertical (RF-RUL-01/02): pasan nombres, incluidos señuelos, y siempre se detiene en el
// minijuego fijo de la ronda. Todas las pantallas animan la misma tira desde startsAt.
export const roulettePhase = {
  durationMs: (config) => config.timings.roulette,
  enter({ phase, config, random }) {
    const { decoys, spinMs } = config.minigameRules.roulette;
    const names = [...new Set([...config.minigames.map((entry) => entry.name), ...decoys])];
    const reel = [];
    while (reel.length < REEL_LENGTH) reel.push(...pickDistinct(names, names.length, random));
    reel.length = REEL_LENGTH;
    const target = minigameName(config, phase.minigame);
    phase.data = { reel: [...reel, target, ...pickDistinct(names, 2, random)], targetIndex: REEL_LENGTH, spinMs };
  },
  view: ({ phase }) => phase.data,
};

// Grupos del minijuego: parejas al azar, cada equipo solo o, si el plugin los arma (la Arena: jefes
// y retadores según el puntaje, o los jefes que eligió el host en la práctica), los suyos.
function formGroups({ room, phase, config, random }) {
  const plugin = MINIGAMES[phase.minigame];
  if (plugin.makeGroups) {
    const chosen = room.practice?.bosses ?? null;
    return plugin.makeGroups({ teams: room.teams, settings: rulesFor(config, phase.minigame), random, chosen });
  }
  const teamIds = room.teams.map((team) => team.id);
  return plugin.grouping === 'pairs' ? makePairs(teamIds, random) : teamIds.map((id) => [id]);
}

function setGroups(ctx) {
  const { room, phase, record } = ctx;
  const groups = formGroups(ctx);
  room.minigameSetup = { round: phase.round, minigame: phase.minigame, groups, fresh: phase.kind === 'minigameGroups' };
  record('minigame_groups', { round: phase.round, minigame: phase.minigame, groups });
}

// «Formando grupos» (rediseño, fase 5), solo en los minijuegos en equipos: aquí se forman los
// grupos y las pantallas animan cómo se juntan. Las instrucciones usan los mismos.
export const minigameGroupsPhase = {
  durationMs: (config) => config.timings.minigameGroups,
  enter: setGroups,
  view({ room, phase, config }) {
    return { name: minigameName(config, phase.minigame), minigame: phase.minigame, groups: room.minigameSetup?.groups ?? [] };
  },
};

// Instrucciones (RF-MJ-01): aquí se forman los grupos, para que cada equipo sepa con quién juega,
// salvo que ya los haya formado «Formando grupos» justo antes. El tipo de minijuego (grouping:
// 'teams' solitario, 'pairs' en equipos, 'roles' contra el jefe) decide cómo se dibujan.
export const minigameIntroPhase = {
  durationMs: (config) => config.timings.minigameIntro,
  enter(ctx) {
    const { room, phase } = ctx;
    const setup = room.minigameSetup;
    if (setup?.fresh && setup.round === phase.round && setup.minigame === phase.minigame) setup.fresh = false;
    else setGroups(ctx);
  },
  view({ room, phase, config }) {
    return {
      name: minigameName(config, phase.minigame),
      minigame: phase.minigame,
      grouping: MINIGAMES[phase.minigame].grouping,
      instructions: rulesFor(config, phase.minigame).instructions,
      groups: room.minigameSetup?.round === phase.round ? room.minigameSetup.groups : [],
    };
  },
};

// El minijuego en sí: cuenta 3-2-1 sincronizada hasta playStartsAt y luego el juego (RF-MJ-01).
export const minigamePhase = {
  durationMs: (config, step) =>
    config.minigameRules.countdownMs + MINIGAMES[step.minigame].playMs(rulesFor(config, step.minigame)),
  acceptsActions: true,

  enter(ctx) {
    const { room, phase, config, random } = ctx;
    const plugin = MINIGAMES[phase.minigame];
    const settings = rulesFor(config, phase.minigame);
    const groups = room.minigameSetup?.round === phase.round ? room.minigameSetup.groups : formGroups(ctx);
    phase.playStartsAt = phase.startsAt + config.minigameRules.countdownMs;
    phase.closeAt = phase.endsAt + (plugin.graceMs?.(settings) ?? 0);
    const { slotConnected } = pluginCtx(ctx);
    const slotTaken = (teamId, slot) => Boolean(room.teams.find((t) => t.id === teamId)?.slots[slot]);
    phase.data = {
      groups,
      state: plugin.init({
        groups, settings, random, slotTaken, slotConnected, window: { start: phase.playStartsAt, end: phase.endsAt },
      }),
    };
    // Semilla del tablero o del nivel, para poder reproducirlo (RNF-17).
    if (phase.data.state.seed !== undefined) {
      ctx.record('minigame_started', { round: phase.round, minigame: phase.minigame, seed: phase.data.state.seed });
    }
  },

  onAction(ctx, { teamId, deviceId, action }) {
    if (action.type !== 'input') return fail('invalid_action');
    if (ctx.now < ctx.phase.playStartsAt) return fail('game_not_started');
    const slot = ctx.teamOf(deviceId).slot;
    return plugin(ctx).onInput(ctx.phase.data.state, { ...pluginCtx(ctx), teamId, deviceId, slot, input: action.input });
  },

  isComplete: (ctx) => Boolean(plugin(ctx).isFinished?.(ctx.phase.data.state, pluginCtx(ctx))),
  nextWakeup: (ctx) => plugin(ctx).nextWakeup?.(ctx.phase.data.state, pluginCtx(ctx)) ?? null,
  onWakeup: (ctx) => plugin(ctx).onWakeup?.(ctx.phase.data.state, pluginCtx(ctx)),
  shiftTimes: (ctx, delta) => plugin(ctx).shiftTimes?.(ctx.phase.data.state, delta),
  // Minijuegos en tiempo real (la Arena): cada frameMs avanzan su simulación y devuelven un fotograma.
  frameMs: (ctx) => plugin(ctx).frameMs?.(rulesFor(ctx.config, ctx.phase.minigame)) ?? null,
  onFrame: (ctx) => plugin(ctx).onFrame(ctx.phase.data.state, pluginCtx(ctx)),

  // Premios (RF-MJ-03): cada equipo del grupo ganador. Un empate por el primer puesto o por el
  // fragmento ya no premia a todos: se juega un Duelo (fase siguiente) y los premios se reparten al
  // terminarlo. Para no guardar el estado del minijuego, se calcula aquí el resultado que tendría
  // cada lado si gana el Duelo.
  exit(ctx) {
    const { room, phase, config, record } = ctx;
    const game = plugin(ctx);
    const settings = rulesFor(config, phase.minigame);
    // Lo que el minijuego tenga pendiente (la Arena: impactos aún sin decidir) se decide antes.
    for (const { type, ...payload } of game.settle?.(phase.data.state, pluginCtx(ctx)) ?? []) {
      record(type, { phase: phase.id, ...payload });
    }
    const base = pluginCtx(ctx);
    const scores = game.scores(phase.data.state, base);
    const resultsFor = (tiebreak) => (game.results
      ? game.results(phase.data.state, { ...base, tiebreak })
      : groupResults(phase.data.groups, scores, settings.prize, tiebreak));
    const results = resultsFor(null);
    const info = { round: phase.round, minigame: phase.minigame, metric: game.metric };
    if (!results.tie) {
      finishMinigame(ctx, { ...info, results });
      return;
    }
    room.pendingMinigame = { ...info, sides: results.tie, outcomes: results.tie.map((side) => resultsFor(side)) };
    queueDuel(room, { kind: 'minigame', round: phase.round, minigame: phase.minigame, sides: results.tie });
    record('minigame_tied', { ...info, sides: results.tie });
  },

  view(ctx, viewer) {
    const mine = viewer.deviceId ? ctx.teamOf(viewer.deviceId) : null;
    const who = { role: viewer.role, teamId: mine?.team.id ?? null, slot: mine?.slot ?? null };
    return {
      groups: ctx.phase.data.groups,
      game: plugin(ctx).view(ctx.phase.data.state, { ...pluginCtx(ctx), viewer: who }),
    };
  },
};

export const minigameResultPhase = {
  durationMs: () => null,
  waitsHost: true,
  view({ room, phase }) {
    return room.minigameResults?.[phase.round] ?? { groups: [], awards: [] };
  },
};

// Reparte los premios de un minijuego ya decidido (sin empate, o tras el Duelo: `duel` dice entre
// quiénes fue y quién ganó). Los puntos de cada premio son los de la ronda 1: se multiplican por
// el factor de la ronda y por la compensación del equipo, calculada con los puntajes de antes de
// repartir (así el orden de los premios no cambia nada). Cada fragmento puede completar una estrella.
export function finishMinigame({ room, config, record }, { round, minigame, metric, results, duel = null }) {
  const scoring = config.minigameScoring;
  const factor = roundFactor(scoring, round);
  const top = Math.max(0, ...room.teams.map(totalScore)); // la distancia al 1.º, con el pozo de estrellas
  const teamOf = (teamId) => room.teams.find((t) => t.id === teamId);
  const awards = results.awards.filter((award) => teamOf(award.teamId)).map((award) => {
    const catchUp = catchUpFactor(scoring.catchUp, round, top - totalScore(teamOf(award.teamId)));
    return { ...award, base: award.points, catchUp, points: Math.round(award.points * factor * catchUp) };
  });
  for (const award of awards) {
    const team = teamOf(award.teamId);
    award.points = addPoints(team, award.points);
    if (award.streak) setStreak(team, team.streak + award.streak);
  }
  const fragments = (results.fragments ?? []).filter(teamOf).map((teamId) => {
    const team = teamOf(teamId);
    const star = giveFragments(team, 1, config.stars);
    if (star.completed > 0) {
      record('star_completed', { teamId, round, source: 'minigame', completed: star.completed, stars: team.stars, points: star.points });
    }
    // starPoints: lo que creció el pozo de estrellas (1000 por el fragmento, más 1000 si completó).
    return { teamId, fragments: team.fragments, stars: team.stars, starsCompleted: star.completed, starPoints: star.points };
  });
  const { tie, ...rest } = results;
  const final = { minigame, metric, ...rest, awards, fragments, roundFactor: factor, duel };
  room.minigameResults = { ...room.minigameResults, [round]: final };
  record('minigame_closed', { round, ...final });
}

function plugin(ctx) {
  return MINIGAMES[ctx.phase.minigame];
}

function pluginCtx(ctx) {
  const { phase, config, now, random, room, isConnected, activeTeamIds, record } = ctx;
  return {
    groups: phase.data.groups,
    activeTeamIds,
    settings: rulesFor(config, phase.minigame),
    window: { start: phase.playStartsAt, end: phase.endsAt },
    now,
    random,
    record,
    scoreOf: (teamId) => room.teams.find((t) => t.id === teamId)?.score ?? 0,
    slotConnected: (teamId, slot) => {
      const deviceId = room.teams.find((t) => t.id === teamId)?.slots[slot];
      return Boolean(deviceId && isConnected(deviceId));
    },
  };
}
