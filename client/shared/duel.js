// Duelo: piedra, papel o tijera (server/phases/duel.js), rediseñado en el estilo del resultado del
// minijuego: círculos de los equipos, sin recuadros, y dibujos de cartón en vez de emojis.
// Pasos: (cartelera, con varios duelos) → presentación → mano (elige un celular por lado) →
// revelado → otra mano si hubo empate → resultado. Un Desafío sin nada que robar solo se avisa.
// duelBody sirve al celular (con socket: botones y su punto de vista) y al proyector; el host usa
// duelHostBody, en texto.
//
// Animaciones: cada paso entra con las suyas cuando cambia (no con cada vista que llega dentro del
// mismo paso), sincronizadas con el inicio del paso en el reloj del servidor (`since`), así una
// pantalla que se conecta a mitad del paso las ve donde van. Las cartas que se mueven mientras se
// elige van al mismo compás en todas las pantallas.
import { h } from './dom.js';
import { send, toast } from './ui.js';
import { errorMessage } from './errors.js';
import { countdown, starMeter } from './widgets.js';

export const DUEL_OPTIONS = {
  piedra: { label: 'Piedra' },
  papel: { label: 'Papel' },
  tijera: { label: 'Tijera' },
};
const BEATS = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' };
const WHY = { piedra: 'Piedra rompe tijera', papel: 'Papel envuelve a piedra', tijera: 'Tijera corta papel' };
const INK = '#1c1640';
const BOB_MS = 900;
const CROWN = '<svg class="crown" viewBox="0 0 40 26" aria-hidden="true"><path d="M3 23 L6 6 L14 15 L20 3 L26 15 L34 6 L37 23 Z" fill="#ffc93c" stroke="#1c1640" stroke-width="3" stroke-linejoin="round"/></svg>';

// Dibujos de cartón con las reglas de los íconos de objetos (docs/ICONOS.md): cuadrícula de 64,
// tinta de 3 px y sombra dura. Cada uno lleva su propio filtro (los id no pueden repetirse).
let filterSeq = 0;
function drawing(body) {
  const id = `duel-lift-${++filterSeq}`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><filter id="${id}" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="0" dy="2.5" stdDeviation="0" flood-color="${INK}" flood-opacity="1"/></filter></defs><g filter="url(#${id})" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}
const ROCK = 'M9 42 C8 33 12 25 19 20 C25 15 33 12 41 15 C49 18 55 26 56 35 C57 44 51 51 42 53 C32 55 18 54 12 49 C10 47 9 45 9 42 Z';
const scissorArm = (angle) => `<g transform="translate(32 31) rotate(${angle})"><rect x="-2.6" y="4" width="5.2" height="9" rx="2" fill="#3a3366"/><circle cx="0" cy="19" r="7.2" fill="#ff4f8b"/><circle cx="0" cy="19" r="3" fill="#fff"/><path d="M-4.6 6 C-4.6 -8 -2.6 -19 0 -26 C2.6 -19 4.6 -8 4.6 6 Z" fill="#e9f6ff"/><path d="M-1.4 -15 V1" stroke="#fff" stroke-width="2"/></g>`;
const ART = {
  piedra: () => drawing(`<path d="${ROCK}" fill="#8c88a8" stroke="none"/><path d="M20 21 C26 16 33 14 40 16 C45 18 49 21 51 25 C43 24 35 26 29 31 C25 28 22 25 20 21 Z" fill="#b9b5d6" stroke="none"/><path d="M14 46 C24 50 38 51 50 45 C47 50 40 52 32 52.5 C23 53 16 50 14 46 Z" fill="#6e6a8e" stroke="none"/><path d="M36 33 C39 36 43 37 47 36" stroke-width="2.4"/><path d="${ROCK}"/><path d="M15 34 C17 29 20 25 24 22" stroke="#fff" stroke-width="2.6"/>`),
  papel: () => drawing('<g transform="rotate(-7 32 33)"><path d="M17 7 H40 L49 16 V57 H17 Z" fill="#fff"/><path d="M40 7 V16 H49" fill="#e9f6ff"/><path d="M23 26 H43 M23 34 H43 M23 42 H43 M23 50 H35" stroke="#4d9bff" stroke-width="2.6"/></g>'),
  tijera: () => drawing(`${scissorArm(24)}${scissorArm(-24)}<circle cx="32" cy="31" r="2.8" fill="${INK}"/>`),
  // Carta boca abajo: lo que se ve mientras un lado elige.
  carta: () => drawing(`<rect x="12" y="6" width="40" height="52" rx="8" fill="#ffc93c"/><rect x="17.5" y="11.5" width="29" height="41" rx="5" stroke="#e9a91c" stroke-width="2.5" stroke-dasharray="4 4"/><path d="M26 25 C26 19 38 19 38 25.5 C38 30 32 30.5 32 35.5" stroke-width="4"/><circle cx="32" cy="43" r="2.6" fill="${INK}" stroke="none"/>`),
  // Desafío (el dibujo del objeto, items/ds.svg).
  desafio: () => drawing('<g transform="translate(32 27) rotate(-45)"><path d="M-4 14 V-15 L0 -20.5 L4 -15 V14 Z" fill="#e9f6ff"/><rect x="-3.5" y="19" width="7" height="8.5" rx="2.5" fill="#3a3366"/><circle cx="0" cy="30.5" r="3.8" fill="#fff3c4"/><rect x="-11" y="13" width="22" height="6" rx="3" fill="#ffc93c"/></g><g transform="translate(32 27) rotate(45)"><path d="M-4 14 V-15 L0 -20.5 L4 -15 V14 Z" fill="#e9f6ff"/><path d="M-1 -13 V8" stroke="#fff" stroke-width="2.2"/><path d="M-4 14 V-15 L0 -20.5 L4 -15 V14 Z"/><rect x="-3.5" y="19" width="7" height="8.5" rx="2.5" fill="#3a3366"/><circle cx="0" cy="30.5" r="3.8" fill="#fff3c4"/><rect x="-11" y="13" width="22" height="6" rx="3" fill="#ffc93c"/></g>'),
};

