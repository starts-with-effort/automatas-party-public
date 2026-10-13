// Dibujo del Flappy con el tema de cartón de party.css: contorno de tinta, colores planos y sombra
// dura. Solo dibuja: la física y las colisiones están en flappy-physics.js. Todo se mide en
// unidades del mundo (alto 100) y se escala con k = píxeles por unidad.
import { BIRD_X, HEIGHT, VIEW_WIDTH } from './flappy-physics.js';

const INK = '#1c1640';
const SUN = '#ffc93c';
const SKY = '#dff0ff';
const CLOUD = '#ffffff';
const CLOUD_EDGE = '#b8c6ef';
const HILL = '#cfc6f7';
const HILL_EDGE = '#b2a6ec';
const PIPE = '#2fb36b';
const PIPE_LIGHT = '#8fe6b2';
const PIPE_DARK = '#128a52';
const GROUND_DARK = '#e9a91f';
const CRASHED = '#a9a3c9';

const CLOUDS = [{ x: 10, y: 16, s: 1 }, { x: 52, y: 30, s: 0.75 }, { x: 88, y: 12, s: 0.9 }, { x: 120, y: 24, s: 0.65 }];
const CLOUD_SPAN = 150; // las nubes se repiten cada tanto (paralaje 0,25)
const HILL_SPAN = 34; // las colinas, cada tanto (paralaje 0,5)
const GROUND_H = 1.8;
const CAP_H = 3; // alto de la boquilla del tubo
const PIPE_INSET = 0.7; // el cuerpo del tubo es algo más angosto que la boquilla y la zona de choque

export const FLAP_MS = 240; // lo que dura el movimiento del ala tras aletear
export const PUFF_MS = 420; // lo que duran las plumitas que quedan detrás
const WING_REST = -0.15; // ángulo del ala; positivo levanta la punta
const WING_KEYS = [[0, WING_REST], [0.25, 1.0], [0.65, -0.8], [1, WING_REST]];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (a, n) => ((a % n) + n) % n;
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}
// Cuerpo del color del equipo; ala y cola más oscuras; pecho más claro.
const shades = (color) => ({ body: color, dark: mix(color, INK, 0.28), light: mix(color, '#ffffff', 0.55) });

// Inclinación del cuerpo según la velocidad vertical: mira arriba al subir y abajo al caer.
export const tiltFor = (vy) => clamp(vy * 0.33, -0.45, 0.85);
export const CRASH_TILT = 1.3;

// Ángulo del ala. `t` es la fracción del aleteo en curso (0 a 1; fuera de ese rango no hay aleteo).
export function wingAngle(t, vy, idle, now) {
  if (t >= 0 && t < 1) {
    for (let i = 1; i < WING_KEYS.length; i += 1) {
      const [t0, a0] = WING_KEYS[i - 1];
      const [t1, a1] = WING_KEYS[i];
      if (t > t1) continue;
      const u = (t - t0) / (t1 - t0);
      return a0 + (a1 - a0) * u * u * (3 - 2 * u);
    }
  }
  if (idle) return WING_REST + 0.45 * Math.sin(now / 85); // revoloteo mientras flota antes de empezar
  return WING_REST + clamp(vy, 0, 2.2) * 0.18; // al caer abre un poco el ala: planea
}

