// Q6 · El Desafío y el duelo: piedra, papel o tijera; qué pasa si gana o pierde el equipo que reta.
import { box, hidden, show } from './common.js';
import { itemIcon, starSvg } from './quiz-common.js';

// Los dibujos del duelo del quiz (client/shared/duel.js): cuadrícula de 64, tinta de 3 px y sombra
// dura. Cada uno lleva su propio filtro (los id no pueden repetirse).
const INK = '#1c1640';
let filterSeq = 0;
function drawing(body) {
  const id = `qz-lift-${++filterSeq}`;
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><filter id="${id}" x="-15%" y="-15%" width="130%" height="135%"><feDropShadow dx="0" dy="2.5" stdDeviation="0" flood-color="${INK}" flood-opacity="1"/></filter></defs><g filter="url(#${id})" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}
const ROCK = 'M9 42 C8 33 12 25 19 20 C25 15 33 12 41 15 C49 18 55 26 56 35 C57 44 51 51 42 53 C32 55 18 54 12 49 C10 47 9 45 9 42 Z';
const scissorArm = (angle) => `<g transform="translate(32 31) rotate(${angle})"><rect x="-2.6" y="4" width="5.2" height="9" rx="2" fill="#3a3366"/><circle cx="0" cy="19" r="7.2" fill="#ff4f8b"/><circle cx="0" cy="19" r="3" fill="#fff"/><path d="M-4.6 6 C-4.6 -8 -2.6 -19 0 -26 C2.6 -19 4.6 -8 4.6 6 Z" fill="#e9f6ff"/><path d="M-1.4 -15 V1" stroke="#fff" stroke-width="2"/></g>`;
const HANDS = [
  ['Piedra', () => drawing(`<path d="${ROCK}" fill="#8c88a8" stroke="none"/><path d="M20 21 C26 16 33 14 40 16 C45 18 49 21 51 25 C43 24 35 26 29 31 C25 28 22 25 20 21 Z" fill="#b9b5d6" stroke="none"/><path d="M14 46 C24 50 38 51 50 45 C47 50 40 52 32 52.5 C23 53 16 50 14 46 Z" fill="#6e6a8e" stroke="none"/><path d="M36 33 C39 36 43 37 47 36" stroke-width="2.4"/><path d="${ROCK}"/><path d="M15 34 C17 29 20 25 24 22" stroke="#fff" stroke-width="2.6"/>`)],
  ['Papel', () => drawing('<g transform="rotate(-7 32 33)"><path d="M17 7 H40 L49 16 V57 H17 Z" fill="#fff"/><path d="M40 7 V16 H49" fill="#e9f6ff"/><path d="M23 26 H43 M23 34 H43 M23 42 H43 M23 50 H35" stroke="#4d9bff" stroke-width="2.6"/></g>')],
  ['Tijera', () => drawing(`${scissorArm(24)}${scissorArm(-24)}<circle cx="32" cy="31" r="2.8" fill="${INK}"/>`)],
];

export default function mount({ body, steps }) {
  box(body, 'qz-versus', { x: 0, y: 0, w: 1728 }, `
    <div class="qz-side">
      ${itemIcon('ds')}
      <i class="qz-dot big" style="background: #e03131"></i>
      <span>El equipo<br>que reta</span>
    </div>
    <div class="qz-vs display-font">VS</div>
    <div class="qz-side">
      <span>El equipo<br>retado</span>
      <i class="qz-dot big" style="background: #1971c2"></i>
      ${starSvg(3)}
    </div>`);
  const lead = box(body, 'qz-lead', { x: 0, y: 170, w: 1728 }, 'Con el <strong>Desafío</strong> retas a otro equipo a un <strong>duelo</strong>. Nada lo bloquea.');
  const tie = box(body, 'qz-lead', { x: 0, y: 170, w: 1728 }, '<span class="chip sun">Además</span> también hay duelo si un minijuego termina en <strong>empate</strong>.');
  const hands = box(body, 'card qz-hands', { x: 114, y: 265, w: 1500 }, `
    <div class="qz-hand-row">${HANDS.map(([label, art]) => `<div class="qz-hand">${art()}<b>${label}</b></div>`).join('')}</div>
    <div>
      <p>En cada mano elige <strong>un solo celular</strong> por equipo.</p>
      <p class="muted">Si empatan, se juega otra mano.</p>
    </div>`);
  const win = box(body, 'card ok qz-outcome', { x: 0, y: 540, w: 840, h: 200 }, `
    <div class="display-font">Si gana el que retó</div>
    <p>se lleva <strong>todas</strong> las estrellas y los fragmentos del otro equipo.</p>`);
  const lose = box(body, 'card qz-outcome', { x: 888, y: 540, w: 840, h: 200 }, `
    <div class="display-font">Si pierde</div>
    <p>no pasa nada: <strong>nadie pierde nada</strong>.</p>`);
  hidden([hands, win, lose]);
  hidden(tie, { y: 0 });

  steps.step((tl, at) => show(tl, at, hands));
  steps.step((tl, at) => show(tl, at, win));
  steps.step((tl, at) => show(tl, at, lose));
  steps.step((tl, at) => {
    tl.to(lead, { autoAlpha: 0, duration: 0.25 }, at);
    show(tl, at + 0.2, tie);
  });
}
