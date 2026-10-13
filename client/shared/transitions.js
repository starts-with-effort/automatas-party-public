// Transiciones entre fases del celular y el proyector (el host no las usa).
// - Base («cascada»): al cambiar de fase, las piezas de la pantalla anterior caen y se
//   desvanecen, y las de la nueva aterrizan una a una, de arriba abajo, con un pequeño rebote.
// - Momentos especiales: cambio de ronda, revelado de la respuesta, ranking que se reordena y
//   podio final.
// Solo se anima cuando cambia la fase (seq): las vistas que llegan dentro de una misma fase se
// dibujan en seco, así que un render a mitad de animación muestra el estado final. Todo usa la
// Web Animations API con transform y opacity; con «reducir movimiento» queda un fundido corto.
import { h } from './dom.js';
import { FINAL_ROUND, RANKING_KINDS, roundLabel } from './phases.js';

const EASE_IO = 'cubic-bezier(.6,0,.3,1)';
const EASE_IN = 'cubic-bezier(.5,0,.75,0)';
const EASE_BACK = 'cubic-bezier(.34,1.56,.64,1)';
const MAX_STAGGER = 7; // desde la octava pieza, todas aterrizan a la vez
const INK = '#1c1640';

export const stillMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Por omisión la animación solo rellena hacia atrás: durante el retraso se ve el estado inicial
// y al terminar queda el estilo normal del elemento, sin efectos pegados.
function play(el, keyframes, duration, { delay = 0, easing = 'ease-out', fill = 'backwards' } = {}) {
  return el.animate(keyframes, { duration, delay, easing, fill });
}

const STAMP = [
  { opacity: 0, transform: 'scale(2.1) rotate(-7deg)' },
  { opacity: 1, transform: 'scale(.94) rotate(-1.5deg)', offset: 0.55 },
  { opacity: 1, transform: 'none' },
];
// qF al aceptar: crece y vuelve; parte de su tamaño normal para no verse grande mientras espera.
const ACCEPT = [{ transform: 'none' }, { transform: 'scale(1.45)', offset: 0.4 }, { transform: 'none' }];
const POP = [
  { opacity: 0, transform: 'scale(.3)' },
  { opacity: 1, transform: 'scale(1.18)', offset: 0.6 },
  { opacity: 1, transform: 'none' },
];

// ------------------------------------------------------------------ cascada

// Envuelve el render de cada cliente: run(view, draw) dibuja la vista y, si la fase cambió,
// anima la salida de la pantalla anterior y la entrada de la nueva.
export function createPhaseFx(app) {
  let shownKey; // undefined hasta el primer render: al abrir la página no se anima
  let lastRanking = null; // último ranking dibujado: de él parten las barras del siguiente

  return function run(view, draw) {
    const key = phaseKey(view);
    const changed = shownKey !== undefined && key !== shownKey;
    shownKey = key;
    const kind = view.room?.started ? view.phase?.kind : null;
    const previousRanking = lastRanking;
    if (RANKING_KINDS.has(kind)) lastRanking = rankingMemory(view.phase.data.ranking);
    if (!changed) return draw();
    if (stillMotion()) {
      draw();
      play(app, [{ opacity: 0 }, { opacity: 1 }], 150, { easing: 'linear' });
      return;
    }
    const ghost = detach(app);
    draw();
    if (ghost) fallOut(ghost);
    const pieces = piecesOf(app);
    const enter = SPECIAL[kind];
    if (enter) enter({ app, view, pieces, previousRanking });
    else land(pieces);
  };
}

function phaseKey(view) {
  if (!view.room) return 'none';
  return view.room.started && view.phase ? view.phase.seq : 'lobby';
}

const isOverlay = (el) => ['fixed', 'absolute'].includes(getComputedStyle(el).position);

// Las piezas son los hijos de la pantalla; si uno es una columna (.stack), sus hijos.
function piecesOf(root) {
  const pieces = [];
  for (const el of root.children) {
    if (el.hidden || isOverlay(el)) continue;
    if (el.classList.contains('stack') && el.children.length > 0) {
      pieces.push(...[...el.children].filter((child) => !child.hidden && !isOverlay(child)));
    } else {
      pieces.push(el);
    }
  }
  return pieces;
}

