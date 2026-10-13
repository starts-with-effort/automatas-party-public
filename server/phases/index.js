// Tipos de fase (patrón State, sección 3.4). Cada tipo define:
//   durationMs(config, step) → duración, o null si espera al host
//   waitsHost / terminal / acceptsActions
//   enter(ctx), onAction(ctx, { teamId, deviceId, action }), isComplete(ctx), exit(ctx)
//   nextWakeup(ctx) → próximo instante en que la fase debe actuar sola; onWakeup(ctx)
//   shiftTimes(ctx, delta) → desplaza instantes propios tras una pausa
//   frameMs(ctx) / onFrame(ctx) → { frame, events }: fases en tiempo real (la Arena); el motor llama
//     a onFrame cada frameMs y difunde el fotograma sin guardar ni rehacer las vistas
//   view(ctx, viewer) → datos de la fase que ve ese dispositivo
//   skip?({ room, config, step }) → true si esta vez la fase no hace falta (el Duelo sin duelos
//     pendientes): el motor pasa directo a la siguiente sin anunciarla
// ctx = { room, phase, config, activeTeamIds, now, random, presence, teamOf, isConnected, record }.
import { rankTeams } from '../domain/ranking.js';
import { highlights } from '../domain/stats.js';
import { draftPhase } from './draft.js';
import { duelPhase } from './duel.js';
import { itemUsePhase, resolutionPhase } from './itemUse.js';
import { minigameGroupsPhase, minigameIntroPhase, minigamePhase, minigameResultPhase, roulettePhase } from './minigame.js';
import { questionPhase, questionResultPhase } from './question.js';

export const PHASES = {
  question: questionPhase,
  questionResult: questionResultPhase,
  draft: draftPhase,
  roulette: roulettePhase,
  minigameGroups: minigameGroupsPhase,
  minigameIntro: minigameIntroPhase,
  minigame: minigamePhase,
  minigameResult: minigameResultPhase,
  duel: duelPhase,
  itemUse: itemUsePhase,
  resolution: resolutionPhase,
  ranking: rankingPhase({ terminal: false }),
  finalRanking: rankingPhase({ terminal: true }),
};

function rankingPhase({ terminal }) {
  return {
    durationMs: () => null,
    waitsHost: true,
    terminal,
    enter({ room, phase, record, events = [] }) {
      // El puesto anterior se guarda en la fase: si se reanuda desde un snapshot, el
      // cambio de puesto se calcula igual (RF-RNK-01).
      const previous = room.lastPositions;
      phase.data = {
        ranking: rankTeams(room.teams).map((row) => ({
          ...row,
          delta: previous[row.teamId] == null ? null : previous[row.teamId] - row.position,
        })),
      };
      // Ranking final: podio y datos destacados (RF-RNK-03). Se guardan en la fase, como el ranking.
      if (terminal) phase.data.highlights = highlights({ events, teams: room.teams });
      // Puntaje de cada equipo al final de cada ronda (RF-EST-01) y antes del uso de objetos.
      record('ranking', { round: phase.round, ...(phase.before ? { before: true } : {}), ranking: phase.data.ranking });
    },
    exit({ room, phase }) {
      room.lastPositions = Object.fromEntries(phase.data.ranking.map((row) => [row.teamId, row.position]));
    },
    view({ phase }) {
      return phase.data;
    },
  };
}
