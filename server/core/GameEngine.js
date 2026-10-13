// Máquina de estados de la partida (servidor autoritativo, RF-FLU-02). Todo cambio de
// estado pasa por aquí: los clientes solo envían intenciones. Cada método público
// devuelve { ok: true, ... } o { ok: false, error: '<código>' } (ver docs/PROTOCOL.md).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRng, mixSeed } from '../domain/random.js';
import { cleanMembers, cleanTeamName, sameName } from '../domain/registration.js';
import { addPoints } from '../domain/teams.js';
import { newWorkshop, workshopAct } from '../domain/workshop.js';
import { PHASES } from '../phases/index.js';
import { systemClock } from './clock.js';
import { log as defaultLogger } from './log.js';
import { SNAPSHOT_VERSION } from './Persistence.js';
import { isImplemented } from '../minigames/index.js';
import { planFor } from './RoundPlan.js';

export const SLOTS = ['A', 'B'];
// Instantes absolutos que puede tener una fase; la pausa los desplaza todos.
const PHASE_TIMES = ['startsAt', 'answersAt', 'playStartsAt', 'endsAt', 'closeAt'];
const THROTTLE_MS = 250;

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

export const hasDevices = (team) => team.slots.A !== null || team.slots.B !== null;

export class GameEngine extends EventEmitter {
  constructor({ config, clock = systemClock, persistence = null, logger = defaultLogger }) {
    super();
    this.config = config;
    this.clock = clock;
    this.persistence = persistence;
    this.logger = logger;
    this.presence = new Map(); // deviceId → { connected, rtt, offset, platform, lastSeen }; no se persiste
    this.timer = null; // plazo de la fase
    this.wakeTimer = null; // eventos dentro de la fase (p. ej. pasos de Contrarreloj)
    this.frameTimer = null; // fotogramas de los minijuegos en tiempo real (la Arena)
    this.throttleTimer = null; // difusión limitada de cambios frecuentes (minijuegos)
    this.random = Math.random; // se reemplaza por un generador con semilla en cada fase
    this.events = []; // log de la sala actual, también en memoria: estadísticas y exportación (Fase 8)
    this.state = this.restore() ?? { version: SNAPSHOT_VERSION, phaseSeq: 0, devices: {}, room: null };
    this.plan = planFor(config, this.room); // la partida completa o, en una sala de práctica, un minijuego
    if (this.room?.recovered) this.record('game_recovered', { phase: this.room.phase.id });
  }

  get room() {
    return this.state.room;
  }

  stop() {
    this.clearTimer();
    if (this.throttleTimer) this.clock.clearTimeout(this.throttleTimer);
    this.throttleTimer = null;
  }

  // ---------------------------------------------------------------- dispositivos

  registerDevice() {
    const token = randomBytes(16).toString('hex');
    let id;
    do id = `d${randomBytes(3).toString('hex')}`; while (this.state.devices[id]);
    this.state.devices[id] = { id, tokenHash: hashToken(token), createdAt: this.clock.now() };
    this.changed();
    return { deviceId: id, token };
  }

  authenticate(token) {
    if (typeof token !== 'string' || token.length > 128) return null;
    const hash = hashToken(token);
    return Object.values(this.state.devices).find((device) => device.tokenHash === hash)?.id ?? null;
  }

  setPresence(deviceId, patch) {
    this.presence.set(deviceId, { ...this.presence.get(deviceId), ...patch });
    this.changed({ persist: false });
  }

  teamOf(deviceId) {
    for (const team of this.room?.teams ?? []) {
      for (const slot of SLOTS) if (team.slots[slot] === deviceId) return { team, slot };
    }
    return null;
  }

  // ---------------------------------------------------------------- sala y lobby