function art(name, className = 'dl-art') {
  const el = h('span', { class: className, 'aria-hidden': 'true' });
  el.innerHTML = ART[name]();
  return el;
}

// Lo que eligió este celular, mientras el servidor confirma: respuesta visual inmediata (RNF-02).
let localPick = { key: null, option: null };
// Paso que ya se animó: las vistas siguientes del mismo paso se dibujan en seco.
let animatedKey = null;

// data-fx (y su retraso) de las piezas que entran con el paso; null si no se anima.
const fx = (name, delay) => (name ? { fx: name, ...(delay !== undefined ? { fxDelay: delay } : {}) } : null);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const points = (n) => Number(n).toLocaleString('es-CO');
const cel = (slot) => (slot === 'A' ? 1 : 2);
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lootText = ({ fragments = 0, stars = 0 }) => [
  fragments > 0 && plural(fragments, 'fragmento', 'fragmentos'),
  stars > 0 && plural(stars, 'estrella', 'estrellas'),
].filter(Boolean).join(' y ');

// socket: solo en el celular (puede elegir). clock: reloj del servidor (animaciones y compás).
// rerender(): vuelve a dibujar con la última vista.
export function duelBody(view, { socket = null, clock = null, rerender = () => {} } = {}) {
  const { phase, teams, me } = view;
  const d = phase.data;
  const byId = new Map(teams.map((team) => [team.id, team]));
  const phone = Boolean(socket);
  const myTeamId = phone ? me?.teamId ?? null : null;
  const ctx = {
    d,
    phone,
    myTeamId,
    team: (id) => byId.get(id) ?? { id, name: id, color: '#888888' },
    sideName: (side) => d.duel.sides[side].map((id) => byId.get(id)?.name ?? id).join(' + '),
  };
  const key = `${phase.seq}:${d.index}:${d.hand}`;
  ctx.myPick = d.myPick ?? (localPick.key === key ? localPick.option : null);
  ctx.pick = async (option) => {
    localPick = { key, option };
    rerender();
    navigator.vibrate?.(15);
    const res = await send(socket, 'duel:pick', { option });
    if (!res.ok && res.error !== 'already_picked') {
      localPick = { key: null, option: null };
      toast(errorMessage(res.error));
      rerender();
    }
  };

  const body = STEPS[d.step]?.(ctx) ?? [];
  const root = h('section', { class: `stack duel${phone ? ' duel-phone' : ' duel-screen'}`, 'data-step': d.step }, body);
  if (clock) {
    // Todas las cartas al mismo compás: el retraso negativo las pone en la fase del reloj.
    root.style.setProperty('--bob-delay', `${-(clock.now() % BOB_MS)}ms`);
    const stepKey = `${phase.seq}:${d.index}:${d.step}:${d.hand}`;
    if (stepKey !== animatedKey) {
      animatedKey = stepKey;
      const elapsed = clock.now() - d.since;
      if (!still() && elapsed < 2500) playFx(root, Math.max(0, elapsed));
    }
  }
  return root;
}

// Cuenta de la mano para la cabecera (en el Duelo, la fase no tiene una cuenta propia).
export function duelCountdown(phase, room) {
  const d = phase.data;
  if (d?.step !== 'pick') return null;
  return countdown({ endsAt: d.until, startsAt: d.since, resumeAt: phase.resumeAt }, room);
}

// Hasta cuándo corre la cuenta final de 5 s (urgency.js) en este celular: solo si le toca elegir y
// su lado no ha elegido.
export function duelUrgentEndsAt(phase) {
  const d = phase.data;
  const key = `${phase.seq}:${d.index}:${d.hand}`;
  const picked = d.myPick ?? (localPick.key === key ? localPick.option : null);
  return d.step === 'pick' && d.myTurn && !picked ? d.until : null;
}

