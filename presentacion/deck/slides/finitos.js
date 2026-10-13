// 2 · Lo que ya conocemos: un AFD y un AFN para el mismo lenguaje (las cadenas que terminan en ab),
// leyendo la misma cadena. El AFD sigue un solo camino; el AFN, varios a la vez.
import { createDiagram } from '../views/diagram.js';
import { COLORS } from '../views/format.js';
import { createTape } from '../views/tape.js';
import { $, box, hidden, htmlEl, show } from './common.js';

const INPUT = 'aab';
const STATES = ['q0', 'q1', 'q2'];

// Autómatas finitos con la forma que espera el diagrama (transiciones sin pila).
const automaton = (arrows) => ({
  states: STATES,
  final: ['q2'],
  start: 'q0',
  transitions: arrows.map(([from, read, to]) => ({ from, read, to })),
});
const AFD = automaton([
  ['q0', 'b', 'q0'], ['q0', 'a', 'q1'], ['q1', 'a', 'q1'], ['q1', 'b', 'q2'], ['q2', 'a', 'q1'], ['q2', 'b', 'q0'],
]);
const AFN = automaton([
  ['q0', 'a', 'q0'], ['q0', 'b', 'q0'], ['q0', 'a', 'q1'], ['q1', 'b', 'q2'],
]);

// Camino del AFD con «aab» (índices de AFD.transitions) y, para el AFN, las transiciones que se usan
// con cada símbolo y los estados que quedan activos.
const AFD_PATH = [1, 2, 3];
const AFN_MOVES = [
  { used: [0, 2], active: ['q0', 'q1'] },
  { used: [0, 2], active: ['q0', 'q1'] },
  { used: [1, 3], active: ['q0', 'q2'] },
];
const PACE = 0.8;

// Un rótulo por arco, con todos sus símbolos («a, b»).
function layout(fa, shapes) {
  const edges = {};
  fa.transitions.forEach((tr, i) => {
    const key = `${tr.from}>${tr.to}`;
    edges[key] ??= { ...shapes[key], lines: [{ text: '', items: [] }] };
    const [line] = edges[key].lines;
    line.text += `${line.text ? ', ' : ''}${tr.read}`;
    line.items.push(i);
  });
  return { width: 800, height: 420, states: { q0: [150, 190], q1: [400, 190], q2: [650, 190] }, edges };
}

function panel(body, x, { title, tag, fa, shapes, caption }) {
  const card = box(body, 'card fa-panel', { x, y: 0, w: 844 }, `
    <div class="fa-head"><span class="display-font">${title}</span><span class="chip">${tag}</span><span class="chip ok fa-verdict">${INPUT} ✓ aceptada</span></div>
    <div class="fa-diagram"></div>
    <div class="fa-foot"><div class="fa-tape"></div><p class="fa-caption">${caption}</p></div>`);
  const dia = createDiagram($(card, '.fa-diagram'), fa, layout(fa, shapes), { width: 780, height: 400 });
  dia.activate(fa.start);
  const tape = createTape($(card, '.fa-tape'), INPUT, { cell: 64, label: '' });
  const result = [$(card, '.fa-verdict'), $(card, '.fa-caption')];
  hidden(result, { y: 12 });
  return { dia, tape, result, fa };
}

export default function mount({ el, body, steps }) {
  htmlEl('span', 'head-chip', 'Autómatas finitos: cadenas que terminan en «ab»', $(el, '.slide-head'));
  const afd = panel(body, 0, {
    title: 'Determinista',
    tag: 'AFD',
    fa: AFD,
    shapes: { 'q0>q0': { loop: 'up' }, 'q1>q1': { loop: 'up' }, 'q2>q0': { bend: 150 } },
    caption: '<b>Una sola opción</b> en cada paso:<br>sigue un único camino.',
  });
  const afn = panel(body, 884, {
    title: 'No determinista',
    tag: 'AFN',
    fa: AFN,
    shapes: { 'q0>q0': { loop: 'up' } },
    caption: '<b>Varias opciones</b> a la vez:<br>basta un camino que acepte.',
  });
  const memory = box(body, 'card sun fa-memory', { x: 0, y: 664, w: 1728 }, `
    Los dos recuerdan una sola cosa: <b>en qué estado están</b>.`);
  hidden(memory);

  // AFD: una transición por símbolo; la ficha recorre el arco.
  steps.step((tl, at) => {
    AFD_PATH.forEach((index, k) => {
      const t = at + k * PACE;
      const last = k === AFD_PATH.length - 1;
      afd.dia.fire(tl, t, index, { travel: 0.45 });
      afd.tape.step(tl, t + 0.1, AFD.transitions[index]);
      afd.dia.setActive(tl, t + 0.5, AFD.transitions[index].to, last ? COLORS.ok : COLORS.sun);
    });
    const end = at + AFD_PATH.length * PACE;
    afd.dia.clearFire(tl, end);
    show(tl, end, afd.result, { stagger: 0.1 });
  });

  // AFN: con cada símbolo se encienden todos los arcos posibles y quedan varios estados activos.
  steps.step((tl, at) => {
    let active = [AFN.start];
    AFN_MOVES.forEach((move, k) => {
      const t = at + k * PACE;
      const last = k === AFN_MOVES.length - 1;
      afn.tape.step(tl, t + 0.1, { read: INPUT[k] });
      for (const index of move.used) {
        const tr = AFN.transitions[index];
        const edge = afn.dia.edges.get(`${tr.from}>${tr.to}`);
        tl.to(edge.path, { stroke: COLORS.pink, duration: 0.15 }, t);
        tl.to(edge.arrow, { fill: COLORS.pink, duration: 0.15 }, t);
        tl.to(edge.path, { stroke: COLORS.ink, duration: 0.15 }, t + 0.55);
        tl.to(edge.arrow, { fill: COLORS.ink, duration: 0.15 }, t + 0.55);
        afn.dia.mark(tl, t, index);
        afn.dia.mark(tl, t + 0.55, index, false);
      }
      const circle = (name) => afn.dia.states.get(name).circle;
      for (const name of active.filter((q) => !move.active.includes(q))) tl.to(circle(name), { fill: COLORS.surface, duration: 0.25 }, t + 0.4);
      for (const name of move.active.filter((q) => !active.includes(q))) {
        tl.to(circle(name), { fill: last && AFN.final.includes(name) ? COLORS.ok : COLORS.sun, duration: 0.25 }, t + 0.4);
      }
      active = move.active;
    });
    show(tl, at + AFN_MOVES.length * PACE, afn.result, { stagger: 0.1 });
  });

  steps.step((tl, at) => show(tl, at, memory));
}
