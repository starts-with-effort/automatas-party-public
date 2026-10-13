// Árbol de computación de un PDA no determinista (como la figura 6.5 de Hopcroft): la raíz es la ID
// inicial y cada hijo, un movimiento posible. Aparece nivel por nivel; las ramas que mueren se
// apagan con ✗ y su motivo; la que acepta se pone verde con ✓. Al final se resalta el camino.
import { gsap } from '../engine/gsap.js';
import { computationTree } from '../pda/pda.js';
import { deadReason } from '../pda/narrate.js';
import { COLORS, idSvg, svgEl } from './format.js';

const NODE_H = 56;
const GAP_X = 34;
const GAP_Y = 52;

export function createTree(container, pda, input, mode, { width, height } = {}) {
  const tree = computationTree(pda, input, mode);
  const svg = svgEl('svg', { class: 'pda-svg tree', width, height, preserveAspectRatio: 'xMidYMin meet' }, container);
  const edgeLayer = svgEl('g', {}, svg);
  const nodeLayer = svgEl('g', {}, svg);

  // Texto de cada nodo, para medir el ancho común.
  const els = tree.nodes.map((node) => {
    const g = svgEl('g', { class: `tnode status-${node.status}` }, nodeLayer);
    const rect = svgEl('rect', { rx: 14, class: 'tnode-box' }, g);
    const text = svgEl('text', { class: 'tnode-text', 'text-anchor': 'middle' }, g);
    text.innerHTML = idSvg(node.id);
    return { g, rect, text, w: text.getBBox().width };
  });
  const nodeW = Math.max(...els.map((e) => e.w)) + 34;

  // Hojas de izquierda a derecha en orden de recorrido; cada padre, centrado sobre sus hijos.
  const x = new Map();
  let leaf = 0;
  const place = (n) => {
    const node = tree.nodes[n];
    if (!node.children.length) {
      x.set(n, leaf * (nodeW + GAP_X));
      leaf += 1;
    } else {
      node.children.forEach(place);
      x.set(n, (x.get(node.children[0]) + x.get(node.children.at(-1))) / 2);
    }
  };
  place(0);
  const y = (node) => node.depth * (NODE_H + GAP_Y);
  const totalW = leaf * (nodeW + GAP_X) - GAP_X;
  const totalH = tree.depth * (NODE_H + GAP_Y) + NODE_H + 46;
  svg.setAttribute('viewBox', `${-nodeW / 2 - 20} -20 ${totalW + nodeW + 40} ${totalH + 30}`);

  const edges = new Map(); // hijo → línea
  for (const node of tree.nodes) {
    const e = els[node.n];
    const cx = x.get(node.n);
    const top = y(node);
    e.rect.setAttribute('x', cx - nodeW / 2);
    e.rect.setAttribute('y', top);
    e.rect.setAttribute('width', nodeW);
    e.rect.setAttribute('height', NODE_H);
    e.text.setAttribute('x', cx);
    e.text.setAttribute('y', top + NODE_H / 2 + 11);
    if (node.parent !== null) {
      const parent = tree.nodes[node.parent];
      const px = x.get(parent.n);
      const line = svgEl('path', { d: `M ${px} ${y(parent) + NODE_H} L ${cx} ${top}`, class: 'tedge' }, edgeLayer);
      const tr = pda.transitions[node.transition];
      const label = svgEl('text', { x: (px + cx) / 2 + (cx >= px ? 12 : -12), y: (y(parent) + NODE_H + top) / 2 + 8, class: 'tedge-label', 'text-anchor': cx >= px ? 'start' : 'end' }, edgeLayer);
      label.textContent = tr.read || 'ε';
      edges.set(node.n, { line, label });
      gsap.set([line, label], { autoAlpha: 0 });
    }
    if (node.status === 'dead' || node.status === 'accept' || node.status === 'cut') {
      const ok = node.status === 'accept';
      const badge = svgEl('g', { class: `tbadge ${ok ? 'ok' : 'bad'}` }, e.g);
      svgEl('circle', { cx: cx + nodeW / 2 - 4, cy: top + 4, r: 17 }, badge);
      const mark = svgEl('text', { x: cx + nodeW / 2 - 4, y: top + 13, 'text-anchor': 'middle' }, badge);
      mark.textContent = ok ? '✓' : node.status === 'cut' ? '…' : '✗';
      const why = svgEl('text', { x: cx, y: top + NODE_H + 32, 'text-anchor': 'middle', class: `treason ${ok ? 'ok' : 'bad'}` }, e.g);
      why.textContent = ok ? 'acepta' : node.status === 'cut' ? 'sigue…' : deadReason(node, mode);
      e.badge = [badge, why];
    }
    gsap.set(e.rect, { fill: COLORS.surface, stroke: COLORS.ink });
    if (node.depth > 0) {
      gsap.set(e.g, { autoAlpha: 0, y: -12 });
      if (e.badge) gsap.set(e.badge, { autoAlpha: 0 });
    } else if (e.badge) {
      // La raíz ya es una hoja (p. ej. ε en un PDA sin movimientos): su resultado se ve desde el inicio.
      gsap.set(e.rect, { fill: node.status === 'accept' ? COLORS.okSoft : COLORS.dim });
    }
  }

  return {
    tree,
    svg,
    // Pasos: uno por nivel y uno final (camino que acepta o «ninguna acepta»).
    get stepCount() {
      return tree.depth + 2;
    },
    revealLevel(tl, at, depth) {
      const level = tree.nodes.filter((node) => node.depth === depth);
      level.forEach((node, k) => {
        const e = els[node.n];
        const t = at + k * 0.06;
        tl.to([edges.get(node.n).line, edges.get(node.n).label], { autoAlpha: 1, duration: 0.25 }, t);
        tl.to(e.g, { autoAlpha: 1, y: 0, duration: 0.3 }, t + 0.1);
      });
      const settle = at + level.length * 0.06 + 0.4;
      // Las hojas nuevas muestran su resultado.
      for (const node of level) {
        const e = els[node.n];
        if (!e.badge) continue;
        tl.to(e.badge, { autoAlpha: 1, duration: 0.25 }, settle);
        if (node.status === 'accept') tl.to(e.rect, { fill: COLORS.okSoft, stroke: COLORS.ok, duration: 0.3 }, settle);
        else tl.to(e.rect, { fill: COLORS.dim, duration: 0.3 }, settle);
        if (node.status === 'dead') tl.to(e.text, { opacity: 0.55, duration: 0.3 }, settle);
      }
    },
    // Resalta el camino de la raíz a la primera hoja que acepta.
    highlightAccepted(tl, at) {
      const accept = tree.nodes.find((node) => node.status === 'accept');
      if (!accept) return;
      for (let n = accept.n; n !== null; n = tree.nodes[n].parent) {
        const e = els[n];
        tl.to(e.rect, { stroke: COLORS.pink, strokeWidth: 6, duration: 0.3 }, at);
        if (edges.has(n)) tl.to(edges.get(n).line, { stroke: COLORS.pink, strokeWidth: 7, duration: 0.3 }, at);
      }
    },
  };
}
