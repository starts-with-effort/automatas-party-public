// R1 · Simulador en vivo: la cadena se escribe en el celular y aquí se ejecuta con el PDA elegido
// (aⁿbⁿ y paréntesis como ejecución; wwᴿ como árbol de computación).
import { LIVE_OPTIONS } from '../deck.js';
import { EXAMPLES } from '../pda/examples.js';
import { htmlEl } from '../views/format.js';
import { LAYOUTS } from '../views/layouts.js';
import { createRunScene, createTreeScene } from '../views/scene.js';

export default function mount({ el, body, steps, live }) {
  const option = LIVE_OPTIONS[live.pda];
  const pda = EXAMPLES[live.pda];
  htmlEl('span', 'head-chip', `${option.label} · «${live.input || 'ε'}» · ${option.mode === 'final' ? 'por estado final' : 'por pila vacía'}`, el.querySelector('.slide-head'));
  if (option.view === 'tree') {
    createTreeScene(body, { pda, input: live.input, mode: option.mode }).addLevels(steps);
  } else {
    createRunScene(body, { pda, input: live.input, mode: option.mode, layout: LAYOUTS[live.pda](pda) }).addRun(steps);
  }
}
