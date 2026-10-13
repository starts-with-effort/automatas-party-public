// Bots con socket.io-client: jugadores que se unen a un equipo y completan las fases, proyectores
// que solo miran y un host que avanza la partida. Los usan las pruebas de integración,
// scripts/bots.js, scripts/demo.js y la prueba de carga (scripts/load.js).
//
// Eventos de cada bot: 'view' (vista, hora local de llegada), 'frame' (fotograma de la Arena, hora
// local de llegada) y 'disconnect' (motivo de Socket.IO; 'io client disconnect' cuando lo cerró el
// propio bot).
import { EventEmitter } from 'node:events';
import { io } from 'socket.io-client';
import { ANGLES, aimAngle, angleOf, effectiveRules, moveVehicle, perTick, tickAt, ticksOf } from '../../client/shared/arena-physics.js';
import { TICK_MS, initialState, step } from '../../client/shared/flappy-physics.js';
import { TRAZA_PDA, WORKSHOP_PDAS, acceptingTrace, isAccepting } from '../../server/domain/pda.js';
import { LEVELS, expectedStep } from '../../server/domain/workshop.js';
import { shouldFlap } from './flappy-autopilot.js';

const RETRYABLE = new Set(['phase_not_started', 'answers_not_open', 'paused', 'timeout']);
// Respuestas esperables cuando la fase ya cerró o el compañero se adelantó.
const BENIGN = new Set([
  'no_action_expected', 'already_answered', 'question_closed', 'already_picked', 'already_confirmed',
  'not_your_turn', 'card_unavailable', 'outside_window', 'game_not_started', 'invalid_action',
  'already_accepted', 'no_attempts', 'not_diagram', 'swapping', 'too_fast', 'implausible_progress', 'not_in_arena',
  'duel_not_open', 'not_in_duel',
]);
const DUEL_OPTIONS = ['piedra', 'papel', 'tijera'];
const CLICK_BATCH_MS = 200;
const MEMORY_RECALL = 0.85; // probabilidad de que un bot de Memoria recuerde una carta que vio
const TRAZA_MISTAKES = 0.04; // probabilidad de que el del diagrama toque un estado equivocado
const TRAZA_STEP_MS = [450, 900]; // entre toques (una persona tarda más: dictar y buscar el arco)
const WORKSHOP_MISTAKES = 0.12; // probabilidad de tropezar en un paso del taller antes de acertar
const WORKSHOP_STEP_MS = [140, 300]; // entre toques del taller (el servidor admite 8 por segundo)
const STACK_ACTS = ['push', 'pop', 'same', 'halt'];
const FLAPPY_CRASH_RATE = 0.3; // parte de los bots deja de aletear en algún momento y choca
const ARENA_AIM_ERROR_DEG = { boss: 5, challenger: 9 }; // error de puntería de los bots
const ARENA_STUCK_TICKS = 10; // si casi no avanza este tiempo, prueba otra dirección un momento
const ARENA_PAD_REACH = 700; // un retador sin poder va por una caja que tenga a esta distancia (si le gustan)

// Lo que el de la cadena "dicta en voz alta" en la Traza a ciegas: la cadena y la forma de aceptar
// de cada equipo, por sala y fase.
// Solo funciona entre bots del mismo proceso (pruebas, scripts/bots.js, demo).
const RADIO = new Map();

class Client extends EventEmitter {
  constructor(url, label) {
    super();
    this.url = url;
    this.label = label;
    this.view = null;
    this.offset = 0;
    this.rtt = null;
    this.socket = null;
    this.generation = 0; // aumenta en cada conexión
    this.closed = true;
  }

