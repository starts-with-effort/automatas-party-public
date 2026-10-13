// Piezas comunes de las diapositivas: aparecer y desaparecer con la línea de tiempo, notación con
// subíndices y regiones con posición fija dentro del cuerpo (1728 × ~790 px).
import { gsap } from '../engine/gsap.js';
import { htmlEl, symHtml } from '../views/format.js';

export { gsap, htmlEl };

// Oculta al montar (el paso que los muestra usa show()).
export function hidden(targets, { y = 24, x = 0, scale = 1 } = {}) {
  gsap.set(targets, { autoAlpha: 0, y, x, scale });
  return targets;
}

export function show(tl, at, targets, vars = {}) {
  return tl.to(targets, { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0.4, ...vars }, at);
}

export function fade(tl, at, targets, vars = {}) {
  return tl.to(targets, { autoAlpha: 0, duration: 0.25, ...vars }, at);
}

// Resaltador amarillo que se enciende y se apaga (fondo de un elemento en línea).
export function mark(tl, at, targets, on = true) {
  return tl.to(targets, { backgroundColor: on ? 'rgba(255, 201, 60, 1)' : 'rgba(255, 201, 60, 0)', duration: 0.25 }, at);
}

export function markable(targets) {
  gsap.set(targets, { backgroundColor: 'rgba(255, 201, 60, 0)' });
  return targets;
}

// Elemento con posición absoluta en el cuerpo.
export function box(parent, className, { x, y, w, h }, html = '') {
  const el = htmlEl('div', `region ${className}`, html, parent);
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px` });
  if (h !== undefined) el.style.height = `${h}px`;
  return el;
}

export const $ = (root, selector) => root.querySelector(selector);
export const $$ = (root, selector) => [...root.querySelectorAll(selector)];

// Notación: s('q0') → q₀ con <sub>; L = {aⁿbⁿ} con <sup>.
export const s = symHtml;
export const anbn = 'a<sup>n</sup>b<sup>n</sup>';
export const wwr = 'ww<sup>R</sup>';
