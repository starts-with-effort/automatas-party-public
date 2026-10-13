// Draft de objetos (sección 4.5): cada equipo recibe una oferta según su suerte y elige.
import { buildOffer, canAppear, challengeTeams } from '../domain/Luck.js';
import { pickDistinct } from '../domain/random.js';
import { rankTeams } from '../domain/ranking.js';
import { giveItem } from '../domain/teams.js';

const fail = (error) => ({ ok: false, error });

export const draftPhase = {
  durationMs: (config) => config.timings.draft,
  acceptsActions: true,

  // Las ofertas se calculan al entrar. El Ticket Dorado y el objeto adicional se consumen al
  // salir: si el servidor se reinicia a mitad del draft, el equipo no los pierde.
  // Además de la suerte: el Desafío aparece en las ofertas de 1 o 2 equipos (challengeTeams), las
  // defensas como mucho una vez por partida y la Poción solo para el 1.º (canAppear). Los equipos
  // se recorren en orden al azar, para que el primero en recibir una defensa no sea siempre el mismo.
  enter({ room, phase, config, random, record }) {
    const positions = new Map(rankTeams(room.teams).map((row) => [row.teamId, row.position]));
    const tickets = new Set((room.activeEffects ?? [])
      .filter((effect) => effect.appliesTo === 'draft' && effect.code === 'TD')
      .map((effect) => effect.targetTeamId));
    // Lo ofrecido en este reparto se guarda aparte: si se rehace (reinicio del servidor), no cuenta dos veces.
    room.offered ??= {};
    const now = (room.offered[phase.round] = {});
    const offered = (code) => Object.values(room.offered).reduce((sum, counts) => sum + (counts[code] ?? 0), 0);
    const challenged = new Set(challengeTeams({ config, teams: room.teams, random }));
    phase.data = { offers: {}, chosen: {} };
    for (const team of pickDistinct(room.teams, room.teams.length, random)) {
      const position = positions.get(team.id);
      const offer = buildOffer({
        config,
        position,
        goldenTicket: tickets.has(team.id),
        extraItem: Boolean(team.pendingExtraItem),
        random,
        allowed: (code) => canAppear(config, code, { position, offered }),
        include: challenged.has(team.id) ? ['DS'] : [],
      });
      for (const code of [...offer.codes, offer.extra].filter(Boolean)) now[code] = (now[code] ?? 0) + 1;
      phase.data.offers[team.id] = { offerId: `${phase.seq}-${team.id}`, ...offer };
    }
    record('items_offered', { round: phase.round, offers: phase.data.offers });
  },

  // Cualquiera de los dos dispositivos elige; la primera confirmación es la definitiva (RF-OBJ-06).
  onAction({ phase }, { teamId, action }) {
    if (action.type !== 'pick') return fail('invalid_action');
    const offer = phase.data.offers[teamId];
    if (phase.data.chosen[teamId]) return fail('already_picked');
    if (action.offerId !== offer.offerId) return fail('wrong_offer');
    const codes = [...new Set(action.codes)];
    if (codes.length !== offer.picks || !codes.every((code) => offer.codes.includes(code))) return fail('invalid_pick');
    phase.data.chosen[teamId] = codes;
    return { ok: true, event: { type: 'items_picked', codes, luck: offer.luck } };
  },

  isComplete({ phase, activeTeamIds }) {
    return activeTeamIds.length > 0 && activeTeamIds.every((id) => phase.data.chosen[id]);
  },

  // Quien no eligió a tiempo recibe al azar uno de los objetos ofrecidos (RF-OBJ-07).
  exit({ room, phase, random, record }) {
    for (const team of room.teams) {
      const offer = phase.data.offers[team.id];
      let codes = phase.data.chosen[team.id];
      if (!codes) {
        codes = pickDistinct(offer.codes, offer.picks, random);
        record('items_assigned', { teamId: team.id, codes });
      }
      for (const code of codes) giveItem(room, team, code, phase.round);
      if (offer.extra) giveItem(room, team, offer.extra, phase.round);
      team.pendingExtraItem = false;
    }
    room.activeEffects = (room.activeEffects ?? []).filter((effect) => effect.appliesTo !== 'draft');
  },

  view(ctx, viewer) {
    const { phase, activeTeamIds } = ctx;
    const base = { pickedTeamIds: Object.keys(phase.data.chosen), expectedTeamIds: activeTeamIds };
    if (viewer.role === 'host') return { ...base, offers: phase.data.offers, chosen: phase.data.chosen };
    if (viewer.role !== 'play') return base;
    const mine = ctx.teamOf(viewer.deviceId);
    if (!mine) return base;
    return { ...base, offer: phase.data.offers[mine.team.id], chosen: phase.data.chosen[mine.team.id] ?? null };
  },
};
