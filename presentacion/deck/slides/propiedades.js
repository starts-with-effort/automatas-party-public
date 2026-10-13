// R3 · Lo que no se ve no importa: propiedades de las descripciones instantáneas (Hopcroft,
// teoremas 6.5 y 6.6).
import { box, hidden, show } from './common.js';

export default function mount({ body, steps }) {
  box(body, 'card prop', { x: 0, y: 0, w: 1728 }, `
    <div class="prop-title display-font">Agregar lo que el PDA no mira no cambia nada</div>
    <div class="prop-math">(q, x, α) ⊢* (p, y, β) &nbsp;⟹&nbsp; (q, x<span class="hl-sun">w</span>, α<span class="hl-sun">γ</span>) ⊢* (p, y<span class="hl-sun">w</span>, β<span class="hl-sun">γ</span>)</div>
    <div class="muted">w: entrada de más al final · γ: símbolos de más debajo de la pila</div>`);
  const back = box(body, 'card prop', { x: 0, y: 270, w: 1728 }, `
    <div class="prop-title display-font">La entrada que no se lee se puede quitar</div>
    <div class="prop-math">(q, x<span class="hl-sun">w</span>, α) ⊢* (p, y<span class="hl-sun">w</span>, β) &nbsp;⟹&nbsp; (q, x, α) ⊢* (p, y, β)</div>`);
  const caveat = box(body, 'card bad caveat', { x: 0, y: 500, w: 1728 }, `
    <b>Con la pila no vale lo mismo:</b> el PDA podría sacar símbolos de abajo y volver a ponerlos, así que no se pueden quitar sin más.`);
  hidden([back, caveat]);

  steps.step((tl, at) => show(tl, at, back));
  steps.step((tl, at) => show(tl, at, caveat));
}
