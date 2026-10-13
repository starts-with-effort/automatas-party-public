// Simulador de autómatas de pila (PDA), sin DOM: lo usan el servidor (cuántos pasos tiene el
// simulador en vivo), las pruebas, el manifiesto (notas de cada paso) y las vistas del proyector.
//
// Un PDA es { id, name, states, input, stack, start, bottom, final, transitions } con
// transitions = [{ from, read, top, to, push }]:
//   read = '' es ε; push es la lista de símbolos que reemplaza al tope, con push[0] como nuevo tope
//   (push = [] saca el tope). Es la δ de Hopcroft: (to, push) ∈ δ(from, read, top).
// Una descripción instantánea (ID) es { state, input, stack }: input es lo que falta leer y stack
// va del tope hacia el fondo.
//
// Modos de aceptación: 'final' (L(P): se consumió la entrada y el estado es final) y 'empty'
// (N(P): se consumió la entrada y la pila quedó vacía).

export function t(from, read, top, to, push) {
  return { from, read, top, to, push };
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
      next: {
        state: tr.to,
        input: tr.read === '' ? id.input : id.input.slice(1),
        stack: [...tr.push, ...id.stack.slice(1)],
      },
    });
  });
  return result;
}

export function isAccepting(pda, id, mode) {
  if (id.input !== '') return false;
  return mode === 'empty' ? id.stack.length === 0 : pda.final.includes(id.state);
}

const key = (id) => `${id.state}|${id.input}|${id.stack.join(',')}`;

// Tope de altura de pila para que la búsqueda termine aunque haya ε que apilan sin fin.
function stackLimit(pda, input) {
  const maxPush = Math.max(1, ...pda.transitions.map((tr) => tr.push.length));
  return (input.length + 2) * maxPush + 4;
}

// Camino que acepta (el más corto) o null. Cada elemento: { id, transition } (transition es la que
// llevó a esa ID; null en la inicial).
export function acceptingPath(pda, input, mode) {
  const start = initialId(pda, input);
  const limit = stackLimit(pda, input);
  const seen = new Set([key(start)]);
  const queue = [[{ id: start, transition: null }]];
  while (queue.length) {
    const path = queue.shift();
    const last = path.at(-1).id;
    if (isAccepting(pda, last, mode)) return path;
    for (const move of moves(pda, last)) {
      const k = key(move.next);
      if (seen.has(k) || move.next.stack.length > limit) continue;
      seen.add(k);
      queue.push([...path, { id: move.next, transition: move.transition }]);
    }
  }
  return null;
}

export function accepts(pda, input, mode) {
  return acceptingPath(pda, input, mode) !== null;
}

// La ejecución que se muestra: la que acepta si existe; si no, la que consume más entrada (en cada
// paso prefiere leer un símbolo antes que una ε). Devuelve { steps, accepted, reason }:
//   reason = { kind: 'accepted', mode } | { kind: 'stuck', remaining } (no puede seguir y sobra
//   entrada) | { kind: 'not-final', state } | { kind: 'not-empty', stack }.
export function run(pda, input, mode) {
  const found = acceptingPath(pda, input, mode);
  if (found) return { steps: found, accepted: true, reason: { kind: 'accepted', mode } };
  const steps = [{ id: initialId(pda, input), transition: null }];
  const seen = new Set([key(steps[0].id)]);
  for (;;) {
    const options = moves(pda, steps.at(-1).id).filter((m) => !seen.has(key(m.next)));
    if (!options.length) break;
    const move = options.find((m) => pda.transitions[m.transition].read !== '') ?? options[0];
    seen.add(key(move.next));
    steps.push({ id: move.next, transition: move.transition });
  }
  const last = steps.at(-1).id;
  let reason;
  if (last.input !== '') reason = { kind: 'stuck', remaining: last.input };
  else if (mode === 'empty') reason = { kind: 'not-empty', stack: last.stack };
  else reason = { kind: 'not-final', state: last.state };
  return { steps, accepted: false, reason };
}

// Árbol de computación (todas las elecciones del no determinismo), por niveles. Cada nodo:
// { n, parent, depth, transition, id, children, status } con status 'accept', 'dead' (no puede
// seguir y no acepta), 'cut' (se cortó por los límites) o 'inner'.
export function computationTree(pda, input, mode, { maxDepth = 3 * input.length + 6, maxNodes = 120 } = {}) {
  const nodes = [{ n: 0, parent: null, depth: 0, transition: null, id: initialId(pda, input), children: [], status: 'inner' }];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const options = moves(pda, node.id);
    const accepting = isAccepting(pda, node.id, mode);
    if (!options.length) {
      node.status = accepting ? 'accept' : 'dead';
      continue;
    }
    if (accepting) node.status = 'accept';
    if (node.depth >= maxDepth || nodes.length + options.length > maxNodes) {
      if (!accepting) node.status = 'cut';
      continue;
    }
    for (const move of options) {
      const child = { n: nodes.length, parent: node.n, depth: node.depth + 1, transition: move.transition, id: move.next, children: [], status: 'inner' };
      node.children.push(child.n);
      nodes.push(child);
    }
  }
  const depth = Math.max(...nodes.map((node) => node.depth));
  const accepted = nodes.some((node) => node.status === 'accept');
  return { nodes, depth, accepted };
}

