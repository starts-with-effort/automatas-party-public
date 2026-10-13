// Textos de cada paso de una ejecución: las notas del celular y los rótulos del proyector salen de
// aquí, así siempre coinciden con lo que se anima.
import { computationTree, idText, initialId, run, stackText, symbolText } from './pda.js';

// Qué le hace una transición a la pila.
export function stackEffect(tr) {
  const top = symbolText(tr.top);
  if (tr.push.length === 0) return `saca ${top}`;
  if (tr.push.length === 1 && tr.push[0] === tr.top) return 'deja la pila igual';
  if (tr.push.at(-1) === tr.top) return `apila ${stackText(tr.push.slice(0, -1))}`;
  return `cambia ${top} por ${stackText(tr.push)}`;
}

// Rótulo corto para el proyector: «Lee a · apila A».
export function moveCaption(tr) {
  const reading = tr.read ? `Lee ${tr.read}` : 'ε (no lee)';
  return `${reading} · ${stackEffect(tr)}${tr.to === tr.from ? '' : ` · pasa a ${symbolText(tr.to)}`}`;
}

const ADDED = {
  start: ' (arranque de la construcción)',
  final: ' (apareció X₀: P_N habría vaciado su pila)',
  drain: ' (vaciado de la pila)',
};

export function moveNote(tr, id) {
  const reading = tr.read ? `**Lee «${tr.read}»** con ${symbolText(tr.top)} en el tope` : `**Sin leer (ε)**, con ${symbolText(tr.top)} en el tope`;
  const move = tr.to === tr.from ? `sigue en ${symbolText(tr.to)}` : `pasa a ${symbolText(tr.to)}`;
  return `${reading}: ${stackEffect(tr)} y ${move}${ADDED[tr.added] ?? ''}. Queda ${idText(id)}.`;
}

export function verdict(result) {
  const last = result.steps.at(-1).id;
  const { reason } = result;
  if (result.accepted) {
    return reason.mode === 'empty'
      ? { ok: true, title: 'Aceptada', detail: 'entrada leída y pila vacía' }
      : { ok: true, title: 'Aceptada', detail: `entrada leída y ${symbolText(last.state)} es final` };
  }
  if (reason.kind === 'stuck') return { ok: false, title: 'Rechazada', detail: `no hay transición y sobra «${reason.remaining}»` };
  if (reason.kind === 'not-empty') return { ok: false, title: 'Rechazada', detail: `la pila no quedó vacía (${stackText(reason.stack)})` };
  return { ok: false, title: 'Rechazada', detail: `${symbolText(reason.state)} no es final` };
}

export function verdictNote(result) {
  const last = result.steps.at(-1).id;
  const { reason } = result;
  if (result.accepted) {
    return reason.mode === 'empty'
      ? 'Se leyó toda la entrada y la pila quedó vacía: **aceptada por pila vacía**.'
      : `Se leyó toda la entrada y ${symbolText(last.state)} es final: **aceptada por estado final**.`;
  }
  if (reason.kind === 'stuck') {
    return `No hay transición para ${idText(last)} y sobra «${reason.remaining}»: **rechazada**. Hay que leer toda la entrada.`;
  }
  if (reason.kind === 'not-empty') {
    return `Se leyó toda la entrada, pero la pila no quedó vacía (${stackText(reason.stack)}) y no hay más movimientos: **rechazada**.`;
  }
  return `Se leyó toda la entrada, pero ${symbolText(reason.state)} no es final y no hay más movimientos: **rechazada**.`;
}

// Notas de una ejecución: la ID inicial, una por movimiento y el veredicto.
export function runNotes(pda, input, mode) {
  const result = run(pda, input, mode);
  const start = initialId(pda, input);
  return [
    `Empieza en ${idText(start)}: estado inicial, toda la entrada por leer y solo ${symbolText(pda.bottom)} en la pila.`,
    ...result.steps.slice(1).map((step) => moveNote(pda.transitions[step.transition], step.id)),
    verdictNote(result),
  ];
}

// Por qué muere una rama del árbol.
export function deadReason(node, mode) {
  if (node.id.input !== '') return 'se atasca';
  return mode === 'empty' ? 'pila no vacía' : `${symbolText(node.id.state)} no es final`;
}

// Notas del árbol de computación: la raíz, un nivel por paso y el resultado.
export function treeNotes(pda, input, mode) {
  const tree = computationTree(pda, input, mode);
  const notes = [`Raíz: ${idText(tree.nodes[0].id)}. Cada rama es una elección distinta del no determinismo.`];
  for (let depth = 1; depth <= tree.depth; depth += 1) {
    const level = tree.nodes.filter((node) => node.depth === depth);
    const dead = level.filter((node) => node.status === 'dead');
    const accept = level.find((node) => node.status === 'accept');
    let text = `Nivel ${depth}: ${level.length === 1 ? 'una configuración' : `${level.length} configuraciones`} (${level.map((node) => idText(node.id)).join(', ')}).`;
    if (dead.length) text += ` ${dead.length === 1 ? 'Muere una rama' : `Mueren ${dead.length} ramas`}: ${dead.map((node) => `${idText(node.id)} ${deadReason(node, mode)}`).join('; ')}.`;
    if (accept) text += ` **${idText(accept.id)} acepta.**`;
    notes.push(text);
  }
  notes.push(tree.accepted
    ? `Basta con **una** rama que acepte: «${input || 'ε'}» está en el lenguaje, aunque las demás mueran.`
    : `Ninguna rama acepta: «${input || 'ε'}» **no** está en el lenguaje.`);
  return notes;
}
