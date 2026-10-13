// 18 · Mismo poder: las dos formas de aceptar definen la misma clase; AF frente a PDA; lo que viene.
import { anbn, box, hidden, show, wwr } from './common.js';

export default function mount({ body, steps }) {
  const left = box(body, 'card family', { x: 0, y: 40, w: 560 }, '<div class="display-font">Por estado final</div><div class="muted">lo que algún autómata de pila acepta así</div>');
  const right = box(body, 'card family', { x: 1168, y: 40, w: 560 }, '<div class="display-font">Por pila vacía</div><div class="muted">lo que algún autómata de pila acepta así</div>');
  const arrows = box(body, 'family-arrows', { x: 600, y: 20, w: 528 }, `
    <div class="farrow to-left"><span>primer teorema</span></div>
    <div class="farrow to-right"><span>segundo teorema</span></div>`);
  const merged = box(body, 'card sun merged', { x: 364, y: 30, w: 1000 }, `
    <div class="display-font big">La misma clase de lenguajes</div>
    <div>los que acepta algún PDA, con cualquiera de los dos criterios</div>`);
  hidden(merged, { scale: 0.8, y: 0 });

  const table = box(body, 'card compare', { x: 0, y: 280, w: 1728 }, `
    <table>
      <thead><tr><th></th><th>Autómata finito</th><th>Autómata de pila</th></tr></thead>
      <tbody>
        <tr><th>Memoria</th><td>solo los estados</td><td>estados + una pila</td></tr>
        <tr><th>Transición</th><td>δ(q, a) → p</td><td>δ(q, a o ε, tope) → (p, γ)</td></tr>
        <tr><th>Acepta</th><td>por estado final</td><td>por estado final o por pila vacía</td></tr>
        <tr><th>Ejemplos</th><td>a*b*, número par de a</td><td>${anbn}, ${wwr}, paréntesis balanceados</td></tr>
      </tbody>
    </table>`);
  const next = box(body, 'next-topic', { x: 0, y: 720, w: 1728 }, `
    <span class="chip pink">Lo que viene (3.3 y 3.4)</span> PDA deterministas y la relación entre PDA y gramáticas libres de contexto.`);
  hidden([table, next]);

  steps.step((tl, at) => {
    tl.to(left, { x: 420, autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, at);
    tl.to(right, { x: -420, autoAlpha: 0, duration: 0.45, ease: 'power2.in' }, at);
    tl.to(arrows, { autoAlpha: 0, duration: 0.25 }, at);
    show(tl, at + 0.35, merged, { ease: 'back.out(1.6)' });
  });
  steps.step((tl, at) => show(tl, at, table));
  steps.step((tl, at) => show(tl, at, next));
}