  connectSocket(auth) {
    this.generation += 1;
    this.closed = false;
    this.socket = io(this.url, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    this.socket.on('state:sync', (view) => {
      const receivedAt = Date.now();
      this.view = view;
      this.onView(view);
      this.emit('view', view, receivedAt);
    });
    this.socket.on('disconnect', (reason) => this.emit('disconnect', reason));
    this.socket.on('mg:frame', (frame) => {
      this.frame = frame; // Arena: el último fotograma
      this.emit('frame', frame, Date.now());
    });
    return new Promise((resolve, reject) => {
      this.socket.once('connect_error', reject);
      this.once('view', async () => {
        await this.syncClock();
        resolve(this);
      });
    });
  }

  onView() {}

  // Igual que el navegador (sección 3.6): varios pings y se usa el de menor RTT. Sin conexión, o si
  // ya hay una sincronización en curso, no hace nada.
  async syncClock(samples = 5) {
    if (this.syncing || !this.socket?.connected) return;
    this.syncing = true;
    let best = null;
    try {
      for (let i = 0; i < samples; i += 1) {
        const t0 = Date.now();
        const res = await this.send('time:ping', { t0 });
        const rtt = Date.now() - t0;
        if (Number.isFinite(res.tServer) && (!best || rtt < best.rtt)) best = { rtt, offset: res.tServer - (t0 + rtt / 2) };
      }
    } finally {
      this.syncing = false;
    }
    if (!best) return;
    Object.assign(this, best);
    this.socket.emit('time:report', { rtt: best.rtt, offset: best.offset });
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  send(event, payload = {}) {
    return this.socket.timeout(5000).emitWithAck(event, payload).catch(() => ({ ok: false, error: 'timeout' }));
  }

  waitFor(predicate, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      if (this.view && predicate(this.view)) return resolve(this.view);
      const onView = (view) => {
        if (!predicate(view)) return;
        clearTimeout(timer);
        this.off('view', onView);
        resolve(view);
      };
      const timer = setTimeout(() => {
        this.off('view', onView);
        reject(new Error(`${this.label}: tiempo agotado esperando una condición`));
      }, timeoutMs);
      this.on('view', onView);
    });
  }

  // ¿Sigue abierta la conexión `generation`? Los bucles y reintentos de una conexión cerrada (o ya
  // reemplazada por otra) se detienen: si no, seguirían para siempre con la última vista y no
  // dejarían terminar el proceso.
  isCurrent(generation) {
    return !this.closed && this.generation === generation;
  }

  close() {
    this.closed = true;
    this.socket?.disconnect();
  }
}

export class PlayerBot extends Client {
  constructor(url, {
    label = 'bot', token = null, preferredTeam = null, autoJoin = true, autoAct = true, actDelayMs = [50, 400],
    flappyCrashRate = FLAPPY_CRASH_RATE, trazaMistakeRate = TRAZA_MISTAKES, onlyPreferred = false,
    team = null, workshopMistakeRate = WORKSHOP_MISTAKES, workshopStepMs = WORKSHOP_STEP_MS,
  } = {}) {
    super(url, label);
    // onlyPreferred: si su equipo está lleno no entra a otro (deja libres los equipos de los celulares).
    // team: { name, members } con el que se registra en una sala con registro (o al que se une, si
    // otro bot ya lo creó).
    Object.assign(this, {
      token, preferredTeam, autoJoin, autoAct, actDelayMs, flappyCrashRate, trazaMistakeRate, onlyPreferred,
      team: team ?? { name: `Equipo ${label}`, members: [`${label} A`, `${label} B`] }, workshopMistakeRate, workshopStepMs,
    });
    this.deviceId = null;
    this.ended = null;
    this.errors = [];
    this.phaseIds = []; // fases vistas, en orden
    this.lastSeq = null;
    this.actedSeq = null;
    this.joining = false;
  }

  open() {
    const ready = this.connectSocket({ role: 'play', token: this.token });
    this.socket.on('session:welcome', ({ deviceId, token }) => {
      this.deviceId = deviceId;
      if (token) this.token = token;
    });
    this.socket.on('session:ended', ({ reason }) => {
      this.ended = reason;
      this.emit('ended', reason);
    });
    return ready;
  }

  // Al cerrar se detienen bucles y reintentos; al volver a conectar retoma la fase en curso.
  close() {
    super.close();
    this.joining = false;
    this.actedSeq = null;
    this.clickingSeq = this.trazaSeq = this.flappySeq = this.arenaSeq = this.flipKey = this.workshopSeq = null;
  }

  // Cerrar y volver a abrir con el mismo token, como al recargar la página.
  async reconnect() {
    this.close();
    this.view = null;
    return this.open();
  }

  onView(view) {
    if (view.phase && view.phase.seq !== this.lastSeq) {
      this.lastSeq = view.phase.seq;
      this.phaseIds.push(view.phase.id);
    }
    if (this.autoJoin) this.maybeJoin(view);
    if (this.autoAct) this.maybeAct(view);
    if (this.autoAct) this.maybeWorkshop(view);
  }

