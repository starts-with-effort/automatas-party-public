// Dibujo de la Arena con el tema «El Autómata» (fase B de docs/ARENA.md), en canvas: piso de papel
// cuadriculado, obstáculos de cinta y estados de cartón, el jefe como estado final con su pila, los
// retadores como estados chicos con una flecha de transición por cañón, las cajas de poder como
// rótulos de transición (δ), los íconos de los seis poderes y los efectos. Lo usan el celular, el
// proyector y el host (arena.js). Colores de la exposición: amarillo = estado actual, rosado = lo
// que golpea, celeste = congelado.
export const INK = '#1c1640';
export const SUN = '#ffc93c';
export const PINK = '#ff4f8b';
export const ICE = '#5cc8ff';
export const PAPER = '#fdfcff';
export const OUTSIDE = '#d9d1f6';
const Z0 = '#e8e3ff'; // fondo de la pila
const GRID_MINOR = 'rgba(52, 81, 209, 0.09)';
const GRID_MAJOR = 'rgba(52, 81, 209, 0.2)';
const SHIELD = 'rgba(64, 196, 255, 0.8)';
const DISPLAY = '"Lilita One", Nunito, system-ui, sans-serif';
// Relleno del centro del jefe según su estado: q₀ blanco, q₁ amarillo, q₂ (furia) rosado.
export const STAGE_FILLS = ['#ffffff', SUN, PINK, PINK];
// Símbolos de los trozos de cinta (fijos por obstáculo y celda, para que no cambien entre cuadros).
const SYMBOLS = ['a', 'b', 'X', '0', '1', 'b', 'a', 'Z'];
export const PILA_CELLS = 10; // la pila del jefe se dibuja en 10 celdas (cada una, un 10 % de su vida)

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Celdas llenas de la pila con `hp` de `max` (una celda mientras quede algo de vida).
export const pilaFilled = (hp, max) => (hp <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((PILA_CELLS * hp) / max)));