// En el proyector, la ficha de la cuenta late en rojo mientras algún lado no ha elegido.
export function duelPendingEndsAt(phase) {
  const d = phase.data;
  return d.step === 'pick' && d.picked.length < d.alive.length ? d.until : null;
}

// ------------------------------------------------------------------ piezas

function ball(team, { size = '', me = false, crown = false, off = false } = {}) {
  const el = h('i', { class: `team-ball dl-ball${size ? ` ${size}` : ''}${me ? ' me' : ''}${off ? ' off' : ''}`, style: { '--team': team.color }, 'aria-hidden': 'true' });
  if (crown) el.insertAdjacentHTML('beforeend', CROWN);
  return el;
}

// Los círculos de un lado (un equipo, o los del grupo unidos con «+»).
function sideBalls(ctx, side, opts = {}) {
  const ids = ctx.d.duel.sides[side];
  return h('span', { class: 'dl-balls' }, ids.flatMap((id, i) => [
    i > 0 && h('span', { class: 'dl-plus', 'aria-hidden': 'true' }, '+'),
    ball(ctx.team(id), { ...opts, me: id === ctx.myTeamId }),
  ]));
}

function kindChip(ctx, { lineup = false } = {}) {
  const { d } = ctx;
  const many = d.count > 1 && !lineup ? h('span', { class: 'dl-of' }, ` · duelo ${d.index + 1} de ${d.count}`) : null;
  if (d.duel.kind === 'desafio') return h('span', { class: 'dl-kind' }, art('desafio', 'dl-kind-art'), 'Desafío', many);
  return h('span', { class: 'dl-kind' }, art('carta', 'dl-kind-art'), `Desempate · ${d.duel.minigameName}`, many);
}

// Lo que está en juego: la estrella del desafiado o el primer puesto del minijuego.
function stakeChip(ctx) {
  const { d } = ctx;
  if (d.duel.kind === 'desafio') {
    const stake = d.stake ?? {};
    return h('span', { class: 'dl-stake' }, h('span', { class: 'dl-stake-label' }, 'En juego'), starMeter(stake),
      `${lootText(stake)} · ${points(stake.points ?? 0)} pts`);
  }
  return h('span', { class: 'dl-stake' }, h('span', { class: 'dl-stake-label' }, 'En juego'), starMeter({ fragments: 1 }),
    `Primer puesto y fragmento de ${d.duel.minigameName}`);
}

// Los dos celulares de cada equipo del lado; el que elige, en amarillo. swapFrom: el que eligió en
// la mano anterior (tras un empate, el turno pasa de ese al que está en amarillo).
function pips(ctx, side, turn, { swapFrom = null } = {}) {
  const ids = ctx.d.duel.sides[side];
  const group = ids.length > 1;
  const row = h('span', { class: 'dl-pips', 'aria-hidden': 'true' }, ids.map((id) => h('span', { class: 'dl-pip-team' },
    group && h('i', { class: 'dl-pip-dot', style: { '--team': ctx.team(id).color } }),
    ['A', 'B'].map((slot) => {
      const on = turn?.teamId === id && turn.slot === slot;
      const was = swapFrom?.teamId === id && swapFrom.slot === slot;
      return h('i', { class: `dl-pip${on ? ' on' : ''}`, dataset: fx(on && swapFrom ? 'pip-on' : was ? 'pip-off' : null) }, String(cel(slot)));
    }))));
  const who = turn ? (group ? `${ctx.team(turn.teamId).name} · cel. ${cel(turn.slot)}` : `celular ${cel(turn.slot)}`) : '';
  return h('span', { class: 'dl-turn' }, row, turn && h('span', { class: swapFrom ? 'dl-swap' : '' }, `${swapFrom ? 'Cambio: elige' : 'Elige'} ${who}`));
}

function slot(choice, { bob = false, ready = false, auto = false, win = false, lose = false, flip = false } = {}) {
  const cls = ['dl-slot', bob && 'bob', win && 'won', lose && 'lost'].filter(Boolean).join(' ');
  return h('div', { class: cls, dataset: fx(flip ? 'flip' : null) },
    art(choice ?? 'carta'),
    ready && h('span', { class: 'dl-sticker' }, '¡Listo!'),
    auto && h('span', { class: 'dl-sticker auto' }, 'al azar'));
}

// Las manos ya jugadas, en una tira: «Mano 1 · piedra piedra · empate».
function history(ctx, hands) {
  if (hands.length === 0) return null;
  return h('p', { class: 'dl-history' }, hands.map((hand, i) => h('span', { class: 'dl-history-hand' },
    `Mano ${i + 1}`,
    Object.keys(hand.picks).map((side) => art(hand.picks[side], 'dl-history-art')),
    hand.alive.length === Object.keys(hand.picks).length ? 'empate' : null)));
}

const vs = (small = false, dataset = null) => h('span', { class: `dl-vs${small ? ' small' : ''}`, 'aria-hidden': 'true', dataset }, 'VS');
// Los elementos con una pieza en medio de cada par (el «VS», o el sello de empate).
const between = (items, mid) => items.flatMap((el, i) => (i === 0 ? [el] : [mid(), el]));

