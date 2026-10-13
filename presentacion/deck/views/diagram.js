// Diagrama de estados de un PDA en SVG, con el tema de cartón: estados con contorno grueso y sombra
// dura, doble círculo en los finales, flecha de inicio y una línea de rótulo por transición
// («a, Z₀ / AZ₀»). Todas las animaciones se agregan a la línea de tiempo de la diapositiva.
//
// layout = {
//   width, height,                       tamaño natural (el SVG se escala a su caja)
//   states: { q0: [x, y], … },
//   edges: { 'q0>q0': { loop: 'up' }, 'q0>q1': { bend: 0, label: 'below', lines: [...] } },
//   initial: 'left' | 'up' | 'down',     de dónde llega la flecha de inicio
//   boxes: [{ states: [...], label: 'P_N', pad }],
//   hidden: { states: [...], edges: [...], boxes: [...], initial: true },
// }
// lines (opcional) reemplaza los rótulos de un arco: [{ text: 'ε, {Y} / ε', items: [índices] }].
import { gsap } from '../engine/gsap.js';
import { COLORS, richSvg, svgEl, symSvg, transitionSvg } from './format.js';

const R = 46;
const ARROW = 20;
const LINE = 40;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const perp = (u) => [u[1], -u[0]];
const fmt = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const dirOf = (angle) => [Math.cos(angle), Math.sin(angle)];
const ANGLES = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 };

function edgeGeometry(A, B, cfg, hasReverse) {
  if (A === B) return loopGeometry(A, cfg);
  const u = unit(sub(B, A));
  const bend = cfg.bend ?? (hasReverse ? 56 : 0);
  if (!bend) {
    const start = add(A, mul(u, R));
    const end = sub(B, mul(u, R));
    const base = sub(end, mul(u, ARROW));
    return { d: `M ${fmt(start)} L ${fmt(base)}`, end, tangent: u, apex: mul(add(start, end), 0.5), normal: perp(u) };
  }
  const n = perp(u);
  const control = add(mul(add(A, B), 0.5), mul(n, 2 * bend));
  const start = add(A, mul(unit(sub(control, A)), R));
  const end = add(B, mul(unit(sub(control, B)), R));
  const tangent = unit(sub(end, control));
  const base = sub(end, mul(tangent, ARROW));
  const apex = add(add(mul(start, 0.25), mul(control, 0.5)), mul(end, 0.25));
  return { d: `M ${fmt(start)} Q ${fmt(control)} ${fmt(base)}`, end, tangent, apex, normal: mul(n, Math.sign(bend)) };
}

function loopGeometry(C, cfg) {
  const angle = ANGLES[cfg.loop ?? 'up'];
  const spread = 0.45;
  const p0 = add(C, mul(dirOf(angle - spread), R));
  const p3 = add(C, mul(dirOf(angle + spread), R));
  const p1 = add(C, mul(dirOf(angle - 0.62), R * 2.9));
  const p2 = add(C, mul(dirOf(angle + 0.62), R * 2.9));
  const tangent = unit(sub(p3, p2));
  const base = sub(p3, mul(tangent, ARROW));
  const apex = add(add(mul(p0, 0.125), mul(p1, 0.375)), add(mul(p2, 0.375), mul(p3, 0.125)));
  return { d: `M ${fmt(p0)} C ${fmt(p1)} ${fmt(p2)} ${fmt(base)}`, end: p3, tangent, apex, normal: dirOf(angle) };
}

function arrowPoints(tip, tangent) {
  const base = sub(tip, mul(tangent, ARROW));
  const side = mul(perp(tangent), 11);
  return [tip, add(base, side), sub(base, side)].map(fmt).join(' ');
}

