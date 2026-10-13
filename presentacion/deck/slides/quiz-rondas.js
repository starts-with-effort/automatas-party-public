// Q1 · El quiz: 6 rondas. La tira de estados es la del quiz (q₁…q₅ y q_F); debajo, las partes de
// una ronda y la ronda final.
import { $, $$, box, hidden, show } from './common.js';
import { COLORS } from '../views/format.js';

const PARTS = [
  ['ask', 'Pregunta'],
  ['item', 'Elegir un objeto'],
  ['ask', 'Pregunta'],
  ['game', 'Minijuego'],
  ['item', 'Usar el objeto'],
];

export default function mount({ body, steps }) {
  const strip = box(body, 'qz-rounds', { x: 0, y: 0, w: 1728 }, `
    ${[1, 2, 3, 4, 5].map((n) => `<div class="qz-round"><b>q<sub>${n}</sub></b><span>Ronda ${n}</span></div><i class="qz-link"></i>`).join('')}
    <div class="qz-round final"><b>q<sub>F</sub></b><span>Ronda 6</span></div>`);
  const lead = box(body, 'qz-lead muted', { x: 0, y: 210, w: 1728 }, 'Cada ronda es un estado: así verán el avance en el celular.');
  const parts = box(body, 'qz-parts', { x: 0, y: 250, w: 1728 }, `
    <div class="qz-parts-head"><span class="chip sun">Rondas 1 a 5</span> siempre en este orden:</div>
    <div class="qz-parts-row">
      ${PARTS.map(([kind, text], i) => `${i ? '<i class="qz-then"></i>' : ''}<div class="qz-part ${kind}"><b>${i + 1}</b><span>${text}</span></div>`).join('')}
    </div>`);
  const last = box(body, 'card qz-last', { x: 164, y: 610, w: 1400 }, `
    <span class="chip pink">Ronda 6</span>
    <span>Una sola pregunta, la final. <strong>11 preguntas</strong> en total.</span>`);
  const firstFive = $$(strip, '.qz-round:not(.final) b');
  const pieces = $$(parts, '.qz-part, .qz-then');
  hidden($(parts, '.qz-parts-head'));
  hidden(pieces, { y: 0, x: -24 });
  hidden(last);

  steps.step((tl, at) => {
    tl.to(lead, { autoAlpha: 0, duration: 0.25 }, at);
    tl.to(firstFive, { backgroundColor: COLORS.sun, duration: 0.3 }, at);
    show(tl, at + 0.1, $(parts, '.qz-parts-head'));
    show(tl, at + 0.25, pieces, { duration: 0.25, stagger: 0.08 });
  });
  steps.step((tl, at) => {
    tl.to($(strip, '.qz-round.final b'), { backgroundColor: COLORS.pink, color: '#ffffff', duration: 0.3 }, at);
    show(tl, at + 0.1, last);
  });
}
