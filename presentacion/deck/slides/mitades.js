// 11 · wwᴿ, la estrategia antes del autómata: se apila la primera mitad y, con la segunda, se va
// sacando. Como la pila devuelve lo último primero, compara con la primera mitad al revés.
import { createStack } from '../views/stack.js';
import { createTape } from '../views/tape.js';
import { $$, box, fade, hidden, s, show, wwr } from './common.js';

const READ = { read: 'x' };
const PACE = 0.5;

export default function mount({ body, steps }) {
  box(body, 'card lang-row', { x: 0, y: 0, w: 1728 }, `
    <span class="big">L = { ${wwr} | w ∈ {0, 1}* }</span>
    <span class="muted">una cadena y, enseguida, la misma <b>al revés</b>: 01·10, 110·011</span>`);
  box(body, 'halves', { x: 0, y: 176, w: 400 }, `<span class="half first">w = 01</span><span class="half second">w<sup>R</sup> = 10</span>`);
  const tape = createTape(box(body, 'mitades-tape', { x: 0, y: 236, w: 700 }), '0110', { label: '' });
  const stack = createStack(box(body, 'mitades-stack', { x: 1230, y: 150, w: 320, h: 450 }), { initial: ['Z0'], capacity: 4, tile: 88, width: 210 });
  const captions = box(body, 'captions mitades-caps', { x: 0, y: 410, w: 1040 }, `
    <div class="cap card">¿Cómo comprobar que la segunda mitad es la primera <b>al revés</b>?</div>
    <div class="cap card"><b>Primera mitad:</b> se apila cada símbolo que se lee.</div>
    <div class="cap card"><b>Segunda mitad:</b> cada símbolo debe ser igual al <b class="hl-pink">tope</b>. Si coincide, se saca.</div>`);
  const caps = $$(captions, '.cap');
  const end = box(body, 'card sun rule-card', { x: 0, y: 616, w: 1728 }, `
    La pila devuelve primero lo último que entró: entrega la primera mitad <b>al revés</b>.
    Si todo coincide y solo queda ${s('Z0')}, la cadena es de la forma ${wwr}.`);
  hidden(caps.slice(1), { y: 30 });
  hidden(end);

  // Primera mitad: 0 y 1 a la pila.
  steps.step((tl, at) => {
    fade(tl, at, caps[0]);
    show(tl, at + 0.2, caps[1]);
    [['0', 'Z0'], ['1', '0']].forEach((push, k) => {
      tape.step(tl, at + 0.4 + k * PACE, READ);
      stack.replace(tl, at + 0.5 + k * PACE, push);
    });
  });
  // Segunda mitad: 1 y 0 coinciden con el tope y salen.
  steps.step((tl, at) => {
    fade(tl, at, caps[1]);
    show(tl, at + 0.2, caps[2]);
    for (let k = 0; k < 2; k += 1) {
      tape.step(tl, at + 0.4 + k * PACE, READ);
      stack.replace(tl, at + 0.5 + k * PACE, []);
    }
  });
  steps.step((tl, at) => show(tl, at, end));
}