// Saca la pantalla anterior a una copia fantasma en la misma posición, detrás de la nueva.
// Las capas fijas (cuenta 3-2-1, pausa, tinta) no se copian: desaparecen al instante.
function detach(app) {
  const nodes = [...app.childNodes].filter((node) => !(node instanceof Element) || !isOverlay(node));
  if (nodes.length === 0) return null;
  const rect = app.getBoundingClientRect();
  const ghost = h('div', { class: `${app.className} phase-ghost`, 'aria-hidden': 'true' });
  Object.assign(ghost.style, {
    left: `${rect.left + window.scrollX}px`,
    top: `${rect.top + window.scrollY}px`,
    width: `${rect.width}px`,
  });
  ghost.append(...nodes);
  document.body.append(ghost);
  return ghost;
}

function fallOut(ghost) {
  const pieces = piecesOf(ghost);
  const remove = () => ghost.remove();
  if (pieces.length === 0) return remove();
  let last = null;
  pieces.forEach((el, i) => {
    last = play(el, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(22px)', opacity: 0 }], 200,
      { delay: Math.min(i, MAX_STAGGER) * 35, easing: EASE_IN, fill: 'forwards' });
  });
  last.finished.then(remove, remove);
}

export function land(pieces, { delay = 170, step = 65 } = {}) {
  pieces.forEach((el, i) => play(el, [
    { transform: 'translateY(-26px)', opacity: 0 },
    { transform: 'translateY(3px)', opacity: 1, offset: 0.7 },
    { transform: 'translateY(0)', opacity: 1 },
  ], 380, { delay: delay + Math.min(i, MAX_STAGGER) * step }));
}

