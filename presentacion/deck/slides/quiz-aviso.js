// Q7 · Antes de empezar: el marcador es volátil a propósito y para la nota solo cuentan las
// respuestas correctas (docs/TALLER.md, «Notas por estudiante»).
import { $$, box, hidden, show } from './common.js';

const REASONS = [
  ['Ir primero te pone <strong>en la mira</strong>.', 'Todos le apuntan al líder.'],
  ['Un objeto o un duelo puede <strong>cambiarlo todo</strong>.', 'En cualquier ronda.'],
  ['El que va atrás <strong>recibe ayuda</strong>.', 'Nadie queda fuera.'],
];

export default function mount({ body, steps }) {
  box(body, 'card sun qz-warn', { x: 0, y: 0, w: 1728 }, `
    <div class="display-font">El marcador va a dar muchas vueltas</div>
    <p>Está hecho así a propósito: es difícil acumular ventaja.</p>`);
  const reasons = box(body, 'qz-reasons', { x: 0, y: 275, w: 1728 }, REASONS.map(([text, sub]) => `
    <div class="card"><p>${text}</p><p class="muted">${sub}</p></div>`).join(''));
  const grade = box(body, 'card ink qz-grade', { x: 0, y: 565, w: 1728 }, `
    <div class="display-font">Para la nota solo cuenta responder bien las preguntas</div>
    <p>Ni el puesto, ni los objetos, ni los minijuegos. Tómenlo como lo que es: <strong>un juego</strong>.</p>`);
  const cards = $$(reasons, '.card');
  hidden(cards);
  hidden(grade);

  steps.step((tl, at) => show(tl, at, cards, { stagger: 0.12 }));
  steps.step((tl, at) => show(tl, at, grade));
}
