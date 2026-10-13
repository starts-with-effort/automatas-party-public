// Traza a ciegas (reemplaza al Laberinto oculto en la ronda 2): cada equipo lleva su copia del mismo
// autómata de pila con la misma cadena. Un celular tiene el diagrama (ve el estado actual y la pila,
// no la cadena) y toca el estado al que pasa el autómata en cada paso, también en los ε; el otro tiene
// la cadena (sin marca de avance) y la dicta en voz alta. Un toque equivocado los hace cambiar de papel
// y empezar de nuevo con la misma cadena; con el segundo error se quedan sin intentos. El primero en
// aceptar gana el fragmento; los demás que aceptan suman según el tiempo que les sobró.
import { settleTop } from '../domain/Grouping.js';
import {
  ACCEPT_MODES, TRAZA_PDA, acceptingTrace, correctMove, initialId, isAccepting, moves, tapMove, trazaWords,
} from '../domain/pda.js';
import { createRng } from '../domain/random.js';

const fail = (error) => ({ ok: false, error });
const PDA = TRAZA_PDA;
const other = (slot) => (slot === 'A' ? 'B' : 'A');

// Lo que dibuja el celular del diagrama: estados y un arco por par de estados con sus rótulos (las
// transiciones con X comparten uno).
const DIAGRAM = (() => {
  const edges = [];
  for (const tr of PDA.transitions) {
    let edge = edges.find((e) => e.from === tr.from && e.to === tr.to);
    if (!edge) edges.push(edge = { from: tr.from, to: tr.to, labels: [] });
    if (!edge.labels.includes(tr.label)) edge.labels.push(tr.label);
  }
  return { states: PDA.states, start: PDA.start, final: PDA.final, edges };
})();

// Papel de un celular: 'diagram' o 'string' según a quién le toca el diagrama en este intento. Si
// el compañero no está conectado, el celular ve las dos cosas ('both') y toca él (AMB-30).
export function trazaRole({ slotConnected }, teamId, slot, team) {
  if (!teamId || !slot || !team) return null;
  if (!slotConnected(teamId, other(slot))) return 'both';
  return slot === team.diagram ? 'diagram' : 'string';
}

const stepOf = (transition) => {
  const tr = PDA.transitions[transition];
  return { from: tr.from, to: tr.to, label: tr.label, read: tr.read };
};

// Puntos de la ronda 1 de quien acepta sin ser el primero: base + porTiempo × lo que sobraba, a la
// decena.
export function timePrize(settings, ms) {
  const left = Math.max(0, settings.maxDurationMs - ms) / settings.maxDurationMs;
  return Math.round((settings.prizeBase + settings.prizeByTime * left) / 10) * 10;
}

