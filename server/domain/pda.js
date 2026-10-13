// Autómata de pila del minijuego «Traza a ciegas» y lo justo de un simulador para validar cada toque.
// Viene del simulador de la exposición (presentacion/deck/pda/pda.js), con la misma δ de Hopcroft:
// una transición es { from, read, top, to, push } con read = '' para ε y push = lo que reemplaza al
// tope (push[0] queda arriba; [] lo saca). Una descripción instantánea (ID) es { state, input, stack }:
// input es lo que falta leer y stack va del tope hacia el fondo.
//
// Modos de aceptación: 'final' (L(P): se leyó todo y el estado es final) y 'empty' (N(P): se leyó
// todo y la pila quedó vacía).

export const ACCEPT_MODES = ['final', 'empty'];

const t = (from, read, top, to, push, label) => ({ from, read, top, to, push, label });
const ANY = ['Z0', '0', '1']; // la «X» de los rótulos: cualquier símbolo que pueda estar en el tope

// Los dos PDA de la exposición, uno detrás del otro: aⁿbⁿ (q0, q1) y wwᴿ (q2 apila w, una ε adivina
// la mitad y q3 compara). Al final, con Z0 en el tope, una ε lleva a q4 (final, deja la pila) y otra
// a q5 (saca Z0: vacía la pila). L(P) = N(P) = { aⁿbⁿ w wᴿ | n ≥ 1, w ∈ {0,1}* }.
// El rótulo (label) es como se dibuja; las transiciones con X comparten el suyo.
export const TRAZA_PDA = {
  states: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'],
  input: ['a', 'b', '0', '1'],
  stack: ['A', '0', '1', 'Z0'],
  start: 'q0',
  bottom: 'Z0',
  final: ['q4'],
  transitions: [
    t('q0', 'a', 'Z0', 'q0', ['A', 'Z0'], 'a, Z₀ / AZ₀'),
    t('q0', 'a', 'A', 'q0', ['A', 'A'], 'a, A / AA'),
    t('q0', 'b', 'A', 'q1', [], 'b, A / ε'),
    t('q1', 'b', 'A', 'q1', [], 'b, A / ε'),
    t('q1', '', 'Z0', 'q2', ['Z0'], 'ε, Z₀ / Z₀'),
    ...ANY.map((x) => t('q2', '0', x, 'q2', ['0', x], '0, X / 0X')),
    ...ANY.map((x) => t('q2', '1', x, 'q2', ['1', x], '1, X / 1X')),
    ...ANY.map((x) => t('q2', '', x, 'q3', [x], 'ε, X / X')),
    t('q3', '0', '0', 'q3', [], '0, 0 / ε'),
    t('q3', '1', '1', 'q3', [], '1, 1 / ε'),
    t('q3', '', 'Z0', 'q4', ['Z0'], 'ε, Z₀ / Z₀'),
    t('q3', '', 'Z0', 'q5', [], 'ε, Z₀ / ε'),
  ],
};

// Las cadenas del juego: aⁿbⁿ w wᴿ con n de 1 a 3, w de 2 o 3 símbolos y largo 8 o 10 (24 cadenas).
// Piden 11 o 13 toques, 3 de ellos ε.
export function trazaWords() {
  const words = (k) => (k === 0 ? [''] : words(k - 1).flatMap((w) => [`${w}0`, `${w}1`]));
  const result = [];
  for (let n = 1; n <= 3; n += 1) {
    for (let k = 2; k <= 3; k += 1) {
      const length = 2 * n + 2 * k;
      if (length < 8 || length > 10) continue;
      for (const w of words(k)) result.push('a'.repeat(n) + 'b'.repeat(n) + w + [...w].reverse().join(''));
    }
  }
  return result;
}

export function initialId(pda, input) {
  return { state: pda.start, input, stack: [pda.bottom] };
}

// Movimientos posibles desde una ID: [{ transition (índice), next (ID) }]. Con la pila vacía no hay
// ninguno: toda transición necesita un símbolo en el tope.
export function moves(pda, id) {
  const top = id.stack[0];
  if (top === undefined) return [];
  const result = [];
  pda.transitions.forEach((tr, index) => {
    if (tr.from !== id.state || tr.top !== top) return;
    if (tr.read !== '' && tr.read !== id.input[0]) return;
    result.push({
      transition: index,
      next: { state: tr.to, input: tr.read === '' ? id.input : id.input.slice(1), stack: [...tr.push, ...id.stack.slice(1)] },
    });
  });
  return result;
}

export function isAccepting(pda, id, mode) {
  if (id.input !== '') return false;
  return mode === 'empty' ? id.stack.length === 0 : pda.final.includes(id.state);
}

// ¿Se puede aceptar todavía desde esta ID? Búsqueda en anchura con un tope de altura de pila, para
// que termine aunque hubiera ε que apilan sin fin.
export function canAccept(pda, id, mode) {
  const limit = (id.input.length + 2) * 2 + id.stack.length + 4;
  const key = (d) => `${d.state}|${d.input}|${d.stack.join(',')}`;
  const seen = new Set([key(id)]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (isAccepting(pda, current, mode)) return true;
    for (const { next } of moves(pda, current)) {
      const k = key(next);
      if (seen.has(k) || next.stack.length > limit) continue;
      seen.add(k);
      queue.push(next);
    }
  }
  return false;
}