// Cuenta el primer número del texto (con puntos de miles, como points()) desde `from`.
function countText(el, from, delay = 0, duration = 700) {
  const text = el?.textContent;
  const match = text?.match(/\d[\d.]*/);
  if (!match) return;
  const to = Number(match[0].replace(/\./g, ''));
  const write = (n) => { el.textContent = text.replace(match[0], n.toLocaleString('es-CO')); };
  write(from);
  const start = performance.now() + delay;
  const tick = (now) => {
    if (!el.isConnected) return;
    const t = Math.min(1, Math.max(0, (now - start) / duration));
    write(Math.round(from + (to - from) * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ momentos especiales

const SPECIAL = {
  duel: ({ pieces }) => land(pieces.slice(0, 1)), // el resto lo anima duel.js
  minigameResult: winEntrance,
  questionResult: revealAnswer,
  ranking: rankingEntrance,
  finalRanking: finalEntrance,
};

// Resultado del minijuego (fase 7): en el proyector los ganadores caen con rebote uno tras otro y sus
// puntos cuentan desde 0; luego salta el desempeño. En el celular, los puntos cuentan desde 0.
function winEntrance({ app, pieces }) {
  land(pieces);
  app.querySelectorAll('.champ').forEach((champ, k) => {
    play(champ, [{ opacity: 0, transform: 'translateY(-2.5rem)' }, { opacity: 1, transform: 'none' }], 520, { delay: 350 + k * 160, easing: EASE_BACK });
    countText(champ.querySelector('.champ-points'), 0, 500 + k * 160, 700);
  });
  const perf = app.querySelector('.win-perf');
  if (perf) play(perf, [{ opacity: 0, transform: 'scale(0.8)' }, { opacity: 1, transform: 'none' }], 420, { delay: 1100, easing: EASE_BACK });
  countText(app.querySelector('.win-points'), 0, 400, 800);
}

// Revelado: las opciones incorrectas se apagan una por una, la correcta salta con su anillo y su
// sello ✓, y luego llegan los conteos (proyector) o la estrella del veredicto (celular).
function revealAnswer({ app, pieces }) {
  const grid = app.querySelector('.options-grid');
  const tiles = grid ? [...grid.children] : [];
  const correct = tiles.find((tile) => tile.classList.contains('correct'));
  const others = tiles.filter((tile) => tile !== correct);
  const dimAt = 750;
  const popAt = dimAt + others.length * 150 + 150;
  const burstAt = popAt + 450;
  const burst = app.querySelector('.burst-wrap');
  // En el celular, lo que va entre la estrella y las opciones (racha, objetos) delata el
  // resultado: llega con la estrella.
  const gridIndex = pieces.indexOf(grid);
  const withBurst = burst ? pieces.filter((p, i) => i > 0 && i < gridIndex && p !== burst) : [];
  land(pieces.filter((p) => p !== burst && !withBurst.includes(p)));
  land(withBurst, { delay: burstAt + 250 });

  others.forEach((tile, k) => play(tile, [{ opacity: 1, offset: 0 }], 280, { delay: dimAt + k * 150 }));
  if (correct) {
    play(correct, [
      { transform: 'scale(1)', boxShadow: `0 5px 0 ${INK}`, offset: 0 },
      { transform: 'scale(1.08)', offset: 0.5 },
      { transform: 'scale(1)' },
    ], 460, { delay: popAt });
    const stamp = correct.querySelector('.option-stamp');
    if (stamp) play(stamp, [{ opacity: 0, transform: 'scale(2.4) rotate(-30deg)' }, { opacity: 1, transform: 'none' }], 320, { delay: popAt + 120, easing: EASE_BACK });
  }
  app.querySelectorAll('.option-count').forEach((count, k) => play(count, POP, 320, { delay: popAt + 300 + k * 60 }));

  if (burst) {
    play(burst, [
      { opacity: 0, transform: 'scale(0) rotate(-40deg)' },
      { opacity: 1, transform: 'scale(1.12) rotate(6deg)', offset: 0.65 },
      { opacity: 1, transform: 'none' },
    ], 560, { delay: burstAt });
    countText(burst.querySelector('.burst-points'), 0, burstAt + 150, 700);
  }
}

// Puesto y puntaje de cada equipo en un ranking, para animar el siguiente desde ahí.
function rankingMemory(ranking) {
  return new Map(ranking.map((row, index) => [row.teamId, { index, score: row.score }]));
}

// Sin un ranking anterior en memoria (primera ronda o página recargada), el puesto anterior sale
// del cambio de puesto que manda el servidor y las barras crecen desde cero.
function memoryFromDeltas(ranking) {
  return new Map(ranking.map((row, index) => [row.teamId, {
    index: row.delta === null || row.delta === undefined ? index : row.position + row.delta - 1,
    score: 0,
  }]));
}

// Ranking: las barras crecen desde el puntaje anterior mientras los números cuentan; luego los
// equipos se deslizan a su puesto nuevo y aparecen las flechas de subida o bajada.
function rankingEntrance({ app, view, pieces, previousRanking }) {
  land(pieces);
  const { ranking } = view.phase.data;
  const before = previousRanking ?? memoryFromDeltas(ranking);
  const list = app.querySelector('.rank-bars');
  if (list) reorderBars(list, ranking, before, 450);
  const mine = ranking.find((row) => row.teamId === view.me?.teamId);
  const place = app.querySelector('.place-card');
  if (mine && place) {
    countText(place.querySelector('strong'), before.get(mine.teamId)?.score ?? 0, 500, 900);
    const badge = place.querySelector('.delta-up, .delta-down');
    if (badge) play(badge, POP, 320, { delay: 1500 });
  }
}

function reorderBars(list, ranking, before, delay) {
  const GROW = 850;
  const HOLD = GROW + 150;
  const MOVE = 650;
  const best = Math.max(1, ...ranking.map((row) => row.score));
  const byId = new Map(ranking.map((row) => [row.teamId, row]));
  const rows = [...list.children];
  const tops = rows.map((row) => row.offsetTop);
  rows.forEach((row, j) => {
    const now = byId.get(row.dataset.teamId);
    const prev = before.get(row.dataset.teamId);
    if (!now) return;
    const prevScore = Math.max(0, prev?.score ?? 0);
    const bar = row.querySelector('.rank-bar');
    // La barra mide el total (88 % como máximo, como en screen.js): sus dos tramos crecen juntos.
    if (bar) play(bar, [{ width: `${(88 * prevScore) / best}%`, offset: 0 }], GROW, { delay, easing: EASE_IO });
    countText(row.querySelector('.rank-score'), prevScore, delay, GROW);
    const i = Math.min(Math.max(prev?.index ?? j, 0), rows.length - 1);
    const dy = tops[i] - tops[j];
    // La medalla del puesto se queda quieta; el resto de la fila se desliza a su puesto nuevo y
    // los que suben pasan por encima de los que bajan.
    if (dy !== 0) {
      for (const cell of row.children) {
        if (cell.classList.contains('medal')) continue;
        if (dy > 0) Object.assign(cell.style, { position: 'relative', zIndex: '1' });
        play(cell, [
          { transform: `translateY(${dy}px)` },
          { transform: `translateY(${dy}px)`, offset: HOLD / (HOLD + MOVE), easing: EASE_IO },
          { transform: 'none' },
        ], HOLD + MOVE, { delay, easing: 'linear' });
      }
    }
    const badge = row.querySelector('.rank-delta > *');
    if (badge) play(badge, POP, 320, { delay: delay + HOLD + MOVE + j * 80 });
  });
}

// Ranking final. Proyector: el podio sube escalón por escalón (3.º, 2.º y por último el 1.º),
// qF se pone verde y cae confeti; después llegan los datos destacados y las barras.
// Celular: «¡Aceptado!» cae como un sello y también hay confeti.
function finalEntrance({ app, pieces }) {
  const qf = document.querySelector('.rounds-state.is-accepted');
  const podium = app.querySelector('.podium');
  if (!podium) {
    land(pieces);
    const title = app.querySelector('.phase-head h1');
    if (title) play(title, STAMP, 560, { delay: 250, easing: 'cubic-bezier(.3,0,.4,1)' });
    const place = app.querySelector('.place');
    if (place) play(place, POP, 420, { delay: 900 });
    if (qf) play(qf, ACCEPT, 520, { delay: 600 });
    confetti({ delay: 700 });
    return;
  }
  const RISE = [[3, 300, 800, 4], [2, 1000, 850, 5], [1, 1900, 1100, 8]]; // puesto, retraso, duración, rebote %
  for (const [place, delay, duration, over] of RISE) {
    const step = podium.querySelector(`[data-place="${place}"]`);
    if (step) {
      play(step, [
        { transform: 'translateY(105%)' },
        { transform: `translateY(-${over}%)`, offset: 0.7 },
        { transform: 'none' },
      ], duration, { delay, easing: 'cubic-bezier(.3,.6,.4,1)' });
    }
  }
  const accepted = 3000;
  if (qf) play(qf, ACCEPT, 520, { delay: accepted });
  confetti({ delay: accepted - 200 });
  const rest = pieces.filter((p) => p !== podium);
  land(rest.slice(0, 1));
  land(rest.slice(1), { delay: accepted + 300, step: 150 });
}

// Ceros, unos y símbolos del curso cayendo sobre toda la pantalla.
export function confetti({ delay = 0, count = 46 } = {}) {
  if (stillMotion()) return;
  const layer = h('div', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(layer);
  const glyphs = ['0', '1', 'δ', 'ε', 'q', '★', 'Σ'];
  const colors = ['#ff4f8b', '#ffc93c', '#2f6fed', '#3ccf6e', '#7048e8', '#ffffff'];
  let longest = 0;
  for (let i = 0; i < count; i += 1) {
    const piece = h('span', {
      style: { left: `${Math.random() * 96}%`, color: colors[i % colors.length], fontSize: `${1.4 + Math.random() * 1.6}rem` },
    }, glyphs[i % glyphs.length]);
    layer.append(piece);
    const duration = 2000 + Math.random() * 1500;
    const start = delay + Math.random() * 800;
    longest = Math.max(longest, start + duration);
    piece.animate([
      { transform: 'translate(0, 0) rotate(0)' },
      { transform: `translate(${(Math.random() - 0.5) * 120}px, ${window.innerHeight + 80}px) rotate(${(Math.random() - 0.5) * 720}deg)` },
    ], { duration, delay: start, easing: 'cubic-bezier(.25,.1,.6,1)', fill: 'both' });
  }
  setTimeout(() => layer.remove(), longest + 100);
}

// ------------------------------------------------------------------ cambio de ronda

const stateLabel = (n) => (n === FINAL_ROUND ? 'qF' : `q${n}`);
const roundOf = (view) => (view?.room?.started && view.phase ? view.phase.round : 0);
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Se llama cuando llega la vista de una fase nueva, antes de su startsAt (onAhead de
// createViewScheduler). Si empieza una ronda, el autómata aparece en grande sobre toda la
// pantalla: la flecha se completa, la ficha salta al estado nuevo y este queda con doble círculo.
// Usa el margen de anticipación (leadMs); la pantalla se descubre poco después de startsAt, dentro
// del tiempo de lectura de la pregunta, que no descuenta tiempo para responder.
export function announceRound(shownView, view, delay, { color = '#ff4f8b' } = {}) {
  const from = roundOf(shownView);
  const to = roundOf(view);
  if (to <= from || delay < 500 || stillMotion()) return;
  showRoundChange(to, roundLabel(view.phase), delay, color);
}

async function showRoundChange(to, title, delay, color) {
  const begin = performance.now();
  const first = Math.max(1, to - 2);
  const states = new Map();
  const parts = [];
  let fill = null;
  for (let n = first; n <= to; n += 1) {
    if (n > first || n === 1) {
      const entering = n === to;
      if (entering) fill = h('i', { class: 'rc-fill' });
      parts.push(h('i', { class: `rc-arrow${n === 1 ? ' rc-start' : ''}${entering ? ' todo' : ''}` }, entering ? fill : null));
    }
    const state = h('span', { class: `rc-state${n < to - 1 ? ' done' : n === to - 1 ? ' now' : ''}` }, stateLabel(n));
    states.set(n, state);
    parts.push(state);
  }
  const token = h('span', { class: 'rc-token', style: { '--team': color } });
  const automaton = h('div', { class: 'rc-automaton' }, parts, token);
  const heading = h('strong', { class: 'rc-title' }, title);
  const formula = to > 1 ? h('small', { class: 'rc-formula' }, `δ(${stateLabel(to - 1)}, ranking) = ${stateLabel(to)}`) : null;
  const el = h('div', { class: 'round-change', 'aria-hidden': 'true' }, automaton, heading, formula);
  document.body.append(el);

  // La ficha parte del estado anterior (o del inicio de la flecha de entrada, en la ronda 1).
  const corner = (state) => [state.offsetLeft + state.offsetWidth * 0.8, state.offsetTop + state.offsetHeight * 0.8];
  const from = states.get(to - 1);
  const arrow = fill.parentElement;
  const [x0, y0] = from ? corner(from) : [arrow.offsetLeft, arrow.offsetTop + arrow.offsetHeight / 2];
  const target = states.get(to);
  const [x1, y1] = corner(target);
  Object.assign(token.style, { left: `${x0}px`, top: `${y0}px` });
  heading.style.opacity = '0';

  await play(el, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], 220).finished;
  await play(fill, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], 300, { easing: EASE_IO, fill: 'forwards' }).finished;
  arrow.classList.remove('todo');
  from?.classList.replace('now', 'done');
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lift = target.offsetHeight * 0.8;
  await play(token, Array.from({ length: 9 }, (_, k) => {
    const t = k / 8;
    return { transform: `translate(${dx * t}px, ${dy * t - 4 * lift * t * (1 - t)}px)` };
  }), 440, { easing: 'ease-in-out', fill: 'forwards' }).finished;
  play(token, [
    { transform: `translate(${dx}px, ${dy}px) scale(1.35, .65)` },
    { transform: `translate(${dx}px, ${dy}px)` },
  ], 240, { easing: EASE_BACK, fill: 'forwards' });
  target.classList.add('now');
  play(target, [{ transform: 'scale(1.3)' }, { transform: 'none' }], 320, { easing: EASE_BACK });
  heading.style.opacity = '';
  await play(heading, STAMP, 340).finished;

  // Se queda hasta que empiece la fase y, como mínimo, un momento para leer la ronda.
  const elapsed = performance.now() - begin;
  await wait(Math.max(250, delay - elapsed));
  await play(el, [{ transform: 'translateY(0)' }, { transform: 'translateY(-104%)' }], 350, { easing: EASE_IN, fill: 'forwards' }).finished;
  el.remove();
}
