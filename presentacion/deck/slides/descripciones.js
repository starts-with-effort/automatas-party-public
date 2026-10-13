// 8 · Descripciones instantáneas. Primero la «foto» con un ejemplo y en palabras, después (q, w, γ);
// luego un movimiento y varios, cada uno leído antes de escribirlo con ⊢ y ⊢*; al final, la regla.
import { $$, box, fade, hidden, s, show } from './common.js';

const id = (state, input, stack) => `<span class="id">(${s(state)}, ${input}, ${stack})</span>`;
const START = id('q0', 'aabb', s('Z0'));
const NEXT = id('q0', 'abb', `A${s('Z0')}`);
const END = id('q2', 'ε', s('Z0'));

export default function mount({ body, steps }) {
  // ------------------------------------------------ la foto
  const photo = [
    box(body, 'id-lead', { x: 0, y: 30, w: 1728 }, 'Una <b>foto</b> del autómata en un instante. Guarda tres datos:'),
    box(body, 'triple', { x: 0, y: 120, w: 1728 }, `(<span class="tq">${s('q0')}</span>, <span class="tw">abb</span>, <span class="tg">A${s('Z0')}</span>)`),
    box(body, 'triple-notes', { x: 0, y: 330, w: 1728 }, `
      <div class="anote tq">el <b>estado</b> actual</div>
      <div class="anote tw">lo que <b>falta por leer</b></div>
      <div class="anote tg">la <b>pila</b>, con el tope a la izquierda</div>`),
  ];
  const general = box(body, 'id-general', { x: 0, y: 530, w: 1728 }, `
    <span class="muted">En general se escribe</span>
    <span class="triple">(<span class="tq">q</span>, <span class="tw">w</span>, <span class="tg">γ</span>)</span>`);

  // ------------------------------------------------ movimientos: se lee y se escribe
  const legend = box(body, 'id-legend', { x: 0, y: 6, w: 1728 }, `
    <span class="chip">Descripción instantánea</span>
    <span>(<span class="tq">q</span>, <span class="tw">w</span>, <span class="tg">γ</span>) = (estado, lo que falta por leer, pila)</span>`);
  const relation = (x, { title, words, formula, symbol, reading }) => box(body, 'card rel', { x, y: 96, w: 844, h: 372 }, `
    <div class="rel-title display-font">${title}</div>
    <p class="rel-words">${words}</p>
    <div class="rel-write">${formula}</div>
    <div class="rel-read"><span class="chip sun">${symbol}</span> se lee «${reading}»</div>`);
  const one = relation(0, {
    title: 'Un movimiento',
    words: `Está en ${START}. Lee <span class="ra">a</span> y cambia el tope <span class="rx">${s('Z0')}</span> por <span class="rx">A${s('Z0')}</span>: queda en ${NEXT}.`,
    formula: `${START} <span class="turn">⊢</span> ${NEXT}`,
    symbol: '⊢',
    reading: 'pasa en un movimiento a',
  });
  const many = relation(884, {
    title: 'Varios movimientos',
    words: `Desde ${START}, paso a paso, lee toda la cadena y llega a ${END}.`,
    formula: `${START} <span class="turn">⊢*</span> ${END}`,
    symbol: '⊢*',
    reading: 'llega en cero o más movimientos a',
  });
  const written = (card) => $$(card, '.rel-write, .rel-read');
  const rule = box(body, 'card rule', { x: 0, y: 510, w: 1728 }, `
    <div class="muted">La regla general: si (p, α) ∈ δ(q, a, X), entonces</div>
    <div class="rule-line">(q, <span class="ra">a</span>w, <span class="rx">X</span><span class="rb">β</span>)
      <span class="turn">⊢</span> (p, w, <span class="rx">α</span><span class="rb">β</span>)</div>
    <div class="muted small">se lee <span class="ra">a</span> · el tope <span class="rx">X</span> se cambia por <span class="rx">α</span> · lo demás (w y <span class="rb">β</span>) no se toca</div>`);
  hidden([general, legend, one, many, rule]);
  hidden([...written(one), ...written(many)], { y: 12 });

  steps.step((tl, at) => show(tl, at, general));
  steps.step((tl, at) => {
    fade(tl, at, [...photo, general]);
    show(tl, at + 0.2, legend);
    show(tl, at + 0.3, one);
  });
  steps.step((tl, at) => show(tl, at, written(one), { stagger: 0.25 }));
  steps.step((tl, at) => {
    show(tl, at, many);
    show(tl, at + 0.5, written(many), { stagger: 0.25 });
  });
  steps.step((tl, at) => show(tl, at, rule));
}