// Los lados con sus círculos y nombres, en fila con «VS» (el celular lo usa en chico).
function faceRow(ctx, { small = false, crowned = null, off = [] } = {}) {
  return h('div', { class: `dl-row${small ? ' small' : ''}` }, between(ctx.d.duel.sides.map((_, side) => h('div', { class: 'dl-who' },
    sideBalls(ctx, side, { size: small ? 'sm' : '', crown: crowned === side, off: off.includes(side) }),
    h('span', { class: 'dl-who-name' }, ctx.sideName(side)))), () => vs(small)));
}

const mySideOf = (ctx) => (ctx.phone ? ctx.d.mySide : -1);
const isMe = (ctx, turn) => Boolean(turn) && turn.teamId === ctx.myTeamId && turn.slot === ctx.d.mySlot;
// Quién elige, dicho desde el celular: «tu compañero» si es del mismo equipo, o el equipo del grupo.
const mateName = (ctx, turn) => (turn.teamId === ctx.myTeamId ? 'tu compañero' : ctx.team(turn.teamId).name);

// ------------------------------------------------------------------ pasos

const STEPS = { lineup, void: voidStep, intro, pick, reveal, result };

// Cartelera: con varios duelos, la lista antes del primero.
function lineup(ctx) {
  const { d } = ctx;
  const rows = d.lineup.map((duel, i) => {
    const sub = { ...ctx, d: { ...d, duel }, sideName: (side) => duel.sides[side].map((id) => ctx.team(id).name).join(' + ') };
    const mine = duel.sides.some((ids) => ids.includes(ctx.myTeamId));
    return h('li', { class: `dl-entry${mine ? ' mine' : ''}`, dataset: fx('rise', 250 + i * 350) },
      h('span', { class: 'dl-line-num' }, String(i + 1)),
      kindChip(sub, { lineup: true }),
      h('span', { class: 'dl-line-face' }, between(duel.sides.map((_, side) => h('span', { class: 'dl-who inline' },
        sideBalls(sub, side, { size: 'sm' }), h('span', { class: 'dl-who-name' }, sub.sideName(side)))), () => vs(true))));
  });
  const mine = d.lineup.map((duel, i) => (duel.sides.some((ids) => ids.includes(ctx.myTeamId)) ? i + 1 : null)).filter(Boolean);
  const note = mine.length === 0 ? 'Tu equipo no juega estos duelos.'
    : mine.length === 1 ? `Tu equipo juega el duelo ${mine[0]}.`
      : `Tu equipo juega los duelos ${mine.slice(0, -1).join(', ')} y ${mine.at(-1)}.`;
  return [
    h('p', { class: 'dl-label' }, `Hoy hay ${d.count} duelos`),
    h('ol', { class: 'dl-lineup' }, rows),
    ctx.phone && h('p', { class: 'dl-line-note' }, note),
  ];
}

// Desafío contra un equipo sin fragmentos ni estrellas: no se juega.
function voidStep(ctx) {
  const [[attacker], [target]] = ctx.d.duel.sides;
  return [
    kindChip(ctx),
    faceRow(ctx, { small: ctx.phone, off: [1] }),
    h('p', { class: 'dl-big', dataset: fx('stamp') }, `${ctx.team(target).name} no tiene estrellas que robar`),
    h('p', { class: 'dl-note' }, `El Desafío de ${ctx.team(attacker).name} no se juega.`),
  ];
}

// Presentación: los lados entran desde los costados y cae el «VS».
function intro(ctx) {
  const { d } = ctx;
  const mySide = mySideOf(ctx);
  const roles = d.duel.kind === 'desafio' ? ['Reta', 'Defiende'] : d.duel.sides.map((_, i) => `Grupo ${i + 1}`);
  if (ctx.phone) {
    if (mySide < 0) {
      return [kindChip(ctx), faceRow(ctx, { small: true }), h('p', { class: 'dl-note' }, 'Tu equipo no juega este duelo. Míralo en el proyector.')];
    }
    const group = d.duel.sides[mySide].length > 1;
    const turn = d.turns[mySide];
    const loot = d.stake ? lootText(d.stake) : '';
    const stake = d.duel.kind === 'desafio'
      ? h('p', { class: 'dl-line-stake' }, starMeter(d.stake ?? {}), mySide === 0 ? `Si ganan, se llevan ${loot}.` : `Si pierden, les quitan ${loot}.`)
      : h('p', { class: 'dl-line-stake' }, starMeter({ fragments: 1 }), `Si ganan, su grupo se lleva el primer puesto de ${d.duel.minigameName}.`);
    return [
      h('p', { class: 'dl-verdict go', dataset: fx('stamp') }, group ? '¡Tu grupo va al duelo!' : '¡Tu equipo va al duelo!'),
      faceRow(ctx, { small: true }),
      stake,
      isMe(ctx, turn)
        ? h('p', { class: 'dl-tag' }, `Primera mano: eliges tú (celular ${cel(d.mySlot)})`)
        : turn && h('p', { class: 'dl-tag other' }, `Primera mano: elige ${mateName(ctx, turn)}.`, !group && h('br'), !group && 'Si empatan, te toca a ti.'),
    ];
  }
  return [
    h('div', { class: 'dl-kind-wrap', dataset: fx('rise', 0) }, kindChip(ctx)),
    h('div', { class: 'dl-face' }, between(d.duel.sides.map((_, side) => h('div', {
      class: 'dl-side',
      dataset: fx(side === 0 ? 'in-l' : side === d.duel.sides.length - 1 ? 'in-r' : 'rise'),
    }, sideBalls(ctx, side, { size: d.duel.sides[side].length > 1 ? 'lg' : 'xl' }),
    h('span', { class: 'dl-name' }, ctx.sideName(side)),
    h('span', { class: 'dl-role' }, roles[side]),
    pips(ctx, side, d.turns[side]))), () => vs(false, fx('stamp')))),
    h('div', { dataset: fx('rise', 1150) }, stakeChip(ctx)),
    h('p', { class: 'dl-note', dataset: fx('rise', 1450) }, 'Elige un celular por lado; si empatan, cambia al otro.'),
  ];
}

