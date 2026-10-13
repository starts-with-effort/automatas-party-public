// Traza a ciegas en la interfaz: el celular (diagrama o cadena), el proyector (un cronómetro por
// equipo con sus intentos) y el host (texto). El servidor decide cada toque; aquí solo se dibuja lo
// que trae la vista de cada papel.
import { h, replace } from './dom.js';
import { errorMessage } from './errors.js';
import { send, toast } from './ui.js';
import { teamChip } from './widgets.js';

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
export const stateName = (state) => state.replace(/\d/g, (d) => SUB[d]);
const symbol = (s) => (s === 'Z0' ? 'Z₀' : s);
export const formatId = ({ state, input = '', stack }) =>
  `(${stateName(state)}, ${input || 'ε'}, ${stack.length ? stack.map(symbol).join('') : 'ε'})`;
const seconds = (ms) => (ms / 1000).toFixed(1).replace('.', ',');
const attemptText = (n) => (n === 1 ? '1.er' : '2.º');
const MODE = { final: 'estado final', empty: 'pila vacía' };

// ------------------------------------------------------------------ diagrama (SVG)

// Posición de cada estado en un lienzo de 270 × 512 (vertical, para el celular), y dónde va el
// rótulo de los arcos que no son verticales. Es el lienzo del autómata de la Traza; el taller dibuja
// los suyos con otro `layout` ({ pos, labelAt, view }).
const TRAZA_LAYOUT = {
  pos: { q0: [62, 55], q1: [62, 155], q2: [62, 255], q3: [62, 355], q4: [62, 475], q5: [215, 450] },
  labelAt: { 'q3>q4': [72, 425], 'q3>q5': [148, 392] },
  view: { w: 270, h: 512 },
};
const R = 28;
const HEAD = 11;

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const unit = (a) => mul(a, 1 / (Math.hypot(a[0], a[1]) || 1));
const dir = (angle) => [Math.cos(angle), Math.sin(angle)];
const pt = (v) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`;

function arrowHead(tip, tangent) {
  const base = sub(tip, mul(tangent, HEAD));
  const side = mul([tangent[1], -tangent[0]], 6.2);
  return [tip, add(base, side), sub(base, side)].map((v) => v.map((n) => n.toFixed(1)).join(',')).join(' ');
}

// Trazo, punta y lugar del rótulo de un arco: bucle a la derecha del estado o línea recta.
function edgeGeometry({ from, to }, { pos, labelAt = {} }) {
  const A = pos[from];
  const B = pos[to];
  if (from === to) {
    const p0 = add(A, mul(dir(-0.45), R));
    const p3 = add(A, mul(dir(0.45), R));
    const p1 = add(A, mul(dir(-0.62), R * 2.45));
    const p2 = add(A, mul(dir(0.62), R * 2.45));
    const tangent = unit(sub(p3, p2));
    return { d: `M ${pt(p0)} C ${pt(p1)} ${pt(p2)} ${pt(sub(p3, mul(tangent, HEAD)))}`, head: arrowHead(p3, tangent), label: [A[0] + 60, A[1]] };
  }
  const u = unit(sub(B, A));
  const start = add(A, mul(u, R));
  const end = sub(B, mul(u, R));
  const middle = mul(add(start, end), 0.5);
  return { d: `M ${pt(start)} L ${pt(sub(end, mul(u, HEAD)))}`, head: arrowHead(end, u), label: labelAt[`${from}>${to}`] ?? [A[0] + 10, middle[1]] };
}

const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Dónde descansa la ficha del equipo: abajo a la derecha del estado actual.
const tokenAt = (state, { pos }) => [pos[state][0] + R * 0.74, pos[state][1] + R * 0.74];

// SVG del autómata, de cartón: estados con sombra dura y doble círculo en los finales. current:
// estado actual (amarillo, con la ficha del equipo si hay token); last: { from, to, label } del
// último paso (arco y rótulo en rosado); interactive: los estados son botones (data-state). Cada
// arco lleva data-edge="q0>q1", para animar la ficha por él. Un arco con `hole` es una transición
// por armar (taller): punteado hasta que esté completa (`set`).
export function trazaDiagram(pda, { current = null, last = null, interactive = false, token = null, layout = TRAZA_LAYOUT } = {}) {
  const POS = layout.pos;
  const VIEW = layout.view;
  let edges = '';
  let labels = '';
  for (const edge of pda.edges) {
    if (!POS[edge.from] || !POS[edge.to]) continue;
    const used = last && last.from === edge.from && last.to === edge.to && (!edge.hole || last.custom);
    const kind = `${used ? ' used' : ''}${edge.hole ? ` hole${edge.set ? ' set' : ''}` : ''}`;
    const g = edgeGeometry(edge, layout);
    edges += `<path d="${g.d}" class="tz-edge${kind}" data-edge="${edge.from}>${edge.to}"/><polygon points="${g.head}" class="tz-arrow${kind}"/>`;
    edge.labels.forEach((text, k) => {
      const y = g.label[1] + (k - (edge.labels.length - 1) / 2) * 16 + 5;
      labels += `<text x="${g.label[0]}" y="${y.toFixed(1)}" class="tz-label${used && last.label === text ? ' used' : ''}${edge.hole ? ' hole' : ''}">${escapeText(text)}</text>`;
    });
  }
  const [sx, sy] = POS[pda.start];
  edges += `<path d="M 4 ${sy} L ${sx - R - HEAD} ${sy}" class="tz-edge"/><polygon points="${arrowHead([sx - R, sy], [1, 0])}" class="tz-arrow"/>`;
  let states = '';
  for (const state of pda.states) {
    if (!POS[state]) continue;
    const [x, y] = POS[state];
    const cls = `tz-state${state === current ? ' now' : ''}${interactive ? ' tap' : ''}`;
    const attrs = interactive ? ` tabindex="0" role="button" aria-label="Pasar a ${stateName(state)}"` : '';
    states += `<g class="${cls}" data-state="${state}"${attrs}>`
      + `<circle cx="${x + 3}" cy="${y + 3.5}" r="${R}" class="tz-shadow"/>`
      + `<circle cx="${x}" cy="${y}" r="${R}" class="tz-body"/>`
      + (pda.final.includes(state) ? `<circle cx="${x}" cy="${y}" r="${R - 5.5}" class="tz-ring"/>` : '')
      + `<text x="${x}" y="${y + 7}" class="tz-name">${stateName(state)}</text></g>`;
  }
  const chip = token && current && POS[current]
    ? `<circle cx="${tokenAt(current, layout)[0].toFixed(1)}" cy="${tokenAt(current, layout)[1].toFixed(1)}" r="7.5" class="tz-token" style="fill:${token}"/>`
    : '';
  const box = document.createElement('div');
  box.className = 'tz-diagram';
  box.innerHTML = `<svg class="tz-svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Diagrama del autómata">${edges}${labels}${states}${chip}</svg>`;
  return box;
}

const stillMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// La ficha recorre el arco que se acaba de usar (también los bucles) y se acomoda en su estado.
export function travel(box, last, ms = 420, layout = TRAZA_LAYOUT) {
  const path = box.querySelector(`[data-edge="${last.from}>${last.to}"]`);
  const chip = box.querySelector('.tz-token');
  if (!path || !chip || stillMotion() || typeof path.getTotalLength !== 'function') return;
  const length = path.getTotalLength();
  const [rx, ry] = tokenAt(last.to, layout);
  const end = path.getPointAtLength(length);
  const t0 = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = 1 - (1 - t) ** 3;
    // Recorre el arco y, en el último tramo, baja a su lugar junto al estado.
    const along = Math.min(1, k / 0.8);
    const p = path.getPointAtLength(length * along);
    const settle = Math.max(0, (k - 0.8) / 0.2);
    chip.setAttribute('cx', (p.x + (rx - end.x) * settle).toFixed(1));
    chip.setAttribute('cy', (p.y + (ry - end.y) * settle).toFixed(1));
    if (t < 1 && chip.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ celular

// La pila, con el tope arriba. Comparada con la anterior (prev): lo que se apiló entra desde arriba
// (.enter) y lo que se sacó sale volando (.leave), como en la exposición.
export function stackColumn(stack, prev = stack) {
  let shared = 0;
  while (shared < stack.length && shared < prev.length && stack.at(-1 - shared) === prev.at(-1 - shared)) shared += 1;
  const pushed = stack.length - shared;
  const popped = prev.slice(0, prev.length - shared);
  const cells = stack.map((s, i) => h('span', { class: `tz-cell${i === 0 ? ' top' : ''}${i < pushed ? ' enter' : ''}` }, symbol(s)));
  const gone = stillMotion() ? [] : popped.map((s) => h('span', { class: 'tz-cell leave', 'aria-hidden': 'true' }, symbol(s)));
  return h('div', { class: 'tz-stack', 'aria-label': `Pila: ${stack.map(symbol).join(' ') || 'vacía'}` },
    h('span', { class: 'tz-stack-title' }, 'Pila'),
    gone,
    stack.length === 0 ? h('span', { class: 'tz-stack-empty' }, 'vacía') : cells);
}

function tape(word) {
  return h('div', { class: 'tz-tape', 'aria-label': `Cadena ${word}` }, [...word].map((c) => h('span', {}, c)));
}

// Por qué no era ese estado, y cuál era (si se muestra).
function errorLines(error) {
  const { tapped, deadBranch, at, correct } = error;
  const why = deadBranch
    ? `Había una transición a ${stateName(tapped)}, pero por esa rama la cadena ya no se acepta.`
    : `Desde ${stateName(at.state)} con ${symbol(at.top)} en el tope no hay transición a ${stateName(tapped)}${at.next ? ` leyendo «${at.next}» ni con ε` : ' con ε'}.`;
  const fix = correct && `El paso era ${stateName(correct.to)} con «${correct.label}»${correct.read ? '' : ' (no lee nada)'}.`;
  return [h('p', {}, `Tocaron ${stateName(tapped)}. ${why}`), fix && h('p', { class: 'tz-fix' }, fix)];
}

// Pantalla encima del tablero: el error con el cambio de papel, sin intentos o la cadena aceptada.
function overlayCard(game, clock) {
  if (game.acceptedMs !== null) {
    return h('div', { class: 'tz-card good' },
      h('h2', {}, '¡Cadena aceptada!'),
      h('p', { class: 'tz-big' }, `${seconds(game.acceptedMs)} s`),
      h('p', {}, `${game.place}.º en aceptar · ${attemptText(game.attempt)} intento`),
      game.current && h('p', { class: 'hint' }, `${formatId({ ...game.current, input: '' })}: se leyó toda la cadena y ${game.mode === 'empty' ? 'la pila quedó vacía' : `${stateName(game.current.state)} es final`}.`));
  }
  if (game.out) {
    return h('div', { class: 'tz-card grey' },
      h('h2', {}, 'Sin intentos'),
      game.error && errorLines(game.error),
      h('p', {}, h('strong', {}, 'Esta vez no suman puntos.'), ' Esperen a los demás equipos.'));
  }
  if (game.error && game.swapUntil) {
    const left = Math.max(0, game.swapUntil - clock.now());
    const bar = h('i', { style: { animationDuration: `${left}ms` } });
    return h('div', { class: 'tz-card bad' },
      h('h2', {}, '✗ Ese no era'),
      errorLines(game.error),
      h('p', { class: 'tz-swap' }, `Cambian de papel: ahora tú tienes ${game.role === 'string' ? 'la cadena' : 'el diagrama'}. Empiezan de nuevo con la misma cadena.`),
      h('div', { class: 'tz-bar' }, bar));
  }
  return null;
}

const ROLE_TEXT = {
  diagram: ['Tienes el diagrama', 'Tu compañero te dicta la cadena. Toca el estado al que pasa el autómata con cada símbolo, y también en los pasos ε.'],
  string: ['Tienes la cadena', 'Díctale los símbolos a tu compañero, uno por uno. Aquí no se ve en cuál van: llévenlo ustedes.'],
  both: ['Tu compañero no está conectado', 'Ves el diagrama y la cadena: toca tú cada paso.'],
};

const WRONG_MS = 550; // el estado equivocado parpadea en rojo antes de la pantalla del error

// Celular: según el papel, el diagrama con la pila (y tocar estados) o la cadena con la forma de
// aceptar. Se monta una vez por fase; cada vista nueva lo vuelve a dibujar, y lo que cambió desde
// lo último dibujado (`shown`) se anima: la ficha viaja por el arco, la pila apila o saca, un error
// sacude el tablero y marca en rojo el estado tocado, y al terminar el cambio de papel el tablero
// entra desde el costado (el diagrama «llega» del otro celular).
export function createTrazaPad({ socket, clock, team }) {
  let view = null;
  let inflight = false;
  let lastTap = 0;
  let shown = null; // { role, attempt, steps, stack, errorMs, swapping, done }
  let waiting = null; // temporizador de la pantalla del error (tras el parpadeo)
  const head = h('div', { class: 'tz-head' });
  const stage = h('div', { class: 'tz-stage' });
  const foot = h('p', { class: 'tz-last' });
  const overlay = h('div', { class: 'tz-overlay', hidden: true });
  const el = h('section', { class: 'tz-play' }, head, h('div', { class: 'tz-stage-wrap' }, stage, overlay), foot);

  const game = () => view.phase.data.game;
  const playing = () => {
    const { phase, room } = view;
    const now = clock.now();
    const g = game();
    return !room.paused && g.acceptedMs === null && !g.out && !(g.swapUntil && now < g.swapUntil)
      && now >= phase.playStartsAt && now <= phase.endsAt;
  };

  async function tap(state, node) {
    if (!view || !game().pda || !playing() || inflight) return;
    const now = performance.now();
    if (now - lastTap < 300) return;
    lastTap = now;
    inflight = true;
    node?.classList.add('pending');
    const res = await send(socket, 'mg:input', { type: 'tap', state });
    inflight = false;
    node?.classList.remove('pending');
    if (!res.ok && !['too_fast', 'swapping'].includes(res.error)) toast(errorMessage(res.error));
  }

  const pick = (event) => event.target.closest?.('.tz-state.tap');
  stage.addEventListener('pointerdown', (event) => {
    const node = pick(event);
    if (!node) return;
    event.preventDefault();
    tap(node.dataset.state, node);
  });
  stage.addEventListener('keydown', (event) => {
    const node = pick(event);
    if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    tap(node.dataset.state, node);
  });

  const wrap = el.querySelector('.tz-stage-wrap');
  const animate = (node, frames, options) => {
    if (!stillMotion()) node?.animate(frames, { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)', ...options });
  };

  // Un error nuevo: el tablero se sacude en los dos celulares. En el que tocó, el estado equivocado
  // parpadea en rojo y la pantalla del error llega después.
  function flagError(g, hadDiagram) {
    animate(wrap, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 420, easing: 'ease-out' });
    navigator.vibrate?.(120);
    if (!hadDiagram || stillMotion()) return false;
    stage.querySelector(`.tz-state[data-state="${g.error.tapped}"]`)?.classList.add('wrong');
    waiting = setTimeout(() => {
      waiting = null;
      if (view) draw();
    }, WRONG_MS);
    return true;
  }

  function draw() {
    const g = game();
    const swapping = Boolean(g.error && g.swapUntil);
    const done = g.acceptedMs !== null || g.out;
    const newError = Boolean(g.error && shown && g.error.ms !== shown.errorMs);
    if (waiting) return; // el parpadeo del error todavía no termina
    if (newError) {
      shown.errorMs = g.error.ms;
      if (flagError(g, shown.hadDiagram)) return;
    }

    const [title, text] = ROLE_TEXT[g.role] ?? ['Traza a ciegas', 'Mira el proyector.'];
    replace(head, h('p', { class: 'tz-eyebrow' }, `${title} · Intento ${g.attempt} de ${g.attempts}`), h('p', { class: 'tz-role' }, text));
    const sameAttempt = shown && shown.attempt === g.attempt && shown.role === g.role;
    const parts = [];
    if (g.word) {
      parts.push(h('div', { class: 'tz-string' }, tape(g.word),
        h('span', { class: 'tz-ticket' }, 'Se acepta por ', h('b', {}, MODE[g.mode] ?? g.mode)),
        g.role === 'string' && h('p', { class: 'hint' }, 'Los pasos ε no leen nada: si tu compañero toca uno, no avances.')));
    }
    let diagram = null;
    if (g.pda && g.current) {
      diagram = trazaDiagram(g.pda, { current: g.current.state, last: g.last, interactive: true, token: team?.color ?? null });
      const prevStack = sameAttempt && shown.stack ? shown.stack : g.current.stack;
      parts.push(h('div', { class: 'tz-board' }, diagram, stackColumn(g.current.stack, prevStack)));
    }
    stage.classList.toggle('string-only', !g.pda);
    replace(stage, parts);
    replace(foot, g.pda ? ['Último paso: ', h('b', {}, g.last?.label ?? '—')] : '');
    const card = overlayCard(g, clock);
    const cardIsNew = Boolean(card) && overlay.hidden;
    overlay.hidden = !card;
    replace(overlay, card);

    if (diagram && g.last && sameAttempt && g.steps === shown.steps + 1) travel(diagram, g.last);
    if (cardIsNew) animate(card, [{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
    // Terminó la pantalla del cambio: el tablero nuevo entra desde el costado.
    if (shown?.swapping && !swapping && !done) {
      const from = g.role === 'string' ? '-60px' : '60px';
      animate(stage, [{ opacity: 0, transform: `translateX(${from})` }, { opacity: 1, transform: 'none' }], { duration: 480 });
    }
    shown = {
      role: g.role,
      attempt: g.attempt,
      steps: g.steps,
      stack: g.current?.stack ?? null,
      errorMs: g.error?.ms ?? shown?.errorMs ?? null,
      swapping,
      hadDiagram: Boolean(g.pda) && !swapping && !done,
    };
  }

  return {
    el,
    fill: true, // play.js le da todo el alto de la pantalla
    update(next) {
      view = next;
      if (view.phase.data.game?.role) draw();
    },
    destroy() {
      clearTimeout(waiting);
    },
  };
}

// ------------------------------------------------------------------ repaso en el resultado

const REPLAY_STEP_MS = 1100;
const REPLAY_HOLD_MS = 2600;
let replayCache = { key: null, el: null };

// Proyector, en el resultado: la traza que acepta la cadena de la partida, paso a paso y en bucle,
// con la cinta (ahora sí con el cabezal), el diagrama, la pila y la descripción instantánea. Es un
// repaso para todo el salón. Se reutiliza mientras no cambie la cadena, para que una vista nueva no
// lo reinicie. Con «reducir movimiento» queda el último paso.
export function trazaReplay({ word, mode, pda, steps }) {
  const key = `${word}|${mode}|${steps.length}`;
  if (replayCache.key === key && replayCache.el) return replayCache.el;
  const cells = [...word].map((c) => h('span', {}, c));
  const tapeEl = h('div', { class: 'tz-tape replay' }, cells);
  const diagramBox = h('div', { class: 'tz-replay-diagram' });
  const stackBox = h('div', { class: 'tz-replay-stack' });
  const idLine = h('p', { class: 'tz-replay-id' });
  const stepLine = h('p', { class: 'tz-replay-step' });
  const el = h('section', { class: 'tz-replay' },
    h('p', { class: 'tz-replay-title' }, 'Así se aceptaba ', h('b', {}, word), ` (por ${MODE[mode] ?? mode})`),
    tapeEl, diagramBox, h('div', { class: 'tz-replay-side' }, stackBox, idLine, stepLine));
  replayCache = { key, el };

  const idAt = (i) => (i === 0 ? { state: pda.start, input: word, stack: ['Z0'] } : steps[i - 1].id);
  let shownStep = -1;
  const show = (i) => {
    const id = idAt(i);
    const last = i === 0 ? null : steps[i - 1];
    const read = word.length - id.input.length;
    cells.forEach((cell, k) => {
      cell.classList.toggle('read', k < read);
      cell.classList.toggle('head', k === read);
    });
    tapeEl.classList.toggle('done', read === word.length);
    const diagram = trazaDiagram(pda, { current: id.state, last, token: '#ff4f8b' });
    const prev = i > 0 && shownStep === i - 1 ? idAt(i - 1).stack : id.stack;
    replace(diagramBox, diagram);
    replace(stackBox, stackColumn(id.stack, prev));
    if (last) travel(diagram, last, 600);
    idLine.textContent = formatId(id);
    stepLine.textContent = i === 0
      ? `Empieza en ${stateName(pda.start)} con Z₀ en la pila`
      : `Paso ${i} de ${steps.length} · ${last.label}${last.read ? ` (lee «${last.read}»)` : ' (no lee nada)'}${i === steps.length ? ' · ¡aceptada!' : ''}`;
    shownStep = i;
  };
  if (stillMotion()) {
    show(steps.length);
    return el;
  }
  const t0 = performance.now();
  const cycle = (steps.length + 1) * REPLAY_STEP_MS + REPLAY_HOLD_MS;
  let away = null;
  const frame = (now) => {
    if (replayCache.el !== el) return; // ya hay otro repaso
    if (!el.isConnected) {
      away ??= now;
      if (now - away > 3000) return; // la pantalla cambió
    } else away = null;
    const i = Math.min(steps.length, Math.floor((Math.max(0, now - t0) % cycle) / REPLAY_STEP_MS)); // el primer cuadro puede llegar antes que t0
    if (i !== shownStep) show(i);
    requestAnimationFrame(frame);
  };
  show(0);
  requestAnimationFrame(frame);
  return el;
}

// ------------------------------------------------------------------ proyector

// Un cronómetro de cartón por equipo (el del Laberinto, rediseño fase 6), con dos fichas de intento
// al lado: la gastada se pone roja. Al aceptar, el centro se pone verde con el puesto; sin intentos,
// se congela en gris. Nunca muestra el autómata ni la cadena.
const stopwatchText = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0').replace('.', ',')}` : s.toFixed(1).replace('.', ',');
};

