// 13 · Árbol de computación de 0110 en el PDA de wwᴿ: un nivel por paso; basta una rama que acepte.
import { wwr } from '../pda/examples.js';
import { createTreeScene } from '../views/scene.js';
import { htmlEl } from './common.js';

export default function mount({ el, body, steps }) {
  htmlEl('span', 'head-chip', 'ww<sup>R</sup> · «0110» · por estado final', el.querySelector('.slide-head'));
  createTreeScene(body, { pda: wwr, input: '0110', mode: 'final' }).addLevels(steps);
}