// Cadenas de largo ≤ maxLen sobre el alfabeto de entrada que el PDA acepta.
export function language(pda, mode, maxLen) {
  const accepted = [];
  let layer = [''];
  for (let len = 0; len <= maxLen; len += 1) {
    for (const w of layer) if (accepts(pda, w, mode)) accepted.push(w);
    layer = layer.flatMap((w) => pda.input.map((c) => w + c));
  }
  return accepted;
}

// ------------------------------------------------------------ construcciones (3.2)

// De pila vacía a estado final (Hopcroft, teorema 6.9): nuevo inicial p₀ que pone Z₀ sobre el
// marcador X₀; desde cada estado, si se ve X₀ (P_N habría vaciado su pila), ε hacia el final p_f.
export function emptyToFinal(pN, { start = 'p0', final = 'pf', marker = 'X0' } = {}) {
  return {
    id: `${pN.id}-F`,
    name: `${pN.name} (estado final)`,
    states: [start, ...pN.states, final],
    input: pN.input,
    stack: [...pN.stack, marker],
    start,
    bottom: marker,
    final: [final],
    transitions: [
      { ...t(start, '', marker, pN.start, [pN.bottom, marker]), added: 'start' },
      ...pN.transitions,
      ...pN.states.map((q) => ({ ...t(q, '', marker, final, []), added: 'final' })),
    ],
  };
}

// De estado final a pila vacía (Hopcroft, teorema 6.11): nuevo inicial p₀ con el marcador X₀ abajo;
// desde cada estado final, ε hacia p, que vacía la pila. Con marker: false se omite el marcador
// (la versión ingenua: acepta de más si P_F vacía su pila sin aceptar).
export function finalToEmpty(pF, { start = 'p0', drain = 'p', marker = 'X0' } = {}) {
  const symbols = marker ? [...pF.stack, marker] : pF.stack;
  const drains = [
    ...pF.final.flatMap((q) => symbols.map((y) => ({ ...t(q, '', y, drain, []), added: 'drain' }))),
    ...symbols.map((y) => ({ ...t(drain, '', y, drain, []), added: 'drain' })),
  ];
  if (!marker) {
    return {
      id: `${pF.id}-N0`,
      name: `${pF.name} (pila vacía, sin X₀)`,
      states: [...pF.states, drain],
      input: pF.input,
      stack: pF.stack,
      start: pF.start,
      bottom: pF.bottom,
      final: [],
      transitions: [...pF.transitions, ...drains],
    };
  }
  return {
    id: `${pF.id}-N`,
    name: `${pF.name} (pila vacía)`,
    states: [start, ...pF.states, drain],
    input: pF.input,
    stack: symbols,
    start,
    bottom: marker,
    final: [],
    transitions: [{ ...t(start, '', marker, pF.start, [pF.bottom, marker]), added: 'start' }, ...pF.transitions, ...drains],
  };
}

// ------------------------------------------------------------ texto

const SUBSCRIPT = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };

// Nombre de un estado o símbolo partido en base y subíndice: q0 → q₀, Z0 → Z₀, pf → p_f.
export function splitSymbol(name) {
  const match = /^([A-Za-z])([0-9]+|[a-z])$/.exec(name);
  return match ? { base: match[1], sub: match[2] } : { base: name, sub: '' };
}

// Texto plano: q₀, Z₀, p_f (las notas convierten «_f» en subíndice).
export function symbolText(name) {
  const { base, sub } = splitSymbol(name);
  if (!sub) return base;
  return /^\d+$/.test(sub) ? base + [...sub].map((d) => SUBSCRIPT[d]).join('') : `${base}_${sub}`;
}

export const stackText = (stack) => (stack.length ? stack.map(symbolText).join('') : 'ε');
export const inputText = (input) => input || 'ε';
export const idText = (id) => `(${symbolText(id.state)}, ${inputText(id.input)}, ${stackText(id.stack)})`;
export const transitionText = (tr) => `${tr.read || 'ε'}, ${symbolText(tr.top)} / ${stackText(tr.push)}`;
