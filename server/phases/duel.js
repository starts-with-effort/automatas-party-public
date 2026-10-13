// Duelo: piedra, papel o tijera para desempatar un minijuego (el primer puesto o el fragmento) y
// para resolver los Desafíos. El plan tiene una fase de Duelo después de cada minijuego y otra
// después de la resolución de objetos; si no hay duelos en la cola (room.duels), se salta.
//
// Con más de un duelo en la cola, primero la cartelera (lineupMs) con la lista. Luego, cada duelo:
//   presentación (introMs) → mano: elige un celular por lado en pickMs (si no elige, recibe una
//   opción al azar; con todos elegidos se muestra al instante) → se muestran las opciones
//   (revealMs) → si sigue el empate, otra mano → ganador (resultMs).
// Un Desafío contra un equipo sin fragmentos ni estrellas no se juega: se avisa (voidMs) y sigue.
// No hay empates: si tras maxRounds manos siguen varios lados, el ganador se sortea entre ellos.
//
// Turnos (rediseño del Duelo): en cada mano elige un solo celular por lado. Los celulares del lado
// van en rotación (el A de cada equipo y luego el B; en un grupo, A del primero, A del segundo, B
// del primero…), que empieza en uno al azar y avanza uno en cada mano. Si al que le toca no está
// conectado, elige el siguiente conectado de la rotación.
import { OPTIONS, playHand } from '../domain/duel.js';
import { poolPoints, stealAll } from '../domain/stars.js';
import { finishMinigame, minigameName } from './minigame.js';

const fail = (error) => ({ ok: false, error });

// Lo más que puede durar un duelo: con eso se fija el plazo de la fase.
export const duelSpan = ({ introMs, pickMs, revealMs, resultMs, maxRounds }) =>
  introMs + maxRounds * (pickMs + revealMs) + resultMs;

export const duelPhase = {
  durationMs: (config) => duelSpan(config.duel),
  acceptsActions: true,
  skip: ({ room }) => !(room.duels?.length > 0),

  enter(ctx) {
    const { room, phase, config } = ctx;
    const duels = room.duels.map((duel) => ({ ...duel }));
    const lineup = duels.length > 1;
    phase.endsAt = phase.startsAt + duelSpan(config.duel) * duels.length + (lineup ? config.duel.lineupMs : 0);
    phase.data = { duels, current: 0, bout: null, done: [] };
    phase.data.bout = lineup ? lineupBout(phase.startsAt, config.duel) : newBout(ctx, duels[0], phase.startsAt);
  },

  onAction(ctx, { teamId, deviceId, action }) {
    const { phase, now } = ctx;
    if (action.type !== 'duel' || !OPTIONS.includes(action.option)) return fail('invalid_action');
    const { bout } = phase.data;
    const duel = currentDuel(phase);
    if (!duel || bout.step !== 'pick') return fail('duel_not_open');
    const side = sideOf(duel, teamId);
    if (side < 0 || !bout.alive.includes(side)) return fail('not_in_duel');
    if (bout.picks[side]) return fail('already_picked');
    if (turnOf(ctx, duel, bout, side, bout.hand).deviceId !== deviceId) return fail('not_your_turn');
    bout.picks[side] = action.option;
    if (bout.alive.every((s) => bout.picks[s])) playOut(ctx, now);
    return { ok: true, event: { type: 'duel_pick', duelId: duel.id, hand: bout.hand, option: action.option } };
  },

  isComplete: ({ phase }) => phase.data.current >= phase.data.duels.length,
  nextWakeup: ({ phase }) => (currentDuel(phase) ? phase.data.bout.until : null),

  // Avanza los pasos vencidos (tras una pausa larga puede haber más de uno).
  onWakeup(ctx) {
    const { phase, now } = ctx;
    while (currentDuel(phase) && now >= phase.data.bout.until) advance(ctx);
  },

  shiftTimes({ phase }, delta) {
    phase.data.bout.since += delta;
    phase.data.bout.until += delta;
  },

  // Si la fase se cierra antes (el host la salta), los duelos que falten se sortean.
  exit(ctx) {
    const { phase, random } = ctx;
    while (currentDuel(phase)) {
      if (phase.data.bout.step === 'lineup') phase.data.bout = newBout(ctx, currentDuel(phase), ctx.now);
      const { bout } = phase.data;
      if (bout.step !== 'void' && bout.winner === null) decide(ctx, bout.alive[Math.floor(random() * bout.alive.length)], { drawn: true });
      nextDuel(ctx, ctx.now);
    }
  },

  // Todo es público salvo lo que eligió cada lado en la mano en curso: cada equipo ve solo lo suyo
  // (los dos celulares del equipo, y los del grupo, ven lo que eligió su lado).
  view(ctx, viewer) {
    const { phase, config } = ctx;
    const { duels, current, bout, done } = phase.data;
    const index = Math.min(current, duels.length - 1);
    const duel = duels[index];
    const me = viewer.deviceId ? ctx.teamOf(viewer.deviceId) : null;
    const mySide = me ? sideOf(duel, me.team.id) : -1;
    // Turnos que se muestran: los de la mano en curso mientras se elige; los de la que viene en la
    // presentación y tras un empate.
    const turnHand = bout.step === 'pick' ? bout.hand
      : bout.step === 'intro' || (bout.step === 'reveal' && bout.winner === null) ? bout.hand + 1 : null;
    const turns = turnHand === null ? {}
      : Object.fromEntries(bout.alive.map((side) => [side, publicTurn(turnOf(ctx, duel, bout, side, turnHand))]));
    return {
      index,
      count: duels.length,
      lineup: duels.length > 1 ? duels.map((d) => summary(config, d)) : null,
      duel: summary(config, duel),
      step: bout.step,
      since: bout.since,
      until: bout.until,
      pickMs: config.duel.pickMs,
      hand: bout.hand,
      alive: bout.alive,
      picked: bout.step === 'pick' ? bout.alive.filter((side) => bout.picks[side]) : [],
      myPick: bout.step === 'pick' && mySide >= 0 ? bout.picks[mySide] ?? null : null,
      mySide,
      mySlot: me?.slot ?? null,
      turnHand,
      turns,
      myTurn: bout.step === 'pick' && mySide >= 0 && bout.alive.includes(mySide)
        && turnOf(ctx, duel, bout, mySide, bout.hand).deviceId === viewer.deviceId,
      stake: bout.stake,
      hands: bout.hands, // las manos ya jugadas (públicas)
      winner: bout.winner,
      drawn: bout.drawn,
      outcome: bout.outcome,
      done,
    };
  },
};

