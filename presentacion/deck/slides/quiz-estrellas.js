// Q5 · Las estrellas: cada minijuego ganado da un fragmento (una punta); cinco hacen una estrella.
// Los valores son los de server/config/game.json («stars»).
import { $, $$, box, hidden, show } from './common.js';
import { COLORS } from '../views/format.js';
import { starSvg } from './quiz-common.js';

export default function mount({ body, steps }) {
  const star = box(body, 'qz-big-star', { x: 70, y: 20, w: 520 }, starSvg(0));
  const worth = box(body, 'qz-worth', { x: 0, y: 610, w: 660 }, '<span class="chip">1 fragmento = 1000 puntos</span>');
  box(body, 'card qz-star-card', { x: 720, y: 30, w: 1008 }, `
    <p>Ganar un minijuego da un <strong>fragmento</strong>:</p>
    <p class="muted">una punta de la estrella.</p>`);
  const full = box(body, 'card sun qz-star-card', { x: 720, y: 270, w: 1008 }, `
    <div class="display-font big">5 fragmentos = 1 estrella</div>
    <p>Una estrella vale <strong>6000 puntos</strong>.</p>`);
  const steal = box(body, 'card pink qz-star-card', { x: 720, y: 530, w: 1008 }, `
    <p>Hay pocos fragmentos…</p>
    <p>y las estrellas <strong>se pueden robar</strong>.</p>`);
  const arms = $$(star, '.arm');
  const lit = { fill: COLORS.sun, stroke: COLORS.sun, duration: 0.3 };
  hidden([worth, full, steal]);

  steps.step((tl, at) => {
    tl.to(arms[0], lit, at);
    show(tl, at + 0.15, worth);
  });
  steps.step((tl, at) => {
    tl.to(arms.slice(1), { ...lit, duration: 0.2, stagger: 0.1 }, at);
    tl.to($(star, 'svg'), { scale: 1.08, duration: 0.2, ease: 'power2.out', transformOrigin: '50% 50%' }, at + 0.5);
    tl.to($(star, 'svg'), { scale: 1, duration: 0.25, ease: 'back.out(2)' }, at + 0.7);
    show(tl, at + 0.5, full);
  });
  steps.step((tl, at) => show(tl, at, steal));
}