  // practice: id de un minijuego para una sala de práctica (solo ese minijuego, en bucle); null o
  // ausente para la partida completa. workshop: sala con registro y taller (docs/TALLER.md): empieza
  // sin equipos y cada grupo registra el suyo desde un celular, hasta teamCount equipos.
  createRoom({ teamCount, names = [], confirm = false, practice = null, workshop = false }) {
    const { minCount, maxCount } = this.config.teams;
    if (this.room?.started && !this.room.finished && !confirm) return fail('game_in_progress');
    if (!Number.isInteger(teamCount) || teamCount < minCount || teamCount > maxCount) {
      return fail('invalid_team_count');
    }
    if (practice !== null && !isImplemented(practice)) return fail('unknown_minigame');
    if (workshop && practice !== null) return fail('invalid_room_type');
    this.clearTimer();
    const now = this.clock.now();
    const teams = workshop
      ? []
      : Array.from({ length: teamCount }, (_, i) => this.newTeam(i, names[i]?.trim() || this.config.teams.names[i]));
    this.state.room = {
      id: roomId(now),
      createdAt: now,
      seed: randomInt(2 ** 31), // semilla de los minijuegos, registrada en el log (RNF-17)
      lobbyOpen: true,
      started: false,
      finished: false,
      recovered: false,
      paused: null,
      phase: null,
      teams,
      lastPositions: {},
      questionResults: {}, // número de pregunta → resultados por equipo
      itemSeq: 0, // para los ids de los objetos
      activeEffects: [], // efectos diferidos: { code, sourceTeamId, targetTeamId, appliesTo } (RF-USO-06)
      resolutions: {}, // ronda → eventos de la resolución de objetos
      minigameSetup: null, // grupos del minijuego en curso (se forman en las instrucciones)
      minigameResults: {}, // ronda → grupos, puntajes y premios del minijuego
      pendingMinigame: null, // minijuego empatado: lo que gana cada lado si gana el Duelo
      duels: [], // duelos por jugar: desempates de minijuego y Desafíos (server/phases/duel.js)
      duelSeq: 0,
      offered: {}, // ronda → { código: veces ofrecido } (objetos con tope por partida)
      // Sala de práctica: el minijuego, el intento en curso y, en la Arena, los jefes que eligió el
      // host (null: se eligen por puntaje, como en la partida).
      practice: practice === null ? null : { minigame: practice, attempt: 0, bosses: null },
      // Sala con registro y taller: cuántos equipos caben y el orden en que se registraron.
      workshop: workshop ? { maxTeams: teamCount, teamSeq: 0 } : null,
    };
    this.plan = planFor(this.config, this.state.room);
    this.persistence?.openEventLog(this.room.id);
    this.events = [];
    this.record('room_created', {
      seed: this.room.seed,
      ...(practice === null ? {} : { practice }),
      ...(workshop ? { workshop: true, maxTeams: teamCount } : {}),
      teams: teams.map(({ id, name }) => ({ id, name })),
    });
    this.changed();
    return ok({ roomId: this.room.id });
  }

  // Un equipo nuevo en el puesto `index` de la configuración (su id y su color salen de ahí).
  newTeam(index, name, { order = index, members = [] } = {}) {
    return {
      id: `t${index + 1}`,
      order,
      name,
      color: this.config.teams.colors[index],
      members, // integrantes, si el equipo se registró desde un celular
      score: 0,
      streak: 0,
      maxStreak: 0,
      inventory: [], // objetos sin usar: { id, code, round } (RF-OBJ-10)
      pendingExtraItem: false, // por no responder una pregunta (RF-OBJ-08)
      fragments: 0, // fragmentos de estrella sin completar (server/domain/stars.js)
      stars: 0,
      slots: { A: null, B: null },
    };
  }

  setLobbyOpen(open) {
    if (!this.room) return fail('no_room');
    if (this.room.started) return fail('game_started');
    this.room.lobbyOpen = open;
    this.record(open ? 'lobby_opened' : 'lobby_closed');
    this.changed();
    return ok();
  }

