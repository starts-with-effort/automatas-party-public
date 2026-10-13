// Pila: fichas de cartón apiladas desde abajo, con una flecha «tope» a la izquierda de la de arriba.
// Una transición reemplaza el tope X por γ. Si γ termina en X (apilar), X se queda y solo caen las
// fichas nuevas; si no, X sale volando y caen las de γ. Todas las fichas se crean al montar.
import { gsap } from '../engine/gsap.js';
import { htmlEl, symHtml } from './format.js';

export function tileClass(symbol) {
  return `tile tile-${/^[A-Za-z0-9]+$/.test(symbol) ? symbol : 'other'}`;
}

// initial: símbolos del tope hacia el fondo (como en una ID).
export function createStack(container, { initial = ['Z0'], capacity = 6, tile = 64, width = 168, label = 'Pila' } = {}) {
  const root = htmlEl('div', 'stack-view', '', container);
  root.style.setProperty('--tile', `${tile}px`);
  root.style.setProperty('--tile-w', `${width}px`);
  const well = htmlEl('div', 'stack-well', '', root);
  well.style.height = `${capacity * tile + 12}px`;
  const marker = htmlEl('div', 'stack-top', 'tope ▸', well);
  const empty = htmlEl('div', 'stack-empty', 'pila vacía', well);
  htmlEl('div', 'stack-label', label, root);

  const items = []; // del fondo al tope: { symbol, el }
  const place = (el, slot) => {
    el.style.bottom = `${slot * tile + 6}px`;
  };
  const addTile = (symbol, visible) => {
    const el = htmlEl('div', tileClass(symbol), `<span>${symHtml(symbol)}</span>`, well);
    place(el, items.length);
    if (!visible) gsap.set(el, { autoAlpha: 0, y: -110 });
    items.push({ symbol, el });
    return el;
  };
  [...initial].reverse().forEach((symbol) => addTile(symbol, true));
  const markerY = () => -Math.max(0, items.length - 1) * tile;
  gsap.set(marker, { y: markerY(), autoAlpha: items.length ? 1 : 0 });
  gsap.set(empty, { autoAlpha: items.length ? 0 : 1 });

  const api = {
    root,
    get symbols() {
      return items.map((item) => item.symbol).reverse();
    },
    // Reemplaza el tope por push (push[0] queda arriba).
    replace(tl, at, push) {
      const top = items.at(-1);
      const wasEmpty = items.length === 0;
      let t = at;
      let fresh;
      if (top && push.length && push.at(-1) === top.symbol) {
        fresh = push.slice(0, -1);
        if (!fresh.length) tl.to(top.el, { y: -10, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.out' }, at);
      } else {
        if (top) {
          items.pop();
          tl.to(top.el, { autoAlpha: 0, y: -90, x: 60, rotation: 12, duration: 0.3, ease: 'power1.in' }, at);
          t = at + 0.18;
        }
        fresh = push;
      }
      [...fresh].reverse().forEach((symbol, k) => {
        const el = addTile(symbol, false);
        tl.to(el, { autoAlpha: 1, y: 0, duration: 0.38, ease: 'back.out(1.6)' }, t + k * 0.12);
      });
      const end = t + fresh.length * 0.12;
      tl.to(marker, { y: markerY(), autoAlpha: items.length ? 1 : 0, duration: 0.3 }, end);
      if (wasEmpty !== (items.length === 0)) tl.to(empty, { autoAlpha: items.length ? 0 : 1, duration: 0.25 }, end);
      return end + 0.3;
    },
    // Una transición del PDA.
    apply(tl, at, tr) {
      return api.replace(tl, at, tr.push);
    },
  };
  return api;
}

// Altura máxima de la pila en una ejecución (para dimensionar la vista).
export function maxStack(steps) {
  return Math.max(...steps.map((step) => step.id.stack.length));
}