const summary = (config, duel) => ({
  kind: duel.kind,
  sides: duel.sides,
  round: duel.round,
  minigame: duel.minigame ?? null,
  minigameName: duel.minigame ? minigameName(config, duel.minigame) : null,
});

// Cartelera: la lista de duelos de la fase, antes del primero.
function lineupBout(at, rules) {
  return { ...emptyBout([]), step: 'lineup', since: at, until: at + rules.lineupMs };
}

function emptyBout(sides) {
  return {
    step: 'intro', // (lineup →) intro → pick → reveal → (pick → reveal…) → result; o void
    since: 0, // inicio del paso en curso (para que las pantallas sincronicen sus animaciones)
    until: 0,
    hand: 0,
    alive: sides.map((_, index) => index),
    picks: {},
    hands: [], // [{ picks: { lado: opción }, auto: [lados con opción al azar], alive, turns: { lado: { teamId, slot } } }]
    turnStart: sides.map(() => 0), // por lado: en qué celular de la rotación empieza la mano 1
    stake: null, // Desafío: lo que tiene el desafiado al empezar ({ fragments, stars, points })
    winner: null,
    drawn: false, // el ganador salió de un sorteo (maxRounds o fase saltada)
    outcome: null,
  };
}

// Empieza un duelo: presentación, o el aviso si es un Desafío sin nada que robar (en ese caso el
// duelo se da por terminado aquí mismo, sin ganador).
function newBout(ctx, duel, at) {
  const { room, phase, config, random, record } = ctx;
  const rules = config.duel;
  const bout = { ...emptyBout(duel.sides), since: at, until: at + rules.introMs };
  bout.turnStart = duel.sides.map((teamIds) => Math.floor(random() * teamIds.length * 2));
  if (duel.kind !== 'desafio') return bout;
  const target = room.teams.find((t) => t.id === duel.sides[1][0]);
  const loot = { fragments: target?.fragments ?? 0, stars: target?.stars ?? 0 };
  bout.stake = { ...loot, points: poolPoints(loot, config.stars) };
  if (loot.fragments > 0 || loot.stars > 0) return bout;
  bout.step = 'void';
  bout.until = at + rules.voidMs;
  bout.outcome = { stolen: false, empty: true };
  room.duels = (room.duels ?? []).filter((d) => d.id !== duel.id);
  phase.data.done.push({ id: duel.id, kind: duel.kind, sides: duel.sides, winner: null, drawn: false, outcome: bout.outcome });
  record('duel_skipped', { duelId: duel.id, kind: duel.kind, round: duel.round, sides: duel.sides, reason: 'nothing_to_steal' });
  return bout;
}

const currentDuel = (phase) => phase.data.duels[phase.data.current] ?? null;
const sideOf = (duel, teamId) => duel.sides.findIndex((teamIds) => teamIds.includes(teamId));

// Celulares de un lado en el orden en que eligen.
const rotation = (teamIds) => ['A', 'B'].flatMap((slot) => teamIds.map((teamId) => ({ teamId, slot })));
const deviceOf = (room, { teamId, slot }) => room.teams.find((t) => t.id === teamId)?.slots[slot] ?? null;
const publicTurn = ({ teamId, slot }) => ({ teamId, slot });

