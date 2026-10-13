// Línea de tiempo por pasos: una etiqueta s0, s1, … por paso. El paso 0 es como se ve la diapositiva
// al llegar; cada step() agrega las animaciones de un toque de «Siguiente».
//
// Lo que se ve depende solo del tiempo de la línea: el motor anima entre etiquetas vecinas y salta
// (seek) en lo demás. Por eso las diapositivas no usan callbacks ni crean elementos durante la
// animación: todo existe desde el montaje y solo se anima con to() (los estados iniciales van en el
// CSS o con gsap.set antes de armar los pasos).
import { gsap } from './gsap.js';

// Duración mínima de un paso, para que dos etiquetas nunca caigan en el mismo instante.
const MIN_STEP = 0.05;

export function createSteps() {
  const tl = gsap.timeline({ paused: true });
  let count = 1;
  tl.addLabel('s0', 0);
  return {
    tl,
    get count() {
      return count;
    },
    // build(tl, at): agrega las animaciones del paso a partir de `at` (el final del paso anterior).
    step(build) {
      const at = tl.duration();
      build?.(tl, at);
      if (tl.duration() < at + MIN_STEP) tl.to({}, { duration: MIN_STEP }, at);
      tl.addLabel(`s${count}`, tl.duration());
      count += 1;
    },
  };
}