export function createDiagram(container, pda, layout, { width = layout.width, height = layout.height } = {}) {
  const svg = svgEl('svg', {
    class: 'pda-svg diagram',
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width,
    height,
    preserveAspectRatio: 'xMidYMid meet',
  }, container);
  const layers = Object.fromEntries(['boxes', 'edges', 'states', 'labels', 'token'].map((name) => [name, svgEl('g', { class: `layer-${name}` }, svg)]));
  const pos = (name) => layout.states[name];
  const hidden = layout.hidden ?? {};

  // ------------------------------------------------ cajas (un PDA dentro de una construcción)
  const boxes = (layout.boxes ?? []).map((box, i) => {
    const points = box.states.map(pos);
    const pad = box.pad ?? 110;
    const x0 = Math.min(...points.map((p) => p[0])) - pad;
    const x1 = Math.max(...points.map((p) => p[0])) + pad;
    const y0 = Math.min(...points.map((p) => p[1])) - (box.padTop ?? pad);
    const y1 = Math.max(...points.map((p) => p[1])) + (box.padBottom ?? pad);
    const g = svgEl('g', { class: 'box' }, layers.boxes);
    svgEl('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 28 }, g);
    const label = svgEl('text', { x: x0 + 22, y: y0 + 44, class: 'box-label' }, g);
    label.innerHTML = richSvg(box.label);
    if (hidden.boxes?.includes(i)) setHidden(g);
    return g;
  });

  // ------------------------------------------------ arcos
  const groups = new Map();
  pda.transitions.forEach((tr, index) => {
    const key = `${tr.from}>${tr.to}`;
    if (!groups.has(key)) groups.set(key, { key, from: tr.from, to: tr.to, items: [] });
    groups.get(key).items.push(index);
  });
  const lineOf = new Map(); // índice de transición → línea de rótulo
  const edgeOf = new Map(); // índice de transición → arco
  const edges = new Map();
  for (const group of groups.values()) {
    const cfg = layout.edges?.[group.key] ?? {};
    const geo = edgeGeometry(pos(group.from), pos(group.to), cfg, groups.has(`${group.to}>${group.from}`) && group.from !== group.to);
    const path = svgEl('path', { d: geo.d, class: 'edge' }, layers.edges);
    const arrow = svgEl('polygon', { points: arrowPoints(geo.end, geo.tangent), class: 'arrow' }, layers.edges);
    const specs = cfg.lines ?? group.items.map((i) => ({ html: transitionSvg(pda.transitions[i]), items: [i] }));
    const labels = svgEl('g', { class: 'edge-labels' }, layers.labels);
    const lines = placeLabels(labels, specs, geo, cfg);
    const edge = { ...group, path, arrow, labels, lines, d: geo.d };
    lines.forEach((line) => line.items.forEach((i) => {
      lineOf.set(i, line);
      edgeOf.set(i, edge);
    }));
    group.items.forEach((i) => edgeOf.set(i, edge));
    edges.set(group.key, edge);
    if (hidden.edges?.includes(group.key)) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      setHidden(arrow);
      setHidden(labels);
    }
  }

  // ------------------------------------------------ estados
  const states = new Map();
  for (const name of pda.states) {
    const [x, y] = pos(name);
    const g = svgEl('g', { class: 'state', 'data-state': name }, layers.states);
    svgEl('circle', { cx: x, cy: y + 6, r: R, class: 'state-shadow' }, g);
    const ring = svgEl('circle', { cx: x, cy: y, r: R + 14, class: 'state-ring' }, g);
    const circle = svgEl('circle', { cx: x, cy: y, r: R, class: 'state-circle' }, g);
    if (pda.final.includes(name)) svgEl('circle', { cx: x, cy: y, r: R - 9, class: 'state-inner' }, g);
    const text = svgEl('text', { x, y: y + 13, class: 'state-name' }, g);
    text.innerHTML = symSvg(name);
    gsap.set(ring, { opacity: 0 });
    gsap.set(circle, { fill: COLORS.surface });
    states.set(name, { g, circle, ring });
    if (hidden.states?.includes(name)) setHidden(g, true);
  }

  // ------------------------------------------------ flecha de inicio
  const initial = svgEl('g', { class: 'initial' }, layers.edges);
  {
    const dir = { left: [-1, 0], up: [0, -1], down: [0, 1] }[layout.initial ?? 'left'];
    const c = pos(pda.start);
    const tip = add(c, mul(dir, R));
    const from = add(c, mul(dir, R + 92));
    const tangent = mul(dir, -1);
    svgEl('path', { d: `M ${fmt(from)} L ${fmt(sub(tip, mul(tangent, ARROW)))}`, class: 'edge' }, initial);
    svgEl('polygon', { points: arrowPoints(tip, tangent), class: 'arrow' }, initial);
    const label = svgEl('text', { x: from[0] + (dir[0] ? 4 : 14), y: from[1] - 14, class: 'initial-label' }, initial);
    label.textContent = 'inicio';
    if (hidden.initial) setHidden(initial);
  }

  // Ficha que recorre el arco de cada transición.
  const token = svgEl('circle', { cx: 0, cy: 0, r: 13, class: 'token' }, layers.token);
  gsap.set(token, { autoAlpha: 0 });

  let active = null;
  let lit = null;

  const api = {
    svg,
    edges,
    states,
    boxes,
    initial,
    // Estado actual al montar (sin animación).
    activate(name) {
      if (active) gsap.set(states.get(active).circle, { fill: COLORS.surface });
      active = name;
      if (name) gsap.set(states.get(name).circle, { fill: COLORS.sun });
    },
    setActive(tl, at, name, color = COLORS.sun) {
      if (active === name && color === COLORS.sun) return;
      if (active) tl.to(states.get(active).circle, { fill: COLORS.surface, duration: 0.25 }, at);
      active = name;
      if (name) tl.to(states.get(name).circle, { fill: color, duration: 0.25 }, at);
    },
    // Ilumina la transición i (arco y su línea de rótulo) y lleva la ficha por el arco. Devuelve
    // cuándo termina.
    fire(tl, at, i, { travel = 0.55 } = {}) {
      api.clearFire(tl, at);
      const edge = edgeOf.get(i);
      const line = lineOf.get(i);
      tl.to(edge.path, { stroke: COLORS.pink, duration: 0.15 }, at);
      tl.to(edge.arrow, { fill: COLORS.pink, duration: 0.15 }, at);
      if (line) tl.to(line.mark, { opacity: 1, duration: 0.15 }, at);
      tl.to(token, { autoAlpha: 1, duration: 0.08 }, at + 0.1);
      tl.to(token, { motionPath: { path: edge.d }, duration: travel, ease: 'power1.inOut' }, at + 0.1);
      tl.to(token, { autoAlpha: 0, duration: 0.08 }, at + 0.1 + travel);
      lit = { edge, line };
      return at + 0.18 + travel;
    },
    clearFire(tl, at) {
      if (!lit) return;
      tl.to(lit.edge.path, { stroke: COLORS.ink, duration: 0.15 }, at);
      tl.to(lit.edge.arrow, { fill: COLORS.ink, duration: 0.15 }, at);
      if (lit.line) tl.to(lit.line.mark, { opacity: 0, duration: 0.15 }, at);
      lit = null;
    },
    // Aparece un estado, un arco (se dibuja) o una caja ocultos al montar.
    showState(tl, at, name) {
      tl.to(states.get(name).g, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'back.out(1.8)', transformOrigin: '50% 50%' }, at);
    },
    showEdge(tl, at, key) {
      const edge = edges.get(key);
      tl.to(edge.path, { strokeDashoffset: 0, duration: 0.45, ease: 'power1.inOut' }, at);
      tl.to(edge.arrow, { autoAlpha: 1, duration: 0.15 }, at + 0.4);
      tl.to(edge.labels, { autoAlpha: 1, duration: 0.3 }, at + 0.3);
    },
    showBox(tl, at, i) {
      tl.to(boxes[i], { autoAlpha: 1, duration: 0.35 }, at);
    },
    showInitial(tl, at) {
      tl.to(initial, { autoAlpha: 1, duration: 0.3 }, at);
    },
    // Anillo rosado alrededor de estados (para señalar Q, q₀, F…).
    ring(tl, at, names, on = true) {
      for (const name of names) tl.to(states.get(name).ring, { opacity: on ? 1 : 0, duration: 0.25 }, at);
    },
    // Marca una línea de rótulo (sin la ficha).
    mark(tl, at, i, on = true) {
      const line = lineOf.get(i);
      if (line) tl.to(line.mark, { opacity: on ? 1 : 0, duration: 0.2 }, at);
    },
  };
  return api;
}