// Mano: cartas boca abajo que se mueven al compás; «¡Listo!» cuando un lado elige.
function pick(ctx) {
  const { d } = ctx;
  const mySide = mySideOf(ctx);
  if (ctx.phone && mySide >= 0 && d.alive.includes(mySide)) return pickPhone(ctx, mySide);
  if (ctx.phone) {
    const out = mySide >= 0;
    return [
      faceRow(ctx, { small: true, off: d.duel.sides.map((_, s) => s).filter((s) => !d.alive.includes(s)) }),
      h('p', { class: 'dl-note' }, out ? 'Tu equipo quedó fuera de este duelo.' : `Mano ${d.hand}: están eligiendo…`),
    ];
  }
  return [
    h('p', { class: 'dl-hand' }, `Mano ${d.hand}`, h('small', {}, '¡Elijan!')),
    h('div', { class: 'dl-face' }, between(d.duel.sides.map((_, side) => {
      const alive = d.alive.includes(side);
      return h('div', { class: `dl-side${alive ? '' : ' out'}` },
        slot(null, { bob: alive && !d.picked.includes(side), ready: d.picked.includes(side) }),
        h('span', { class: 'dl-who' }, sideBalls(ctx, side, { size: 'sm', off: !alive }), h('span', { class: 'dl-who-name' }, ctx.sideName(side))),
        alive ? pips(ctx, side, d.turns[side]) : h('span', { class: 'dl-turn' }, 'Fuera'));
    }), () => vs(true))),
    history(ctx, d.hands) ?? h('p', { class: 'dl-history' }, 'Piedra, papel o tijera…'),
  ];
}

function pickPhone(ctx, mySide) {
  const { d } = ctx;
  const group = d.duel.sides[mySide].length > 1;
  const turn = d.turns[mySide];
  const next = group ? null : 'tu compañero';
  if (d.myTurn && !ctx.myPick) {
    return [
      h('p', { class: 'dl-verdict go' }, '¡Te toca!'),
      h('p', { class: 'dl-note' }, `Elige por tu ${group ? 'grupo' : 'equipo'} · mano ${d.hand}`),
      h('div', { class: 'dl-options' }, Object.entries(DUEL_OPTIONS).map(([option, { label }]) => h('button', {
        class: 'button dl-option',
        type: 'button',
        onClick: () => ctx.pick(option),
      }, art(option), label))),
      faceRow(ctx, { small: true }),
      next && h('p', { class: 'dl-note' }, `Si empatan, elige ${next}.`),
    ];
  }
  if (ctx.myPick) {
    const own = d.myTurn || isMe(ctx, turn);
    return [
      h('p', { class: 'dl-verdict' }, own ? 'Elegiste' : `${turn ? mateName(ctx, turn).replace(/^tu/, 'Tu') : 'Tu lado'} eligió`),
      h('div', { class: 'dl-big-art' }, art(ctx.myPick)),
      h('p', { class: 'dl-tag other' }, DUEL_OPTIONS[ctx.myPick].label),
      h('p', { class: 'dl-note' }, 'Esperando al rival…'),
      faceRow(ctx, { small: true }),
    ];
  }
  return [
    h('p', { class: 'dl-verdict' }, turn ? `Le toca a ${mateName(ctx, turn)}` : 'Están eligiendo'),
    h('div', { class: 'dl-big-art bob' }, art('carta')),
    h('p', { class: 'dl-note' }, `Mano ${d.hand}. En esta mano no eliges tú: puedes ayudarle a decidir.`),
    !group && h('p', { class: 'dl-tag' }, 'Si empatan, te toca a ti'),
    faceRow(ctx, { small: true }),
  ];
}

