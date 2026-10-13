// Cinta de entrada: una celda por símbolo y el cabezal debajo. Leer apaga la celda y corre el
// cabezal; una transición ε deja el cabezal quieto y muestra «ε» sobre él hasta el paso siguiente.
import { gsap } from '../engine/gsap.js';
import { htmlEl } from './format.js';

const CELL = 76;
const GAP = 8;

export function createTape(container, input, { cell = CELL, label = 'Entrada' } = {}) {
  const pitch = cell + GAP;
  const root = htmlEl('div', 'tape', '', container);
  root.style.setProperty('--cell', `${cell}px`);
  htmlEl('div', 'tape-label', label, root);
  const row = htmlEl('div', 'tape-cells', '', root);
  const cells = [...input].map((symbol) => htmlEl('div', 'tape-cell', '', row));
  cells.forEach((el, i) => { el.textContent = input[i]; });
  // Celda vacía al final: allí queda el cabezal cuando se leyó todo.
  htmlEl('div', 'tape-cell end', input ? '' : 'ε', row);
  const head = htmlEl('div', 'tape-head', '<svg viewBox="0 0 44 34" width="44" height="34"><polygon points="22,3 41,31 3,31"/></svg>', row);
  const eps = htmlEl('div', 'tape-eps', 'ε', row);
  gsap.set(eps, { autoAlpha: 0, x: 0 });
  gsap.set(head, { x: 0 });

  let position = 0;
  let epsOn = false;

  const hideEps = (tl, at) => {
    if (!epsOn) return;
    tl.to(eps, { autoAlpha: 0, duration: 0.12 }, at);
    epsOn = false;
  };

  return {
    root,
    // Un movimiento del PDA: lee (si tr.read) o es ε.
    step(tl, at, tr) {
      hideEps(tl, at);
      if (tr.read) {
        tl.to(cells[position], { opacity: 0.28, duration: 0.25 }, at);
        position += 1;
        tl.to(head, { x: position * pitch, duration: 0.35 }, at + 0.05);
      } else {
        tl.set(eps, { x: position * pitch }, at);
        tl.to(eps, { autoAlpha: 1, duration: 0.2 }, at + 0.05);
        epsOn = true;
      }
    },
    finish(tl, at) {
      hideEps(tl, at);
    },
  };
}
