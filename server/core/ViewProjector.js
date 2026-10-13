// Construye la vista de cada dispositivo según su rol (sección 3.3). Solo incluye lo que
// ese dispositivo puede ver: el cliente es un renderizador delgado y al reconectar basta
// con reenviarle su vista. Formato documentado en docs/PROTOCOL.md.
import { workshopSummary, workshopView } from '../domain/workshop.js';
import { PHASES } from '../phases/index.js';
import { SLOTS } from './GameEngine.js';

export function projectView(engine, viewer, { consoles = [] } = {}) {
  const { room } = engine.state;
  const view = { role: viewer.role, room: null, teams: [], phase: null };
  if (viewer.role === 'play') view.me = meView(engine, viewer.deviceId);
  if (viewer.role === 'host') {
    const { minCount, maxCount, defaultCount } = engine.config.teams;
    view.teamLimits = { minCount, maxCount, defaultCount };
    view.unassigned = unassignedDevices(engine);
    view.consoles = consoles;
    // Para el selector de sala de práctica del panel.
    view.minigames = engine.config.minigames.map(({ id, name }) => ({ id, name }));
  }
  if (!room) return view;

  view.room = {
    id: room.id,
    lobbyOpen: room.lobbyOpen,
    started: room.started,
    finished: room.finished,
    recovered: room.recovered,
    paused: room.paused,
    planLength: engine.plan.length,
    practice: room.practice ?? null,
    // Sala con registro y taller: cuántos equipos caben y cuántos integrantes puede tener cada uno.
    workshop: room.workshop ? { maxTeams: room.workshop.maxTeams, members: engine.config.workshop.members } : null,
    fragmentsPerStar: engine.config.stars.fragmentsPerStar, // puntas de la estrella que se dibuja
  };
  view.teams = room.teams.map((team) => teamView(engine, team, viewer.role));
  // Taller: mientras no empiece la partida, los celulares de un equipo ven el estado de su taller.
  if (viewer.role === 'play' && room.workshop && !room.started) {
    const mine = engine.teamOf(viewer.deviceId)?.team;
    view.workshop = mine?.workshop ? workshopView(mine.workshop) : null;
  }
  if (room.phase) view.phase = phaseView(engine, viewer);
  if (viewer.role === 'host' && room.phase) {
    // En la práctica el plan da la vuelta: después del resultado vienen otra vez las instrucciones.
    // Los Duelos sin duelos pendientes se saltan: no se anuncian.
    const next = room.practice ? [...engine.plan, ...engine.plan] : engine.plan;
    view.upcoming = next
      .slice(room.phase.index + 1)
      .filter((step) => !PHASES[step.kind].skip?.({ room, config: engine.config, step }))
      .slice(0, 3)
      .map((step) => ({ ...step, minigameName: step.minigame ? minigameName(engine.config, step.minigame) : null }));
  }
  return view;
}

// El inventario de un equipo solo lo ven sus dos dispositivos (y el host).
function meView(engine, deviceId) {
  const current = engine.teamOf(deviceId);
  return {
    deviceId,
    teamId: current?.team.id ?? null,
    slot: current?.slot ?? null,
    inventory: current ? (current.team.inventory ?? []).map(({ id, code }) => ({ id, code })) : [],
  };
}

function teamView(engine, team, role) {
  const detailed = role === 'host';
  const slots = {};
  for (const slot of SLOTS) {
    const deviceId = team.slots[slot];
    slots[slot] = deviceId === null ? null : slotView(engine, deviceId, detailed);
  }
  const { id, name, color, score, streak, fragments = 0, stars = 0, starPoints = 0, members = [] } = team;
  // score: puntos del juego; starPoints: pozo de estrellas; total: los dos (lo que ordena el ranking).
  const view = { id, name, color, members, score, streak, fragments, stars, starPoints, total: score + starPoints, slots };
  if (detailed) view.inventory = (team.inventory ?? []).map((item) => item.code);
  // Taller: el proyector solo sabe si el equipo ya terminó (no compara avances); el host ve por dónde
  // va cada uno. Los demás celulares no ven nada del taller de otro equipo.
  if (team.workshop && role !== 'play') view.workshopDone = team.workshop.finishedAt !== null;
  if (team.workshop && detailed) view.workshop = workshopSummary(team.workshop);
  return view;
}

function slotView(engine, deviceId, detailed) {
  const presence = engine.presence.get(deviceId) ?? {};
  const connected = Boolean(presence.connected);
  if (!detailed) return { connected };
  return {
    deviceId,
    connected,
    rtt: presence.rtt ?? null,
    offset: presence.offset ?? null,
    platform: presence.platform ?? null,
  };
}

// Dispositivos conectados que todavía no están en un equipo (solo los ve el host).
function unassignedDevices(engine) {
  return [...engine.presence.entries()]
    .filter(([deviceId, presence]) => presence.connected && !engine.teamOf(deviceId))
    .map(([deviceId]) => slotView(engine, deviceId, true));
}

function phaseView(engine, viewer) {
  const { data, ...phase } = engine.room.phase;
  const handler = PHASES[phase.kind];
  return {
    ...phase,
    terminal: Boolean(handler.terminal),
    minigameName: phase.minigame ? minigameName(engine.config, phase.minigame) : null,
    data: handler.view ? handler.view(engine.ctx(), viewer) : {},
  };
}

function minigameName(config, id) {
  return config.minigames.find((entry) => entry.id === id)?.name ?? id;
}
