// Flappy (RF-MJ4): cada dispositivo controla su propio pájaro en el mismo nivel. La física corre en
// el celular (respuesta inmediata al toque) y el servidor la verifica: el celular informa cada
// 200 ms hasta qué tick llegó y en qué ticks aleteó, y el servidor re-simula esos aleteos con el
// mismo código (client/shared/flappy-physics.js). Lo que cuenta es la simulación del servidor.
import { generateLevel, initialState, simulate, TICK_MS } from '../../client/shared/flappy-physics.js';
import { settleTop, topTeams } from '../domain/Grouping.js';
import { createRng } from '../domain/random.js';

const SLOTS = ['A', 'B'];
const fail = (error) => ({ ok: false, error });
const keyOf = (teamId, slot) => `${teamId}:${slot}`;
const round1 = (n) => Math.round(n * 10) / 10;

const reply = ({ sim }, quiet) => ({ ok: true, quiet, tick: sim.tick, status: sim.status, x: round1(sim.x) });

export const flappy = {
  id: 'flappy',
  grouping: 'teams',
  metric: 'llegadas',
  fragmentRule: 'El equipo con más jugadores que lleguen a la meta gana un fragmento de estrella.',
  playMs: (settings) => settings.levelMs + settings.extraMs,
  graceMs: () => 500, // el último informe puede venir en camino

  init({ settings, random }) {
    const seed = Math.floor(random() * 2 ** 31); // queda en el log (RNF-17)
    return { seed, level: generateLevel(settings, createRng(seed)), players: {} };
  },

  // input = { type: 'fly', tick, flaps }: el celular llegó a `tick` y aleteó en esos ticks (los que
  // el servidor aún no confirmó; puede repetir algunos ya aplicados).
  onInput(state, ctx) {
    const { teamId, slot, input, now, window, settings } = ctx;
    if (input.type !== 'fly') return fail('invalid_input');
    const key = keyOf(teamId, slot);
    const player = (state.players[key] ??= { teamId, slot, sim: initialState(state.level), flaps: [] });
    const { sim } = player;
    if (sim.status !== 'playing' || input.tick <= sim.tick) return reply(player, true);
    // RF-MJ4-06: el progreso solo avanza y no puede ir más rápido que el reloj (con un margen por el
    // error de sincronización).
    const allowed = Math.floor((now - window.start + settings.toleranceMs) / TICK_MS);
    if (input.tick > allowed) return fail('implausible_progress');
    const fresh = input.flaps.filter((tick) => tick >= sim.tick);
    if (fresh.some((tick, i) => tick >= input.tick || (i > 0 && tick <= fresh[i - 1]))) return fail('invalid_input');

    player.flaps.push(...fresh);
    simulate(state.level, sim, fresh, input.tick);
    if (sim.status === 'playing') return reply(player, true);
    // Llegada o choque confirmados al re-simular (RF-MJ4-07): se difunde de inmediato y el registro
    // de aleteos queda en el log.
    return {
      ...reply(player, false),
      event: {
        type: sim.status === 'arrived' ? 'flappy_arrival' : 'flappy_crash',
        slot,
        x: round1(sim.x),
        tick: sim.tick,
        flaps: player.flaps,
      },
    };
  },

  // Termina antes si ya no queda ningún dispositivo conectado en juego.
  isFinished(state, ctx) {
    const rows = participants(state, ctx);
    return rows.length > 0 && !rows.some((row) => row.status === 'playing' && ctx.slotConnected(row.teamId, row.slot));
  },

  scores(state, { groups }) {
    return groups.map(([teamId]) => arrivedOf(state, teamId).length);
  },

  // RF-MJ4-08: 500 puntos por cada jugador del equipo que llega (1000 si llegan ambos; valores de
  // la ronda 1, se escalan con la ronda). El fragmento es para el equipo con más jugadores que
  // llegaron; si varios empatan, se desempata con un Duelo (`tie`, o `tiebreak` ya jugado).
  results(state, ctx) {
    const { groups, settings, tiebreak = null } = ctx;
    const { tied } = topTeams(groups.map(([teamId]) => teamId), (teamId) => arrivedOf(state, teamId).length);
    const { winner, tie } = settleTop(tied, tiebreak);
    const rows = groups.map(([teamId]) => {
      const arrived = arrivedOf(state, teamId).length;
      const played = Object.values(state.players).filter((p) => p.teamId === teamId).length;
      return {
        teamIds: [teamId],
        score: arrived,
        winner: arrived > 0,
        label: arrived === 0 ? 'Nadie llegó' : `${arrived === 1 ? 'Llegó' : 'Llegaron'} ${arrived} de ${played}`,
      };
    });
    return {
      groups: rows,
      awards: rows
        .filter((row) => row.score > 0)
        .map((row) => ({ teamId: row.teamIds[0], points: row.score * settings.prizePerPlayer, streak: 0 })),
      fragments: winner ? [winner] : [],
      tie,
    };
  },

  // Todos ven el avance de todos (RF-MJ4-09). El jugador recibe además el nivel y el estado de su
  // pájaro según el servidor, para retomarlo si recarga la página (RF-MJ-04).
  view(state, ctx) {
    const { viewer } = ctx;
    const base = { length: state.level.length, players: participants(state, ctx) };
    if (viewer.role !== 'play' || !viewer.teamId) return base;
    const player = state.players[keyOf(viewer.teamId, viewer.slot)];
    return { ...base, level: state.level, progressMs: ctx.settings.progressMs, me: player ? { ...player.sim } : null };
  },
};

function arrivedOf(state, teamId) {
  return Object.values(state.players).filter((p) => p.teamId === teamId && p.sim.status === 'arrived');
}

// Los dispositivos de los equipos en juego: los que ya informaron y los conectados que aún no.
function participants(state, { groups, slotConnected }) {
  const rows = [];
  for (const [teamId] of groups) {
    for (const slot of SLOTS) {
      const player = state.players[keyOf(teamId, slot)];
      if (!player && !slotConnected(teamId, slot)) continue;
      rows.push({ teamId, slot, x: player ? round1(player.sim.x) : 0, status: player?.sim.status ?? 'playing' });
    }
  }
  return rows;
}