  join(deviceId, teamId) {
    if (!this.room) return fail('no_room');
    if (this.room.started) return fail('game_started');
    if (!this.room.lobbyOpen) return fail('lobby_closed');
    return this.assign(deviceId, teamId, 'device_joined');
  }

  // Sala con registro: el celular crea su equipo (nombre e integrantes) y ocupa el puesto A. Si ya
  // está en un equipo, cambia el nombre y los integrantes de ese equipo (cualquiera de sus dos
  // celulares puede corregirlos mientras no empiece la partida).
  registerTeam(deviceId, { name, members }) {
    const room = this.room;
    if (!room) return fail('no_room');
    if (room.started) return fail('game_started');
    if (!room.workshop) return fail('no_registration');
    if (!this.state.devices[deviceId]) return fail('unknown_device');
    const cleanName = cleanTeamName(name);
    if (!cleanName) return fail('invalid_name');
    const cleanList = cleanMembers(members, this.config.workshop.members);
    if (!cleanList) return fail('invalid_members');
    const current = this.teamOf(deviceId);
    if (room.teams.some((team) => team !== current?.team && sameName(team.name, cleanName))) return fail('name_taken');
    if (current) {
      Object.assign(current.team, { name: cleanName, members: cleanList });
      this.record('team_updated', { deviceId, teamId: current.team.id, name: cleanName, members: cleanList });
      this.changed();
      return ok({ teamId: current.team.id, slot: current.slot });
    }
    if (!room.lobbyOpen) return fail('lobby_closed');
    if (room.teams.length >= room.workshop.maxTeams) return fail('teams_full');
    // El primer puesto libre de la configuración: así un equipo que se deshizo deja su color.
    const used = new Set(room.teams.map((team) => team.id));
    const index = this.config.teams.colors.findIndex((_, i) => !used.has(`t${i + 1}`));
    const team = this.newTeam(index, cleanName, { order: room.workshop.teamSeq, members: cleanList });
    room.workshop.teamSeq += 1;
    team.slots.A = deviceId;
    team.workshop = newWorkshop(this.clock.now()); // el taller del equipo (server/domain/workshop.js)
    room.teams.push(team);
    this.record('team_registered', { deviceId, teamId: team.id, name: cleanName, members: cleanList });
    this.afterRosterChange();
    return ok({ teamId: team.id, slot: 'A' });
  }

  leave(deviceId) {
    if (!this.room) return fail('no_room');
    if (this.room.started) return fail('game_started');
    const current = this.teamOf(deviceId);
    if (!current) return ok();
    current.team.slots[current.slot] = null;
    this.record('device_left', { deviceId, teamId: current.team.id });
    // En la sala con registro, un equipo del que salió su último celular se deshace.
    if (this.room.workshop && !hasDevices(current.team)) this.dropTeam(current.team, 'empty');
    this.changed();
    return ok();
  }

  // Taller: una acción de cualquiera de los dos celulares del equipo, mientras no empiece la partida.
  // Cada equipo va a su ritmo: no hay fases ni plazos, solo el estado de su taller.
  workshopAction(deviceId, action) {
    const room = this.room;
    if (!room) return fail('no_room');
    if (!room.workshop) return fail('no_registration');
    if (room.started) return fail('game_started');
    const current = this.teamOf(deviceId);
    if (!current?.team.workshop) return fail('not_in_team');
    const { ok: done, error, reply, events } = workshopAct(current.team.workshop, action, { now: this.clock.now() });
    if (!done) return fail(error);
    for (const { type, ...payload } of events) this.record(type, { teamId: current.team.id, deviceId, ...payload });
    this.changed();
    return ok(reply);
  }

  dropTeam(team, reason) {
    this.room.teams = this.room.teams.filter((other) => other !== team);
    this.record('team_removed', { teamId: team.id, name: team.name, reason });
  }