// «q» con su número como subíndice, centrado en (x, y). La fuente de la app no trae los subíndices
// de Unicode: el número va dibujado más chico y más abajo.
export function stateLabel(ctx, n, x, y, size, fill = INK) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${DISPLAY}`;
  const wq = ctx.measureText('q').width;
  ctx.font = `${Math.round(size * 0.62)}px ${DISPLAY}`;
  const wd = ctx.measureText(String(n)).width;
  const left = x - (wq + wd) / 2;
  ctx.fillStyle = fill;
  ctx.font = `${size}px ${DISPLAY}`;
  ctx.fillText('q', left, y - size * 0.06);
  ctx.font = `${Math.round(size * 0.62)}px ${DISPLAY}`;
  ctx.fillText(String(n), left + wq * 0.96, y + size * 0.2);
}

// Ícono de un poder, centrado en (x, y), de lado s.
export function powerIcon(ctx, id, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  const lw = Math.max(1, s * 0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (id === 'freeze') {
    // Copo de nieve: Estado trampa.
    for (const [color, width] of [[INK, lw * 2.6], [ICE, lw * 1.2]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (let i = 0; i < 6; i += 1) {
        const a = (i * Math.PI) / 3;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(c * s * 0.42, sn * s * 0.42);
        const bx = c * s * 0.26;
        const by = sn * s * 0.26;
        for (const d of [-0.7, 0.7]) {
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(a + d) * s * 0.13, by + Math.sin(a + d) * s * 0.13);
        }
        ctx.stroke();
      }
    }
  } else if (id === 'blast') {
    // Estallido: Desbordamiento.
    ctx.beginPath();
    for (let i = 0; i < 18; i += 1) {
      const r = (i % 2 ? 0.22 : 0.46) * s;
      const a = (i * Math.PI) / 9 - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = SUN;
    ctx.fill();
    ctx.lineWidth = lw * 1.3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    circle(ctx, 0, 0, s * 0.13);
    ctx.fillStyle = PINK;
    ctx.fill();
    ctx.stroke();
  } else if (id === 'double') {
    // Dos celdas apiladas: Apilar doble.
    const cw = s * 0.5;
    const ch = s * 0.3;
    for (const [dy, fill] of [[0.04, PINK], [-0.3, SUN]]) {
      ctx.fillStyle = fill;
      ctx.fillRect(-cw / 2, dy * s, cw, ch);
      ctx.lineWidth = lw * 1.4;
      ctx.strokeStyle = INK;
      ctx.strokeRect(-cw / 2, dy * s, cw, ch);
    }
    ctx.beginPath();
    ctx.moveTo(-cw / 2 - s * 0.1, s * 0.42);
    ctx.lineTo(cw / 2 + s * 0.1, s * 0.42);
    ctx.lineWidth = lw * 1.6;
    ctx.stroke();
  } else if (id === 'fan') {
    // Tres ramas: No determinismo.
    for (const a of [-0.5, 0, 0.5]) {
      const ex = Math.sin(a) * s * 0.4;
      const ey = -Math.cos(a) * s * 0.4;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.34);
      ctx.lineTo(ex, ey);
      ctx.lineWidth = lw * 1.4;
      ctx.strokeStyle = INK;
      ctx.stroke();
      circle(ctx, ex, ey, s * 0.09);
      ctx.fillStyle = SUN;
      ctx.fill();
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    circle(ctx, 0, s * 0.34, s * 0.08);
    ctx.fillStyle = INK;
    ctx.fill();
  } else if (id === 'shield') {
    // Bucle con su flecha: Lazo.
    ctx.beginPath();
    ctx.arc(0, s * 0.06, s * 0.36, -Math.PI * 0.35, Math.PI * 1.55);
    ctx.lineWidth = lw * 2.6;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = lw * 1.2;
    ctx.strokeStyle = ICE;
    ctx.stroke();
    const a = -Math.PI * 0.35;
    const tx = Math.cos(a) * s * 0.36;
    const ty = s * 0.06 + Math.sin(a) * s * 0.36;
    ctx.beginPath();
    ctx.moveTo(tx + s * 0.12, ty - s * 0.02);
    ctx.lineTo(tx - s * 0.06, ty - s * 0.12);
    ctx.lineTo(tx - s * 0.02, ty + s * 0.1);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
  } else if (id === 'turbo') {
    // Doble flecha: Transición ε.
    for (const dx of [-0.16, 0.12]) {
      ctx.beginPath();
      ctx.moveTo((dx - 0.12) * s, -0.3 * s);
      ctx.lineTo((dx + 0.14) * s, 0);
      ctx.lineTo((dx - 0.12) * s, 0.3 * s);
      ctx.lineWidth = lw * 2.8;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.lineWidth = lw * 1.3;
      ctx.strokeStyle = SUN;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Piso de papel cuadriculado (línea fina cada 100, marcada cada 500) y el borde de la arena. Solo
// la parte que se ve; las líneas finas, si no quedan demasiado juntas.
export function drawFloor(ctx, cam, size) {
  const { w, h, scale, cx, cy } = cam;
  const sx = (x) => (x - cx) * scale + w / 2;
  const sy = (y) => (y - cy) * scale + h / 2;
  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(sx(0), sy(0), size * scale, size * scale);
  const left = Math.max(0, cx - w / 2 / scale);
  const right = Math.min(size, cx + w / 2 / scale);
  const top = Math.max(0, cy - h / 2 / scale);
  const bottom = Math.min(size, cy + h / 2 / scale);
  const lines = (step, color, width) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      ctx.moveTo(sx(x), sy(top));
      ctx.lineTo(sx(x), sy(bottom));
    }
    for (let y = Math.ceil(top / step) * step; y <= bottom; y += step) {
      ctx.moveTo(sx(left), sy(y));
      ctx.lineTo(sx(right), sy(y));
    }
    ctx.stroke();
  };
  if (100 * scale >= 7) lines(100, GRID_MINOR, Math.max(0.6, 2 * scale));
  lines(500, GRID_MAJOR, Math.max(0.8, 4 * scale));
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, 10 * scale);
  ctx.strokeRect(sx(0), sy(0), size * scale, size * scale);
}

// Obstáculos: los rectángulos son trozos de cinta con un símbolo por celda; los círculos, estados
// de cartón (q₃…q₆). Todos con sombra dura. Los que no se ven no se dibujan.
export function drawObstacles(ctx, cam, obstacles) {
  const { w, h, scale, cx, cy } = cam;
  const sx = (x) => (x - cx) * scale + w / 2;
  const sy = (y) => (y - cy) * scale + h / 2;
  const lift = Math.max(2, 10 * scale);
  const lw = Math.max(1.5, 6 * scale);
  obstacles.forEach((o, i) => {
    const box = o.r !== undefined ? { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r } : o;
    if (sx(box.x + box.w) < -lift || sx(box.x) > w + lift || sy(box.y + box.h) < -lift || sy(box.y) > h + lift) return;
    for (const pass of ['shadow', 'body']) {
      const dy = pass === 'shadow' ? lift : 0;
      ctx.beginPath();
      if (o.r !== undefined) ctx.arc(sx(o.x), sy(o.y) + dy, o.r * scale, 0, Math.PI * 2);
      else ctx.rect(sx(o.x), sy(o.y) + dy, o.w * scale, o.h * scale);
      ctx.fillStyle = pass === 'shadow' ? INK : '#ffffff';
      ctx.fill();
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (o.r !== undefined) {
      const r = o.r * scale;
      circle(ctx, sx(o.x), sy(o.y), r * 0.78);
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();
      if (r > 8) stateLabel(ctx, (i % 4) + 3, sx(o.x), sy(o.y), Math.round(r * 0.8));
      return;
    }
    const horiz = o.w >= o.h;
    const long = horiz ? o.w : o.h;
    const cells = Math.max(2, Math.round(long / 75));
    const cell = long / cells;
    ctx.lineWidth = lw * 0.55;
    ctx.beginPath();
    for (let k = 1; k < cells; k += 1) {
      if (horiz) {
        ctx.moveTo(sx(o.x + k * cell), sy(o.y));
        ctx.lineTo(sx(o.x + k * cell), sy(o.y + o.h));
      } else {
        ctx.moveTo(sx(o.x), sy(o.y + k * cell));
        ctx.lineTo(sx(o.x + o.w), sy(o.y + k * cell));
      }
    }
    ctx.stroke();
    const px = Math.min(cell, horiz ? o.h : o.w) * scale;
    if (px < 9) return;
    ctx.font = `${Math.round(px * 0.55)}px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < cells; k += 1) {
      const tx = horiz ? o.x + (k + 0.5) * cell : o.x + o.w / 2;
      const ty = horiz ? o.y + o.h / 2 : o.y + (k + 0.5) * cell;
      ctx.fillStyle = (k + i) % 3 === 0 ? PINK : INK;
      ctx.fillText(SYMBOLS[(i + k) % SYMBOLS.length], sx(tx), sy(ty) + px * 0.03);
    }
  });
}