  maybeJoin({ room, me, teams }) {
    if (!room || room.started || !room.lobbyOpen || me.teamId || this.joining) return;
    const free = (team) => team.slots.A === null || team.slots.B === null;
    let request;
    if (room.workshop) {
      // Sala con registro: entra al equipo de su nombre si ya existe; si no, lo registra.
      const mine = teams.find((team) => team.name === this.team.name);
      if (mine && !free(mine)) return;
      request = mine ? ['lobby:join', { teamId: mine.id }] : ['lobby:register', this.team];
    } else {
      const preferred = teams.find((team) => team.id === this.preferredTeam && free(team));
      const target = preferred ?? (this.onlyPreferred ? null : teams.find(free));
      if (!target) return;
      request = ['lobby:join', { teamId: target.id }];
    }
    this.joining = true;
    const generation = this.generation;
    this.send(...request).then((res) => {
      if (!this.isCurrent(generation)) return;
      this.joining = false;
      if (res.ok) return;
      // Su compañero registró el equipo un instante antes: se une en cuanto la vista lo traiga (si
      // ya llegó, ahora; si no, con la próxima).
      if (res.error === 'name_taken') {
        if (this.view?.teams.some((team) => team.name === this.team.name)) this.maybeJoin(this.view);
        return;
      }
      if (res.error !== 'team_full') this.errors.push(`${request[0]}: ${res.error}`);
      this.maybeJoin(this.view); // otro llegó primero: probar con la vista actualizada
    });
  }

  // Taller (sala con registro, antes de empezar): actúa un solo celular por equipo (el A, si está),
  // un toque por cada estado del taller, con las respuestas de server/domain/workshop.js y, a veces,
  // un tropiezo primero.
  maybeWorkshop(view) {
    const w = view.workshop;
    if (!w || view.room.started || !view.me.teamId || w.stage === 'done' || this.workshopSeq === w.seq) return;
    const team = view.teams.find((t) => t.id === view.me.teamId);
    if (view.me.slot !== 'A' && team.slots.A?.connected) return;
    this.workshopSeq = w.seq;
    const generation = this.generation;
    const [min, max] = this.workshopStepMs;
    setTimeout(async () => {
      if (!this.isCurrent(generation) || this.view?.room?.started || this.view?.workshop?.seq !== w.seq) return;
      const res = await this.send('taller:act', { ...this.workshopMove(w), seq: w.seq });
      if (res.ok || !this.isCurrent(generation)) return;
      this.workshopSeq = null;
      if (!['stale_action', 'game_started', 'timeout', 'rate_limited'].includes(res.error)) this.errors.push(`taller:act: ${res.error}`);
      // Sin vista nueva no habría otro intento: se reintenta con la que hay.
      setTimeout(() => this.isCurrent(generation) && this.maybeWorkshop(this.view), 400);
    }, min + Math.random() * (max - min));
  }

  workshopMove(w) {
    if (w.stage === 'intro1' || w.stage === 'intro2') return { type: 'begin' };
    // Un tropiezo como mucho por paso: si ya se equivocó aquí, ahora acierta.
    const slip = w.feedback?.kind !== 'wrong' && Math.random() < this.workshopMistakeRate;
    if (w.stage === 'e1') {
      if (w.phase === 'solved') return { type: 'next' };
      const run = { pda: w.run.pda.id, word: w.run.word, mode: w.run.mode };
      if (w.phase === 'verdict') {
        const accept = isAccepting(WORKSHOP_PDAS[run.pda], w.id, run.mode);
        return { type: 'verdict', accept: slip ? !accept : accept };
      }
      const expected = expectedStep(run, w.id).act;
      const wrong = STACK_ACTS.filter((act) => act !== expected);
      return { type: 'stack', act: slip ? wrong[Math.floor(Math.random() * wrong.length)] : expected };
    }
    if (w.solved) return { type: 'next' };
    // Ejercicio 2: pone, una por una, las fichas que faltan.
    const { answer } = LEVELS[w.level.index];
    const slot = answer.findIndex((value, i) => w.sel[i] !== value);
    return { type: 'chip', slot, value: answer[slot] };
  }

  maybeAct(view) {
    const { room, me, phase } = view;
    if (!room?.started || room.paused || !phase || !me.teamId) return;
    if (phase.kind === 'minigame') return this.playMinigame(view);
    if (phase.kind === 'duel') return this.maybeDuel(phase);
    if (this.actedSeq === phase.seq) return;
    if (phase.kind === 'question') return this.maybeAnswer(phase, me.teamId);
    // En el draft y en la fase de uso actúa un solo dispositivo por equipo (el A, si está).
    const team = view.teams.find((t) => t.id === me.teamId);
    const leader = me.slot === 'A' || !team.slots.A?.connected;
    if (phase.kind === 'draft' && leader && !phase.data.chosen) return this.maybePick(phase);
    if (phase.kind === 'itemUse' && leader && !phase.data.confirmedTeamIds.includes(me.teamId)) {
      return this.maybeUseItems(phase, view);
    }
  }

