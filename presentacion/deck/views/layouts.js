// Posición de los estados y forma de los arcos de cada PDA de la exposición (ver diagram.js). El
// tamaño es el natural: el SVG se escala a la caja donde se dibuja.

// Rótulo único para varias transiciones: «ε, Y / ε» con Y cualquier símbolo de la pila.
const anySymbol = (pda, from, to) => [{
  text: 'ε, Y / ε',
  items: pda.transitions.flatMap((tr, i) => (tr.from === from && tr.to === to ? [i] : [])),
}];

export const LAYOUTS = {
  anbn: () => ({
    width: 960,
    height: 440,
    states: { q0: [190, 310], q1: [500, 310], q2: [810, 310] },
    edges: { 'q0>q0': { loop: 'up' }, 'q1>q1': { loop: 'up' } },
  }),

  anbnEmpty: () => ({
    width: 960,
    height: 440,
    states: { q0: [190, 310], q1: [500, 310], q2: [810, 310] },
    edges: { 'q0>q0': { loop: 'up' }, 'q1>q1': { loop: 'up' }, 'q2>q2': { loop: 'up' } },
  }),

  wwr: () => ({
    width: 1120,
    height: 560,
    states: { q0: [200, 420], q1: [580, 420], q2: [960, 420] },
    edges: {
      'q0>q0': { loop: 'up' },
      'q0>q1': { label: 'below' },
      'q1>q1': { loop: 'up' },
    },
  }),

  parens: () => ({
    width: 960,
    height: 440,
    states: { q: [480, 340] },
    edges: { 'q>q': { loop: 'up' } },
  }),

  parensFinal: () => ({
    width: 1460,
    height: 470,
    states: { p0: [150, 360], q: [710, 360], pf: [1270, 360] },
    edges: { 'q>q': { loop: 'up' } },
    boxes: [{ states: ['q'], label: 'P_N', pad: 170, padTop: 330, padBottom: 80 }],
  }),

  anbnStack: (pda) => ({
    width: 1640,
    height: 470,
    states: { p0: [110, 360], q0: [480, 360], q1: [800, 360], q2: [1120, 360], p: [1500, 360] },
    edges: {
      'q0>q0': { loop: 'up' },
      'q1>q1': { loop: 'up' },
      'q2>p': { lines: anySymbol(pda, 'q2', 'p') },
      'p>p': { loop: 'up', lines: anySymbol(pda, 'p', 'p') },
    },
    boxes: [{ states: ['q0', 'q1', 'q2'], label: 'P_F', pad: 92, padTop: 290, padBottom: 80 }],
  }),
};
