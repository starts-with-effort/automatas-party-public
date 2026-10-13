// Avance de la partida dibujado como un autómata: cada ronda es un estado (q1…q5 y qF) y la
// actual lleva doble círculo. En el celular, la ficha del equipo se apoya sobre el estado actual.
// Si la tira no cabe, se desplaza a la izquierda para que el estado actual quede a la vista
// (desde q3 se ven los últimos estados aunque dejen de verse los primeros).
import { h } from './dom.js';
import { FINAL_ROUND } from './phases.js';

const LABELS = Array.from({ length: FINAL_ROUND }, (_, i) => (i + 1 === FINAL_ROUND ? 'qF' : `q${i + 1}`));

// Se crea una vez y se actualiza en cada vista: así la ficha y el desplazamiento se animan.
export function createRoundStrip({ withToken = false } = {}) {
  const start = h('i', { class: 'rounds-arrow start' });
  const states = LABELS.map((label) => h('span', { class: 'rounds-state' }, label));
  const arrows = states.slice(1).map(() => h('i', { class: 'rounds-arrow' }));
  const token = withToken ? h('span', { class: 'rounds-token', 'aria-hidden': 'true' }) : null;
  const track = h('div', { class: 'rounds-track' },
    start, states.flatMap((state, i) => (i === 0 ? [state] : [arrows[i - 1], state])), token);
  const el = h('div', { class: 'rounds', role: 'img' }, track);

  let current = 0; // 0: la partida no ha empezado (la ficha espera en la flecha de inicio)
  let shown = false; // ya se dibujó una vista: desde entonces los cambios de ronda se animan

  function layout(instant) {
    const width = el.clientWidth;
    if (width === 0) return;
    const anchor = current > 0 ? states[current - 1] : start;
    const center = anchor.offsetLeft + anchor.offsetWidth / 2;
    const max = Math.max(0, track.offsetWidth - width);
    const offset = Math.min(max, Math.max(0, center - width / 2));
    // Sin animación al abrir la página o al cambiar el tamaño: la tira aparece ya en su sitio.
    track.classList.toggle('instant', instant);
    track.style.transform = `translateX(${-offset}px)`;
    if (token) {
      const r = anchor.offsetHeight / 2;
      // En el estado: sobre su borde inferior derecho. En la flecha de inicio: sobre la línea.
      token.style.left = `${current > 0 ? center + r * 0.85 : center}px`;
      token.style.top = `${anchor.offsetTop + (current > 0 ? r + r * 0.85 : anchor.offsetHeight / 2)}px`;
    }
  }

  new ResizeObserver(() => layout(true)).observe(el);

  return {
    el,
    // round: 0 antes de empezar; finished: la partida terminó (qF se pinta como aceptado).
    update({ round = 0, finished = false, color = null } = {}) {
      current = Math.min(round, FINAL_ROUND);
      states.forEach((state, i) => {
        const n = i + 1;
        state.className = `rounds-state${n < current ? ' is-done' : ''}${n === current ? (finished ? ' is-accepted' : ' is-now') : ''}`;
      });
      arrows.forEach((arrow, i) => arrow.classList.toggle('is-todo', i + 2 > current));
      if (token) {
        token.hidden = !color;
        if (color) token.style.setProperty('--team', color);
      }
      el.setAttribute('aria-label', current === 0
        ? 'La partida no ha empezado'
        : finished ? 'Partida terminada' : current === FINAL_ROUND ? 'Ronda final' : `Ronda ${current} de ${FINAL_ROUND - 1}`);
      const instant = !shown;
      shown = true;
      requestAnimationFrame(() => layout(instant));
    },
  };
}
