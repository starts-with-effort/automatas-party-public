// 10 · Cuando no se acepta: aab termina en un estado no final; abb llega a q₂ con una b sin leer.
import { verdict } from '../pda/narrate.js';
import { anbn } from '../pda/examples.js';
import { run } from '../pda/pda.js';
import { COLORS } from '../views/format.js';
import { createIdList } from '../views/ids.js';
import { anbn as anbnHtml, box, hidden, show } from './common.js';

export default function mount({ body, steps }) {
  box(body, 'rechazo-intro', { x: 0, y: 0, w: 1728 }, `¿Qué pasa con <b>aab</b> y <b>abb</b>? <span class="muted">Mismo PDA de ${anbnHtml}, por estado final.</span>`);
  const columns = ['aab', 'abb'].map((input, i) => {
    const result = run(anbn, input, 'final');
    const v = verdict(result);
    const col = box(body, 'card trace-col', { x: i * 884, y: 70, w: 844 }, `
      <div class="trace-head"><span class="chip sun big-chip">${input}</span></div>
      <div class="trace-ids"></div>
      <div class="verdict bad"><span class="verdict-mark">✗</span><span><b>${v.title}</b> · ${v.detail}</span></div>`);
    const ids = createIdList(col.querySelector('.trace-ids'), anbn, result.steps, { rows: 6, rowHeight: 62, title: '' });
    const verdictEl = col.querySelector('.verdict');
    hidden(col);
    hidden(verdictEl, { scale: 0.85 });
    return { col, ids, verdictEl, n: result.steps.length };
  });
  const rule = box(body, 'card sun rule-card', { x: 0, y: 640, w: 1728 }, `
    Se acepta solo si se lee <b>toda</b> la entrada y se termina en un estado <b>final</b>.
    Sin transición posible, esa computación muere.`);
  hidden(rule);

  for (const { col, ids, verdictEl, n } of columns) {
    steps.step((tl, at) => {
      show(tl, at, col);
      for (let k = 1; k < n; k += 1) ids.reveal(tl, at + 0.25 + k * 0.28, k);
      const end = at + 0.25 + n * 0.28;
      ids.settle(tl, end, COLORS.badSoft);
      show(tl, end + 0.1, verdictEl, { ease: 'back.out(1.7)' });
    });
  }
  steps.step((tl, at) => show(tl, at, rule));
}