// Rótulos de un arco: una línea por transición, apiladas lejos del arco. Detrás de cada una, un
// resaltador amarillo que se enciende cuando se usa esa transición.
function placeLabels(group, specs, geo, cfg) {
  const normal = cfg.label === 'below' ? [0, 1] : cfg.label === 'above' ? [0, -1] : geo.normal;
  const gap = cfg.gap ?? 16;
  const anchor = add(add(geo.apex, mul(normal, gap)), [cfg.dx ?? 0, cfg.dy ?? 0]);
  const sideways = Math.abs(normal[0]) > Math.abs(normal[1]);
  const textAnchor = sideways ? (normal[0] > 0 ? 'start' : 'end') : 'middle';
  const n = specs.length;
  let firstBaseline;
  if (sideways) firstBaseline = anchor[1] - ((n - 1) * LINE) / 2 + 11;
  else if (normal[1] < 0) firstBaseline = anchor[1] - (n - 1) * LINE - 4;
  else firstBaseline = anchor[1] + 26;
  return specs.map((spec, k) => {
    const mark = svgEl('rect', { class: 'label-mark', rx: 8 }, group);
    const text = svgEl('text', { x: anchor[0], y: firstBaseline + k * LINE, 'text-anchor': textAnchor, class: 'edge-label' }, group);
    text.innerHTML = spec.html ?? richSvg(spec.text);
    const box = text.getBBox();
    for (const [name, value] of Object.entries({ x: box.x - 7, y: box.y - 2, width: box.width + 14, height: box.height + 4 })) mark.setAttribute(name, value);
    gsap.set(mark, { opacity: 0 });
    return { text, mark, items: spec.items };
  });
}

function setHidden(el, scale = false) {
  gsap.set(el, scale ? { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 50%' } : { autoAlpha: 0 });
}
