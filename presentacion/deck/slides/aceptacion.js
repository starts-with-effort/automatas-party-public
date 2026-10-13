// 14 · Dos formas de aceptar. Empieza con el PDA de aⁿbⁿ, que acepta por estado final; después, la
// aceptación por pila vacía, cómo se ve en ese mismo autómata (queda Z₀) y la transición que le
// falta para vaciar la pila. Al final, las dos con símbolos: L(P) y N(P).
import { anbnEmpty } from '../pda/examples.js';
import { createDiagram } from '../views/diagram.js';
import { COLORS } from '../views/format.js';
import { LAYOUTS } from '../views/layouts.js';
import { createStack } from '../views/stack.js';
import { $, $$, box, fade, gsap, hidden, s, show } from './common.js';

// Los colores unen las palabras con los símbolos: rosado, «se leyó todo»; amarillo, la condición.
const all = (text) => `<span class="ra">${text}</span>`;
const cond = (text) => `<span class="rx">${text}</span>`;
// Transición que se agrega (examples.js, anbnEmpty): ε, Z₀ / ε en q₂.
const EXTRA = { edge: 'q2>q2', index: 5 };

export default function mount({ body, steps }) {
  // ------------------------------------------------ el autómata y cómo termina aabb
  const layout = { ...LAYOUTS.anbnEmpty(), hidden: { edges: [EXTRA.edge] } };
  const dia = createDiagram(box(body, 'acc-diagram', { x: 0, y: 0, w: 1060, h: 430 }), anbnEmpty, layout, { width: 1060, height: 430 });
  gsap.set(dia.states.get('q2').circle, { fill: COLORS.ok });
  const end = box(body, 'card acc-end', { x: 1100, y: 0, w: 628, h: 430 }, `
    <div class="acc-end-title">Al terminar de leer <b>aabb</b></div>
    <div class="acc-end-body">
      <div class="acc-end-state">queda en <span class="chip ok">${s('q2')}</span></div>
      <div class="acc-end-stack"></div>
    </div>`);
  const stack = createStack($(end, '.acc-end-stack'), { initial: ['Z0'], capacity: 2, tile: 92, width: 200 });

  // ------------------------------------------------ los dos criterios
  const criterion = (x, { title, words, aside, checks, math }) => box(body, 'card crit', { x, y: 470, w: 844, h: 310 }, `
    <div class="crit-title display-font">${title}</div>
    <p class="crit-words">${words} <span class="muted">${aside}</span></p>
    <div class="crit-check">${checks}</div>
    <div class="crit-math">${math}</div>`);
  criterion(0, {
    title: 'Por estado final',
    words: `Se lee ${all('toda la cadena')} y se termina en un ${cond('estado de aceptación')}.`,
    aside: 'La pila no importa.',
    checks: `<span class="chip ok">${s('q2')} es de aceptación ✓</span>`,
    math: `L(P) = { w | (${s('q0')}, w, ${s('Z0')}) ⊢* (q, ${all('ε')}, α), ${cond('q ∈ F')} }`,
  });
  const empty = criterion(884, {
    title: 'Por pila vacía',
    words: `Se lee ${all('toda la cadena')} y la ${cond('pila queda vacía')}.`,
    aside: 'El estado no importa.',
    checks: `
      <span class="chip bad">en la pila queda ${s('Z0')} ✗</span>
      <span class="chip ok">con la transición nueva, se vacía ✓</span>`,
    math: `N(P) = { w | (${s('q0')}, w, ${s('Z0')}) ⊢* (q, ${all('ε')}, ${cond('ε')}) }`,
  });
  const [stays, empties] = $$(empty, '.crit-check .chip');
  const maths = $$(body, '.crit-math');
  hidden(empty);
  hidden([stays, empties, ...maths], { y: 12 });

  steps.step((tl, at) => show(tl, at, empty));
  steps.step((tl, at) => show(tl, at, stays));
  steps.step((tl, at) => {
    dia.showEdge(tl, at, EXTRA.edge);
    dia.mark(tl, at + 0.45, EXTRA.index);
    const done = stack.replace(tl, at + 0.7, []);
    fade(tl, done - 0.2, stays);
    show(tl, done, empties);
  });
  steps.step((tl, at) => show(tl, at, maths, { stagger: 0.2 }));
}
