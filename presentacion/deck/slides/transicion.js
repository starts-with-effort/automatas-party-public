// 5 · Anatomía de una transición: a, X / α y sus tres usos típicos (sacar, dejar igual, apilar).
import { stackHtml } from '../views/format.js';
import { createStack } from '../views/stack.js';
import { $, box, hidden, s, show } from './common.js';

const DEMOS = [
  { title: 'Sacar', label: `b, A / ε`, before: ['A', 'Z0'], push: [] },
  { title: 'Dejar igual', label: `ε, ${s('Z0')} / ${s('Z0')}`, before: ['Z0'], push: ['Z0'] },
  { title: 'Apilar', label: 'a, A / AA', before: ['A', 'Z0'], push: ['A', 'A'] },
];

export default function mount({ body, steps }) {
  const formula = box(body, 'card anatomy', { x: 0, y: 0, w: 1728 }, `
    <div class="anatomy-label">
      <span class="part pa">a</span><span class="sep">,</span>
      <span class="part px">X</span><span class="sep">/</span>
      <span class="part pg">α</span>
    </div>
    <div class="anatomy-delta">⟺ (p, α) ∈ δ(q, a, X)</div>`);
  const notes = box(body, 'anatomy-notes', { x: 0, y: 226, w: 1728 }, `
    <div class="anote pa"><b>a</b> símbolo que se lee<br><span class="muted">(o ε: no lee nada)</span></div>
    <div class="anote px"><b>X</b> lo que debe estar en el tope<br><span class="muted">(se saca)</span></div>
    <div class="anote pg"><b>α</b> lo que se pone en su lugar<br><span class="muted">(su primer símbolo queda arriba)</span></div>`);
  hidden(notes.children);
  hidden($(formula, '.anatomy-delta'), { y: 0 });

  const demos = DEMOS.map((demo, i) => {
    const card = box(body, 'card demo', { x: i * 596, y: 418, w: 536, h: 372 }, `
      <div class="demo-head"><span class="display-font">${demo.title}</span><span class="chip sun">${demo.label}</span></div>
      <div class="demo-body"><div class="demo-stack"></div><div class="demo-after muted">antes: ${stackHtml(demo.before)}<br>después: ${stackHtml([...demo.push, ...demo.before.slice(1)])}</div></div>`);
    const stack = createStack($(card, '.demo-stack'), { initial: demo.before, capacity: 3, tile: 60, width: 140, label: '' });
    hidden(card);
    return { card, stack, demo };
  });

  steps.step((tl, at) => {
    show(tl, at, notes.children, { stagger: 0.12 });
    show(tl, at + 0.4, $(formula, '.anatomy-delta'));
  });
  for (const { card, stack, demo } of demos) {
    steps.step((tl, at) => {
      show(tl, at, card);
      stack.replace(tl, at + 0.55, demo.push);
    });
  }
}