// Caja de poder: un rótulo de transición (tarjeta con δ) con el ícono del poder; rosada en los ejes
// (poderes fuertes), amarilla en las esquinas. Late un poco y tiene un halo, salvo con `still`.
export function drawPad(ctx, x, y, s, { power, ring, now, still }) {
  const beat = still ? 1 : 1 + 0.06 * Math.sin(now / 180);
  const side = s * beat;
  const r = side * 0.2;
  ctx.save();
  ctx.translate(x, y);
  if (!still) {
    circle(ctx, 0, 0, side * (0.8 + 0.12 * Math.sin(now / 240)));
    ctx.lineWidth = Math.max(1, side * 0.06);
    ctx.strokeStyle = ring === 'axis' ? 'rgba(255, 79, 139, 0.6)' : 'rgba(255, 201, 60, 0.75)';
    ctx.stroke();
  }
  roundRect(ctx, -side / 2, -side / 2 + side * 0.1, side, side, r);
  ctx.fillStyle = INK;
  ctx.fill();
  roundRect(ctx, -side / 2, -side / 2, side, side, r);
  ctx.fillStyle = ring === 'axis' ? '#ffe0ec' : '#fff3cf';
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, side * 0.07);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
  powerIcon(ctx, power, x, y + side * 0.03, side * 0.72);
  if (side > 18) {
    ctx.font = `900 ${Math.round(side * 0.4)}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, side * 0.1);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText('δ', x - side * 0.5, y - side * 0.5);
    ctx.fillStyle = PINK;
    ctx.fillText('δ', x - side * 0.5, y - side * 0.5);
  }
}

// Bala: la del retador, un punto de su color; la del jefe, una celda de cinta rosada.
export function drawBullet(ctx, x, y, r, { boss, color, lw }) {
  if (boss) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.4);
    ctx.fillStyle = PINK;
    ctx.fillRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.strokeRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
    ctx.restore();
    return;
  }
  circle(ctx, x, y, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// Flecha de transición desde el borde de un estado de radio r hacia `angle` (el cañón).
function transitionArrow(ctx, r, angle, thick) {
  ctx.save();
  ctx.rotate(angle);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r * 0.85, 0);
  ctx.lineTo(r * 1.5, 0);
  ctx.lineWidth = r * thick;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r * 1.95, 0);
  ctx.lineTo(r * 1.4, -r * 0.42);
  ctx.lineTo(r * 1.4, r * 0.42);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
}

function ownRing(ctx, r, line) {
  circle(ctx, 0, 0, r + line * 2.2);
  ctx.lineWidth = line * 1.6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  circle(ctx, 0, 0, r + line * 3.4);
  ctx.lineWidth = line * 0.8;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function flashOver(ctx, r, flash) {
  if (!(flash > 0)) return;
  circle(ctx, 0, 0, r);
  ctx.globalAlpha = flash * 0.45; // suave: al jefe le pegan seguido y no debe verse siempre blanco
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Retador: un estado del color de su equipo con la letra del celular (A o B) y una flecha de
// transición hacia donde mira. Con poder lleva su ícono; el Lazo dibuja el bucle encima y el
// Desbordamiento, un aro amarillo que late.
export function drawChallenger(ctx, x, y, r, { angle, color, label, mine = false, shield = false, flash = 0, power = null, now = 0, still = false }) {
  const line = Math.max(1.3, r * 0.13);
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, r * 0.14, r);
  ctx.fillStyle = INK;
  ctx.fill();
  transitionArrow(ctx, r, angle, 0.34);
  circle(ctx, 0, 0, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (label) {
    ctx.font = `900 ${Math.round(r * 1.05)}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.strokeText(label, 0, r * 0.06);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, 0, r * 0.06);
  }
  flashOver(ctx, r, flash);
  if (mine) ownRing(ctx, r, line);
  if (shield || power === 'shield') {
    circle(ctx, 0, 0, r * 1.45);
    ctx.lineWidth = line * 1.4;
    ctx.strokeStyle = SHIELD;
    ctx.stroke();
  }
  if (power === 'shield') {
    ctx.beginPath();
    ctx.arc(0, -r * 1.3, r * 0.55, Math.PI * 0.75, Math.PI * 2.25);
    ctx.lineWidth = line * 1.2;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (power === 'blast') {
    circle(ctx, 0, 0, r * (1.4 + (still ? 0 : 0.12 * Math.sin(now / 120))));
    ctx.lineWidth = line * 1.3;
    ctx.strokeStyle = SUN;
    ctx.stroke();
  }
  if (power) {
    const br = Math.max(6, r * 0.6);
    const bx = r * 1.05;
    const by = -r * 1.05;
    circle(ctx, bx, by, br);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(1, line * 0.7);
    ctx.strokeStyle = INK;
    ctx.stroke();
    powerIcon(ctx, power, bx, by, br * 1.5);
  }
  ctx.restore();
}

