// 12 · Un PDA no determinista: wwᴿ (ejemplo 6.2 de Hopcroft). Las ε hacia q₁ «adivinan» la mitad.
import { wwr as wwrPda } from '../pda/examples.js';
import { createDiagram } from '../views/diagram.js';
import { LAYOUTS } from '../views/layouts.js';
import { $$, box, fade, hidden, s, show, wwr } from './common.js';

// Índices de las transiciones (examples.js): 0–5 apilan en q₀, 6–8 son las ε hacia q₁, 9–10
// comparan en q₁ y 11 acepta.
const PUSH = [0, 1, 2, 3, 4, 5];
const GUESS = [6, 7, 8];
const MATCH = [9, 10, 11];

export default function mount({ body, steps }) {
  box(body, 'card lang-row', { x: 0, y: 0, w: 1728 }, `
    <span class="big">L = { ${wwr} | w ∈ {0, 1}* }</span>
    <span class="chip ok">0110 · 1001 · 00 · ε</span><span class="chip bad">010 · 0111</span>`);
  const dia = createDiagram(box(body, 'wwr-diagram', { x: 0, y: 130, w: 1120, h: 560 }), wwrPda, LAYOUTS.wwr(), { width: 1120, height: 560 });
  const captions = box(body, 'captions', { x: 1160, y: 170, w: 568 }, `
    <div class="cap card">Apila la primera mitad y la compara con la segunda… pero <b>¿dónde está la mitad?</b></div>
    <div class="cap card"><b>${s('q0')}</b> apila todo lo que lee, sea 0 o 1.</div>
    <div class="cap card sun">En cualquier momento puede <b>adivinar</b> que llegó a la mitad: con ε pasa a ${s('q1')} sin leer ni tocar la pila. <b>Dos opciones: no determinismo.</b></div>
    <div class="cap card"><b>${s('q1')}</b> compara: si coincide con el tope, lo saca. Si reaparece ${s('Z0')}, pasa a ${s('q2')} y acepta.</div>`);
  const caps = $$(captions, '.cap');
  hidden(caps.slice(1), { y: 30 });

  const groups = [PUSH, GUESS, MATCH];
  const rings = [['q0'], ['q0', 'q1'], ['q1', 'q2']];
  groups.forEach((group, i) => {
    steps.step((tl, at) => {
      fade(tl, at, caps[i]);
      // Solo se apagan los anillos que no siguen (dos tweens a la vez sobre el mismo no se revierten bien).
      const before = rings[i - 1] ?? [];
      if (i > 0) groups[i - 1].forEach((t) => dia.mark(tl, at, t, false));
      dia.ring(tl, at, before.filter((q) => !rings[i].includes(q)), false);
      group.forEach((t, k) => dia.mark(tl, at + 0.15 + k * 0.05, t));
      dia.ring(tl, at + 0.15, rings[i].filter((q) => !before.includes(q)));
      show(tl, at + 0.2, caps[i + 1]);
    });
  });
}