  // Clicker: un lote de 2 a 4 clics cada 200 ms mientras dura el juego (como el navegador).
  // Memoria: recuerda las caras que vio y, cuando le toca, busca una pareja conocida.
  // Traza a ciegas: el de la cadena la pasa por la "radio" y el del diagrama toca la traza que acepta.
  // Flappy: vuela con el piloto automático al ritmo del reloj e informa cada 200 ms.
  // Arena: maneja y dispara con la física compartida, como el celular.
  playMinigame(view) {
    const { phase } = view;
    if (phase.minigame === 'traza') return this.playTraza(view);
    if (phase.minigame === 'flappy') return this.playFlappy(view);
    if (phase.minigame === 'arena') return this.playArena(view);
    if (phase.minigame === 'clicker') {
      if (this.clickingSeq === phase.seq) return;
      this.clickingSeq = phase.seq;
      const generation = this.generation;
      const timer = setInterval(() => {
        const now = this.serverNow();
        if (!this.isCurrent(generation) || this.view?.phase?.seq !== phase.seq || now > phase.endsAt) return clearInterval(timer);
        if (now >= phase.playStartsAt && !this.view.room.paused) {
          this.socket.emit('mg:input', { type: 'clicks', count: 2 + Math.floor(Math.random() * 3) });
        }
      }, CLICK_BATCH_MS);
      return;
    }
    const { game } = phase.data;
    if (phase.minigame !== 'memoria') return;
    this.rememberFaces(phase);
    if (!game.canFlip) return;
    const turnKey = `${phase.seq}:${game.turn.group}:${game.turn.step}:${game.turn.deadline}`;
    if (this.flipKey === turnKey) return;
    this.flipKey = turnKey;
    this.schedule(phase, Math.max(phase.playStartsAt, this.serverNow()), async () => {
      // La vista pudo cambiar mientras esperaba: solo voltea si aún le toca y quedan cartas.
      const current = this.view.phase.data.game;
      const down = current.cards.map((card, index) => (card.state === 'down' ? index : null)).filter((i) => i !== null);
      if (!current.canFlip || down.length === 0) return { ok: true };
      return this.send('mg:input', { type: 'flip', card: this.chooseCard(current.cards, down) });
    });
  }

  rememberFaces(phase) {
    if (this.memorySeq !== phase.seq) {
      this.memorySeq = phase.seq;
      this.faces = new Map();
    }
    phase.data.game.cards.forEach((card, index) => card.face && this.faces.set(index, card.face));
  }

