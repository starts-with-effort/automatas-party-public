// Uso de objetos y resolución (sección 4.6). Las declaraciones son secretas hasta la resolución
// (RF-USO-02); al cerrar la fase se resuelven todas juntas con EffectResolver (RF-USO-04).
import { queueDuel } from '../domain/duel.js';
import { resolveItemUse } from '../domain/EffectResolver.js';
import { ITEM_DEFS, itemParams } from '../domain/items/index.js';
import { addPoints, setStreak } from '../domain/teams.js';
import { ROUNDS } from '../core/RoundPlan.js';

const fail = (error) => ({ ok: false, error });

// Repetirlos en la misma fase no suma nada: se rechaza para que el equipo no lo desperdicie.
const ONCE_PER_TURN = new Set(['EF', 'EA', 'E', 'SV', 'CR', 'DN', 'TD']);

export const itemUsePhase = {
  durationMs: (config) => config.timings.itemUse,
  acceptsActions: true,

  // Foto de cada equipo al empezar la fase (rediseño, fase 4): el selector de objetivo muestra la racha,
  // los puntos del juego y los fragmentos y estrellas de entonces. No se actualiza con lo que otros
  // declaren: las declaraciones son secretas y se aplican en la resolución.
  enter({ room, phase }) {
    const snapshot = Object.fromEntries(room.teams.map((team) => [team.id, {
      streak: team.streak, score: team.score, fragments: team.fragments ?? 0, stars: team.stars ?? 0,
    }]));
    phase.data = { declarations: [], confirmedTeamIds: [], nextSeq: 1, snapshot };
  },

  onAction({ room, phase }, { teamId, action }) {
    const data = phase.data;
    if (data.confirmedTeamIds.includes(teamId)) return fail('already_confirmed');
    const team = room.teams.find((t) => t.id === teamId);

    if (action.type === 'declare') {
      const item = (team.inventory ?? []).find((i) => i.id === action.itemId);
      if (!item) return fail('unknown_item');
      if (data.declarations.some((d) => d.itemId === item.id)) return fail('already_declared');
      const def = ITEM_DEFS[item.code];
      let targetTeamId = null;
      if (def.target === 'ONE') {
        if (!action.targetTeamId) return fail('target_required');
        if (action.targetTeamId === teamId) return fail('self_target'); // RF-USO-07
        if (!room.teams.some((t) => t.id === action.targetTeamId)) return fail('unknown_team');
        targetTeamId = action.targetTeamId;
      }
      if (def.timing === 'SIGUIENTE_DRAFT' && phase.round >= ROUNDS) return fail('no_next_draft');
      if (ONCE_PER_TURN.has(def.code) && data.declarations.some((d) => d.teamId === teamId && d.code === def.code)) {
        return fail('duplicate_effect');
      }
      data.declarations.push({ seq: data.nextSeq++, teamId, itemId: item.id, code: item.code, targetTeamId });
      return { ok: true, event: { type: 'item_declared', itemId: item.id, code: item.code, targetTeamId } };
    }

    if (action.type === 'undeclare') {
      const index = data.declarations.findIndex((d) => d.teamId === teamId && d.itemId === action.itemId);
      if (index === -1) return fail('not_declared');
      const [removed] = data.declarations.splice(index, 1);
      return { ok: true, event: { type: 'item_undeclared', itemId: removed.itemId, code: removed.code } };
    }

    if (action.type === 'confirm') {
      data.confirmedTeamIds.push(teamId);
      return { ok: true, event: { type: 'items_confirmed', count: data.declarations.filter((d) => d.teamId === teamId).length } };
    }

    return fail('invalid_action');
  },

  // Termina al vencer el plazo o cuando todos confirman; lo declarado sin confirmar también se usa
  // y lo no declarado se queda en el inventario (RF-USO-03).
  isComplete({ phase, activeTeamIds }) {
    return activeTeamIds.length > 0 && activeTeamIds.every((id) => phase.data.confirmedTeamIds.includes(id));
  },

  exit({ room, phase, config, record }) {
    const { declarations } = phase.data;
    const before = room.teams.map(({ id, score, streak }) => ({ id, score, streak }));
    const result = resolveItemUse({
      teams: before,
      declarations,
      paramsFor: (code) => itemParams(config, code),
    });

    for (const row of result.final) {
      const team = room.teams.find((t) => t.id === row.teamId);
      addPoints(team, row.score - team.score);
      setStreak(team, row.streak);
    }
    const used = new Set(declarations.map((d) => d.itemId));
    for (const team of room.teams) team.inventory = (team.inventory ?? []).filter((item) => !used.has(item.id));
    // RF-USO-06. Los Desafíos que no se bloquearon van a la cola de duelos (fase de Duelo siguiente).
    room.activeEffects = [...(room.activeEffects ?? []), ...result.effects.filter((effect) => effect.appliesTo !== 'duel')];
    for (const effect of result.effects.filter((e) => e.appliesTo === 'duel')) {
      queueDuel(room, {
        kind: 'desafio',
        round: phase.round,
        sides: [[effect.sourceTeamId], [effect.targetTeamId]],
      });
    }

    const summary = before.map(({ id, score, streak }) => {
      const team = room.teams.find((t) => t.id === id);
      return { teamId: id, scoreBefore: score, scoreAfter: team.score, streakBefore: streak, streakAfter: team.streak };
    });
    room.resolutions = { ...room.resolutions, [phase.round]: { events: result.events, teams: summary } };
    record('items_resolved', { round: phase.round, declarations, events: result.events, effects: result.effects, teams: summary });
  },

  // Cada equipo ve solo lo suyo; el resto solo sabe quién confirmó (7.2).
  view(ctx, viewer) {
    const { phase, activeTeamIds } = ctx;
    const base = {
      confirmedTeamIds: phase.data.confirmedTeamIds,
      expectedTeamIds: activeTeamIds,
      nextDraft: phase.round < ROUNDS,
    };
    if (viewer.role !== 'play') return base;
    const mine = ctx.teamOf(viewer.deviceId);
    if (!mine) return base;
    return {
      ...base,
      snapshot: phase.data.snapshot ?? {},
      declared: phase.data.declarations
        .filter((d) => d.teamId === mine.team.id)
        .map(({ itemId, code, targetTeamId }) => ({ itemId, code, targetTeamId })),
    };
  },
};

// Pantalla de resolución: secuencia de lo que hizo cada objeto (RF-USO-08). Espera al host.
export const resolutionPhase = {
  durationMs: () => null,
  waitsHost: true,
  view({ room, phase }) {
    return room.resolutions?.[phase.round] ?? { events: [], teams: [] };
  },
};