// Jefe: un estado final (doble círculo) del color de su equipo con su estado adentro (q₀, q₁, q₂;
// el centro se pone amarillo y luego rosado), un bucle encima, una flecha gruesa por cañón y, al
// costado, su pila. Congelado: una capa de hielo con cristales.
export function drawBoss(ctx, x, y, r, { angle, color, stage = 0, hp = null, frozen = false, flash = 0, mine = false, now = 0, still = false }) {
  const line = Math.max(1.5, r * 0.1);
  ctx.save();
  ctx.translate(x, y);
  circle(ctx, 0, r * 0.12, r);
  ctx.fillStyle = INK;
  ctx.fill();
  transitionArrow(ctx, r, angle, 0.3);
  circle(ctx, 0, 0, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
  circle(ctx, 0, 0, r * 0.72);
  ctx.fillStyle = STAGE_FILLS[stage] ?? '#ffffff';
  ctx.fill();
  ctx.lineWidth = line * 0.8;
  ctx.stroke();
  stateLabel(ctx, stage, 0, r * 0.02, Math.round(r * 0.7));
  // Bucle encima (gira despacio).
  const spin = still ? 0 : (now / 1400) % (Math.PI * 2);
  ctx.save();
  ctx.translate(0, -r * 1.14);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.36, Math.PI * 0.7 + spin * 0.1, Math.PI * 2.3 + spin * 0.1);
  ctx.lineWidth = line * 0.9;
  ctx.strokeStyle = INK;
  ctx.stroke();
  const end = Math.PI * 2.3 + spin * 0.1;
  const ax = Math.cos(end) * r * 0.36;
  const ay = Math.sin(end) * r * 0.36;
  ctx.beginPath();
  ctx.moveTo(ax + r * 0.14, ay - r * 0.02);
  ctx.lineTo(ax - r * 0.04, ay - r * 0.16);
  ctx.lineTo(ax - r * 0.02, ay + r * 0.12);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  // Pila al costado: Z₀ abajo y una celda por cada 10 % de vida; el tope en amarillo.
  if (hp !== null) {
    const filled = pilaFilled(hp, 1);
    const cw = r * 0.24;
    const ch = r * 0.17;
    const bx = r * 1.2;
    const base = r * 0.95;
    ctx.lineWidth = Math.max(0.7, line * 0.35);
    ctx.strokeStyle = INK;
    for (let k = 0; k <= PILA_CELLS; k += 1) {
      const top = base - (k + 1) * ch;
      if (k > filled) break;
      ctx.fillStyle = k === 0 ? Z0 : k === filled ? SUN : color;
      ctx.fillRect(bx, top, cw, ch);
      ctx.strokeRect(bx, top, cw, ch);
    }
  }
  flashOver(ctx, r, flash);
  if (frozen) {
    circle(ctx, 0, 0, r * 1.1);
    ctx.fillStyle = 'rgba(140, 215, 255, 0.55)';
    ctx.fill();
    ctx.lineWidth = line;
    ctx.strokeStyle = '#1b7fc0';
    ctx.stroke();
    ctx.lineCap = 'round';
    for (let k = 0; k < 6; k += 1) {
      const a = (k * Math.PI) / 3 + 0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
      ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
      ctx.lineWidth = line * 1.6;
      ctx.strokeStyle = '#1b7fc0';
      ctx.stroke();
      ctx.lineWidth = line * 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    powerIcon(ctx, 'freeze', 0, 0, r * 0.9);
  }
  if (mine) ownRing(ctx, r, line);
  ctx.restore();
}

// Efectos (duración en ms): estallido al caer, chispa del impacto, explosión de Desbordamiento (de
// su alcance real, con el borde punteado) y cambio de estado del jefe (un aro y su estado nuevo).
export const EFFECT_MS = { boom: 600, spark: 220, blast: 800, stage: 900 };
export function drawEffect(ctx, fx, { x, y, scale, now, still }) {
  const t = Math.min(1, (now - fx.at) / EFFECT_MS[fx.kind]);
  ctx.save();
  if (fx.kind === 'blast') {
    const r = fx.r * scale * (still ? 1 : 0.35 + Math.min(1, t * 2.5) * 0.65);
    circle(ctx, x, y, r);
    ctx.globalAlpha = 0.45 * (1 - t);
    ctx.fillStyle = SUN;
    ctx.fill();
    ctx.globalAlpha = 1 - t;
    ctx.setLineDash([Math.max(3, r * 0.08), Math.max(3, r * 0.08)]);
    ctx.lineWidth = Math.max(1.5, r * 0.03);
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.setLineDash([]);
    powerIcon(ctx, 'blast', x, y, Math.max(16, r * 0.45) * (still ? 1 : 0.6 + t * 0.6));
  } else if (fx.kind === 'stage') {
    const r = fx.r * scale * (still ? 1.6 : 1.1 + t * 1.6);
    circle(ctx, x, y, r);
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = Math.max(3, fx.r * scale * 0.25 * (1 - t));
    ctx.strokeStyle = STAGE_FILLS[fx.stage] ?? SUN;
    ctx.stroke();
    ctx.lineWidth = Math.max(1, fx.r * scale * 0.06);
    ctx.strokeStyle = INK;
    ctx.stroke();
    const size = Math.max(16, fx.r * scale * 0.9);
    const rise = still ? 0 : t * size * 0.8;
    ctx.globalAlpha = Math.min(1, 2 * (1 - t));
    circle(ctx, x, y - fx.r * scale * 1.9 - rise, size * 0.62);
    ctx.fillStyle = STAGE_FILLS[fx.stage] ?? SUN;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, size * 0.08);
    ctx.strokeStyle = INK;
    ctx.stroke();
    stateLabel(ctx, fx.stage, x, y - fx.r * scale * 1.9 - rise, Math.round(size * 0.7));
  } else {
    const grow = fx.kind === 'boom' ? 0.8 + t * 1.6 : 0.8 + t * 0.8;
    circle(ctx, x, y, fx.r * scale * (still ? 1.2 : grow));
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = fx.kind === 'spark' ? fx.color : SUN;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, 5 * scale);
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  ctx.restore();
}

