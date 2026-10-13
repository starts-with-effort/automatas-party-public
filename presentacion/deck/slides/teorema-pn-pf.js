// 16 · De pila vacía a estado final (Hopcroft, teorema 6.9), construido sobre el PDA de paréntesis y
// probado con «()».
import { parensFinal } from '../pda/examples.js';
import { LAYOUTS } from '../views/layouts.js';
import { constructionSlide } from './construction.js';
import { s } from './common.js';

export default function mount({ body, steps }) {
  constructionSlide({
    body,
    steps,
    theorem: '<b>Teorema.</b> Lo que un autómata de pila acepta <b>por pila vacía</b>, otro lo acepta <b>por estado final</b>.',
    pda: parensFinal,
    layout: { ...LAYOUTS.parensFinal(), hidden: { states: ['p0', 'pf'], edges: ['p0>q', 'q>pf'], initial: true } },
    explain0: `Partimos del autómata de paréntesis, que acepta por <b>pila vacía</b>. En el dibujo es la caja P<sub>N</sub>.`,
    stages: [
      {
        text: `Se agrega un estado inicial nuevo, <b>${s('p0')}</b>. Antes de empezar deja una marca nueva, <b>${s('X0')}</b>, en el fondo de la pila, pone ${s('Z0')} encima y entra al autómata original.`,
        build(tl, at, dia) {
          dia.showState(tl, at, 'p0');
          dia.showInitial(tl, at + 0.2);
          dia.showEdge(tl, at + 0.3, 'p0>q');
        },
      },
      {
        text: `Se agrega un estado de aceptación nuevo, <b>p<sub>f</sub></b>. Si en el tope aparece ${s('X0')}, es porque el autómata original <b>vació su pila</b>: sin leer nada, pasa a p<sub>f</sub> y acepta.`,
        build(tl, at, dia) {
          dia.showState(tl, at, 'pf');
          dia.showEdge(tl, at + 0.2, 'q>pf');
        },
      },
    ],
    input: '()',
    mode: 'final',
  });
}
