// 1 · Portada. Al llegar, una pila de fichas cae y se apila; el paso 1 muestra el recorrido.
import { PRESENTERS } from '../deck.js';
import { escapeHtml } from '../ui.js';
import { createStack } from '../views/stack.js';
import { $, box, gsap, hidden, show } from './common.js';

export default function mount({ el, body, steps }) {
  el.classList.add('no-title');
  const text = box(body, 'cover-text', { x: 0, y: 110, w: 1040 }, `
    <div class="kicker">Exposición · 3.1 y 3.2</div>
    <h1 class="cover-title">Autómatas<br>de pila</h1>
    <p class="cover-sub">Definición del PDA y los lenguajes que acepta</p>
    <div class="cover-team">${PRESENTERS.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join('')}</div>`);
  const art = box(body, 'cover-art', { x: 1180, y: 110, w: 460, h: 620 });
  const stack = createStack(art, { initial: [], capacity: 4, tile: 108, width: 300, label: 'pila' });
  const agenda = box(body, 'card agenda', { x: 1080, y: 150, w: 648 }, `
    <h2>Hoy</h2>
    <ol>
      <li>¿Qué le falta a un autómata finito?</li>
      <li>Definición y notación</li>
      <li>Ejecución paso a paso</li>
      <li>No determinismo</li>
      <li>Dos formas de aceptar</li>
    </ol>`);
  hidden(agenda, { x: 60, y: 0 });

  // Entrada: el título sube y caen Z₀, A, A.
  const intro = gsap.timeline({ paused: true });
  intro.from($(text, '.cover-title'), { y: 40, autoAlpha: 0, duration: 0.5 }, 0);
  intro.from([$(text, '.kicker'), $(text, '.cover-sub'), $(text, '.cover-team')], { autoAlpha: 0, y: 20, duration: 0.4, stagger: 0.1 }, 0.2);
  stack.replace(intro, 0.3, ['Z0']);
  stack.replace(intro, 0.75, ['A', 'Z0']);
  stack.replace(intro, 1.15, ['A', 'A']);

  steps.step((tl, at) => {
    tl.to(art, { autoAlpha: 0, x: -40, duration: 0.3 }, at);
    show(tl, at + 0.15, agenda);
  });
  return { intro };
}
