// Andamio de las diapositivas de los teoremas (16 y 17): el enunciado, el PDA original en su caja,
// la construcción por etapas (cada una agrega estados y arcos con un rótulo que explica) y, al
// final, la ejecución de una cadena en el PDA construido.
//
// Pasos: el inicial, uno por etapa, uno para mostrar la ejecución y los de la ejecución (movimientos
// y veredicto). Coincide con [nota inicial, notas de las etapas, ...runNotes] del manifiesto.
import { createDiagram } from '../views/diagram.js';
import { createRunScene } from '../views/scene.js';
import { $$, box, fade, hidden, show } from './common.js';

const REGIONS = {
  diagram: { x: 0, y: 92, w: 1728, h: 380 },
  tape: { x: 0, y: 492, w: 620, h: 150 },
  caption: { x: 0, y: 668, w: 820, h: 110 },
  stack: { x: 840, y: 470, w: 170, h: 320 },
  ids: { x: 1030, y: 482, w: 698, h: 308 },
};

// stages: [{ text, build(tl, at, diagram), undo?(tl, at, diagram) }]; explain0: rótulo del paso
// inicial. undo se aplica al mostrar la ejecución (p. ej. quitar un resaltado).
export function constructionSlide({ body, steps, theorem, pda, layout, explain0, stages, input, mode }) {
  box(body, 'card theorem', { x: 0, y: 0, w: 1728 }, theorem);
  const dia = createDiagram(box(body, 'scene-diagram', REGIONS.diagram), pda, layout, { width: REGIONS.diagram.w, height: REGIONS.diagram.h });
  const explain = box(body, 'explain', { x: 0, y: 520, w: 1728 }, [explain0, ...stages.map((stage) => stage.text)]
    .map((text) => `<div class="cap card">${text}</div>`).join(''));
  const caps = $$(explain, '.cap');
  hidden(caps.slice(1), { y: 30 });

  const scene = createRunScene(body, {
    pda, input, mode, diagram: dia, regions: REGIONS, idRows: 4, idRowHeight: 58, startHidden: true,
  });

  stages.forEach((stage, i) => {
    steps.step((tl, at) => {
      fade(tl, at, caps[i]);
      stage.build(tl, at, dia);
      show(tl, at + 0.3, caps[i + 1]);
    });
  });
  steps.step((tl, at) => {
    fade(tl, at, caps.at(-1));
    for (const stage of stages) stage.undo?.(tl, at, dia);
    scene.reveal(tl, at + 0.1);
  });
  scene.addRun(steps);
}
