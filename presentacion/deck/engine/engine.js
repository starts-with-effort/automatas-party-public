// Motor del proyector: monta cada diapositiva en el lienzo de 1920×1080, la lleva al paso pedido y
// anima los cambios. Un módulo de diapositiva (slides/<id>.js) exporta por defecto
//
//   mount({ el, body, steps, slide, live }) → { intro?, destroy? } (opcional)
//
// y arma sus pasos con steps.step((tl, at) => …) (ver steps.js). El título lo pone el motor a partir
// del manifiesto. intro (una línea de tiempo en pausa) es una animación de entrada que se reproduce
// al llegar a la diapositiva y se completa de golpe si se salta a ella; no debe tocar lo que animan
// los pasos.
import { escapeHtml, noteHtml, slideGroup, slideLabel } from '../ui.js';
import { gsap } from './gsap.js';
import { createSteps } from './steps.js';

export const WIDTH = 1920;
export const HEIGHT = 1080;

// Escala el lienzo a la ventana, centrado y sin deformar.
export function fitStage(stage) {
  const fit = () => {
    const scale = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
    const x = (innerWidth - WIDTH * scale) / 2;
    const y = (innerHeight - HEIGHT * scale) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  addEventListener('resize', fit);
  fit();
}

// Carga los módulos de todas las diapositivas al empezar, para que cambiar de diapositiva no espere
// la red. Si uno falla, esa diapositiva se muestra con su título y sus notas (no se cae la exposición).
export async function loadModules(slides) {
  const entries = await Promise.all(slides.map(async (slide) => {
    try {
      const module = await import(`../slides/${slide.id}.js`);
      return [slide.id, module.default];
    } catch (err) {
      console.error(`No se pudo cargar la diapositiva ${slide.id}`, err);
      return [slide.id, null];
    }
  }));
  return new Map(entries);
}

// Monta una diapositiva dentro de host. Devuelve su línea de tiempo y cuántos pasos armó. Si el
// módulo falla o arma menos pasos de los esperados, se completan con pasos vacíos para que la
// navegación siga funcionando; `error` y `count` dejan ver el problema (?print lo revisa).
export function mountSlide(host, slide, { mount, live, expected }) {
  const el = document.createElement('section');
  el.className = 'slide';
  el.dataset.id = slide.id;
  el.innerHTML = `<header class="slide-head"><h1>${escapeHtml(slide.title)}</h1></header><div class="slide-body"></div>`;
  host.append(el);
  const body = el.querySelector('.slide-body');
  const steps = createSteps();
  let instance = null;
  let error = null;
  try {
    instance = (mount ?? placeholder)({ el, body, steps, slide, live }) ?? null;
  } catch (err) {
    error = err;
    console.error(`Error al montar la diapositiva ${slide.id}`, err);
    body.innerHTML = '';
    placeholder({ el, body, steps: createSteps(), slide });
  }
  const count = steps.count;
  while (steps.count < expected) steps.step();
  return { el, tl: steps.tl, intro: instance?.intro ?? null, count, error, destroy: () => instance?.destroy?.() };
}

// Diapositiva sin módulo: las notas de cada paso aparecen una por una.
function placeholder({ body, steps, slide }) {
  body.innerHTML = `<div class="placeholder card">${slide.steps.map((note) => `<div class="ph-step">${noteHtml(note)}</div>`).join('')}</div>`;
  const items = [...body.querySelectorAll('.ph-step')];
  for (const item of items.slice(1)) {
    gsap.set(item, { autoAlpha: 0, y: 20 });
    steps.step((tl, at) => tl.to(item, { autoAlpha: 1, y: 0 }, at));
  }
}

// Pie: sección, avance y número. La barra solo cuenta las diapositivas de la exposición: en las del
// quiz y en las de respaldo queda llena. Se oculta en la portada.
export function footerHtml(slides, sections, index) {
  const slide = slides[index];
  const talk = slides.filter((s) => slideGroup(s) === 'talk');
  const progress = slideGroup(slide) === 'talk' ? (talk.indexOf(slide) + 1) / talk.length : 1;
  return `
    <span class="foot-section">${escapeHtml(sections[slide.section] ?? '')}</span>
    <span class="foot-progress"><i style="transform: scaleX(${progress})"></i></span>
    <span class="foot-num">${escapeHtml(slideLabel(slides, index))}</span>`;
}

export class DeckEngine {
  // layer: donde se montan las diapositivas. onSlide(index) avisa cada cambio de diapositiva.
  constructor({ layer, slides, modules, stepCount, reducedMotion = false, onSlide = () => {} }) {
    Object.assign(this, { layer, slides, modules, stepCount, reducedMotion, onSlide });
    this.current = null;
    this.anim = null;
    this.cleanup = null;
  }

  // target: { id, step, live }. Un paso vecino se anima; lo demás salta directo.
  show(target, { animate = true } = {}) {
    this.finish();
    const instant = !animate || this.reducedMotion;
    const cur = this.current;
    if (cur && cur.slide.id === target.id && (!cur.slide.live || sameLive(cur.live, target.live))) {
      if (cur.step === target.step) return;
      const to = `s${target.step}`;
      if (!instant && Math.abs(target.step - cur.step) === 1) {
        this.anim = cur.tl.tweenFromTo(`s${cur.step}`, to, { ease: 'none' });
        // Hacia atrás, un poco más rápido.
        if (target.step < cur.step) this.anim.timeScale(1.6);
      } else {
        cur.tl.seek(to);
      }
      cur.step = target.step;
      return;
    }

    const index = this.slides.findIndex((slide) => slide.id === target.id);
    if (index === -1) return;
    const slide = this.slides[index];
    const mounted = mountSlide(this.layer, slide, {
      mount: this.modules.get(slide.id),
      live: target.live,
      expected: this.stepCount(slide, target.live),
    });
    mounted.tl.seek(`s${target.step}`);
    this.current = { ...mounted, slide, index, step: target.step, live: target.live };
    this.onSlide(index);
    if (mounted.intro) {
      // También al cargar la página: la portada entra con su animación.
      if (this.reducedMotion || target.step > 0) mounted.intro.progress(1);
      else this.intro = mounted.intro.play();
    }
    if (!cur) return;

    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      cur.destroy();
      cur.tl.kill();
      cur.el.remove();
    };
    if (instant) return cleanup();
    // Vecinas: la nueva entra desde el lado hacia el que se avanza. Saltos: fundido.
    const dx = Math.abs(index - cur.index) === 1 ? 70 * Math.sign(index - cur.index) : 0;
    this.cleanup = cleanup;
    this.anim = gsap.timeline({ onComplete: cleanup })
      .to(cur.el, { autoAlpha: 0, x: -dx, duration: 0.25, ease: 'power1.in' }, 0)
      .fromTo(mounted.el, { autoAlpha: 0, x: dx }, { autoAlpha: 1, x: 0, duration: 0.35 }, 0.15);
  }

  // Termina de golpe lo que se esté animando (un toque nuevo nunca deja la pantalla a medias).
  finish() {
    this.intro?.progress(1);
    this.intro = null;
    const anim = this.anim;
    const cleanup = this.cleanup;
    this.anim = null;
    this.cleanup = null;
    if (anim) {
      anim.progress(1);
      anim.kill();
    }
    cleanup?.();
  }
}

function sameLive(a, b) {
  return a?.pda === b?.pda && a?.input === b?.input;
}