export const traza = {
  id: 'traza',
  grouping: 'teams',
  metric: 'aceptación',
  fragmentRule: 'Solo el primer equipo que acepta la cadena gana un fragmento de estrella.',
  playMs: (settings) => settings.maxDurationMs,

  init({ groups, settings, random }) {
    const seed = Math.floor(random() * 2 ** 31); // queda en el log (RNF-17)
    const rng = createRng(seed);
    const words = trazaWords();
    const word = words[Math.floor(rng() * words.length)];
    const modes = settings.modes.filter((mode) => ACCEPT_MODES.includes(mode));
    const mode = modes[Math.floor(rng() * modes.length)];
    const teams = Object.fromEntries(groups.flat().map((teamId) => [teamId, {
      diagram: 'A', // quién tiene el diagrama en este intento
      attempt: 1,
      id: initialId(PDA, word),
      last: null, // índice de la última transición usada
      steps: 0, // toques correctos en este intento
      errors: [],
      swapUntil: null, // hasta cuándo dura la pantalla del cambio de papel
      lastTapAt: null,
      acceptedMs: null,
      outMs: null,
    }]));
    return { seed, word, mode, teams, accepted: [] };
  },

  // Un toque: el estado al que pasa el autómata. Es correcto si hay una transición a ese estado y,
  // desde ahí, la cadena todavía se puede aceptar.
  onInput(state, ctx) {
    const { teamId, slot, input, now, window, settings } = ctx;
    const team = state.teams[teamId];
    if (input.type !== 'tap' || !team || !PDA.states.includes(input.state)) return fail('invalid_input');
    if (team.acceptedMs !== null) return fail('already_accepted');
    if (team.outMs !== null) return fail('no_attempts');
    if (team.swapUntil !== null && now < team.swapUntil) return fail('swapping');
    if (trazaRole(ctx, teamId, slot, team) === 'string') return fail('not_diagram');
    // Un segundo toque muy seguido es un dedo nervioso, no una decisión: se ignora.
    if (team.lastTapAt !== null && now - team.lastTapAt < settings.doubleTapMs) return fail('too_fast');
    team.lastTapAt = now;
    const ms = Math.max(0, now - window.start);

    const move = tapMove(PDA, team.id, input.state, state.mode);
    if (move) {
      team.id = move.next;
      team.last = move.transition;
      team.steps += 1;
      const step = { attempt: team.attempt, steps: team.steps, ...stepOf(move.transition) };
      if (!isAccepting(PDA, team.id, state.mode)) return { ok: true, correct: true, event: { type: 'traza_step', ...step } };
      team.acceptedMs = ms;
      state.accepted.push(teamId);
      return {
        ok: true,
        correct: true,
        accepted: true,
        event: { type: 'traza_accepted', place: state.accepted.length, ms, attempt: team.attempt, steps: team.steps },
      };
    }

    const correct = correctMove(PDA, team.id, state.mode);
    const error = {
      attempt: team.attempt,
      tapped: input.state,
      // Había una transición a ese estado, pero por esa rama ya no se acepta (no determinismo).
      deadBranch: moves(PDA, team.id).some((m) => PDA.transitions[m.transition].to === input.state),
      at: { state: team.id.state, top: team.id.stack[0] ?? null, next: team.id.input[0] ?? null },
      correct: correct ? stepOf(correct.transition) : null,
      ms,
    };
    team.errors.push(error);
    if (team.attempt >= settings.attempts) {
      team.outMs = ms;
      return { ok: true, correct: false, out: true, event: { type: 'traza_out', ...error } };
    }
    // Cambian de papel y empiezan de nuevo con la misma cadena; el tiempo sigue corriendo.
    team.attempt += 1;
    team.diagram = other(team.diagram);
    team.id = initialId(PDA, state.word);
    team.last = null;
    team.steps = 0;
    team.swapUntil = now + settings.swapMs;
    return { ok: true, correct: false, swap: true, event: { type: 'traza_error', ...error, diagram: team.diagram } };
  },

  // La pantalla del cambio de papel termina sola: al vencer, se difunde la vista nueva.
  nextWakeup(state) {
    const times = Object.values(state.teams).map((team) => team.swapUntil).filter((at) => at !== null);
    return times.length > 0 ? Math.min(...times) : null;
  },

  onWakeup(state, { now }) {
    for (const team of Object.values(state.teams)) {
      if (team.swapUntil !== null && team.swapUntil <= now) team.swapUntil = null;
    }
  },

  shiftTimes(state, delta) {
    for (const team of Object.values(state.teams)) {
      if (team.swapUntil !== null) team.swapUntil += delta;
      if (team.lastTapAt !== null) team.lastTapAt += delta;
    }
  },

  isFinished(state, { activeTeamIds }) {
    const done = (id) => state.teams[id] && (state.teams[id].acceptedMs !== null || state.teams[id].outMs !== null);
    return activeTeamIds.length > 0 && activeTeamIds.every(done);
  },

  scores(state, { groups }) {
    return groups.map(([teamId]) => state.teams[teamId]?.acceptedMs ?? null);
  },

  // Premios: 1000 y el fragmento al primero en aceptar; a los demás que aceptan, según el tiempo
  // que les sobró (valores de la ronda 1). Dos aceptaciones en el mismo milisegundo comparten
  // puesto, salvo en el primero: ese empate lo decide un Duelo (`tie`); con `tiebreak`, el ganador
  // queda 1.º y los demás empatados, 2.º. `replay`: la traza que acepta la cadena de la partida,
  // para repasarla en el proyector.
  results(state, { groups, settings, tiebreak = null }) {
    const msOf = (teamId) => state.teams[teamId].acceptedMs;
    const firstMs = state.accepted.length > 0 ? msOf(state.accepted[0]) : null;
    const { winner, tie } = settleTop(state.accepted.filter((id) => msOf(id) === firstMs), tiebreak);
    const order = winner ? [winner, ...state.accepted.filter((id) => id !== winner)] : state.accepted;
    const places = {};
    order.forEach((teamId, index) => {
      const previous = order[index - 1];
      places[teamId] = previous && previous !== winner && msOf(previous) === msOf(teamId) ? places[previous] : index + 1;
    });
    const label = (teamId) => {
      const team = state.teams[teamId];
      if (team.acceptedMs !== null) {
        return `${places[teamId]}.º · ${(team.acceptedMs / 1000).toFixed(1)} s · ${team.attempt === 1 ? '1.er' : '2.º'} intento`;
      }
      return team.outMs !== null ? 'Sin intentos' : 'No terminó';
    };
    return {
      groups: groups.map(([teamId]) => ({
        teamIds: [teamId],
        score: state.teams[teamId].acceptedMs,
        rank: places[teamId] ?? null,
        winner: places[teamId] !== undefined,
        label: label(teamId),
      })),
      awards: state.accepted.map((teamId) => ({
        teamId,
        points: places[teamId] === 1 ? settings.firstPrize : timePrize(settings, msOf(teamId)),
        streak: 0,
      })),
      fragments: winner ? [winner] : [],
      tie,
      replay: {
        word: state.word,
        mode: state.mode,
        pda: DIAGRAM,
        steps: (acceptingTrace(PDA, state.word, state.mode) ?? []).map((move) => ({ ...stepOf(move.transition), id: move.next })),
      },
    };
  },

  // Cada celular recibe solo lo de su papel: el diagrama no ve la cadena ni la forma de aceptar, y
  // la cadena no ve el estado, la pila ni cuántos pasos llevan. El proyector solo ve tiempos e
  // intentos (si mostrara el diagrama, el de la cadena podría mirarlo en la pared). El host ve todo.
  view(state, ctx) {
    const { viewer, settings, now } = ctx;
    const progress = Object.entries(state.teams).map(([teamId, team]) => ({
      teamId,
      attempt: team.attempt,
      lost: team.errors.length,
      acceptedMs: team.acceptedMs,
      outMs: team.outMs,
      place: team.acceptedMs === null ? null : state.accepted.indexOf(teamId) + 1,
    }));
    const base = { attempts: settings.attempts, progress };
    if (viewer.role === 'host') {
      return {
        ...base,
        word: state.word,
        mode: state.mode,
        teams: Object.fromEntries(Object.entries(state.teams).map(([teamId, team]) => [teamId, { id: team.id, steps: team.steps }])),
      };
    }
    const team = viewer.role === 'play' ? state.teams[viewer.teamId] : null;
    const role = team ? trazaRole(ctx, viewer.teamId, viewer.slot, team) : null;
    if (!role) return base;
    const diagram = role !== 'string';
    const string = role !== 'diagram';
    const lastError = team.errors.at(-1) ?? null;
    const done = team.acceptedMs !== null || team.outMs !== null;
    return {
      ...base,
      role,
      attempt: team.attempt,
      // La pantalla del error: con el paso correcto mientras dura el cambio; sin él si se quedaron
      // sin intentos (los demás equipos siguen con la misma cadena).
      swapUntil: team.swapUntil !== null && team.swapUntil > now ? team.swapUntil : null,
      error: lastError && (team.outMs !== null ? { ...lastError, correct: null } : team.swapUntil !== null && team.swapUntil > now ? lastError : null),
      acceptedMs: team.acceptedMs,
      out: team.outMs !== null,
      place: team.acceptedMs === null ? null : state.accepted.indexOf(viewer.teamId) + 1,
      pda: diagram ? DIAGRAM : null,
      current: diagram || done ? { state: team.id.state, stack: team.id.stack } : null,
      last: diagram && team.last !== null ? stepOf(team.last) : null,
      steps: diagram ? team.steps : null,
      word: string ? state.word : null,
      mode: string || done ? state.mode : null,
    };
  },
};