  // Host: cambia el nombre de un equipo (p. ej. uno que no conviene proyectar).
  renameTeam(teamId, name) {
    if (!this.room) return fail('no_room');
    const team = this.room.teams.find((t) => t.id === teamId);
    if (!team) return fail('unknown_team');
    const cleanName = cleanTeamName(name);
    if (!cleanName) return fail('invalid_name');
    if (this.room.teams.some((other) => other !== team && sameName(other.name, cleanName))) return fail('name_taken');
    this.record('team_renamed', { teamId, from: team.name, name: cleanName });
    team.name = cleanName;
    this.changed();
    return ok();
  }

  // Host, en la sala con registro y antes de empezar: quita un equipo; sus celulares quedan sin equipo.
  removeTeam(teamId) {
    const room = this.room;
    if (!room) return fail('no_room');
    if (!room.workshop) return fail('no_registration');
    if (room.started) return fail('game_started');
    const team = room.teams.find((t) => t.id === teamId);
    if (!team) return fail('unknown_team');
    this.dropTeam(team, 'host');
    this.afterRosterChange();
    return ok();
  }

  // Host: en cualquier momento, p. ej. para reemplazar un celular sin batería (RF-ACC-11).
  move(deviceId, teamId) {
    if (!this.room) return fail('no_room');
    if (!this.state.devices[deviceId]) return fail('unknown_device');
    if (teamId !== null) return this.assign(deviceId, teamId, 'device_moved');
    const current = this.teamOf(deviceId);
    if (current) {
      current.team.slots[current.slot] = null;
      this.record('device_moved', { deviceId, teamId: null });
      this.afterRosterChange();
    }
    return ok();
  }

  // Ajuste manual de puntos del host (RF-HOST-03): respeta el piso de 0 y queda en el log.
  adjustScore(teamId, points, reason = '') {
    if (!this.room?.started) return fail('not_started');
    const team = this.room.teams.find((t) => t.id === teamId);
    if (!team) return fail('unknown_team');
    const applied = addPoints(team, points);
    this.record('score_adjusted', { teamId, requested: points, applied, reason, phase: this.room.phase?.id ?? null });
    this.changed();
    return ok({ applied, score: team.score });
  }

  // Sala de práctica de la Arena: el host elige quién es jefe en el próximo intento (los grupos se
  // forman al entrar a las instrucciones). Una lista vacía vuelve a la regla del puntaje.
  setBosses(teamIds) {
    const practice = this.room?.practice;
    if (!practice) return fail('not_practice');
    if (practice.minigame !== 'arena') return fail('invalid_minigame');
    const known = new Set(this.room.teams.map((team) => team.id));
    if (teamIds.some((id) => !known.has(id))) return fail('unknown_team');
    if (this.room.teams.length > 1 && teamIds.length >= this.room.teams.length) return fail('no_challengers');
    practice.bosses = teamIds.length > 0 ? [...new Set(teamIds)] : null;
    this.record('practice_bosses', { bosses: practice.bosses });
    this.changed();
    return ok();
  }

  kick(deviceId) {
    if (!this.state.devices[deviceId]) return fail('unknown_device');
    const current = this.teamOf(deviceId);
    if (current) current.team.slots[current.slot] = null;
    delete this.state.devices[deviceId];
    this.presence.delete(deviceId);
    this.record('device_kicked', { deviceId, teamId: current?.team.id ?? null });
    this.afterRosterChange();
    return ok();
  }

  // Ocupa el primer puesto libre (A y luego B). Node atiende un mensaje a la vez, así
  // que dos solicitudes simultáneas nunca ocupan el mismo puesto (RF-ACC-07).
  assign(deviceId, teamId, eventType) {
    if (!this.state.devices[deviceId]) return fail('unknown_device');
    const target = this.room.teams.find((team) => team.id === teamId);
    if (!target) return fail('unknown_team');
    const current = this.teamOf(deviceId);
    if (current?.team === target) return ok({ slot: current.slot });
    const slot = SLOTS.find((s) => target.slots[s] === null);
    if (!slot) return fail('team_full');
    if (current) current.team.slots[current.slot] = null;
    target.slots[slot] = deviceId;
    this.record(eventType, { deviceId, teamId, slot });
    this.afterRosterChange();
    return ok({ slot });
  }

