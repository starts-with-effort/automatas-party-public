// Q2 · Las preguntas: un celular tiene el enunciado y el otro las opciones; una respuesta por equipo.
import { $, box, hidden, show } from './common.js';

const OPTIONS = ['Una pila', 'Más estados', 'Dos cintas', 'Otro alfabeto'];

const phone = (name, role, screen) => `
  <div class="qz-phone-name display-font">${name}</div>
  <div class="qz-phone"><div class="qz-screen"><div class="qz-content">${screen}</div></div></div>
  <div class="qz-phone-role">${role}</div>`;

export default function mount({ body, steps }) {
  const a = box(body, 'qz-device', { x: 40, y: 0, w: 380 }, phone('Celular A', 'tiene <strong>la pregunta</strong>', `
    <span class="chip sun">Pregunta</span>
    <p>¿Qué tiene un autómata de pila que no tiene un autómata finito?</p>`));
  const b = box(body, 'qz-device', { x: 560, y: 0, w: 380 }, phone('Celular B', 'tiene <strong>las respuestas</strong>', `
    ${OPTIONS.map((text, i) => `<div class="qz-option o${i}">${text}</div>`).join('')}`));
  const talk = box(body, 'qz-talk display-font', { x: 420, y: 300, w: 140 }, '¡Hablen!');
  box(body, 'card sun qz-rule', { x: 1040, y: 40, w: 688 }, 'Cada equipo juega con <strong>dos celulares</strong>… y no ven lo mismo.');
  const one = box(body, 'card qz-rule', { x: 1040, y: 250, w: 688 }, `
    <p><strong>Una sola respuesta</strong> por equipo: la primera que toquen queda.</p>
    <p class="muted">En la pregunta siguiente cambian de papel.</p>`);
  const points = box(body, 'card qz-rule', { x: 1040, y: 540, w: 688 }, `
    <p>Más rápido, <strong>más puntos</strong>.</p>
    <p>Aciertos seguidos: <strong>racha</strong>, que los multiplica.</p>`);
  const screens = [a, b].map((device) => $(device, '.qz-content'));
  const roles = [a, b].map((device) => $(device, '.qz-phone-role'));
  hidden(screens, { y: 0 });
  hidden(roles, { y: 12 });
  hidden(talk, { y: 0, scale: 0.6 });
  hidden([one, points]);

  steps.step((tl, at) => show(tl, at, [screens[0], roles[0]]));
  steps.step((tl, at) => {
    show(tl, at, [screens[1], roles[1]]);
    show(tl, at + 0.3, talk, { ease: 'back.out(1.8)' });
  });
  steps.step((tl, at) => show(tl, at, one));
  steps.step((tl, at) => show(tl, at, points));
}