// Pila horizontal (el HUD del celular): Z₀ a la izquierda y `PILA_CELLS` celdas; las llenas, del
// color del jefe, con el tope en amarillo. `popping`: celdas que acaban de salir ([índice, 0…1]),
// que suben y se desvanecen.
export function drawPilaRow(ctx, x, y, { filled, color, cw, ch, popping = [] }) {
  const z0 = cw * 2;
  ctx.fillStyle = INK;
  ctx.fillRect(x - 2, y - 2, z0 + PILA_CELLS * cw + 4, ch + 4);
  ctx.fillStyle = Z0;
  ctx.fillRect(x, y, z0, ch);
  // Z₀, con el 0 como subíndice dibujado (la fuente no trae los subíndices de Unicode).
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.font = `${Math.round(ch * 0.66)}px ${DISPLAY}`;
  const wz = ctx.measureText('Z').width;
  ctx.font = `${Math.round(ch * 0.44)}px ${DISPLAY}`;
  const w0 = ctx.measureText('0').width;
  const zx = x + z0 / 2 - (wz + w0) / 2;
  ctx.fillText('0', zx + wz, y + ch * 0.68);
  ctx.font = `${Math.round(ch * 0.66)}px ${DISPLAY}`;
  ctx.fillText('Z', zx, y + ch * 0.48);
  for (let k = 0; k < PILA_CELLS; k += 1) {
    ctx.fillStyle = k < filled ? (k === filled - 1 ? SUN : color) : '#ffffff';
    ctx.fillRect(x + z0 + k * cw + 1, y, cw - 1, ch);
  }
  for (const [k, p] of popping) {
    ctx.globalAlpha = 1 - p;
    const cx = x + z0 + k * cw + 1;
    const cy = y - p * ch * 1.6;
    ctx.fillStyle = SUN;
    ctx.fillRect(cx, cy, cw - 1, ch);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = INK;
    ctx.strokeRect(cx, cy, cw - 1, ch);
    ctx.globalAlpha = 1;
  }
  return z0 + PILA_CELLS * cw;
}

// Aviso de una oleada de poderes, centrado en (x, y), un poco inclinado como una cinta pegada.
export function drawBanner(ctx, text, x, y, size, strong) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.025);
  ctx.font = `${size}px ${DISPLAY}`;
  const w = ctx.measureText(text).width + size * 1.4;
  const h = size * 1.8;
  roundRect(ctx, -w / 2, -h / 2 + size * 0.2, w, h, size * 0.35);
  ctx.fillStyle = INK;
  ctx.fill();
  roundRect(ctx, -w / 2, -h / 2, w, h, size * 0.35);
  ctx.fillStyle = strong ? PINK : SUN;
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.15);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText(text, 0, size * 0.04);
  ctx.restore();
}