  afterRosterChange() {
    this.changed();
    this.checkComplete();
  }

  // ---------------------------------------------------------------- flujo de la partida

  start({ force = false } = {}) {
    const room = this.room;
    if (!room) return fail('no_room');
    if (room.started) return fail('game_started');
    const playing = room.teams.filter(hasDevices);
    if (playing.length === 0) return fail('no_players');
    if (!force && room.teams.some((team) => !team.slots.A || !team.slots.B)) return fail('teams_incomplete');
    room.teams = playing; // los equipos sin dispositivos no juegan
    room.started = true;
    room.lobbyOpen = false;
    this.record('game_started', {
      forced: force,
      teams: playing.map((team) => ({ id: team.id, A: team.slots.A, B: team.slots.B })),
    });
    this.enterPhase(0);
    return ok();
  }

  // "Siguiente": solo en pantallas que esperan al host (RF-FLU-04).
  next() {
    const blocked = this.blockedReason();
    if (blocked) return fail(blocked);
    if (!this.room.phase.waitingHost) return fail('not_waiting_host');
    this.closePhase('host');
    return ok();
  }

  // "Saltar fase": cierra la fase actual como si se hubiera acabado el tiempo.
  skip() {
    const blocked = this.blockedReason();
    if (blocked) return fail(blocked);
    this.closePhase('skip');
    return ok();
  }

  pause() {
    const blocked = this.blockedReason();
    if (blocked) return fail(blocked);
    this.room.paused = { at: this.clock.now() };
    this.clearTimer();
    this.record('game_paused', { phase: this.room.phase.id });
    this.changed();
    return ok();
  }

  // Los plazos se desplazan lo que duró la pausa, más leadMs para que todas las
  // pantallas retomen a la vez (RF-FLU-06).
  resume() {
    const room = this.room;
    if (!room?.paused) return fail('not_paused');
    if (room.recovered) {
      // Tras reiniciar el proceso, la fase en curso empieza de nuevo (RNF-07).
      room.recovered = false;
      room.paused = null;
      this.record('game_resumed', { phase: room.phase.id, fromSnapshot: true });
      this.enterPhase(room.phase.index);
      return ok();
    }
    const resumeAt = this.clock.now() + this.config.timings.leadMs;
    const shift = resumeAt - room.paused.at;
    const { phase } = room;
    // Todos los instantes de la fase se corren: así t (medido desde answersAt) no incluye la pausa.
    for (const key of PHASE_TIMES) {
      if (typeof phase[key] === 'number') phase[key] += shift;
    }
    PHASES[phase.kind].shiftTimes?.(this.ctx(), shift); // instantes propios de la fase (p. ej. turnos)
    phase.resumeAt = resumeAt;
    room.paused = null;
    this.record('game_resumed', { phase: phase.id });
    this.armTimer();
    this.changed();
    return ok();
  }

  // Acción de un jugador en la fase actual.
  action(deviceId, action) {
    const blocked = this.blockedReason();
    if (blocked) return fail(blocked);
    const { phase } = this.room;
    const handler = PHASES[phase.kind];
    if (!handler.acceptsActions) return fail('no_action_expected');
    const current = this.teamOf(deviceId);
    if (!current) return fail('not_in_team');
    if (this.clock.now() < phase.startsAt) return fail('phase_not_started');
    const result = handler.onAction(this.ctx(), { teamId: current.team.id, deviceId, action });
    if (!result.ok) return result;
    // La fase puede devolver un evento para el log; no se reenvía al cliente. Las entradas
    // "quiet" (p. ej. lotes de clics) no van al log y su vista se difunde con un tope de frecuencia.
    const { event, quiet, ...reply } = result;
    if (!quiet || event) {
      const { type, ...payload } = event ?? { type: 'team_action', action: action.type };
      this.record(type, { phase: phase.id, teamId: current.team.id, deviceId, ...payload });
    }
    if (quiet) this.changedThrottled();
    else this.changed();
    this.checkComplete();
    if (this.room.phase === phase) this.armWakeup(); // la acción puede cambiar los próximos eventos
    return reply;
  }

