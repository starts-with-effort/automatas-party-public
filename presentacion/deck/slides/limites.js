// R4 · ¿Qué no puede hacer un PDA? aⁿbⁿcⁿ: con una sola pila, la información se gasta al comparar
// las a con las b y no queda nada para las c.
import { createStack } from '../views/stack.js';
import { createTape } from '../views/tape.js';
import { box, hidden, show } from './common.js';

export default function mount({ body, steps }) {
  box(body, 'card lang-row', { x: 0, y: 0, w: 1728 }, '<span class="big">L = { a<sup>n</sup>b<sup>n</sup>c<sup>n</sup> | n ≥ 1 }</span><span class="muted">misma cantidad de a, de b y de c</span>');
  const tape = createTape(box(body, 'limit-tape', { x: 0, y: 170, w: 1000 }), 'aaabbbccc');
  const stack = createStack(box(body, 'limit-stack', { x: 1180, y: 120, w: 320, h: 420 }), { initial: ['Z0'], capacity: 4, tile: 76, width: 200 });
  const lost = box(body, 'lost display-font', { x: 1250, y: 150, w: 180 }, '?');
  const captions = ['Con las a llenamos la pila…', '…y con las b la vaciamos para comparar.', '¿Y las c? Ya no queda nada con qué compararlas.'];
  // Los tres rótulos ocupan el mismo lugar y se van reemplazando.
  const caps = captions.map((text) => box(body, 'card limit-cap', { x: 0, y: 380, w: 1100 }, text));
  const end = box(body, 'card sun rule-card', { x: 0, y: 600, w: 1728 }, `
    Con una sola pila no alcanza. Que <b>ningún</b> PDA lo acepta se demuestra con el lema de bombeo
    para lenguajes libres de contexto (otro tema).`);
  hidden([...caps, lost, end]);

  const read = { read: 'x' };
  steps.step((tl, at) => {
    show(tl, at, caps[0]);
    for (let k = 0; k < 3; k += 1) {
      tape.step(tl, at + 0.2 + k * 0.45, read);
      stack.replace(tl, at + 0.3 + k * 0.45, k === 0 ? ['A', 'Z0'] : ['A', 'A']);
    }
  });
  steps.step((tl, at) => {
    tl.to(caps[0], { autoAlpha: 0, duration: 0.2 }, at);
    show(tl, at + 0.1, caps[1]);
    for (let k = 0; k < 3; k += 1) {
      tape.step(tl, at + 0.2 + k * 0.45, read);
      stack.replace(tl, at + 0.3 + k * 0.45, []);
    }
  });
  steps.step((tl, at) => {
    tl.to(caps[1], { autoAlpha: 0, duration: 0.2 }, at);
    show(tl, at + 0.1, caps[2]);
    show(tl, at + 0.3, lost, { ease: 'back.out(2)' });
  });
  steps.step((tl, at) => show(tl, at, end));
}