// Revelado: las cartas se dan vuelta juntas; la que gana queda sobre el círculo amarillo.
function reveal(ctx) {
  const { d } = ctx;
  const last = d.hands.at(-1);
  const played = Object.keys(last.picks).map(Number);
  const tie = last.alive.length === played.length;
  const options = [...new Set(Object.values(last.picks))];
  const winning = options.length === 2 ? (BEATS[options[0]] === options[1] ? options[0] : options[1]) : null;
  const why = winning ? WHY[winning] : null;
  const mySide = mySideOf(ctx);
  const cards = d.duel.sides.map((_, side) => {
    const choice = last.picks[side];
    if (!choice) return null; // ya estaba fuera
    const won = !tie && last.alive.includes(side);
    return { side, el: slot(choice, { flip: true, win: won, lose: !tie && !won, auto: last.auto.includes(side) }) };
  }).filter(Boolean);

  if (ctx.phone) {
    let verdict;
    let extra = null;
    if (tie) {
      verdict = h('p', { class: 'dl-verdict', dataset: fx('stamp') }, '¡Empate!');
      const turn = mySide >= 0 ? d.turns[mySide] : null;
      if (turn) {
        extra = isMe(ctx, turn)
          ? h('p', { class: 'dl-tag', dataset: fx('rise', 700) }, '¡Ahora te toca a ti!')
          : h('p', { class: 'dl-tag other', dataset: fx('rise', 700) }, `Ahora elige ${mateName(ctx, turn)}`);
      }
    } else if (mySide >= 0 && played.includes(mySide)) {
      const stays = last.alive.includes(mySide);
      const final = d.winner !== null;
      verdict = h('p', { class: `dl-verdict ${stays ? 'good' : 'dim'}`, dataset: fx('stamp') },
        stays ? (final ? '¡Ganaron la mano!' : 'Siguen en el duelo') : (final ? 'Perdieron la mano' : 'Quedaron fuera'));
    } else {
      verdict = h('p', { class: 'dl-verdict', dataset: fx('stamp') }, d.winner !== null ? `¡Gana ${ctx.sideName(d.winner)}!` : `Siguen ${last.alive.map(ctx.sideName).join(' y ')}`);
    }
    return [
      verdict,
      h('div', { class: 'dl-pair' }, between(cards.map(({ side, el }) => h('div', { class: 'dl-card' }, el,
        h('span', { class: 'dl-card-name' }, side === mySide ? `Tu ${d.duel.sides[side].length > 1 ? 'grupo' : 'equipo'}` : ctx.sideName(side)))), () => vs(true))),
      why && !tie && h('p', { class: 'dl-note' }, why),
      extra,
    ];
  }

  return [
    h('p', { class: 'dl-hand' }, `Mano ${d.hand}`),
    h('div', { class: 'dl-face' }, between(cards.map(({ side, el }) => h('div', { class: 'dl-side' }, el,
      h('span', { class: 'dl-who' }, sideBalls(ctx, side, { size: 'sm' }), h('span', { class: 'dl-who-name' }, ctx.sideName(side))),
      tie && pips(ctx, side, d.turns[side], { swapFrom: last.turns?.[side] ?? null }))),
    () => (tie ? h('span', { class: 'dl-stamp', dataset: fx('stamp', 350) }, '¡Empate!') : vs(true)))),
    h('p', { class: 'dl-why', dataset: fx('rise', 600) },
      tie ? 'Otra mano: ahora elige el otro celular'
        : d.winner !== null ? why : `${why}: siguen ${last.alive.map(ctx.sideName).join(' y ')}`),
    history(ctx, d.hands.slice(0, -1)),
  ];
}

