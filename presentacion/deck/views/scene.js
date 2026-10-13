// Escenas: juntan las vistas para mostrar una ejecución completa.
//
// createRunScene: diagrama + cinta + pila + descripciones instantáneas + rótulo, avanzando juntos un
// movimiento por paso, y un veredicto al final. Pasos: la ID inicial, uno por movimiento y el
// veredicto (lo mismo que runNotes, así las notas del celular siempre coinciden).
//
// createTreeScene: el árbol de computación, un nivel por paso y el resultado al final (treeNotes).
import { gsap } from '../engine/gsap.js';
import { verdict as verdictOf, moveCaption } from '../pda/narrate.js';
import { idText, run } from '../pda/pda.js';
import { createDiagram } from './diagram.js';
import { COLORS, htmlEl, idHtml } from './format.js';

// Los textos de narrate.js escriben p_f; aquí, con subíndice.
const subs = (text) => text.replace(/([A-Za-z])_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>');
import { createIdList } from './ids.js';
import { createStack, maxStack } from './stack.js';
import { createTape } from './tape.js';
import { createTree } from './tree.js';

// Regiones por defecto dentro del cuerpo de la diapositiva (1728 × ~790 px).
export const RUN_REGIONS = {
  diagram: { x: 0, y: 0, w: 960, h: 440 },
  tape: { x: 0, y: 470, w: 960, h: 150 },
  caption: { x: 0, y: 650, w: 960, h: 110 },
  stack: { x: 990, y: 0, w: 190, h: 760 },
  ids: { x: 1200, y: 0, w: 528, h: 760 },
};

export function region(body, className, r) {
  const el = htmlEl('div', `region ${className}`, '', body);
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  return el;
}

// options: { pda, input, mode, layout, regions, diagram (uno ya creado), show: { tape, stack, ids, caption },
// idRows, idRowHeight, startHidden }. Con startHidden la cinta, la pila, las ID y el rótulo empiezan
// ocultos y el estado inicial sin marcar: reveal() los muestra (como paso de la diapositiva).
export function createRunScene(body, {
  pda, input, mode, layout, regions = {}, diagram = null, show = {}, idRows = 8, idRowHeight = 66, startHidden = false,
}) {
  const r = { ...RUN_REGIONS, ...regions };
  const parts = { tape: true, stack: true, ids: true, caption: true, ...show };
  const result = run(pda, input, mode);
  const { steps } = result;

  const dia = diagram ?? createDiagram(region(body, 'scene-diagram', r.diagram), pda, layout, { width: r.diagram.w, height: r.diagram.h });
  if (!startHidden) dia.activate(pda.start);
  const panels = [];
  const panel = (name) => {
    const el = region(body, `scene-${name}`, r[name]);
    panels.push(el);
    return el;
  };
  const capacity = Math.max(3, maxStack(steps));
  const tile = Math.min(64, Math.floor((r.stack.h - 64) / capacity));
  const tape = parts.tape ? createTape(panel('tape'), input) : null;
  const stack = parts.stack ? createStack(panel('stack'), { initial: steps[0].id.stack, capacity, tile }) : null;
  const ids = parts.ids ? createIdList(panel('ids'), pda, steps, { rows: idRows, rowHeight: idRowHeight }) : null;

  // Rótulo de cada paso (se cruzan) y veredicto.
  let captions = [];
  let verdictEl = null;
  if (parts.caption) {
    const box = panel('caption');
    captions = steps.map((step, k) => {
      const text = k === 0
        ? `Inicio: ${idHtml(step.id)}`
        : `<b>Paso ${k}</b> · ${subs(moveCaption(pda.transitions[step.transition]))}`;
      const el = htmlEl('div', 'caption', text, box);
      if (k) el.style.opacity = '0';
      return el;
    });
    const v = verdictOf(result);
    verdictEl = htmlEl('div', `verdict ${v.ok ? 'ok' : 'bad'}`, `<span class="verdict-mark">${v.ok ? '✓' : '✗'}</span><span><b>${v.title}</b> · ${subs(v.detail)}</span>`, box);
    gsap.set(verdictEl, { autoAlpha: 0, scale: 0.85, transformOrigin: '0% 50%' });
  }

  if (startHidden) gsap.set(panels, { autoAlpha: 0, y: 20 });

  return {
    result,
    diagram: dia,
    // Muestra el panel de ejecución y marca el estado inicial (con startHidden).
    reveal(tl, at) {
      tl.to(panels, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.06 }, at);
      dia.setActive(tl, at + 0.2, pda.start);
    },
    tape,
    stack,
    ids,
    count: steps.length + 1,
    // Agrega los pasos de la ejecución (desde el estado del paso actual de `stepper`).
    addRun(stepper, { verdict = true } = {}) {
      steps.slice(1).forEach((step, i) => {
        const k = i + 1;
        const tr = pda.transitions[step.transition];
        stepper.step((tl, at) => {
          if (captions.length) {
            tl.to(captions[k - 1], { opacity: 0, duration: 0.15 }, at);
            tl.to(captions[k], { opacity: 1, duration: 0.2 }, at + 0.12);
          }
          dia.fire(tl, at, step.transition);
          tape?.step(tl, at + 0.12, tr);
          stack?.apply(tl, at + 0.45, tr);
          dia.setActive(tl, at + 0.6, tr.to);
          ids?.reveal(tl, at + 0.6, k);
        });
      });
      if (!verdict) return;
      stepper.step((tl, at) => {
        dia.clearFire(tl, at);
        tape?.finish(tl, at);
        const last = steps.at(-1).id;
        dia.setActive(tl, at, last.state, result.accepted ? COLORS.ok : COLORS.bad);
        ids?.settle(tl, at, result.accepted ? COLORS.okSoft : COLORS.badSoft);
        if (verdictEl) {
          tl.to(captions.at(-1), { opacity: 0, duration: 0.15 }, at);
          tl.to(verdictEl, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'back.out(1.7)' }, at + 0.1);
        }
      });
    },
    finalText: idText(steps.at(-1).id),
  };
}

export function createTreeScene(body, { pda, input, mode, r = { x: 0, y: 0, w: 1728, h: 790 } }) {
  const tree = createTree(region(body, 'scene-tree', r), pda, input, mode, { width: r.w, height: r.h });
  return {
    tree,
    count: tree.stepCount,
    addLevels(stepper) {
      for (let depth = 1; depth <= tree.tree.depth; depth += 1) stepper.step((tl, at) => tree.revealLevel(tl, at, depth));
      stepper.step((tl, at) => tree.highlightAccepted(tl, at));
    },
  };
}
