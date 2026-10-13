// Cuenta final de 5 s en la pregunta, el draft y el uso de objetos: la misma de Alimenta el
// Autómata. En el celular, el borde de la pantalla parpadea en rojo, la ficha de la cuenta late en
// rojo y un número grande marca 5, 4, 3, 2, 1 (y «¡Tiempo!» si se acaba); en el proyector, solo la
// ficha. Las capas van fuera de #app, así los cambios de pantalla no las cortan, y no reciben toques.
// Cada pantalla dice en cada dibujo hasta cuándo corre la cuenta (set(endsAt)) o null si no aplica:
// el equipo ya respondió, eligió o confirmó, la partida está en pausa o la fase no tiene plazo.
import { h } from './dom.js';

const FINAL_MS = 5000;
const END_MS = 1200; // lo que se ve «¡Tiempo!»
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFinalAlert(clock, { big = true } = {}) {
  const frame = h('div', { class: 'final-alert-frame', 'aria-hidden': 'true' });
  const count = h('div', { class: 'final-alert-count', 'aria-hidden': 'true' });
  if (big) document.body.append(frame, count);
  let endsAt = null;
  let shown = null;

  const tick = () => {
    const left = endsAt === null ? Infinity : endsAt - clock.now();
    const final = left > 0 && left <= FINAL_MS;
    const over = big && left <= 0 && left > -END_MS;
    document.body.classList.toggle('final-alert', final);
    const next = final ? Math.ceil(left / 1000) : over ? 'end' : null;
    if (next !== shown) {
      shown = next;
      count.classList.toggle('end', next === 'end');
      count.textContent = next === 'end' ? '¡Tiempo!' : next ?? '';
      if (big && next !== null && !still()) {
        count.animate(next === 'end'
          ? [{ transform: 'scale(0.4)', opacity: 1 }, { transform: 'scale(1.1)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }]
          : [{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 0.9, offset: 0.3 }, { transform: 'scale(0.9)', opacity: 0 }],
        { duration: next === 'end' ? 350 : 950 });
      }
    }
    requestAnimationFrame(tick);
  };
  tick();

  return {
    set(value) {
      endsAt = Number.isFinite(value) ? value : null;
    },
  };
}