  // Segunda carta: la pareja de la que está boca arriba, si la recuerda. Primera carta: una
  // pareja conocida. Si no, una carta que todavía no vio.
  chooseCard(cards, down) {
    const recalls = () => Math.random() < MEMORY_RECALL;
    const up = cards.findIndex((card) => card.state === 'up');
    if (up !== -1) {
      const match = down.find((index) => this.faces.get(index) === cards[up].face);
      if (match !== undefined && recalls()) return match;
    } else {
      const byFace = new Map();
      for (const index of down) {
        const face = this.faces.get(index);
        if (face) byFace.set(face, [...(byFace.get(face) ?? []), index]);
      }
      const pair = [...byFace.values()].find((indexes) => indexes.length === 2);
      if (pair && recalls()) return pair[0];
    }
    const unseen = down.filter((index) => !this.faces.has(index));
    const pool = unseen.length > 0 ? unseen : down;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // Toca un estado cada TRAZA_STEP_MS mientras tenga el diagrama: el paso `steps` de la traza que
  // acepta (los dos bots del equipo corren esto; toca el que tiene el diagrama en ese intento). A
  // veces se equivoca, para que las partidas de prueba pasen por el cambio de papel.
  playTraza({ room, me, phase }) {
    const { game } = phase.data;
    const key = `${room.id}:${me.teamId}:${phase.seq}`;
    if (game.word) RADIO.set(key, { word: game.word, mode: game.mode });
    if (this.trazaSeq === phase.seq) return;
    this.trazaSeq = phase.seq;
    const generation = this.generation;
    const [min, max] = TRAZA_STEP_MS;
    const tick = async () => {
      if (!this.isCurrent(generation)) return;
      const current = this.view?.phase;
      if (current?.seq !== phase.seq) return RADIO.delete(key);
      const { game: now } = current.data;
      const paused = this.view.room.paused;
      const serverNow = this.serverNow();
      if (now.acceptedMs !== null || now.out || (!paused && serverNow > current.endsAt)) return RADIO.delete(key);
      const said = RADIO.get(key);
      const swapping = now.swapUntil !== null && serverNow < now.swapUntil;
      if (said && now.pda && !paused && !swapping && serverNow >= current.playStartsAt) {
        const step = acceptingTrace(TRAZA_PDA, said.word, said.mode)?.[now.steps];
        if (step) {
          const right = TRAZA_PDA.transitions[step.transition].to;
          const wrong = TRAZA_PDA.states.filter((state) => state !== right);
          const state = Math.random() < this.trazaMistakeRate ? wrong[Math.floor(Math.random() * wrong.length)] : right;
          const res = await this.send('mg:input', { type: 'tap', state });
          if (!res.ok && !BENIGN.has(res.error) && !RETRYABLE.has(res.error)) this.errors.push(`${phase.id}: ${res.error}`);
        }
      }
      setTimeout(tick, min + Math.random() * (max - min));
    };
    tick();
  }

  playFlappy({ phase }) {
    const { game } = phase.data;
    if (!game.level || this.flappySeq === phase.seq) return;
    this.flappySeq = phase.seq;
    const { level } = game;
    const sim = game.me ? { ...game.me } : initialState(level);
    const flaps = [];
    const quitAt = Math.random() < this.flappyCrashRate ? Math.floor(Math.random() * level.ticks) : Infinity;
    let acked = sim.tick;
    let inflight = false;
    const generation = this.generation;
    const timer = setInterval(async () => {
      const current = this.view?.phase;
      if (!this.isCurrent(generation) || current?.seq !== phase.seq) return clearInterval(timer);
      if (this.view.room.paused || inflight) return;
      // Un tick cada 1/60 s desde playStartsAt (que la pausa desplaza).
      const target = Math.min(level.ticks, Math.floor((this.serverNow() - current.playStartsAt) / TICK_MS));
      while (sim.status === 'playing' && sim.tick < target) {
        const flap = sim.tick < quitAt && shouldFlap(level, sim);
        if (flap) flaps.push(sim.tick);
        step(level, sim, flap);
      }
      if (sim.tick <= acked) {
        if (sim.status !== 'playing') clearInterval(timer);
        return;
      }
      inflight = true;
      const res = await this.send('mg:input', { type: 'fly', tick: sim.tick, flaps: flaps.filter((tick) => tick >= acked) });
      inflight = false;
      if (res.ok) {
        acked = res.tick;
        if (res.status !== 'playing') clearInterval(timer);
      } else if (!BENIGN.has(res.error) && !RETRYABLE.has(res.error)) {
        this.errors.push(`${phase.id}: ${res.error}`);
      }
    }, game.progressMs);
  }

  // Arena: cada reportMs avanza su vehículo hasta el tick del reloj e informa posiciones y disparos,
  // como el celular. El retador se mantiene a cierta distancia del jefe más cercano, rodeándolo, y le
  // dispara con algo de error; si no tiene poder y hay una caja cerca, a veces va por ella. El jefe
  // deambula cerca del centro y dispara al retador más cercano.
  // Las posiciones de los demás salen del último fotograma; su velocidad, de los dos últimos (para
  // apuntar adonde van a estar, como la ayuda de puntería del celular).
  playArena({ phase }) {
    const { game } = phase.data;
    if (game.me === undefined || game.me === null || this.arenaSeq === phase.seq) return;
    this.arenaSeq = phase.seq;
    const me = game.me;
    const boss = game.vehicles[me].boss;
    const base = boss ? game.rules.boss : game.rules.challenger;
    const map = { size: game.size, obstacles: game.obstacles };
    const likesPads = !boss && Math.random() < 0.6;
    let pad = null; // caja hacia la que va
    const keep = (boss ? 450 : 380) + Math.random() * 300; // distancia preferida al enemigo
    const aimError = ARENA_AIM_ERROR_DEG[boss ? 'boss' : 'challenger'];
    let sim = null;
    let life = 0;
    let alive = false;
    let pending = [];
    let shots = [];
    let lastShot = -1e9;
    let facing = 0;
    let inflight = 0;
    let sentUpTo = 0; // como el celular: envía lo nuevo sin esperar la respuesta anterior
    let acked = 0;
    let snapAt = -1;
    let orbit = Math.random() < 0.5 ? 1 : -1;
    let goal = null;
    let stuck = 0;
    let detour = null;
    const seen = new Map(); // vehículo → { tick, x, y, vx, vy } según los fotogramas
    const generation = this.generation;

    const steer = (foe) => {
      if (detour) {
        detour.ticks -= 1;
        if (detour.ticks <= 0) detour = null;
        return detour?.dir ?? { x: 0, y: 0 };
      }
      if (pad) {
        const dx = pad.x - sim.x;
        const dy = pad.y - sim.y;
        const d = Math.hypot(dx, dy) || 1;
        return { x: dx / d, y: dy / d };
      }
      if (boss || !foe) {
        if (!goal || Math.random() < 0.01) {
          const c = game.size / 2;
          goal = { x: c + (Math.random() - 0.5) * game.size * 0.35, y: c + (Math.random() - 0.5) * game.size * 0.35 };
        }
        const dx = goal.x - sim.x;
        const dy = goal.y - sim.y;
        const d = Math.hypot(dx, dy) || 1;
        return d < 40 ? { x: 0, y: 0 } : { x: (dx / d) * 0.8, y: (dy / d) * 0.8 };
      }
      const dx = foe.x - sim.x;
      const dy = foe.y - sim.y;
      const d = Math.hypot(dx, dy) || 1;
      const radial = d > keep + 80 ? 1 : d < keep - 80 ? -1 : 0;
      if (Math.random() < 0.004) orbit = -orbit;
      const x = (dx / d) * radial - (dy / d) * orbit * 0.7;
      const y = (dy / d) * radial + (dx / d) * orbit * 0.7;
      const len = Math.hypot(x, y) || 1;
      return { x: x / len, y: y / len };
    };

    const timer = setInterval(async () => {
      const current = this.view?.phase;
      if (!this.isCurrent(generation) || current?.seq !== phase.seq) return clearInterval(timer);
      const frame = this.frame?.seq === phase.seq ? this.frame : null;
      if (!frame || this.view.room.paused) return;
      const row = frame.v[me];
      if (sim === null || row[6] > life) {
        // Al empezar y en cada reaparición sigue desde donde dice el servidor.
        life = row[6];
        alive = row[5] === 1;
        if (!alive) return;
        sim = { tick: row[0], x: row[1], y: row[2], vx: 0, vy: 0 };
        pending = [];
        shots = [];
        lastShot = -1e9;
        sentUpTo = acked = snapAt = row[0];
      }
      if (row[6] === life && row[5] !== 1) alive = false;
      const now = this.serverNow();
      if (!alive || now < current.playStartsAt || now >= current.endsAt) return;
      const foes = frame.v
        .map((r, idx) => {
          const last = seen.get(idx);
          const fresh = last && r[0] > last.tick && r[0] - last.tick < 30;
          const vx = fresh ? (r[1] - last.x) / (r[0] - last.tick) : last?.vx ?? 0;
          const vy = fresh ? (r[2] - last.y) / (r[0] - last.tick) : last?.vy ?? 0;
          if (!last || r[0] !== last.tick) seen.set(idx, { tick: r[0], x: r[1], y: r[2], vx, vy });
          return { idx, x: r[1], y: r[2], vx, vy, alive: r[5] === 1 };
        })
        .filter((v) => v.alive && game.vehicles[v.idx].boss !== boss);
      const target = Math.min(game.endTick, tickAt(now, current.playStartsAt));
      // El jefe dispara según su estado; el retador busca una caja si no tiene poder.
      const rules = boss ? effectiveRules(base, { stage: row[14] ?? 0 }) : base;
      pad = null;
      if (likesPads && !row[10]) {
        game.pads.forEach((spot, i) => {
          const d = Math.hypot(spot.x - sim.x, spot.y - sim.y);
          if (frame.p?.[i] && d < ARENA_PAD_REACH && (!pad || d < Math.hypot(pad.x - sim.x, pad.y - sim.y))) pad = spot;
        });
      }
      if (target - sim.tick > 60) sim.tick = target - 1; // tras un corte largo no recupera todo
      while (sim.tick < target) {
        const foe = foes.reduce((best, v) => (!best || Math.hypot(v.x - sim.x, v.y - sim.y) < Math.hypot(best.x - sim.x, best.y - sim.y) ? v : best), null);
        const stick = steer(foe);
        const before = { x: sim.x, y: sim.y };
        moveVehicle(sim, stick, rules, map);
        if (stick.x !== 0 || stick.y !== 0) {
          facing = angleOf(Math.atan2(stick.y, stick.x));
          stuck = Math.hypot(sim.x - before.x, sim.y - before.y) < 2 ? stuck + 1 : 0;
          if (stuck > ARENA_STUCK_TICKS) {
            const a = Math.random() * Math.PI * 2;
            detour = { dir: { x: Math.cos(a), y: Math.sin(a) }, ticks: 20 };
            stuck = 0;
          }
        }
        sim.tick += 1;
        pending.push([sim.tick, Math.round(sim.x), Math.round(sim.y)]);
        if (foe && Math.hypot(foe.x - sim.x, foe.y - sim.y) < rules.bulletRange * 0.95 && sim.tick - lastShot >= ticksOf(rules.fireMs)) {
          const aim = aimAngle(sim, facing, [foe], { coneDeg: 180, range: rules.bulletRange, bulletStep: perTick(rules.bulletSpeed) });
          const error = Math.round(((Math.random() * 2 - 1) * aimError * ANGLES) / 360);
          shots.push([sim.tick, (aim + error + ANGLES) % ANGLES]);
          lastShot = sim.tick;
        }
      }
      if (pending.length > 120) pending.splice(0, pending.length - 120);
      const batch = pending.filter(([tick]) => tick > sentUpTo);
      const upTo = batch.length > 0 ? batch.at(-1)[0] : sentUpTo;
      const sending = shots.filter(([tick]) => tick > sentUpTo && tick <= upTo);
      if (inflight >= 4 || (batch.length === 0 && sending.length === 0)) return;
      const sentLife = life;
      sentUpTo = upTo;
      inflight += 1;
      const res = await this.send('mg:input', {
        type: 'drive',
        life,
        from: batch.length > 0 ? batch[0][0] : upTo + 1,
        pos: batch.flatMap(([, x, y]) => [x, y]),
        f: facing,
        shots: sending.slice(-20),
      });
      inflight -= 1;
      if (sentLife !== life) return;
      if (!res.ok) {
        sentUpTo = Math.min(sentUpTo, acked); // se reenvía en el próximo envío
        return this.report(phase.id, res);
      }
      acked = Math.max(acked, res.tick);
      pending = pending.filter(([tick]) => tick > acked);
      shots = shots.filter(([tick]) => tick > acked);
      if (res.life === life && res.status !== 'alive') alive = false;
      if (res.fix && res.fix.tick > snapAt) {
        Object.assign(sim, { x: res.fix.x, y: res.fix.y, vx: 0, vy: 0 });
        pending = [];
        sentUpTo = snapAt = sim.tick;
      }
    }, game.reportMs);
  }

  // Errores de minijuego que no son esperables.
  report(where, res) {
    if (!res.ok && !BENIGN.has(res.error) && !RETRYABLE.has(res.error)) this.errors.push(`${where}: ${res.error}`);
  }

  // Solo responde el dispositivo que tiene las opciones; elige al azar entre las que quedan.
  // tClient se mide desde answersAt, como en el navegador (sección 3.6, paso 3).
  maybeAnswer(phase, teamId) {
    const { role, answeredTeamIds, questionId } = phase.data;
    if (role === 'statement' || answeredTeamIds.includes(teamId)) return;
    this.schedule(phase, phase.answersAt, () => {
      const options = [0, 1, 2, 3].filter((option) => !(this.view.phase.data.eliminated ?? []).includes(option));
      return this.send('question:answer', {
        questionId,
        option: options[Math.floor(Math.random() * options.length)],
        tClient: Math.max(0, Math.round(this.serverNow() - phase.answersAt)),
      });
    });
  }

  // Duelo: en cada mano en que le toca a este celular (uno por lado) y su lado aún no eligió, elige
  // al azar.
  maybeDuel(phase) {
    const d = phase.data;
    if (d.step !== 'pick' || !d.myTurn || d.myPick) return;
    const key = `${phase.seq}:${d.index}:${d.hand}`;
    if (this.duelKey === key) return;
    this.duelKey = key;
    const generation = this.generation;
    const [min, max] = this.actDelayMs;
    setTimeout(async () => {
      if (!this.isCurrent(generation) || this.view?.phase?.seq !== phase.seq) return;
      const res = await this.send('duel:pick', { option: DUEL_OPTIONS[Math.floor(Math.random() * DUEL_OPTIONS.length)] });
      if (!this.isCurrent(generation)) return;
      // Con el revelado en 0 (pruebas), un Duelo de muchos equipos puede repetir manos más rápido de
      // lo que deja elegir el límite de frecuencia: se reintenta la misma mano un poco después.
      if (res.error === 'rate_limited') {
        this.duelKey = null;
        setTimeout(() => this.isCurrent(generation) && this.view && this.maybeAct(this.view), 300);
        return;
      }
      this.report(phase.id, res);
    }, min + Math.random() * (max - min));
  }

  maybePick(phase) {
    const { offerId, codes, picks } = phase.data.offer;
    const chosen = [...codes].sort(() => Math.random() - 0.5).slice(0, picks);
    this.schedule(phase, phase.startsAt, () => this.send('item:pick', { offerId, codes: chosen }));
  }

  // Usa cada objeto con probabilidad 1/2 (uno por tipo), con un objetivo al azar, y confirma.
  maybeUseItems(phase, view) {
    const others = view.teams.filter((t) => t.id !== view.me.teamId).map((t) => t.id);
    const codes = new Set();
    const declarations = view.me.inventory.filter((item) => {
      if (codes.has(item.code) || Math.random() < 0.5) return false;
      if (item.code === 'TD' && !phase.data.nextDraft) return false;
      codes.add(item.code);
      return true;
    });
    this.schedule(phase, phase.startsAt, async () => {
      for (const item of declarations) {
        const res = await this.send('item:declare', {
          itemId: item.id,
          targetTeamId: others[Math.floor(Math.random() * others.length)],
        });
        if (!res.ok) return res;
      }
      return this.send('item:confirm');
    });
  }

  // Ejecuta la acción tras `from` + un retraso al azar; reintenta los errores pasajeros mientras la
  // conexión siga abierta.
  schedule(phase, from, act) {
    this.actedSeq = phase.seq;
    const generation = this.generation;
    const retry = (ms) => setTimeout(() => this.isCurrent(generation) && this.maybeAct(this.view), ms);
    const [min, max] = this.actDelayMs;
    const delay = Math.max(0, from - this.serverNow()) + min + Math.random() * (max - min);
    setTimeout(async () => {
      if (!this.isCurrent(generation) || this.view?.phase?.seq !== phase.seq) return;
      const res = await act();
      if (!this.isCurrent(generation)) return; // se cerró mientras esperaba la respuesta
      if (res.secondChance) {
        // Segunda Vida: la opción fallada quedó eliminada; responder otra vez.
        this.actedSeq = null;
        retry(50);
        return;
      }
      if (res.ok || BENIGN.has(res.error)) return;
      if (RETRYABLE.has(res.error)) {
        this.actedSeq = null;
        retry(150);
      } else {
        this.errors.push(`${phase.id}: ${res.error}`);
      }
    }, delay);
  }
}

// Proyector: solo recibe vistas (prueba de carga).
export class ScreenBot extends Client {
  constructor(url, { label = 'proyector' } = {}) {
    super(url, label);
  }

