// R2 · ¿Qué falla sin X₀? Un P_F con una «fuga» vacía su pila sin aceptar: sin el marcador, la
// construcción aceptaría «b».
import { verdict } from '../pda/narrate.js';
import { leakyNaive, leakyStack } from '../pda/examples.js';
import { run } from '../pda/pda.js';
import { COLORS } from '../views/format.js';
import { createIdList } from '../views/ids.js';
import { box, hidden, s, show } from './common.js';

export default function mount({ body, steps }) {
  box(body, 'card leak', { x: 0, y: 0, w: 1728 }, `
    P<sub>F</sub> con una «fuga»: <span class="chip sun">δ(${s('q0')}, b, ${s('Z0')}) = {(${s('q0')}, ε)}</span>
    Con <b>b</b> vacía la pila y queda en ${s('q0')}, que no es final: <b>b ∉ L(P<sub>F</sub>)</b>.`);
  const cases = [
    { pda: leakyNaive, title: 'Sin X<sub>0</sub>', wrong: true },
    { pda: leakyStack, title: `Con ${s('X0')}`, wrong: false },
  ].map(({ pda, title, wrong }, i) => {
    const result = run(pda, 'b', 'empty');
    const v = verdict(result);
    const col = box(body, 'card trace-col short', { x: i * 884, y: 160, w: 844 }, `
      <div class="trace-head"><span class="display-font big">${title}</span><span class="chip">entrada: b</span></div>
      <div class="trace-ids"></div>
      <div class="verdict ${wrong ? 'bad' : 'ok'}"><span class="verdict-mark">${wrong ? '!' : '✓'}</span><span><b>${v.title}</b> · ${wrong ? '¡acepta de más!' : 'como debe ser'}</span></div>`);
    const ids = createIdList(col.querySelector('.trace-ids'), pda, result.steps, { rows: 4, rowHeight: 62, title: '' });
    const verdictEl = col.querySelector('.verdict');
    hidden(col);
    hidden(verdictEl, { scale: 0.85 });
    return { col, ids, verdictEl, n: result.steps.length, ok: !wrong };
  });
  const moral = box(body, 'card sun rule-card', { x: 0, y: 660, w: 1728 }, `
    Con ${s('X0')}, la pila del nuevo PDA solo se vacía en <b>p</b>, y a p solo se llega desde un estado <b>final</b>.`);
  hidden(moral);

  for (const { col, ids, verdictEl, n, ok } of cases) {
    steps.step((tl, at) => {
      show(tl, at, col);
      for (let k = 1; k < n; k += 1) ids.reveal(tl, at + 0.25 + k * 0.3, k);
      const end = at + 0.25 + n * 0.3;
      ids.settle(tl, end, ok ? COLORS.okSoft : COLORS.badSoft);
      show(tl, end + 0.1, verdictEl, { ease: 'back.out(1.7)' });
    });
  }
  steps.step((tl, at) => show(tl, at, moral));
}
