// 7 · Notación gráfica: el PDA de aⁿbⁿ se arma arco por arco.
import { anbn } from '../pda/examples.js';
import { createDiagram } from '../views/diagram.js';
import { LAYOUTS } from '../views/layouts.js';
import { $$, box, fade, hidden, s, show } from './common.js';

const EDGES = ['q0>q0', 'q0>q1', 'q1>q1', 'q1>q2'];

export default function mount({ body, steps }) {
  box(body, 'card legend', { x: 0, y: 0, w: 1728 }, `
    Arco de <b>q</b> a <b>p</b> con <span class="chip sun">a, X / α</span> ⟺ (p, α) ∈ δ(q, a, X)`);
  const layout = { ...LAYOUTS.anbn(), hidden: { edges: EDGES } };
  const dia = createDiagram(box(body, 'nota-diagram', { x: 0, y: 120, w: 1150, h: 530 }), anbn, layout, { width: 1150, height: 530 });
  const captions = box(body, 'captions', { x: 1190, y: 170, w: 538 }, `
    <div class="cap card">Estados como en un AF: flecha de <b>inicio</b> y doble círculo para los de <b>aceptación</b> (${s('q2')}).</div>
    <div class="cap card"><b>${s('q0')}</b> lee las a: apila una <b>A</b> por cada a (sobre ${s('Z0')} o sobre otra A).</div>
    <div class="cap card">La primera <b>b</b> saca una A y pasa a <b>${s('q1')}</b>.</div>
    <div class="cap card">En <b>${s('q1')}</b>, cada b saca una A.</div>
    <div class="cap card">Si reaparece <b>${s('Z0')}</b>, ya no quedan A: sin leer (ε) pasa a <b>${s('q2')}</b> y acepta.</div>`);
  const caps = $$(captions, '.cap');
  hidden(caps.slice(1), { y: 30 });

  EDGES.forEach((key, i) => {
    steps.step((tl, at) => {
      fade(tl, at, caps[i]);
      dia.showEdge(tl, at, key);
      show(tl, at + 0.2, caps[i + 1]);
    });
  });
}
