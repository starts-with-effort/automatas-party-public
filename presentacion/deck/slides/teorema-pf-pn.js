// 17 · De estado final a pila vacía (Hopcroft, teorema 6.11), construido sobre el PDA de aⁿbⁿ y
// probado con «ab».
import { anbnStack } from '../pda/examples.js';
import { LAYOUTS } from '../views/layouts.js';
import { constructionSlide } from './construction.js';
import { s } from './common.js';

export default function mount({ body, steps }) {
  constructionSlide({
    body,
    steps,
    theorem: '<b>Teorema.</b> Lo que un autómata de pila acepta <b>por estado final</b>, otro lo acepta <b>por pila vacía</b>.',
    pda: anbnStack,
    layout: { ...LAYOUTS.anbnStack(anbnStack), hidden: { states: ['p0', 'p'], edges: ['p0>q0', 'q2>p', 'p>p'], initial: true } },
    explain0: 'Partimos del autómata de a<sup>n</sup>b<sup>n</sup>, que acepta por <b>estado final</b>. En el dibujo es la caja P<sub>F</sub>.',
    stages: [
      {
        text: `Igual que antes: un estado inicial nuevo, <b>${s('p0')}</b>, que deja la marca <b>${s('X0')}</b> en el fondo de la pila y pone ${s('Z0')} encima.`,
        build(tl, at, dia) {
          dia.showState(tl, at, 'p0');
          dia.showInitial(tl, at + 0.2);
          dia.showEdge(tl, at + 0.3, 'p0>q0');
        },
      },
      {
        text: `Se agrega un estado nuevo, <b>p</b>, que vacía la pila. Desde cada estado <b>de aceptación</b> del original se pasa a p sin leer nada, y allí se saca todo lo que quede, también ${s('X0')}. (Y es cualquier símbolo de la pila.)`,
        build(tl, at, dia) {
          dia.showState(tl, at, 'p');
          dia.showEdge(tl, at + 0.2, 'q2>p');
          dia.showEdge(tl, at + 0.5, 'p>p');
        },
      },
      {
        text: `¿Para qué sirve ${s('X0')}? El autómata original podría vaciar su pila <b>sin</b> estar en un estado de aceptación, y el nuevo aceptaría cadenas de más. Con ${s('X0')} en el fondo, la pila solo se vacía pasando por p.`,
        build(tl, at, dia) {
          dia.ring(tl, at, ['p0']);
        },
        undo(tl, at, dia) {
          dia.ring(tl, at, ['p0'], false);
        },
      },
    ],
    input: 'ab',
    mode: 'empty',
  });
}