  blockedReason() {
    if (!this.room) return 'no_room';
    if (!this.room.started) return 'not_started';
    if (this.room.finished) return 'game_finished';
    if (this.room.paused) return 'paused';
    return null;
  }

  // ---------------------------------------------------------------- fases

  // Lo que reciben los tipos de fase (server/phases/).
  ctx() {
    const room = this.room;
    return {
      room,
      phase: room.phase,
      config: this.config,
      activeTeamIds: room.teams.filter(hasDevices).map((team) => team.id),
      now: this.clock.now(),
      random: this.random,
      presence: this.presence,
      teamOf: (deviceId) => this.teamOf(deviceId),
      isConnected: (deviceId) => Boolean(this.presence.get(deviceId)?.connected),
      record: (type, payload) => this.record(type, payload),
      events: this.events, // log de la sala (para las estadísticas del ranking final)
    };
  }

  enterPhase(index) {
    this.clearTimer();
    const room = this.room;
    const step = this.plan[index];
    const handler = PHASES[step.kind];
    // Fases que esta vez no hacen falta (un Duelo sin duelos pendientes): ni se anuncian.
    if (handler.skip?.({ room, config: this.config, step })) {
      this.record('phase_skipped', { phase: step.id });
      return this.enterPhase((index + 1) % this.plan.length);
    }
    const startsAt = this.clock.now() + this.config.timings.leadMs;
    const autoAdvance = handler.waitsHost && !handler.terminal ? this.config.timings.autoAdvanceMs : null;
    const span = handler.durationMs(this.config, step) ?? autoAdvance;
    this.state.phaseSeq += 1;
    if (room.practice && index === 0) room.practice.attempt += 1;
    // Azar reproducible: la semilla de la sala y el número de fase determinan ofertas y sorteos.
    this.random = createRng(mixSeed(room.seed, this.state.phaseSeq));
    room.phase = {
      ...step,
      seq: this.state.phaseSeq,
      index,
      startsAt,
      endsAt: span === null ? null : startsAt + span,
      resumeAt: null,
      waitingHost: Boolean(handler.waitsHost),
      ...(room.practice ? { attempt: room.practice.attempt } : {}),
      data: {},
    };
    handler.enter?.(this.ctx());
    if (handler.terminal) room.finished = true;
    this.record('phase_entered', { phase: step.id, startsAt, endsAt: room.phase.endsAt });
    this.armTimer();
    this.changed();
  }

  closePhase(reason) {
    this.clearTimer();
    const { phase } = this.room;
    PHASES[phase.kind].exit?.(this.ctx());
    this.record('phase_closed', { phase: phase.id, reason });
    // La práctica vuelve a empezar tras el resultado; la partida completa termina en el ranking final.
    this.enterPhase((phase.index + 1) % this.plan.length);
  }

  checkComplete() {
    if (this.blockedReason()) return;
    if (PHASES[this.room.phase.kind].isComplete?.(this.ctx())) this.closePhase('complete');
  }

