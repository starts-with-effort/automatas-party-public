// 3 · ¿Qué le falta a un autómata finito? aⁿbⁿ obliga a contar sin límite.
import { $$, anbn, box, hidden, show } from './common.js';

export default function mount({ body, steps }) {
  const lang = box(body, 'card lang', { x: 0, y: 0, w: 1728 }, `
    <span class="big">L = { ${anbn} | n ≥ 1 }</span>
    <span class="muted">= { ab, aabb, aaabbb, aaaabbbb, … }</span>`);
  const count = box(body, 'counter', { x: 0, y: 170, w: 1728 }, `
    <div class="counter-row">
      ${[0, 1, 2, 3, 4].map((n) => `<div class="mstate"><b>${n}</b><span>a</span></div>${'<div class="marrow"><i>a</i></div>'}`).join('')}
      <div class="mstate more"><b>…</b></div>
    </div>
    <p class="counter-caption">Un estado para cada cantidad de <b>a</b> leídas…</p>`);
  const callout = box(body, 'card callout', { x: 0, y: 450, w: 820 }, `
    <div class="display-font big">¿Y con n = 1 000 000?</div>
    <p>Un AF solo recuerda con sus estados: tiene memoria <strong>finita</strong>.
    ${anbn} no es regular (lema de bombeo).</p>`);
  const idea = box(body, 'card sun idea', { x: 880, y: 450, w: 848 }, `
    <div class="display-font big">Idea: agregar una pila</div>
    <p>Memoria ilimitada, pero solo se usa el tope.</p>
    <div class="chips">
      <span class="chip">( [ { } ] )</span>
      <span class="chip">&lt;p&gt;&lt;b&gt;…&lt;/b&gt;&lt;/p&gt;</span>
      <span class="chip">llamadas recursivas</span>
    </div>`);
  const parts = [...$$(count, '.mstate, .marrow')];
  hidden(parts, { y: 0, x: -20 });
  hidden($$(count, '.counter-caption'));
  hidden([callout, idea]);

  steps.step((tl, at) => {
    show(tl, at, parts, { duration: 0.25, stagger: 0.07 });
    show(tl, at + 0.5, $$(count, '.counter-caption'));
  });
  steps.step((tl, at) => {
    tl.to(count, { opacity: 0.35, duration: 0.3 }, at);
    show(tl, at + 0.1, callout);
  });
  steps.step((tl, at) => show(tl, at, idea));
}
