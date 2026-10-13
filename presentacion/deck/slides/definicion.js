// 6 · Definición formal: P = (Q, Σ, Γ, δ, q₀, Z₀, F), cada componente con el ejemplo de aⁿbⁿ.
import { anbn as anbnPda } from '../pda/examples.js';
import { createDiagram } from '../views/diagram.js';
import { LAYOUTS } from '../views/layouts.js';
import { $$, anbn, box, hidden, mark, markable, s, show } from './common.js';

export default function mount({ body, steps }) {
  const tuple = box(body, 'tuple', { x: 0, y: 0, w: 1728 }, `
    P = (<span class="tp" data-k="Q">Q</span>, <span class="tp" data-k="S">Σ</span>, <span class="tp" data-k="G">Γ</span>,
    <span class="tp" data-k="d">δ</span>, <span class="tp" data-k="q">${s('q0')}</span>, <span class="tp" data-k="Z">${s('Z0')}</span>,
    <span class="tp" data-k="F">F</span>)`);
  const parts = Object.fromEntries($$(tuple, '.tp').map((el) => [el.dataset.k, el]));
  markable(Object.values(parts));

  const list = box(body, 'deflist', { x: 0, y: 130, w: 1000 }, `
    <div class="defgroup g1">
      <div class="defrow"><b>Q</b><span>estados (conjunto finito)</span><em>{${s('q0')}, ${s('q1')}, ${s('q2')}}</em></div>
      <div class="defrow"><b>Σ</b><span>alfabeto de entrada</span><em>{a, b}</em></div>
      <div class="defrow"><b>Γ</b><span>alfabeto de la pila</span><em>{A, ${s('Z0')}}</em></div>
    </div>
    <div class="defgroup g2">
      <div class="defrow"><b>δ</b><span>función de transición</span></div>
      <div class="defmath">δ : Q × (Σ ∪ {ε}) × Γ → subconjuntos finitos de Q × Γ*</div>
      <div class="defmath small">δ(${s('q0')}, a, ${s('Z0')}) = {(${s('q0')}, A${s('Z0')})}</div>
    </div>
    <div class="defgroup g3">
      <div class="defrow"><b>${s('q0')}</b><span>estado inicial</span></div>
      <div class="defrow"><b>${s('Z0')}</b><span>símbolo inicial de la pila</span></div>
      <div class="defrow"><b>F</b><span>estados de aceptación</span><em>{${s('q2')}}</em></div>
    </div>`);
  const groups = $$(list, '.defgroup');
  hidden(groups);

  const diaBox = box(body, 'def-diagram', { x: 1040, y: 140, w: 688, h: 330 });
  box(body, 'def-caption muted small', { x: 1040, y: 480, w: 688 }, `Ejemplo: el PDA de ${anbn}`);
  const dia = createDiagram(diaBox, anbnPda, LAYOUTS.anbn(), { width: 688, height: 330 });
  const callout = box(body, 'card sun callout-set', { x: 1040, y: 560, w: 688 }, `
    δ devuelve un <b>conjunto</b>:<br>varias opciones → <b>no determinismo</b><br>ninguna (∅) → se detiene`);
  hidden(callout);

  steps.step((tl, at) => {
    mark(tl, at, [parts.Q, parts.S, parts.G]);
    show(tl, at, groups[0]);
    dia.ring(tl, at + 0.3, anbnPda.states);
  });
  steps.step((tl, at) => {
    mark(tl, at, [parts.Q, parts.S, parts.G], false);
    mark(tl, at, parts.d);
    dia.ring(tl, at, anbnPda.states, false);
    show(tl, at, groups[1]);
    dia.mark(tl, at + 0.3, 0);
  });
  steps.step((tl, at) => {
    mark(tl, at, parts.d, false);
    dia.mark(tl, at, 0, false);
    mark(tl, at, [parts.q, parts.Z, parts.F]);
    show(tl, at, groups[2]);
    dia.ring(tl, at + 0.3, ['q0', 'q2']);
  });
  steps.step((tl, at) => {
    mark(tl, at, [parts.q, parts.Z, parts.F], false);
    dia.ring(tl, at, ['q0', 'q2'], false);
    mark(tl, at, parts.d);
    show(tl, at, callout);
  });
}