// Unión de círculos con contorno: primero todos los trazos (al doble de ancho), luego los rellenos.
function blob(ctx, circles, fill, edge, lw) {
  ctx.lineWidth = lw * 2;
  ctx.strokeStyle = edge;
  for (const [x, y, r] of circles) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  for (const [x, y, r] of circles) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// Pájaro centrado en (cx, cy) píxeles, mirando a la derecha. Mide unas 3,3 unidades de radio.
export function drawBird(ctx, cx, cy, k, { color, tilt = 0, wing = WING_REST, crashed = false, lw }) {
  const { body, dark, light } = shades(crashed ? CRASHED : color);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(k, k);
  ctx.lineWidth = lw / k;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  // Cola.
  ctx.beginPath();
  ctx.moveTo(-2.4, -0.7);
  ctx.lineTo(-4.5, -1.8);
  ctx.lineTo(-4.0, 0.1);
  ctx.lineTo(-4.6, 1.5);
  ctx.lineTo(-2.4, 0.9);
  ctx.closePath();
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.stroke();
  // Cuerpo y pecho.
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.3, 3.0, 0, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(0.9, 1.9, 2.5, 1.6, -0.2, 0, Math.PI * 2);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, 0, 3.3, 3.0, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Pico.
  ctx.beginPath();
  ctx.moveTo(2.6, -0.6);
  ctx.lineTo(4.7, 0.25);
  ctx.lineTo(2.7, 1.0);
  ctx.closePath();
  ctx.fillStyle = SUN;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(2.9, 0.25);
  ctx.lineTo(4.3, 0.25);
  ctx.stroke();
  // Ojo (una X al chocar).
  ctx.beginPath();
  ctx.arc(1.35, -1.05, 1.15, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  if (crashed) {
    ctx.moveTo(0.95, -1.45);
    ctx.lineTo(1.75, -0.65);
    ctx.moveTo(1.75, -1.45);
    ctx.lineTo(0.95, -0.65);
    ctx.stroke();
  } else {
    ctx.arc(1.72, -1.0, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  // Ala: gira sobre su raíz.
  ctx.translate(-0.4, 0.5);
  ctx.rotate(wing);
  ctx.beginPath();
  ctx.ellipse(-1.35, 0, 1.95, 1.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-0.4, 0.15);
  ctx.lineTo(-2.2, 0.15);
  ctx.stroke();
  ctx.restore();
}

// Un tramo de tubo de `top` a `bottom` (píxeles) con la boquilla del lado del hueco. La boquilla
// mide exactamente el ancho de la zona de choque y el cuerpo un poco menos: nada se dibuja fuera.
function drawPipe(ctx, k, left, width, top, bottom, capAtBottom, lw) {
  const capH = CAP_H * k;
  const bodyTop = capAtBottom ? top : top + capH;
  const bodyBottom = capAtBottom ? bottom - capH : bottom;
  const bx = left + PIPE_INSET * k;
  const bw = width - 2 * PIPE_INSET * k;
  const bh = bodyBottom - bodyTop;
  ctx.fillStyle = PIPE;
  ctx.fillRect(bx, bodyTop, bw, bh);
  ctx.fillStyle = PIPE_LIGHT;
  ctx.fillRect(bx + 0.9 * k, bodyTop, 1.1 * k, bh);
  ctx.fillStyle = PIPE_DARK;
  ctx.fillRect(bx + bw - 1.9 * k, bodyTop, 1.9 * k, bh);
  ctx.fillStyle = 'rgba(28, 22, 64, 0.22)'; // sombra dura junto a la boquilla
  ctx.fillRect(bx, capAtBottom ? bodyBottom - 0.9 * k : bodyTop, bw, 0.9 * k);
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.strokeRect(bx, bodyTop, bw, bh);

  const capY = capAtBottom ? bottom - capH : top;
  roundRect(ctx, left, capY, width, capH, 0.6 * k);
  ctx.fillStyle = PIPE;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = PIPE_LIGHT;
  ctx.fillRect(left + 1.2 * k, capY, 1.2 * k, capH);
  ctx.fillStyle = PIPE_DARK;
  ctx.fillRect(left + width - 2.1 * k, capY, 2.1 * k, capH);
  ctx.restore();
  roundRect(ctx, left, capY, width, capH, 0.6 * k);
  ctx.stroke();
}

// Escena completa. f = { level, firstPipe, x, y, team, tilt, wing, crashed, faded, puffs, now }:
// x e y son la posición del pájaro ya interpolada; puffs son las plumitas { x, y, s, born }.
export function drawScene(ctx, width, height, f) {
  const k = height / HEIGHT;
  const cam = f.x - BIRD_X;
  const lw = Math.max(1.5, 0.5 * k);
  const { level } = f;
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, width, height);

  // Fondo: nubes y colinas que avanzan más despacio que los tubos.
  for (const c of CLOUDS) {
    const x = (mod(c.x - cam * 0.25, CLOUD_SPAN) - 25) * k;
    const y = c.y * k;
    const s = c.s * k;
    blob(ctx, [[x, y, 3.2 * s], [x + 4 * s, y - 1.5 * s, 4 * s], [x + 8.5 * s, y, 3.4 * s], [x + 4.5 * s, y + 1.2 * s, 3 * s]],
      CLOUD, CLOUD_EDGE, lw * 0.6);
  }
  const hills = [];
  for (let i = -1; i * HILL_SPAN < VIEW_WIDTH + HILL_SPAN; i += 1) {
    const x = (mod(-cam * 0.5, HILL_SPAN) + i * HILL_SPAN) * k;
    hills.push([x, (HEIGHT + 6) * k, 13 * k], [x + 17 * k, (HEIGHT + 9) * k, 11 * k]);
  }
  blob(ctx, hills, HILL, HILL_EDGE, lw * 0.6);

  // Meta: franja a cuadros.
  const finishX = (level.length - cam) * k;
  if (finishX < width) {
    const cell = 2.5 * k;
    for (let row = 0; row * cell < height; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        ctx.fillStyle = (row + col) % 2 ? INK : '#fff';
        ctx.fillRect(finishX + col * cell, row * cell, cell, cell);
      }
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.strokeRect(finishX, -lw, 2 * cell, height + 2 * lw);
  }

  // Tubos visibles.
  const pipeWidth = level.physics.pipeWidth * k;
  for (let i = f.firstPipe; i < level.pipes.length; i += 1) {
    const pipe = level.pipes[i];
    if (pipe.x > cam + VIEW_WIDTH) break;
    const left = (pipe.x - cam) * k;
    drawPipe(ctx, k, left, pipeWidth, -2 * lw, (pipe.gapY - pipe.gap / 2) * k, true, lw);
    drawPipe(ctx, k, left, pipeWidth, (pipe.gapY + pipe.gap / 2) * k, height + 2 * lw, false, lw);
  }

  // Suelo con franjas que avanzan.
  const groundY = (HEIGHT - GROUND_H) * k;
  ctx.fillStyle = SUN;
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.fillStyle = GROUND_DARK;
  for (let x = -(mod(cam, 4) + 4) * k; x < width + 4 * k; x += 4 * k) {
    ctx.beginPath();
    ctx.moveTo(x, height);
    ctx.lineTo(x + 1.6 * k, groundY);
    ctx.lineTo(x + 3.2 * k, groundY);
    ctx.lineTo(x + 1.6 * k, height);
    ctx.fill();
  }
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();

  // Plumitas del aleteo: quedan quietas en el mundo, así que se alejan con el avance.
  for (const puff of f.puffs) {
    const u = (f.now - puff.born) / PUFF_MS;
    if (u < 0 || u >= 1) continue;
    ctx.globalAlpha = 1 - u;
    ctx.beginPath();
    ctx.arc((puff.x - cam) * k, (puff.y + u * 1.5) * k, (0.5 + u * 1.1) * puff.s * k, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = lw * 0.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Avance: barra fina arriba.
  const bar = 1.1 * k;
  ctx.fillStyle = 'rgba(28, 22, 64, 0.18)';
  ctx.fillRect(0, 0, width, bar);
  ctx.fillStyle = f.team;
  ctx.fillRect(0, 0, (width * f.x) / level.length, bar);
  ctx.fillStyle = INK;
  ctx.fillRect(0, bar, width, Math.max(1, lw * 0.5));

  // Pájaro: parpadea mientras es invulnerable (con más de una vida).
  ctx.globalAlpha = f.faded ? 0.4 : 1;
  drawBird(ctx, BIRD_X * k, f.y * k, k, { color: f.team, tilt: f.tilt, wing: f.wing, crashed: f.crashed, lw });
  ctx.globalAlpha = 1;
}

// El mismo pájaro en SVG, para los carriles del proyector y del host y las demos. crashed: el pájaro
// caído (gris, con el ojo en X y de cabeza), como en el celular al chocar.
export function birdSvg(color, { crashed = false } = {}) {
  const { body, dark, light } = shades(crashed ? CRASHED : color);
  const eye = crashed
    ? `<circle cx="1.35" cy="-1.05" r="1.15" fill="#fff"/><path d="M0.85,-1.55 L1.85,-0.55 M1.85,-1.55 L0.85,-0.55" fill="none" stroke-width="0.45" stroke-linecap="round"/>`
    : `<circle cx="1.35" cy="-1.05" r="1.15" fill="#fff"/><circle cx="1.72" cy="-1" r="0.5" fill="${INK}" stroke="none"/>`;
  return `<svg viewBox="-5.4 -3.8 10.8 7.6" aria-hidden="true"><g stroke="${INK}" stroke-width="0.55" stroke-linejoin="round"${crashed ? ' transform="rotate(160)"' : ''}>`
    + `<path d="M-2.4,-0.7 L-4.5,-1.8 L-4,0.1 L-4.6,1.5 L-2.4,0.9Z" fill="${dark}"/>`
    + `<ellipse rx="3.3" ry="3" fill="${body}"/>`
    + `<path d="M-1.4,2.2 Q0.9,0.4 3.1,1.6 Q1.6,3.1 -0.2,2.95Z" fill="${light}" stroke="none"/>`
    + '<ellipse rx="3.3" ry="3" fill="none"/>'
    + `<path d="M2.6,-0.6 L4.7,0.25 L2.7,1Z" fill="${SUN}"/>${eye}`
    + `<ellipse cx="-1.75" cy="0.5" rx="1.95" ry="1.1" transform="rotate(-8 -0.4 0.5)" fill="${dark}"/></g></svg>`;
}
