// Memoria de parejas (RF-MJ1): un tablero compartido por todos los grupos. Por turnos, en un orden
// al azar fijado al inicio, cada grupo voltea dos cartas: la primera la elige un equipo y la segunda
// el otro (en el siguiente turno del grupo, al revés). Si forman pareja, el grupo suma un punto.
import { pickDistinct } from '../domain/random.js';

const fail = (error) => ({ ok: false, error });

export const memoria = {
  id: 'memoria',
  grouping: 'pairs',
  metric: 'parejas',
  fragmentRule: 'Cada equipo del grupo ganador gana un fragmento de estrella.',
  playMs: (settings) => settings.maxDurationMs,

  init({ groups, settings, random, window }) {
    const faces = pickDistinct(settings.faces, settings.pairs, random);
    const deck = pickDistinct([...faces, ...faces], faces.length * 2, random);
    return {
      cards: deck.map((face) => ({ face, state: 'down' })), // down | up | gone
      order: pickDistinct(groups.map((_, index) => index), groups.length, random),
      position: 0, // índice en `order` del grupo que tiene el turno
      turnsTaken: groups.map(() => 0),
      pairs: groups.map(() => 0),
      turn: newTurn(window.start, settings),
    };
  },

  onInput(state, ctx) {
    const { input, now, settings } = ctx;
    if (input.type !== 'flip' || !Number.isInteger(input.card)) return fail('invalid_input');
    const card = state.cards[input.card];
    if (!card) return fail('invalid_input');
    const { turn } = state;
    if (turn.step === 'reveal' || !canFlip(state, ctx, ctx)) return fail('not_your_turn');
    if (card.state !== 'down') return fail('card_unavailable');

    card.state = 'up';
    if (turn.step === 'first') {
      turn.first = input.card;
      turn.step = 'second';
      turn.deadline = now + settings.cardTimeMs;
      return { ok: true, event: { type: 'memoria_flip', card: input.card } };
    }
    turn.second = input.card;
    turn.match = state.cards[turn.first].face === card.face;
    if (turn.match) state.pairs[currentGroup(state)] += 1;
    // Correcta o no, las cartas se ven un momento y el turno pasa al siguiente grupo (RF-MJ1-05).
    turn.step = 'reveal';
    turn.revealUntil = now + settings.revealMs;
    return { ok: true, event: { type: 'memoria_flip', card: input.card, match: turn.match } };
  },

  nextWakeup(state) {
    if (memoria.isFinished(state)) return null;
    return state.turn.step === 'reveal' ? state.turn.revealUntil : state.turn.deadline;
  },

  // Fin del tiempo de muestra, o de los 10 s por carta: si vence, el grupo pierde el turno (RF-MJ1-06).
  onWakeup(state, { now, settings }) {
    const { turn } = state;
    if (turn.step === 'reveal' && now >= turn.revealUntil) {
      for (const index of [turn.first, turn.second]) state.cards[index].state = turn.match ? 'gone' : 'down';
      nextTurn(state, now, settings);
    } else if (turn.step !== 'reveal' && now >= turn.deadline) {
      if (turn.first !== null) state.cards[turn.first].state = 'down';
      nextTurn(state, now, settings);
    }
  },

  shiftTimes(state, delta) {
    state.turn.deadline += delta;
    if (state.turn.revealUntil !== null) state.turn.revealUntil += delta;
  },

  isFinished(state) {
    return state.cards.every((card) => card.state === 'gone');
  },

  scores(state) {
    return state.pairs;
  },

  // El contenido de una carta solo sale del servidor mientras está volteada (RF-MJ1-08).
  view(state, ctx) {
    const { turn } = state;
    const flipper = turn.step === 'reveal' ? null : whoFlips(state, ctx.groups);
    return {
      cards: state.cards.map((card) => (card.state === 'up' ? { state: 'up', face: card.face } : { state: card.state })),
      turn: {
        group: currentGroup(state),
        step: turn.step,
        deadline: turn.step === 'reveal' ? null : turn.deadline,
        cardMs: ctx.settings.cardTimeMs, // lo que dura el anillo del turno completo
        match: turn.step === 'reveal' ? turn.match : null,
        flipper,
      },
      pairs: state.pairs,
      canFlip: ctx.viewer.role === 'play' && turn.step !== 'reveal' && canFlip(state, ctx, ctx.viewer),
    };
  },
};

function newTurn(start, settings) {
  return { step: 'first', first: null, second: null, deadline: start + settings.cardTimeMs, revealUntil: null, match: null };
}

function currentGroup(state) {
  return state.order[state.position];
}

function nextTurn(state, now, settings) {
  state.turnsTaken[currentGroup(state)] += 1;
  state.position = (state.position + 1) % state.order.length;
  state.turn = newTurn(now, settings);
}

// Quién voltea ahora (RF-MJ1-03): en el turno de un grupo, un equipo voltea la primera carta y el
// otro la segunda; en el siguiente turno del grupo se invierte el orden. En un grupo de un solo
// equipo, A voltea la primera y B la segunda.
function whoFlips(state, groups) {
  const group = currentGroup(state);
  const teams = groups[group];
  const step = state.turn.step;
  if (teams.length === 1) return { teamId: teams[0], slot: step === 'first' ? 'A' : 'B' };
  const firstTeam = state.turnsTaken[group] % 2;
  return { teamId: step === 'first' ? teams[firstTeam] : teams[1 - firstTeam], slot: null };
}

// Si el dispositivo que le toca no está conectado, voltea su compañero.
function canFlip(state, ctx, { teamId, slot }) {
  const flipper = whoFlips(state, ctx.groups);
  if (flipper.teamId !== teamId) return false;
  if (flipper.slot === null || flipper.slot === slot) return true;
  return !ctx.slotConnected(teamId, flipper.slot);
}
