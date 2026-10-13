// Q4 · Los minijuegos: tres formatos (cada equipo solo, en grupos de dos equipos y uno que no se
// revela) y el premio que lleva a las estrellas.
import { box, hidden, show } from './common.js';
import { starSvg } from './quiz-common.js';

// Colores de los primeros equipos del quiz (server/config/game.json).
const TEAMS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00'];
const dot = (color) => `<i class="qz-dot" style="background: ${color}"></i>`;

export default function mount({ body, steps }) {
  box(body, 'qz-lead', { x: 0, y: 0, w: 1728 }, 'Un minijuego distinto en cada ronda. Cambia <strong>con quién juegan</strong>:');
  const solo = box(body, 'card qz-format', { x: 0, y: 110, w: 544, h: 470 }, `
    <div class="qz-format-art solo">${TEAMS.map(dot).join('')}</div>
    <div class="display-font">Individual</div>
    <p>Cada equipo juega por su cuenta.</p>`);
  const pairs = box(body, 'card qz-format', { x: 592, y: 110, w: 544, h: 470 }, `
    <div class="qz-format-art pairs"><span>${TEAMS.slice(0, 2).map(dot).join('')}</span><span>${TEAMS.slice(2).map(dot).join('')}</span></div>
    <div class="display-font">En grupos</div>
    <p>Se juntan <strong>dos equipos</strong> y se ayudan.</p>`);
  const secret = box(body, 'card ink qz-format', { x: 1184, y: 110, w: 544, h: 470 }, `
    <div class="qz-format-art secret display-font">?</div>
    <div class="display-font">???</div>
    <p>Ya lo verán.</p>`);
  const prize = box(body, 'card qz-prize', { x: 164, y: 640, w: 1400 }, `
    ${starSvg(1)}
    <span>Ganar un minijuego da puntos… y un <strong>fragmento de estrella</strong>.</span>`);
  hidden([solo, pairs, prize]);
  hidden(secret, { y: 0, scale: 0.85 });

  steps.step((tl, at) => show(tl, at, solo));
  steps.step((tl, at) => show(tl, at, pairs));
  steps.step((tl, at) => show(tl, at, secret, { ease: 'back.out(1.6)' }));
  steps.step((tl, at) => show(tl, at, prize));
}