  open() {
    return this.connectSocket({ role: 'screen' });
  }
}

export class HostBot extends Client {
  constructor(url, token, { label = 'host' } = {}) {
    super(url, label);
    this.token = token;
    this.driving = null;
    this.handledSeq = null;
  }

  open() {
    return this.connectSocket({ role: 'host', token: this.token });
  }

  command(action, data = {}) {
    return this.send('host:command', { action, data });
  }

  // Pulsa "Siguiente" en las pantallas de resultados y, si se pide, salta las fases
  // con tiempo que no tienen acción (ruleta, instrucciones).
  drive({ nextDelayMs = 300, skipTimedAfterMs = null } = {}) {
    this.driving = { nextDelayMs, skipTimedAfterMs };
    if (this.view) this.onView(this.view);
  }

  onView({ room, phase }) {
    if (!this.driving || !room?.started || room.finished || room.paused || !phase) return;
    if (this.handledSeq === phase.seq) return;
    const { nextDelayMs, skipTimedAfterMs } = this.driving;
    let action = null;
    let delay = 0;
    if (phase.waitingHost) {
      action = 'next';
      delay = nextDelayMs;
    } else if (skipTimedAfterMs !== null && ['roulette', 'minigameGroups', 'minigameIntro'].includes(phase.kind)) {
      action = 'skip';
      delay = skipTimedAfterMs;
    }
    if (!action) return;
    this.handledSeq = phase.seq;
    const wait = Math.max(0, phase.startsAt - this.serverNow()) + delay;
    setTimeout(async () => {
      if (this.view?.phase?.seq !== phase.seq) return;
      const res = await this.command(action);
      if (!res.ok) this.handledSeq = null; // p. ej. en pausa: se reintenta con la próxima vista
    }, wait);
  }
}