export function createTrazaBoard({ clock }) {
  const count = h('span', { class: 'race-count' });
  const hint = h('p', { class: 'hint race-hint' }, 'Cada equipo traza la misma cadena: el diagrama toca y la cadena dicta.');
  const grid = h('div', { class: 'race-dials' });
  const el = h('section', { class: 'stack race' }, h('div', { class: 'race-head' }, hint, count), grid);
  let view = null;
  let dials = new Map();
  const build = (teams, rows, attempts) => {
    dials = new Map(rows.map((row) => {
      const team = teams.find((t) => t.id === row.teamId) ?? { name: row.teamId, color: '#888' };
      const time = h('b', {}, '0,0');
      const unit = h('small', {}, 's');
      const place = h('span', { class: 'dial-place' });
      const pips = Array.from({ length: attempts }, () => h('i', {}));
      const dial = h('div', { class: 'dial' }, time, unit, place);
      const cell = h('div', { class: 'dial-cell', style: { '--team': team.color } },
        h('span', { class: 'dial-pips', 'aria-hidden': 'true' }, pips), dial, h('span', { class: 'dial-name' }, h('i', {}), team.name));
      return [row.teamId, { cell, dial, time, unit, place, pips }];
    }));
    grid.style.gridTemplateColumns = `repeat(${rows.length > 6 ? 4 : 3}, minmax(0, 1fr))`;
    grid.replaceChildren(...[...dials.values()].map((d) => d.cell));
  };
  const paint = () => {
    if (!view) return;
    const { phase, room } = view;
    const { game } = phase.data;
    const start = phase.playStartsAt ?? phase.startsAt;
    const total = Math.max(1, (phase.endsAt ?? start) - start);
    const now = room.paused ? room.paused.at : clock.now();
    for (const row of game.progress) {
      const d = dials.get(row.teamId);
      if (!d) continue;
      const done = row.acceptedMs !== null;
      const out = row.outMs !== null;
      const ms = done ? row.acceptedMs : out ? row.outMs : Math.min(total, Math.max(0, now - start));
      d.dial.classList.toggle('arrived', done);
      d.dial.classList.toggle('out', out);
      d.dial.style.setProperty('--el', (ms / total).toFixed(4));
      d.time.textContent = out ? '✗' : stopwatchText(ms);
      d.unit.textContent = out ? 'sin intentos' : 's';
      d.place.textContent = done ? `${row.place}.º` : '';
      d.pips.forEach((pip, i) => {
        pip.classList.toggle('lost', i < row.lost);
        pip.textContent = i < row.lost ? '✗' : '';
      });
    }
  };
  let attached = false;
  const frame = () => {
    if (el.isConnected) attached = true;
    else if (attached) return;
    paint();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    el,
    update(next) {
      view = next;
      const { game } = next.phase.data;
      if (dials.size !== game.progress.length) build(next.teams, game.progress, game.attempts);
      const accepted = game.progress.filter((row) => row.acceptedMs !== null).length;
      const out = game.progress.filter((row) => row.outMs !== null).length;
      count.textContent = `Aceptaron ${accepted} de ${game.progress.length}${out ? ` · Sin intentos ${out}` : ''}`;
      paint();
    },
    destroy() {},
  };
}