  // Plazo absoluto: el temporizador apunta a un instante, no a "dentro de N ms" (sección 3.3).
  // Una fase puede cerrar un poco después de endsAt (closeAt) para recibir respuestas en camino.
  armTimer() {
    this.clearTimer();
    const { phase, paused } = this.room;
    const deadline = phase.closeAt ?? phase.endsAt;
    if (paused || deadline === null) return;
    const { seq } = phase;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      if (this.room?.phase?.seq === seq && !this.room.paused) this.closePhase('timeout');
    }, Math.max(0, deadline - this.clock.now()));
    this.armWakeup();
    this.armFrame();
  }

  // Eventos programados dentro de una fase: la fase dice cuándo (nextWakeup) y qué hacer (onWakeup).
  armWakeup() {
    if (this.wakeTimer) this.clock.clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    const { phase, paused } = this.room;
    const handler = PHASES[phase.kind];
    if (paused || !handler.nextWakeup) return;
    const at = handler.nextWakeup(this.ctx());
    if (at === null) return;
    const { seq } = phase;
    this.wakeTimer = this.clock.setTimeout(() => {
      this.wakeTimer = null;
      if (this.room?.phase?.seq !== seq || this.room.paused) return;
      handler.onWakeup?.(this.ctx());
      this.changed();
      this.checkComplete();
      if (this.room.phase.seq === seq) this.armWakeup();
    }, Math.max(0, at - this.clock.now()));
  }

  // Fases en tiempo real (la Arena): cada frameMs la fase avanza su simulación y el fotograma se
  // difunde a todas las pantallas ('frame' → mg:frame), sin guardar el snapshot ni rehacer las vistas:
  // sale 20 veces por segundo. Lleva la hora del servidor (t), para medir con cuánto atraso llega. Lo
  // que pase en el fotograma (p. ej. un vehículo destruido) va al log.
  armFrame() {
    if (this.frameTimer) this.clock.clearTimeout(this.frameTimer);
    this.frameTimer = null;
    const { phase, paused } = this.room;
    const every = PHASES[phase.kind].frameMs?.(this.ctx()) ?? null;
    if (paused || !every) return;
    const { seq } = phase;
    this.frameTimer = this.clock.setTimeout(() => {
      this.frameTimer = null;
      if (this.room?.phase?.seq !== seq || this.room.paused) return;
      const { frame, events } = PHASES[this.room.phase.kind].onFrame(this.ctx());
      for (const { type, ...payload } of events) this.record(type, { phase: this.room.phase.id, ...payload });
      this.emit('frame', { seq, t: this.clock.now(), ...frame });
      this.checkComplete();
      if (this.room.phase.seq === seq) this.armFrame();
    }, every);
  }

  clearTimer() {
    if (this.timer) this.clock.clearTimeout(this.timer);
    if (this.wakeTimer) this.clock.clearTimeout(this.wakeTimer);
    if (this.frameTimer) this.clock.clearTimeout(this.frameTimer);
    this.timer = null;
    this.wakeTimer = null;
    this.frameTimer = null;
  }

  // ---------------------------------------------------------------- persistencia y log

  restore() {
    const state = this.persistence?.loadSnapshot();
    if (!state) return null;
    const { room } = state;
    if (room) {
      this.persistence.openEventLog(room.id);
      this.events = this.persistence.readEvents(room.id);
      if (room.started && !room.finished) {
        // Tras un reinicio la partida espera a que el host la reanude (RF-HOST-02).
        room.recovered = true;
        room.paused = { at: this.clock.now() };
      }
    }
    this.logger('info', 'estado recuperado del snapshot', { roomId: room?.id ?? null, phase: room?.phase?.id ?? null });
    return state;
  }

  changed({ persist = true } = {}) {
    if (persist) this.persistence?.saveSnapshot(this.state);
    this.emit('change');
  }

  // Cambios muy frecuentes: como mucho una difusión cada THROTTLE_MS (4 Hz, RF-MJ3-05), sin snapshot.
  changedThrottled() {
    if (this.throttleTimer) return;
    this.throttleTimer = this.clock.setTimeout(() => {
      this.throttleTimer = null;
      this.changed({ persist: false });
    }, THROTTLE_MS);
  }

  record(type, payload = {}) {
    const event = { ts: this.clock.now(), type, ...payload };
    if (this.room) this.events.push(event);
    this.persistence?.appendEvent(event);
    this.logger('info', type, payload);
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function roomId(now) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}
