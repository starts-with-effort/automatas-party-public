// 15 · Pila vacía en acción: paréntesis balanceados con un solo estado; (()) vacía la pila.
import { parens } from '../pda/examples.js';
import { LAYOUTS } from '../views/layouts.js';
import { createRunScene } from '../views/scene.js';
import { htmlEl } from './common.js';

export default function mount({ el, body, steps }) {
  htmlEl('span', 'head-chip', 'Por pila vacía · un solo estado · sin estados de aceptación', el.querySelector('.slide-head'));
  createRunScene(body, { pda: parens, input: '(())', mode: 'empty', layout: LAYOUTS.parens() }).addRun(steps);
}
