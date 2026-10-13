// 9 · Simulación paso a paso: aabb en el PDA de aⁿbⁿ (diagrama, cinta, pila y descripciones).
import { anbn } from '../pda/examples.js';
import { LAYOUTS } from '../views/layouts.js';
import { createRunScene } from '../views/scene.js';

export default function mount({ body, steps }) {
  createRunScene(body, { pda: anbn, input: 'aabb', mode: 'final', layout: LAYOUTS.anbn() }).addRun(steps);
}