// Quién elige por el lado en la mano `hand`: el que toca en la rotación o, si no está conectado,
// el siguiente conectado. Sin ninguno conectado, el que tocaba (al acabarse el tiempo sale una
// opción al azar). Se calcula cada vez, así se adapta a las desconexiones a mitad de una mano.
function turnOf(ctx, duel, bout, side, hand) {
  const order = rotation(duel.sides[side]);
  const first = (bout.turnStart[side] + hand - 1) % order.length;
  for (let k = 0; k < order.length; k += 1) {
    const turn = order[(first + k) % order.length];
    const deviceId = deviceOf(ctx.room, turn);
    if (deviceId && ctx.isConnected(deviceId)) return { ...turn, deviceId };
  }
  return { ...order[first], deviceId: deviceOf(ctx.room, order[first]) };
}

// El paso que vence en bout.until. Los siguientes se cuentan desde ese instante (no desde el de
// la llamada), para que todas las pantallas vean el mismo ritmo aunque el temporizador se atrase.
function advance(ctx) {
  const { phase, config, random } = ctx;
  const { bout } = phase.data;
  const at = bout.until;
  if (bout.step === 'lineup') {
    phase.data.bout = newBout(ctx, currentDuel(phase), at);
    return undefined;
  }
  if (bout.step === 'void') return nextDuel(ctx, at);
  if (bout.step === 'intro') return newHand(bout, at, config.duel);
  if (bout.step === 'pick') {
    const auto = bout.alive.filter((side) => !bout.picks[side]);
    for (const side of auto) bout.picks[side] = OPTIONS[Math.floor(random() * OPTIONS.length)];
    return playOut(ctx, at, auto);
  }
  if (bout.step === 'reveal') {
    if (bout.winner === null) return newHand(bout, at, config.duel);
    bout.step = 'result';
    bout.since = at;
    bout.until = at + config.duel.resultMs;
    return undefined;
  }
  return nextDuel(ctx, at); // result
}

function newHand(bout, at, rules) {
  bout.step = 'pick';
  bout.hand += 1;
  bout.picks = {};
  bout.since = at;
  bout.until = at + rules.pickMs;
}

// Se muestran las opciones de la mano: siguen los que ganaron (o todos, si hubo empate).
function playOut(ctx, at, auto = []) {
  const { phase, config, random } = ctx;
  const { bout } = phase.data;
  const duel = currentDuel(phase);
  const turns = Object.fromEntries(bout.alive.map((side) => [side, publicTurn(turnOf(ctx, duel, bout, side, bout.hand))]));
  const alive = playHand(bout.alive, bout.picks);
  bout.hands.push({ picks: { ...bout.picks }, auto, alive, turns });
  bout.alive = alive;
  if (alive.length === 1) decide(ctx, alive[0]);
  else if (bout.hand >= config.duel.maxRounds) decide(ctx, alive[Math.floor(random() * alive.length)], { drawn: true });
  bout.step = 'reveal';
  bout.since = at;
  bout.until = at + config.duel.revealMs;
}

// Hay ganador: se aplica lo que estaba en juego y el duelo sale de la cola de la sala.
function decide(ctx, side, { drawn = false } = {}) {
  const { room, phase, record } = ctx;
  const { bout } = phase.data;
  const duel = currentDuel(phase);
  bout.winner = side;
  bout.drawn = drawn;
  bout.outcome = settle(ctx, duel, side);
  room.duels = (room.duels ?? []).filter((d) => d.id !== duel.id);
  phase.data.done.push({ id: duel.id, kind: duel.kind, sides: duel.sides, winner: side, drawn, outcome: bout.outcome });
  record('duel_finished', {
    duelId: duel.id,
    kind: duel.kind,
    round: duel.round,
    minigame: duel.minigame ?? null,
    sides: duel.sides,
    winner: side,
    winnerTeamIds: duel.sides[side],
    hands: bout.hands.length,
    drawn,
    outcome: bout.outcome,
  });
}

function nextDuel(ctx, at) {
  const { phase } = ctx;
  phase.data.current += 1;
  const duel = currentDuel(phase);
  if (duel) phase.data.bout = newBout(ctx, duel, at);
}

// Desempate de minijuego: se reparten los premios como si el lado ganador hubiera quedado solo en
// el primer puesto. Desafío: si gana el atacante (lado 0), roba todos los fragmentos y estrellas.
function settle(ctx, duel, side) {
  const { room, config, record } = ctx;
  if (duel.kind === 'minigame') {
    const pending = room.pendingMinigame;
    if (!pending || pending.round !== duel.round || pending.minigame !== duel.minigame) return null;
    room.pendingMinigame = null;
    const { outcomes, sides, ...info } = pending;
    finishMinigame(ctx, { ...info, results: outcomes[side], duel: { sides, winner: side } });
    return { fragments: room.minigameResults[duel.round]?.fragments.map((f) => f.teamId) ?? [] };
  }
  const [[attackerId], [targetId]] = duel.sides;
  const attacker = room.teams.find((t) => t.id === attackerId);
  const target = room.teams.find((t) => t.id === targetId);
  if (side !== 0 || !attacker || !target) return { stolen: false };
  const result = stealAll(attacker, target, config.stars);
  if (result.completed > 0) {
    record('star_completed', {
      teamId: attackerId, round: duel.round, source: 'desafio', completed: result.completed, stars: attacker.stars, points: result.points,
    });
  }
  return { stolen: true, ...result };
}
