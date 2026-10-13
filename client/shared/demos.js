// Demos de los minijuegos para las instrucciones (rediseño, fase 5): una animación en bucle por
// minijuego, hecha con las mismas piezas del juego (cartas, cinta, pájaro, tubos, jefe). Son solo
// dibujo local: no usan la red ni el reloj del servidor. Todas en SVG con un lienzo de 430 × 250,
// así escalan igual en el celular y en el proyector. Con «reducir movimiento» queda un cuadro fijo.
import { birdSvg } from './flappy-draw.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 430;
const H = 250;
const INK = '#1c1640';
const SUN = '#ffc93c';
const PINK = '#ff4f8b';
const PAPER = '#efebff';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function s(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  parent?.append(el);
  return el;
}

// Monta la demo del minijuego `id` en un recuadro. colors: colores de los equipos de la partida.
export function minigameDemo(id, colors = []) {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'demo-svg', 'aria-hidden': 'true' });
  const palette = colors.length >= 6 ? colors : ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#7048e8', '#c2255c'];
  const tick = (DEMOS[id] ?? DEMOS.memoria)(svg, palette);
  const box = document.createElement('div');
  box.className = 'demo-box';
  const tag = document.createElement('span');
  tag.className = 'demo-tag';
  tag.textContent = 'Así se juega';
  box.append(svg, tag);
  if (still()) {
    tick(2600);
    return box;
  }
  const t0 = performance.now();
  let attached = false;
  const frame = (now) => {
    if (box.isConnected) attached = true;
    else if (attached) return; // la pantalla cambió: se detiene
    tick(now - t0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return box;
}

// ------------------------------------------------------------------ Memoria
function memoria(svg) {
  const faces = ['δ', 'Σ', 'ε', 'Γ', 'δ', 'λ', '⊢', 'Σ', '∅', 'q₀', 'ε', '★'];
  const cw = 86;
  const ch = 58;
  const gap = 10;
  const x0 = (W - (4 * cw + 3 * gap)) / 2;
  const y0 = 44;
  s('rect', { width: W, height: H, fill: '#ffffff' }, svg);
  const score = s('text', { x: W - 14, y: 28, 'text-anchor': 'end', class: 'demo-display', 'font-size': 15, fill: INK }, svg);
  const cards = faces.map((face, i) => {
    const cx = x0 + (i % 4) * (cw + gap) + cw / 2;
    const cy = y0 + Math.floor(i / 4) * (ch + gap) + ch / 2;
    const outer = s('g', { transform: `translate(${cx} ${cy})` }, svg);
    const ring = s('rect', { x: -cw / 2 - 5, y: -ch / 2 - 5, width: cw + 10, height: ch + 10, rx: 13, fill: 'none', 'stroke-width': 5 }, outer);
    const card = s('g', {}, outer);
    s('rect', { x: -cw / 2, y: -ch / 2 + 3, width: cw, height: ch, rx: 10, fill: INK }, card);
    const body = s('rect', { x: -cw / 2, y: -ch / 2, width: cw, height: ch, rx: 10, stroke: INK, 'stroke-width': 2.5 }, card);
    const mark = s('g', {}, card);
    s('circle', { r: 11, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.5 }, mark);
    s('circle', { r: 6, fill: 'none', stroke: '#ffffff', 'stroke-width': 2.5 }, mark);
    const glyph = s('text', { y: 9, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 26, fill: INK }, card);
    glyph.textContent = face;
    return { outer, ring, card, body, mark, glyph };
  });
  // [ms, carta, qué pasa]
  const STEPS = [[600, 0, 'up'], [1300, 4, 'up'], [1750, -1, 'match'], [2700, -1, 'gone'], [3500, 1, 'up'], [4200, 10, 'up'], [4600, -1, 'miss'], [5600, -1, 'down']];
  return (t) => {
    t %= 7200;
    const state = cards.map(() => ({ up: 0, ring: null, gone: false }));
    let pairs = 0;
    for (const [at, i, what] of STEPS) {
      if (t < at) break;
      if (what === 'up') state[i].up = at;
      if (what === 'match') { for (const k of [0, 4]) state[k].ring = '#3ccf6e'; pairs = 1; }
      if (what === 'gone') { for (const k of [0, 4]) { state[k].gone = true; state[k].ring = null; } }
      if (what === 'miss') { for (const k of [1, 10]) state[k].ring = '#e8384f'; }
      if (what === 'down') { for (const k of [1, 10]) { state[k].up = -at; state[k].ring = null; } }
    }
    score.textContent = `Grupo 1 · ${pairs} ${pairs === 1 ? 'pareja' : 'parejas'}`;
    cards.forEach((c, i) => {
      const st = state[i];
      // Volteo de 450 ms: se achica en x, cambia de cara y vuelve.
      let p = 0;
      if (st.up > 0) p = Math.min(1, (t - st.up) / 450);
      else if (st.up < 0) p = 1 - Math.min(1, (t + st.up) / 450);
      const sx = Math.abs(Math.cos(p * Math.PI)) || 0.02;
      const front = p >= 0.5;
      c.card.setAttribute('transform', `scale(${sx.toFixed(3)} 1)`);
      c.body.setAttribute('fill', front ? '#ffffff' : PINK);
      c.mark.setAttribute('opacity', front ? 0 : 1);
      c.glyph.setAttribute('opacity', front ? 1 : 0);
      c.ring.setAttribute('stroke', st.ring ?? 'none');
      c.outer.setAttribute('opacity', st.gone ? 0.18 : 1);
    });
  };
}

// ------------------------------------------------------------------ Traza a ciegas
// Arriba, la cadena (sin marca de avance) y lo que dicta su dueño; abajo, los estados del autómata:
// el amarillo avanza con cada toque, también en los pasos ε (que no leen nada).
function traza(svg, colors) {
  const word = 'aabb0110';
  const trace = [['q0', 'a'], ['q0', 'a'], ['q1', 'b'], ['q1', 'b'], ['q2', 'ε'], ['q2', '0'], ['q2', '1'], ['q3', 'ε'], ['q3', '1'], ['q3', '0'], ['q4', 'ε']];
  const names = ['q0', 'q1', 'q2', 'q3', 'q4'];
  const cx = (i) => 55 + i * 80;
  const cy = 182;
  const r = 23;
  s('rect', { width: W, height: H, fill: '#ffffff' }, svg);
  const cw = 28;
  const tx = 40;
  word.split('').forEach((c, i) => {
    s('rect', { x: tx + i * cw, y: 26, width: cw, height: 38, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
    const t = s('text', { x: tx + i * cw + cw / 2, y: 53, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 20, fill: INK }, svg);
    t.textContent = c;
  });
  const bubble = s('g', { transform: `translate(${tx + word.length * cw + 22} 20)` }, svg);
  s('rect', { x: 0, y: 0, width: 116, height: 46, rx: 12, fill: SUN, stroke: INK, 'stroke-width': 2.5 }, bubble);
  s('path', { d: 'M0 22 L-12 30 L2 32', fill: SUN, stroke: INK, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, bubble);
  const say = s('text', { x: 58, y: 30, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 18, fill: INK }, bubble);
  for (let i = 0; i < names.length - 1; i += 1) {
    s('path', { d: `M${cx(i) + r} ${cy} H${cx(i + 1) - r - 9}`, stroke: INK, 'stroke-width': 2.5 }, svg);
    s('path', { d: `M${cx(i + 1) - r} ${cy} l-10 -6 v12 z`, fill: INK }, svg);
  }
  const bodies = names.map((name, i) => {
    const body = s('circle', { cx: cx(i), cy, r, fill: '#ffffff', stroke: INK, 'stroke-width': 3 }, svg);
    if (i === names.length - 1) s('circle', { cx: cx(i), cy, r: r - 5, fill: 'none', stroke: INK, 'stroke-width': 2 }, svg);
    const label = s('text', { x: cx(i), y: cy + 6, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 17, fill: INK }, svg);
    label.textContent = `q${'₀₁₂₃₄'[i]}`;
    return body;
  });
  const touch = s('circle', { r: r + 9, fill: 'none', stroke: colors[1], 'stroke-width': 4, opacity: 0 }, svg);
  const caption = s('text', { x: W / 2, y: 236, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: INK }, svg);
  const step = 800;
  return (t) => {
    t = Math.max(0, t) % (trace.length * step + 1600); // el primer cuadro puede llegar con t < 0
    const done = Math.min(trace.length, Math.floor(t / step));
    const current = done === 0 ? 'q0' : trace[done - 1][0];
    bodies.forEach((body, i) => body.setAttribute('fill', names[i] === current ? SUN : '#ffffff'));
    const next = trace[done];
    say.textContent = next ? (next[1] === 'ε' ? 'ε: no avanzo' : `«${next[1]}»`) : '¡Aceptada!';
    const f = (t % step) / step;
    const tapped = done > 0 && done <= trace.length && f < 0.45;
    touch.setAttribute('opacity', tapped ? (1 - f / 0.45).toFixed(2) : 0);
    touch.setAttribute('cx', cx(names.indexOf(current)));
    touch.setAttribute('cy', cy);
    caption.textContent = next ? `Toque ${done + 1} de ${trace.length}` : 'Leyó toda la cadena y q₄ es final';
  };
}

// ------------------------------------------------------------------ Flappy
function flappy(svg, colors) {
  const GROUND = 16;
  const gaps = [0.42, 0.62, 0.36, 0.55, 0.3, 0.5];
  const SP = 150; // separación de los tubos
  const V = 70; // avance por segundo
  const G = 92; // alto del hueco
  const PW = 36;
  const BX = 114; // centro del pájaro
  s('rect', { width: W, height: H, fill: '#dff0ff' }, svg);
  const pipes = gaps.map(() => {
    const g = s('g', {}, svg);
    const top = s('rect', { y: -4, width: PW, rx: 5, fill: '#2fb36b', stroke: INK, 'stroke-width': 2.5 }, g);
    const bottom = s('rect', { width: PW, rx: 5, fill: '#2fb36b', stroke: INK, 'stroke-width': 2.5 }, g);
    return { g, top, bottom };
  });
  s('rect', { y: H - GROUND, width: W, height: GROUND, fill: SUN }, svg);
  s('path', { d: `M0 ${H - GROUND}H${W}`, stroke: INK, 'stroke-width': 2.5 }, svg);
  const bird = s('g', {}, svg);
  bird.innerHTML = birdSvg(colors[0]);
  const inner = bird.firstElementChild;
  inner.setAttribute('width', 44);
  inner.setAttribute('height', 31);
  inner.setAttribute('x', -22);
  inner.setAttribute('y', -15.5);
  const span = gaps.length * SP;
  const gapY = (index) => gaps[((index % gaps.length) + gaps.length) % gaps.length] * (H - GROUND);
  return (t) => {
    const scroll = (t / 1000) * V;
    pipes.forEach((pipe, i) => {
      let x = i * SP + 240 - (scroll % span);
      if (x < -60) x += span;
      const gy = gaps[i] * (H - GROUND);
      pipe.g.setAttribute('transform', `translate(${x.toFixed(1)} 0)`);
      pipe.top.setAttribute('height', Math.max(0, gy - G / 2 + 4).toFixed(1));
      pipe.bottom.setAttribute('y', (gy + G / 2).toFixed(1));
      pipe.bottom.setAttribute('height', Math.max(0, H - GROUND - gy - G / 2 + 3).toFixed(1));
    });
    // El pájaro sigue los huecos: pasa cada tubo a su altura y cambia de altura entre tubos.
    const wx = scroll + BX - 240 - PW / 2;
    const i0 = Math.floor(wx / SP);
    const f = wx / SP - i0;
    const g0 = gapY(i0);
    const g1 = gapY(i0 + 1);
    const u = Math.min(1, Math.max(0, (f - 0.28) / 0.44));
    const ease = (1 - Math.cos(u * Math.PI)) / 2;
    const y = g0 + (g1 - g0) * ease + Math.sin(t / 140) * 3;
    const tilt = Math.max(-18, Math.min(22, (g1 - g0) * 0.15 * Math.sin(u * Math.PI) + Math.cos(t / 140) * 6));
    bird.setAttribute('transform', `translate(${BX} ${y.toFixed(1)}) rotate(${tilt.toFixed(1)})`);
  };
}

// ------------------------------------------------------------------ Alimenta el Autómata (Clicker)
function clicker(svg) {
  const CELLS = 9;
  const CW = 30;
  const tx = (W - CELLS * CW) / 2;
  const ty = 44;
  s('rect', { width: W, height: H, fill: '#ffffff' }, svg);
  const count = s('text', { x: W / 2, y: 26, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 15, fill: INK }, svg);
  const cells = Array.from({ length: CELLS }, (_, i) => {
    const r = s('rect', { x: tx + i * CW, y: ty, width: CW, height: 32, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
    const label = s('text', { x: tx + i * CW + CW / 2, y: ty + 23, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 17, fill: INK }, svg);
    return { r, label };
  });
  const head = s('path', { fill: PINK, stroke: INK, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, svg);
  const button = s('g', {}, svg);
  s('circle', { cy: 7, r: 58, fill: INK }, button);
  s('circle', { r: 58, fill: PAPER, stroke: INK, 'stroke-width': 4 }, button);
  s('circle', { r: 46, fill: '#ffffff', stroke: INK, 'stroke-width': 4 }, button);
  const state = s('text', { y: 10, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 28, fill: INK }, button);
  const fly = Array.from({ length: 6 }, () => s('text', { 'text-anchor': 'middle', class: 'demo-display', 'font-size': 20, fill: INK, opacity: 0 }, svg));
  const BX = W / 2;
  const BY = 172;
  const TAP = 160;
  return (t) => {
    t %= 9000;
    const taps = Math.floor(t / TAP);
    const total = 140 + taps;
    const filled = taps % CELLS;
    count.textContent = `Grupo 2 · ${total} clics`;
    cells.forEach((c, i) => {
      c.r.setAttribute('fill', i < filled ? '#fff6d6' : '#ffffff');
      c.label.textContent = i < filled ? String((i * 7 + taps) % 2) : '';
    });
    const hx = tx + (filled + 0.5) * CW;
    head.setAttribute('d', `M${hx - 8} ${ty - 14} H${hx + 8} L${hx} ${ty - 2} Z`);
    state.textContent = `q${Math.floor(total / 50)}`;
    // Cada toque hunde el botón; al cambiar de estado, rebota.
    const sinceTap = t - taps * TAP;
    const press = sinceTap < 80 ? 0.95 : 1;
    const sinceState = (total % 50) * TAP + sinceTap;
    const bounce = sinceState < 420 ? 1 + 0.18 * Math.sin((sinceState / 420) * Math.PI) : 1;
    button.setAttribute('transform', `translate(${BX} ${BY + (press < 1 ? 4 : 0)}) scale(${(press * bounce).toFixed(3)})`);
    // Los últimos símbolos vuelan del botón a la cinta.
    fly.forEach((el, k) => {
      const tap = taps - k;
      const age = t - tap * TAP;
      if (tap < 0 || age > 380) { el.setAttribute('opacity', 0); return; }
      const cell = ((tap % CELLS) + CELLS) % CELLS;
      const p = age / 380;
      const x = BX + (tx + (cell + 0.5) * CW - BX) * p;
      const y = BY - 60 + (ty + 20 - (BY - 60)) * p * p;
      el.textContent = String(tap % 2);
      el.setAttribute('x', x.toFixed(1));
      el.setAttribute('y', y.toFixed(1));
      el.setAttribute('opacity', (1 - p * 0.8).toFixed(2));
    });
  };
}

// ------------------------------------------------------------------ Arena
// El tema «El Autómata»: el jefe es un estado final con su estado adentro y su pila arriba; los
// retadores, estados con una flecha de transición. En el ciclo, un retador toma una caja δ (Estado
// trampa), congela al jefe con su disparo, la pila se vacía y el jefe pasa de q₀ a q₁ y a q₂.
const ICE = '#5cc8ff';

function snowflake(parent, size) {
  const g = s('g', { 'stroke-linecap': 'round' }, parent);
  for (const [color, width] of [[INK, size * 0.18], [ICE, size * 0.08]]) {
    let d = '';
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3;
      const c = Math.cos(a);
      const n = Math.sin(a);
      const bx = c * size * 0.26;
      const by = n * size * 0.26;
      d += `M0 0L${(c * size * 0.42).toFixed(1)} ${(n * size * 0.42).toFixed(1)}`;
      for (const k of [-0.7, 0.7]) d += `M${bx.toFixed(1)} ${by.toFixed(1)}L${(bx + Math.cos(a + k) * size * 0.13).toFixed(1)} ${(by + Math.sin(a + k) * size * 0.13).toFixed(1)}`;
    }
    s('path', { d, stroke: color, 'stroke-width': width, fill: 'none' }, g);
  }
  return g;
}

function stateText(parent, x, y, size, n) {
  const text = s('text', { x, y: y + size * 0.32, 'text-anchor': 'middle', class: 'demo-display', 'font-size': size, fill: INK }, parent);
  text.textContent = 'q';
  const sub = s('tspan', { 'font-size': size * 0.62, dy: size * 0.22 }, text);
  sub.textContent = String(n);
  return sub;
}

function arena(svg, colors) {
  s('rect', { width: W, height: H, fill: '#fdfcff' }, svg);
  const minor = s('g', { stroke: 'rgba(52,81,209,.09)', 'stroke-width': 1 }, svg);
  for (let x = 0; x <= W; x += 12) s('path', { d: `M${x} 0V${H}` }, minor);
  for (let y = 0; y <= H; y += 12) s('path', { d: `M0 ${y}H${W}` }, minor);
  const major = s('g', { stroke: 'rgba(52,81,209,.2)', 'stroke-width': 1.2 }, svg);
  for (let x = 0; x <= W; x += 60) s('path', { d: `M${x} 0V${H}` }, major);
  for (let y = 0; y <= H; y += 60) s('path', { d: `M0 ${y}H${W}` }, major);
  // Un trozo de cinta y un estado de cartón.
  s('rect', { x: 330, y: 64, width: 72, height: 24, fill: INK }, svg);
  s('rect', { x: 330, y: 60, width: 72, height: 24, fill: '#fff', stroke: INK, 'stroke-width': 2.5 }, svg);
  ['a', 'b', 'X'].forEach((sym, i) => {
    if (i > 0) s('path', { d: `M${330 + i * 24} 60V84`, stroke: INK, 'stroke-width': 1.5 }, svg);
    const t = s('text', { x: 342 + i * 24, y: 78, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 14, fill: i === 0 ? PINK : INK }, svg);
    t.textContent = sym;
  });
  s('circle', { cx: 52, cy: 82, r: 19, fill: INK }, svg);
  s('circle', { cx: 52, cy: 78, r: 19, fill: '#fff', stroke: INK, 'stroke-width': 2.5 }, svg);
  s('circle', { cx: 52, cy: 78, r: 14.5, fill: 'none', stroke: INK, 'stroke-width': 1.3 }, svg);
  stateText(svg, 52, 78, 15, 3);

  const bossColor = colors[3];
  const others = [colors[0], colors[1], colors[2], colors[4], colors[5]];
  // Caja de poder (δ) con el copo de Estado trampa.
  const PAD = [92, 196];
  const pad = s('g', { transform: `translate(${PAD[0]} ${PAD[1]})` }, svg);
  s('rect', { x: -13, y: -10, width: 26, height: 26, rx: 5, fill: INK }, pad);
  s('rect', { x: -13, y: -13, width: 26, height: 26, rx: 5, fill: '#ffe0ec', stroke: INK, 'stroke-width': 2.2 }, pad);
  snowflake(pad, 19);
  const delta = s('text', { x: -13, y: -10, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 900, fill: PINK, stroke: '#fff', 'stroke-width': 3, 'paint-order': 'stroke' }, pad);
  delta.textContent = 'δ';

  const bulletLayer = s('g', {}, svg);
  const bullets = Array.from({ length: 40 }, () => s('circle', { r: 4, stroke: INK, 'stroke-width': 2, opacity: 0 }, bulletLayer));
  const bossShots = Array.from({ length: 6 }, () => s('rect', { width: 9, height: 9, x: -4.5, y: -4.5, fill: PINK, stroke: INK, 'stroke-width': 1.8, opacity: 0 }, bulletLayer));
  const challengers = others.map((color, i) => {
    const g = s('g', {}, svg);
    s('circle', { cy: 2.5, r: 11, fill: INK }, g);
    const arrow = s('g', {}, g);
    s('path', { d: 'M9 0H16', stroke: INK, 'stroke-width': 4, 'stroke-linecap': 'round' }, arrow);
    s('path', { d: 'M22 0L15 -5L15 5Z', fill: INK }, arrow);
    s('circle', { r: 11, fill: color, stroke: INK, 'stroke-width': 2.5 }, g);
    const badge = i === 0 ? s('g', { transform: 'translate(11 -11)', opacity: 0 }, g) : null;
    if (badge) {
      s('circle', { r: 7.5, fill: '#fff', stroke: INK, 'stroke-width': 1.8 }, badge);
      snowflake(badge, 11);
    }
    return { g, arrow, badge };
  });
  const boss = s('g', {}, svg);
  const bossArrow = s('g', {}, boss);
  s('path', { d: 'M26 0H44', stroke: INK, 'stroke-width': 9, 'stroke-linecap': 'round' }, bossArrow);
  s('path', { d: 'M56 0L41 -12L41 12Z', fill: INK }, bossArrow);
  s('circle', { cy: 4, r: 30, fill: INK }, boss);
  s('circle', { r: 30, fill: bossColor, stroke: INK, 'stroke-width': 3 }, boss);
  const inner = s('circle', { r: 21.5, fill: '#fff', stroke: INK, 'stroke-width': 2.5 }, boss);
  const stageDigit = stateText(boss, 0, 0, 21, 0);
  s('path', { d: 'M-9 -36 A11 11 0 1 1 9 -36', fill: 'none', stroke: INK, 'stroke-width': 2.5 }, boss);
  s('path', { d: 'M13 -33L6 -39L5 -30Z', fill: INK }, boss);
  const ice = s('g', { opacity: 0 }, boss);
  s('circle', { r: 33, fill: 'rgba(140,215,255,.55)', stroke: '#1b7fc0', 'stroke-width': 3 }, ice);
  snowflake(ice, 28);
  const ring = s('circle', { r: 30, fill: 'none', stroke: SUN, 'stroke-width': 6, opacity: 0 }, svg);

  // Pila del jefe, arriba: Z₀ y 10 celdas; el tope en amarillo.
  const label = s('text', { x: W / 2, y: 18, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 13, fill: INK }, svg);
  label.textContent = 'Pila del jefe';
  const PX = W / 2 - 78;
  s('rect', { x: PX - 2, y: 24, width: 160, height: 18, fill: INK }, svg);
  s('rect', { x: PX, y: 26, width: 24, height: 14, fill: '#e8e3ff' }, svg);
  const z = s('text', { x: PX + 12, y: 37.5, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 11, fill: INK }, svg);
  z.textContent = 'Z';
  s('tspan', { 'font-size': 8, dy: 2.5 }, z).textContent = '0';
  const cells = Array.from({ length: 10 }, (_, k) => s('rect', { x: PX + 25 + k * 13, y: 26, width: 12, height: 14 }, svg));

  return (t) => {
    const cycle = t % 12000;
    const filled = Math.max(2, 10 - Math.floor(cycle / 1100));
    cells.forEach((cell, k) => cell.setAttribute('fill', k < filled ? (k === filled - 1 ? SUN : bossColor) : '#ffffff'));
    const stage = filled <= 3 ? 2 : filled <= 6 ? 1 : 0;
    stageDigit.textContent = String(stage);
    inner.setAttribute('fill', ['#ffffff', SUN, PINK][stage]);
    const frozen = cycle > 5200 && cycle < 6400;
    ice.setAttribute('opacity', frozen ? 1 : 0);
    // Congelado, el jefe queda quieto: su movimiento usa un reloj que se detiene.
    const bt = cycle < 5200 ? t : cycle < 6400 ? t - (cycle - 5200) : t - 1200;
    const bx = W / 2 + Math.sin(bt / 1900) * 26;
    const by = H / 2 + 18 + Math.cos(bt / 2300) * 12;
    boss.setAttribute('transform', `translate(${bx.toFixed(1)} ${by.toFixed(1)})`);
    // Aro del cambio de estado.
    const changes = [1100 * 4, 1100 * 7];
    const since = Math.min(...changes.map((c) => (cycle >= c ? cycle - c : Infinity)));
    if (since < 800) {
      const p = since / 800;
      ring.setAttribute('cx', bx.toFixed(1));
      ring.setAttribute('cy', by.toFixed(1));
      ring.setAttribute('r', (32 + p * 40).toFixed(1));
      ring.setAttribute('stroke', ['#ffffff', SUN, PINK][stage]);
      ring.setAttribute('opacity', (1 - p).toFixed(2));
    } else ring.setAttribute('opacity', 0);

    const pos = others.map((_, i) => {
      const a = t / (2600 + i * 300) + (i * Math.PI * 2) / others.length;
      return [bx + Math.cos(a) * W * 0.36, by + Math.sin(a) * H * 0.29];
    });
    // El retador 0 va por la caja (1,4 a 3 s) y vuelve (3 a 4,4 s).
    const go = cycle < 1400 ? 0 : cycle < 3000 ? (cycle - 1400) / 1600 : cycle < 4400 ? 1 - (cycle - 3000) / 1400 : 0;
    const ease = go * go * (3 - 2 * go);
    pos[0] = [pos[0][0] + (PAD[0] - pos[0][0]) * ease, pos[0][1] + (PAD[1] - pos[0][1]) * ease];
    pad.setAttribute('opacity', cycle < 3000 ? 1 : 0);
    challengers.forEach(({ g, arrow, badge }, i) => {
      g.setAttribute('transform', `translate(${pos[i][0].toFixed(1)} ${pos[i][1].toFixed(1)})`);
      arrow.setAttribute('transform', `rotate(${((Math.atan2(by - pos[i][1], bx - pos[i][0]) * 180) / Math.PI).toFixed(1)})`);
      badge?.setAttribute('opacity', cycle >= 3000 && cycle < 9000 ? 1 : 0);
    });
    // Balas: cada retador dispara al jefe; el jefe responde con celdas en abanico (no congelado).
    let used = 0;
    for (let k = 0; k < 6; k += 1) {
      const shot = Math.floor(t / 260) - k;
      if (shot < 0) continue;
      const age = t - shot * 260;
      const i = shot % others.length;
      if (i === 0 && go > 0) continue;
      const [sx, sy] = pos[i];
      const dist = Math.hypot(bx - sx, by - sy);
      const p = (age * 0.32) / dist;
      if (p < 0.85 && used < bullets.length) {
        const b = bullets[used++];
        b.setAttribute('cx', (sx + (bx - sx) * p).toFixed(1));
        b.setAttribute('cy', (sy + (by - sy) * p).toFixed(1));
        b.setAttribute('r', 3.5);
        b.setAttribute('fill', others[i]);
        b.setAttribute('opacity', 1);
      }
    }
    for (let k = used; k < bullets.length; k += 1) bullets[k].setAttribute('opacity', 0);
    let shots = 0;
    for (let k = 0; k < 2 && !frozen; k += 1) {
      const shot = Math.floor(t / 800) - k;
      if (shot < 0) continue;
      const age = t - shot * 800;
      const [tx, ty] = pos[shot % others.length];
      const a0 = Math.atan2(ty - by, tx - bx);
      if (k === 0) bossArrow.setAttribute('transform', `rotate(${((a0 * 180) / Math.PI).toFixed(1)})`);
      for (const spread of [-0.25, 0, 0.25]) {
        const d = 34 + age * 0.22;
        if (d < 190 && shots < bossShots.length) {
          const sq = bossShots[shots++];
          sq.setAttribute('transform', `translate(${(bx + Math.cos(a0 + spread) * d).toFixed(1)} ${(by + Math.sin(a0 + spread) * d).toFixed(1)}) rotate(23)`);
          sq.setAttribute('opacity', 1);
        }
      }
    }
    for (let k = shots; k < bossShots.length; k += 1) bossShots[k].setAttribute('opacity', 0);
  };
}

// ------------------------------------------------------------------ Taller: Sé la pila
// El autómata lee «ab»: arriba la cinta con el cabezal y la transición que aplica, a la derecha la
// pila, y abajo las cuatro respuestas; en cada paso se enciende la que toca.
function taller1(svg, colors) {
  const steps = [
    { head: 0, stack: ['Z₀'], key: 0, rule: 'a, Z₀ / AZ₀' },
    { head: 1, stack: ['A', 'Z₀'], key: 1, rule: 'b, A / ε' },
    { head: 2, stack: ['Z₀'], key: 2, rule: 'ε, Z₀ / Z₀' },
    { head: 2, stack: ['Z₀'], key: 3, rule: 'ninguna aplica' },
  ];
  const keys = ['+ Apilar', '− Sacar', '= Queda igual', '■ Se detiene'];
  s('rect', { width: W, height: H, fill: '#ffffff' }, svg);
  const cw = 40;
  const tx = 60;
  const cells = ['a', 'b', 'fin'].map((c, i) => {
    const box = s('rect', { x: tx + i * cw, y: 66, width: cw, height: 44, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
    const t = s('text', { x: tx + i * cw + cw / 2, y: c === 'fin' ? 93 : 97, 'text-anchor': 'middle', class: c === 'fin' ? '' : 'demo-display', 'font-size': c === 'fin' ? 11 : 24, 'font-weight': 900, fill: INK }, svg);
    t.textContent = c;
    return { box, t };
  });
  const head = s('path', { d: 'M-9 0 H9 L0 12 Z', fill: PINK }, svg);
  const rule = s('text', { x: tx, y: 140, 'font-size': 15, 'font-weight': 800, fill: INK }, svg);
  const sx = 300;
  const title = s('text', { x: sx + 35, y: 44, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 900, fill: '#5d5785', 'letter-spacing': 1.2 }, svg);
  title.textContent = 'PILA';
  const slots = [0, 1].map((i) => {
    const box = s('rect', { x: sx, y: 52 + i * 38, width: 70, height: 38, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
    const t = s('text', { x: sx + 35, y: 78 + i * 38, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 19, fill: INK }, svg);
    return { box, t };
  });
  const kw = 96;
  const pads = keys.map((text, i) => {
    const box = s('rect', { x: 14 + i * (kw + 6), y: 172, width: kw, height: 38, rx: 10, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
    const t = s('text', { x: 14 + i * (kw + 6) + kw / 2, y: 196, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 13, fill: INK }, svg);
    t.textContent = text;
    return box;
  });
  const touch = s('rect', { width: kw + 12, height: 50, rx: 14, fill: 'none', stroke: colors[1], 'stroke-width': 4, opacity: 0 }, svg);
  const caption = s('text', { x: W / 2, y: 236, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: INK }, svg);
  const step = 1300;
  return (t) => {
    t = Math.max(0, t) % (steps.length * step + 2200); // el primer cuadro puede llegar con t < 0
    const n = Math.min(steps.length, Math.floor(t / step));
    const ended = n === steps.length;
    const now = steps[Math.min(n, steps.length - 1)];
    cells.forEach(({ box, t: text }, i) => {
      box.setAttribute('fill', i < now.head ? '#e9e6f5' : i === now.head ? '#fff3c4' : '#ffffff');
      text.setAttribute('fill', i < now.head ? '#a9a3c9' : INK);
    });
    head.setAttribute('transform', `translate(${tx + now.head * cw + cw / 2} 50)`);
    rule.textContent = ended ? 'Se detuvo en q₂ con todo leído.' : `En este paso: ${now.rule}`;
    // La pila se dibuja de arriba hacia abajo; con un solo símbolo, el de arriba queda vacío.
    const shown = now.stack.length === 2 ? now.stack : [null, now.stack[0]];
    slots.forEach(({ box, t: text }, i) => {
      box.setAttribute('opacity', shown[i] ? 1 : 0);
      box.setAttribute('fill', shown[i] && (i === 0 || !shown[0]) ? SUN : '#ffffff');
      text.textContent = shown[i] ?? '';
    });
    const f = (t % step) / step;
    const pressing = !ended && f > 0.45;
    pads.forEach((box, i) => box.setAttribute('fill', pressing && i === now.key ? SUN : '#ffffff'));
    touch.setAttribute('x', 14 + now.key * (kw + 6) - 6);
    touch.setAttribute('y', 166);
    touch.setAttribute('opacity', pressing ? Math.max(0, 1 - (f - 0.45) / 0.5).toFixed(2) : 0);
    caption.textContent = ended ? '¿Acepta? Sí: leyó todo y q₂ es final' : `Toque ${n + 1} de ${steps.length}`;
  };
}

// ------------------------------------------------------------------ Taller: Repara el autómata
// A la izquierda, el estado con el arco punteado que falta; a la derecha, las fichas que se van
// poniendo; abajo, una cadena de prueba que pasa de rojo a verde cuando la transición queda armada.
function taller2(svg) {
  const rows = [['LEE', ['a', 'b', 'ε'], 1], ['TOPE', ['A', 'Z₀'], 0], ['DEJA', ['ε', 'A', 'AA'], 0]];
  s('rect', { width: W, height: H, fill: '#ffffff' }, svg);
  const cx = 78;
  const cy = 96;
  const loop = s('path', { d: `M${cx + 24} ${cy - 14} C${cx + 70} ${cy - 44} ${cx + 70} ${cy + 44} ${cx + 30} ${cy + 15}`, fill: 'none', stroke: '#c8175d', 'stroke-width': 3 }, svg);
  s('path', { d: `M${cx + 23} ${cy + 15} l13 -5 l-2 13 z`, fill: '#c8175d' }, svg);
  s('circle', { cx: cx + 3, cy: cy + 3.5, r: 28, fill: INK }, svg);
  s('circle', { cx, cy, r: 28, fill: SUN, stroke: INK, 'stroke-width': 3 }, svg);
  const name = s('text', { x: cx, y: cy + 7, 'text-anchor': 'middle', class: 'demo-display', 'font-size': 20, fill: INK }, svg);
  name.textContent = 'q₁';
  const label = s('text', { x: cx - 30, y: cy + 62, 'font-size': 17, 'font-weight': 900, fill: '#c8175d' }, svg);
  const chips = rows.map(([caption, options], r) => {
    const y = 34 + r * 44;
    const cap = s('text', { x: 200, y: y + 22, 'font-size': 11, 'font-weight': 900, fill: '#5d5785', 'letter-spacing': 1 }, svg);
    cap.textContent = caption;
    return options.map((text, i) => {
      const box = s('rect', { x: 246 + i * 58, y, width: 52, height: 34, rx: 9, fill: '#ffffff', stroke: INK, 'stroke-width': 2.5 }, svg);
      const t = s('text', { x: 246 + i * 58 + 26, y: y + 23, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 900, fill: INK }, svg);
      t.textContent = text;
      return box;
    });
  });
  const test = s('rect', { x: 150, y: 182, width: 130, height: 36, rx: 18, stroke: INK, 'stroke-width': 2.5 }, svg);
  const word = s('text', { x: 196, y: 206, 'text-anchor': 'middle', 'font-size': 16, 'font-weight': 900, fill: INK }, svg);
  word.textContent = 'aabb';
  const dot = s('circle', { cx: 254, cy: 200, r: 11 }, svg);
  const mark = s('text', { x: 254, y: 205, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 900, fill: '#ffffff' }, svg);
  const caption = s('text', { x: W / 2, y: 240, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: INK }, svg);
  const step = 1100;
  return (t) => {
    t = Math.max(0, t) % (4 * step + 2200); // el primer cuadro puede llegar con t < 0
    const placed = Math.min(3, Math.floor(t / step));
    const part = (r) => (r < placed ? rows[r][1][rows[r][2]] : '?');
    label.textContent = `${part(0)}, ${part(1)} / ${part(2)}`;
    loop.setAttribute('stroke-dasharray', placed === 3 ? 'none' : '7 6');
    chips.forEach((row, r) => row.forEach((box, i) => box.setAttribute('fill', r < placed && i === rows[r][2] ? PINK : '#ffffff')));
    const fixed = placed === 3;
    test.setAttribute('fill', fixed ? '#d9f7e6' : '#ffe3e6');
    dot.setAttribute('fill', fixed ? '#128a52' : '#e8384f');
    mark.textContent = fixed ? '✓' : '✗';
    caption.textContent = fixed ? 'Las pruebas en verde: ¡reparado!' : placed === 0 ? 'Falta una transición: la prueba está en rojo' : `Ficha ${placed} de 3`;
  };
}

const DEMOS = { memoria, traza, flappy, clicker, arena, taller1, taller2 };