// Resultado: como el del minijuego. Etiqueta, el ganador al centro y lo que se llevó.
function result(ctx) {
  const { d } = ctx;
  const { outcome } = d;
  const desafio = d.duel.kind === 'desafio';
  const [[attacker], [target] = []] = d.duel.sides;
  const stolen = desafio && outcome?.stolen;
  const label = desafio ? (stolen ? 'Ganó el Desafío' : 'Resistió el Desafío') : 'Ganó el desempate';
  const drawn = d.drawn && h('p', { class: 'dl-note' }, 'Se decidió por sorteo.');
  const mySide = mySideOf(ctx);

  if (ctx.phone) {
    if (mySide < 0) {
      return [
        h('p', { class: 'dl-verdict' }, `Ganó ${ctx.sideName(d.winner)}`),
        faceRow(ctx, { small: true, crowned: d.winner, off: d.duel.sides.map((_, s) => s).filter((s) => s !== d.winner) }),
        h('p', { class: 'dl-note' }, outcomeLine(ctx)),
        drawn,
      ];
    }
    const won = mySide === d.winner;
    const group = d.duel.sides[mySide].length > 1;
    if (!desafio) {
      return won
        ? [h('p', { class: 'dl-verdict good', dataset: fx('stamp') }, '¡Ganaron el desempate!'), sideBalls(ctx, mySide, { size: 'lg' }),
          h('p', { class: 'dl-line-stake' }, starMeter({ fragments: 1 }), `Su ${group ? 'grupo' : 'equipo'} se lleva el primer puesto de ${d.duel.minigameName}.`),
          h('p', { class: 'dl-note' }, 'Ahora: el resultado del minijuego.'), drawn]
        : [h('p', { class: 'dl-verdict dim', dataset: fx('stamp') }, 'Perdieron el desempate'), h('p', { class: 'dl-note' }, `Ganó ${ctx.sideName(d.winner)}.`), drawn];
    }
    if (mySide === 0) {
      return stolen
        ? [h('p', { class: 'dl-verdict good', dataset: fx('stamp') }, '¡Ganaron el duelo!'),
          h('div', { class: 'dl-loot big', dataset: fx('fly') }, starMeter({ fragments: outcome.fragments, stars: outcome.stars })),
          h('p', { class: 'dl-line' }, `+${lootText(outcome)}`),
          h('p', { class: 'dl-points', dataset: fx('rise', 900) }, `+${points(outcome.points)}`),
          outcome.completed > 0 && h('p', { class: 'dl-tag' }, `¡Completaron ${plural(outcome.completed, 'estrella', 'estrellas')}!`), drawn]
        : [h('p', { class: 'dl-verdict dim', dataset: fx('stamp') }, 'Perdieron el duelo'),
          h('p', { class: 'dl-note' }, `${ctx.team(target).name} resistió: no se llevan nada, pero tampoco pierden.`), drawn];
    }
    return stolen
      ? [h('p', { class: 'dl-verdict dim', dataset: fx('stamp') }, 'Perdieron el duelo'),
        h('div', { class: 'dl-loot big' }, starMeter({ fragments: 0 })),
        h('p', { class: 'dl-line' }, `${ctx.team(attacker).name} se llevó sus ${lootText(outcome)}`),
        h('p', { class: 'dl-points dim' }, `−${points(d.stake?.points ?? 0)}`), drawn]
      : [h('p', { class: 'dl-verdict good', dataset: fx('stamp') }, '¡Resistieron!'),
        h('div', { class: 'dl-loot big' }, starMeter(d.stake ?? {})),
        h('p', { class: 'dl-line' }, `Conservan ${lootText(d.stake ?? {}) || 'lo que tienen'}`), drawn];
  }

  const winners = d.duel.sides[d.winner];
  const champ = h('div', { class: 'dl-champ', dataset: fx(d.winner === 0 ? 'in-l' : 'in-r') },
    sideBalls(ctx, d.winner, { size: winners.length > 1 ? 'lg' : 'xl', crown: winners.length === 1 }));
  let loot;
  if (!desafio) {
    loot = [
      h('p', { class: 'dl-loot', dataset: fx('rise', 800) }, starMeter({ fragments: 1 }), h('span', { class: 'good' }, `Primer puesto y fragmento de ${d.duel.minigameName}`)),
      h('p', { class: 'dl-note', dataset: fx('rise', 1200) }, 'Sigue: el resultado del minijuego.'),
    ];
  } else if (stolen) {
    loot = [
      h('p', { class: 'dl-loot', dataset: fx('fly') }, starMeter({ fragments: outcome.fragments, stars: outcome.stars }), h('span', { class: 'good' }, `+${lootText(outcome)}`)),
      h('p', { class: 'dl-points', dataset: fx('rise', 1400) }, `+${points(outcome.points)} pts`),
      outcome.completed > 0 && h('p', { class: 'dl-tag', dataset: fx('rise', 1700) }, `¡Completó ${plural(outcome.completed, 'estrella', 'estrellas')}!`),
      h('p', { class: 'dl-note', dataset: fx('rise', 1800) }, `${ctx.team(target).name} se queda sin estrellas.`),
    ];
  } else {
    loot = [
      h('p', { class: 'dl-loot', dataset: fx('rise', 800) }, starMeter(d.stake ?? {}), `Conserva ${lootText(d.stake ?? {}) || 'lo que tiene'}`),
      h('p', { class: 'dl-note', dataset: fx('rise', 1200) }, `${ctx.team(attacker).name} no se lleva nada.`),
    ];
  }
  return [
    h('p', { class: 'dl-label' }, label),
    champ,
    h('p', { class: 'dl-name' }, ctx.sideName(d.winner)),
    loot,
    drawn,
  ];
}

function outcomeLine(ctx) {
  const { d } = ctx;
  const { outcome } = d;
  if (d.duel.kind !== 'desafio') return `Se llevan el primer puesto de ${d.duel.minigameName}.`;
  const [[attacker], [target]] = d.duel.sides;
  if (!outcome?.stolen) return `${ctx.team(target).name} conserva sus estrellas.`;
  return `${ctx.team(attacker).name} le robó ${lootText(outcome)} a ${ctx.team(target).name}.`;
}

// ------------------------------------------------------------------ movimiento