// ------------------------------------------------------------------ host

// Host: la cadena de la partida y, por equipo, el intento, los pasos y la descripción instantánea.
export function trazaProgress({ game }, teams) {
  const place = (row) => row.place ?? (row.outMs !== null ? 1e8 : 1e9);
  const rows = [...game.progress].sort((a, b) => place(a) - place(b));
  const status = (row) => {
    if (row.acceptedMs !== null) return `${row.place}.º · ${seconds(row.acceptedMs)} s · ${attemptText(row.attempt)} intento`;
    if (row.outMs !== null) return 'Sin intentos';
    const team = game.teams?.[row.teamId];
    return `Intento ${row.attempt} · ${team?.steps ?? 0} pasos · ${team ? formatId(team.id) : ''}`;
  };
  return h('section', { class: 'stack' },
    game.word && h('p', { class: 'hint' }, 'Cadena: ', h('strong', { class: 'mono' }, game.word), ` · se acepta por ${MODE[game.mode] ?? game.mode}`),
    h('ol', { class: 'plain-list stack' }, rows.map((row) => h('li', { class: `result-row${row.acceptedMs !== null ? ' winner' : ''}` },
      teamChip(teams.find((t) => t.id === row.teamId)),
      h('span', { class: 'mono' }, status(row))))));
}
