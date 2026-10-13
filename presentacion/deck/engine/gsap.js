// Punto único de entrada a GSAP. El servidor lo sirve desde node_modules en /vendor/gsap: no depende
// de un CDN y funciona sin internet. MotionPath mueve la ficha por los arcos del diagrama.
import { gsap } from '/vendor/gsap/index.js';
import { MotionPathPlugin } from '/vendor/gsap/MotionPathPlugin.js';

gsap.registerPlugin(MotionPathPlugin);
gsap.defaults({ duration: 0.45, ease: 'power2.out' });

export { gsap };
