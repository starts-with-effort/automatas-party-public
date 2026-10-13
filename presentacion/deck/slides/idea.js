// 4 · La idea: un AFN-ε con una pila. Solo la pila y la cadena, sin estados: con aabb entra una A
// por cada a y sale una por cada b; con aaabb sobra una A. En el fondo está la ficha de Z₀, todavía
// sin su símbolo (slides.css lo oculta): el nombre llega con la definición.
import { COLORS } from '../views/format.js';
import { createStack } from '../views/stack.js';
import { createTape } from '../views/tape.js';
import { $$, box, fade, gsap, hidden, show } from './common.js';

const READ = { read: 'x' };
const VALID = 'aabb';
const INVALID = 'aaabb';
// Segunda cadena, de corrido: un movimiento cada FAST segundos.
const FAST = 0.4;

const verdictHtml = (ok, title, detail) => `
  <div class="verdict ${ok ? 'ok' : 'bad'}"><span class="verdict-mark">${ok ? '✓' : '✗'}</span><span><b>${title}</b> · ${detail}</span></div>`;

export default function mount({ body, steps }) {
  const stack = createStack(box(body, 'idea-stack', { x: 170, y: 40, w: 320, h: 600 }), { initial: ['Z0'], capacity: 4, tile: 104, width: 250, label: 'Pila' });
  const intro = box(body, 'card idea-intro', { x: 700, y: 230, w: 900 }, `
    <p><b>Una pila:</b> memoria sin límite.</p>
    <p>Solo se usa el <b class="hl-pink">tope</b>: lo último que entra es lo primero que sale.</p>
    <p class="muted">La ficha oscura marca el fondo.</p>`);

  const tapes = [VALID, INVALID].map((input) => createTape(box(body, 'idea-tape', { x: 700, y: 50, w: 900 }), input, { label: 'Cadena' }));
  const rule = box(body, 'idea-rule', { x: 700, y: 270, w: 1028 }, `
    <span class="idea-move">Por cada <b>a</b>, entra una <b>A</b></span>
    <span class="idea-move">Por cada <b>b</b>, sale una <b>A</b></span>`);
  const [push, pop] = $$(rule, '.idea-move');
  gsap.set([push, pop], { backgroundColor: COLORS.surface });
  // La regla que se está usando, en amarillo.
  const light = (tl, at, target, on = true) => tl.to(target, { backgroundColor: on ? COLORS.sun : COLORS.surface, duration: 0.25 }, at);
  // Los dos veredictos ocupan el mismo lugar.
  const verdicts = $$(box(body, 'scene-caption', { x: 700, y: 430, w: 1028 }, `
    ${verdictHtml(true, 'Válida', 'en la pila solo queda el fondo')}
    ${verdictHtml(false, 'No es válida', 'sobra una A en la pila')}`), '.verdict');
  const sum = box(body, 'card sun idea-sum', { x: 700, y: 600, w: 1028 }, `
    Autómata finito (AFN-ε) <b>+</b> pila <b>=</b> <b>autómata de pila</b>`);
  hidden([tapes[0].root, rule, sum]);
  hidden(tapes[1].root, { y: 0 });
  hidden(verdicts, { y: 0, scale: 0.85 });

  // Una A más: el tope X se reemplaza por AX (X es otra A o la ficha del fondo).
  const move = (tl, at, symbol) => stack.replace(tl, at, symbol === 'b' ? [] : ['A', stack.symbols[0]]);

  // La cadena.
  steps.step((tl, at) => {
    fade(tl, at, intro);
    show(tl, at + 0.15, tapes[0].root);
    show(tl, at + 0.3, rule);
  });
  // aabb, un símbolo por toque.
  [...VALID].forEach((symbol, k) => {
    steps.step((tl, at) => {
      if (k === 0) light(tl, at, push);
      if (symbol === 'b' && VALID[k - 1] === 'a') {
        light(tl, at, push, false);
        light(tl, at, pop);
      }
      tapes[0].step(tl, at, READ);
      const end = move(tl, at + 0.2, symbol);
      if (k === VALID.length - 1) {
        light(tl, end, pop, false);
        show(tl, end, verdicts[0], { ease: 'back.out(1.7)' });
      }
    });
  });
  // aaabb, de corrido: al final sobra una A.
  steps.step((tl, at) => {
    fade(tl, at, [verdicts[0], tapes[0].root]);
    show(tl, at + 0.2, tapes[1].root);
    const start = at + 0.6;
    [...INVALID].forEach((symbol, k) => {
      tapes[1].step(tl, start + k * FAST, READ);
      move(tl, start + k * FAST + 0.05, symbol);
    });
    show(tl, start + INVALID.length * FAST + 0.2, verdicts[1], { ease: 'back.out(1.7)' });
  });
  steps.step((tl, at) => show(tl, at, sum));
}
