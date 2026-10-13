// Lista de descripciones instantáneas: (q₀, aabb, Z₀) ⊢ (q₀, abb, AZ₀) ⊢ …, una fila por paso, con
// la transición usada al lado. La fila actual va resaltada; si no caben, la lista se corre hacia
// arriba para que la actual siempre se vea.
import { gsap } from '../engine/gsap.js';
import { COLORS, htmlEl, idHtml, transitionHtml } from './format.js';

export function createIdList(container, pda, steps, { rows = 8, rowHeight = 66, title = 'Descripciones instantáneas' } = {}) {
  const root = htmlEl('div', 'ids', '', container);
  if (title) htmlEl('div', 'ids-title', title, root);
  const viewport = htmlEl('div', 'ids-viewport', '', root);
  viewport.style.height = `${Math.min(rows, steps.length) * rowHeight}px`;
  const track = htmlEl('div', 'ids-track', '', viewport);
  const transparent = 'rgba(255, 201, 60, 0)';
  const rowEls = steps.map((step, i) => {
    const tr = step.transition === null ? null : pda.transitions[step.transition];
    const row = htmlEl('div', 'id-row', `
      <span class="id-turn">${i ? '⊢' : ''}</span>
      <span class="id-text">${idHtml(step.id)}</span>
      <span class="id-tr">${tr ? transitionHtml(tr) : 'inicio'}</span>`, track);
    row.style.height = `${rowHeight}px`;
    gsap.set(row, i ? { autoAlpha: 0, x: -24, backgroundColor: transparent } : { backgroundColor: COLORS.sun });
    return row;
  });
  let current = 0;

  return {
    root,
    rows: rowEls,
    reveal(tl, at, i) {
      tl.to(rowEls[current], { backgroundColor: transparent, duration: 0.2 }, at);
      tl.to(rowEls[i], { autoAlpha: 1, x: 0, backgroundColor: COLORS.sun, duration: 0.3 }, at);
      if (i >= rows) tl.to(track, { y: -(i - rows + 1) * rowHeight, duration: 0.3 }, at);
      current = i;
    },
    // Sin resaltado (al dar el veredicto).
    settle(tl, at, color = transparent) {
      tl.to(rowEls[current], { backgroundColor: color, duration: 0.25 }, at);
    },
  };
}