const EASE_BACK = 'cubic-bezier(.34,1.56,.64,1)';
const FX = {
  'in-l': [[{ transform: 'translateX(-60vw)' }, { transform: 'translateX(2%)', offset: 0.7 }, { transform: 'none' }], 800, 'cubic-bezier(.3,1.2,.5,1)'],
  'in-r': [[{ transform: 'translateX(60vw)' }, { transform: 'translateX(-2%)', offset: 0.7 }, { transform: 'none' }], 800, 'cubic-bezier(.3,1.2,.5,1)'],
  stamp: [[{ opacity: 0, transform: 'scale(2.6) rotate(-10deg)' }, { opacity: 1, transform: 'scale(.92)', offset: 0.6 }, { opacity: 1, transform: 'none' }], 480, 'ease-out', 650],
  rise: [[{ opacity: 0, transform: 'translateY(0.8rem)' }, { opacity: 1, transform: 'none' }], 420, 'ease-out'],
  flip: [[{ transform: 'rotateY(90deg) scale(.6)' }, { transform: 'none' }], 420, EASE_BACK, 150],
  fly: [[{ opacity: 0.2, transform: 'translateX(30vw) scale(.6)' }, { opacity: 1, transform: 'none' }], 900, 'cubic-bezier(.3,.9,.4,1)', 500],
  'pip-on': [[{ background: '#ffffff', boxShadow: 'none', offset: 0 }], 300, 'ease-out', 1100],
  'pip-off': [[{ background: '#ffc93c', offset: 0 }], 300, 'ease-out', 1100],
};

// Las animaciones de entrada del paso, adelantadas lo que ya pasó desde que empezó.
function playFx(root, elapsed) {
  for (const el of root.querySelectorAll('[data-fx]')) {
    const spec = FX[el.dataset.fx];
    if (!spec) continue;
    const [keyframes, duration, easing, baseDelay = 0] = spec;
    const delay = el.dataset.fxDelay !== undefined ? Number(el.dataset.fxDelay) : baseDelay;
    const animation = el.animate(keyframes, { duration, delay, easing, fill: 'backwards' });
    animation.currentTime = elapsed;
  }
  // La carta perdedora se apaga después de darse vuelta.
  for (const el of root.querySelectorAll('.dl-slot.lost')) {
    el.animate([{ filter: 'none', opacity: 1, rotate: '0deg', offset: 0 }], { duration: 450, delay: 600, easing: 'ease-out', fill: 'backwards' }).currentTime = elapsed;
  }
}

// ------------------------------------------------------------------ host

// Host: el mismo duelo en texto, con quién elige en cada lado.
export function duelHostBody(view) {
  const { phase, teams } = view;
  const d = phase.data;
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? id;
  const sideName = (side) => d.duel.sides[side].map(nameOf).join(' + ');
  const kind = d.duel.kind === 'desafio' ? 'Desafío' : `Desempate de ${d.duel.minigameName}`;
  const turnText = (side) => {
    const turn = d.turns?.[side];
    return turn ? `${nameOf(turn.teamId)} cel. ${cel(turn.slot)}` : '—';
  };
  const lines = [];
  if (d.step === 'lineup') {
    lines.push(`Cartelera: ${d.lineup.map((duel, i) => `${i + 1}. ${duel.sides.map((ids) => ids.map(nameOf).join(' + ')).join(' vs ')}`).join(' · ')}`);
  } else {
    lines.push(`${d.count > 1 ? `Duelo ${d.index + 1} de ${d.count} · ` : ''}${kind}: ${d.duel.sides.map((_, s) => sideName(s)).join(' vs ')}`);
    if (d.stake && d.duel.kind === 'desafio') lines.push(`En juego: ${lootText(d.stake) || 'nada'} (${points(d.stake.points)} pts)`);
    if (d.step === 'void') lines.push('El desafiado no tiene nada que robar: el duelo no se juega.');
    if (d.step === 'intro') lines.push(`Presentación · primera mano: ${d.alive.map((s) => turnText(s)).join(' y ')}`);
    if (d.step === 'pick') lines.push(`Mano ${d.hand} · eligen ${d.alive.map((s) => `${turnText(s)}${d.picked.includes(s) ? ' ✓' : ''}`).join(' y ')}`);
    for (const [i, hand] of d.hands.entries()) {
      lines.push(`Mano ${i + 1}: ${Object.entries(hand.picks).map(([s, o]) => `${sideName(Number(s))} ${DUEL_OPTIONS[o].label.toLowerCase()}${hand.auto.includes(Number(s)) ? ' (al azar)' : ''}`).join(', ')}`);
    }
    if (d.step === 'reveal' && d.winner === null) lines.push(`Empate · siguiente mano: ${d.alive.map((s) => turnText(s)).join(' y ')}`);
    if (d.winner !== null) lines.push(`Gana ${sideName(d.winner)}${d.drawn ? ' (sorteo)' : ''}`);
  }
  return h('section', { class: 'stack duel-host' }, lines.map((line) => h('p', {}, line)));
}