// Lo que pasa al tocar el estado `to` desde la ID: el movimiento que lleva a ese estado y desde el
// que todavía se puede aceptar, o null (no hay transición a ese estado, o la rama ya no acepta).
export function tapMove(pda, id, to, mode) {
  return moves(pda, id).find((move) => pda.transitions[move.transition].to === to && canAccept(pda, move.next, mode)) ?? null;
}

// El paso correcto desde la ID (en este autómata, uno solo) o null si ya no se puede aceptar.
export function correctMove(pda, id, mode) {
  return moves(pda, id).find((move) => canAccept(pda, move.next, mode)) ?? null;
}

// Lo que hace el autómata con una cadena, se acepte o no: { accepted, steps: [{ transition, next }] }.
// Si alguna computación acepta, es esa; si no, la que más entrada alcanza a leer (y, entre esas, la
// que llega más lejos). Sirve para mostrar dónde se detiene un autómata al que le falta algo.
export function runTrace(pda, input, mode) {
  const limit = (input.length + 2) * 2 + 5;
  const key = (d) => `${d.state}|${d.input}|${d.stack.join(',')}`;
  const first = { id: initialId(pda, input), prev: null, transition: null };
  const seen = new Set([key(first.id)]);
  const queue = [first];
  let best = first;
  let accepting = null;
  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    if (isAccepting(pda, node.id, mode)) {
      accepting = node;
      break;
    }
    if (node.id.input.length <= best.id.input.length) best = node;
    for (const { transition, next } of moves(pda, node.id)) {
      const k = key(next);
      if (seen.has(k) || next.stack.length > limit) continue;
      seen.add(k);
      queue.push({ id: next, prev: node, transition });
    }
  }
  const steps = [];
  for (let node = accepting ?? best; node.prev; node = node.prev) steps.unshift({ transition: node.transition, next: node.id });
  return { accepted: Boolean(accepting), steps };
}

// ------------------------------------------------------------------ los PDA del taller

// Rótulo de una transición como se escribe en la exposición: «a, Z₀ / AZ₀» (ε si no lee o no deja nada).
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
export const symbolLabel = (symbol) => (symbol === 'Z0' ? 'Z₀' : symbol);
export const stackLabel = (stack) => (stack.length ? stack.map(symbolLabel).join('') : 'ε');
export const stateLabel = (state) => state.replace(/\d/g, (digit) => SUBSCRIPTS[digit]);
export const transitionLabel = ({ read, top, push }) => `${read || 'ε'}, ${symbolLabel(top)} / ${stackLabel(push)}`;
export const formatId = ({ state, input, stack }) => `(${stateLabel(state)}, ${input || 'ε'}, ${stackLabel(stack)})`;
const labeled = (from, read, top, to, push) => t(from, read, top, to, push, transitionLabel({ read, top, push }));

// Los autómatas de las diapositivas con los que se hace el taller (docs/TALLER.md):
//   anbn    {aⁿbⁿ | n ≥ 1}, determinista, por estado final (q2).
//   parens  paréntesis balanceados con un solo estado, por pila vacía. Con Z0 en el tope puede leer
//           «(» o vaciar la pila con ε: es no determinista.
export const WORKSHOP_PDAS = {
  anbn: {
    id: 'anbn',
    name: 'aⁿbⁿ',
    states: ['q0', 'q1', 'q2'],
    input: ['a', 'b'],
    stack: ['A', 'Z0'],
    start: 'q0',
    bottom: 'Z0',
    final: ['q2'],
    transitions: [
      labeled('q0', 'a', 'Z0', 'q0', ['A', 'Z0']),
      labeled('q0', 'a', 'A', 'q0', ['A', 'A']),
      labeled('q0', 'b', 'A', 'q1', []),
      labeled('q1', 'b', 'A', 'q1', []),
      labeled('q1', '', 'Z0', 'q2', ['Z0']),
    ],
  },
  parens: {
    id: 'parens',
    name: 'paréntesis',
    states: ['q'],
    input: ['(', ')'],
    stack: ['P', 'Z0'],
    start: 'q',
    bottom: 'Z0',
    final: [],
    transitions: [
      labeled('q', '(', 'Z0', 'q', ['P', 'Z0']),
      labeled('q', '(', 'P', 'q', ['P', 'P']),
      labeled('q', ')', 'P', 'q', []),
      labeled('q', '', 'Z0', 'q', []),
    ],
  },
};

// Lo que dibuja un celular: los estados y un arco por par de estados, con sus rótulos (las
// transiciones que comparten rótulo salen una vez).
export function pdaDiagram(pda) {
  const edges = [];
  for (const tr of pda.transitions) {
    let edge = edges.find((e) => e.from === tr.from && e.to === tr.to);
    if (!edge) edges.push(edge = { from: tr.from, to: tr.to, labels: [] });
    if (!edge.labels.includes(tr.label)) edge.labels.push(tr.label);
  }
  return { id: pda.id ?? null, states: pda.states, start: pda.start, final: pda.final, edges };
}

// La traza que acepta la cadena, paso a paso: [{ transition, next }].
export function acceptingTrace(pda, input, mode) {
  const steps = [];
  let id = initialId(pda, input);
  while (!isAccepting(pda, id, mode)) {
    const move = correctMove(pda, id, mode);
    if (!move) return null;
    steps.push(move);
    id = move.next;
  }
  return steps;
}
