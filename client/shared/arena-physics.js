// Física de la Arena: la usan el celular (mueve su vehículo al instante), el servidor (valida la
// posición que informa cada celular y decide los impactos) y los bots. Paso fijo de 30 Hz.
//
// Unidades del mundo: la arena es un cuadrado de `size` de lado, con el origen arriba a la izquierda
// (y crece hacia abajo). Las direcciones viajan como enteros de 0 a ANGLES − 1 (una vuelta).
export const TICK_MS = 1000 / 30;
export const ANGLES = 4096;
// Qué tan rápido la velocidad sigue al joystick en cada paso (1 = al instante): llega al ~90 % de
// la velocidad máxima en 4 pasos (~130 ms), así no se siente como manejar sobre hielo.
const GRIP = 0.45;

export const ticksOf = (ms) => Math.round(ms / TICK_MS);
// Tick en curso según el reloj del servidor (negativo durante la cuenta 3-2-1).
export const tickAt = (now, playStartsAt) => Math.floor((now - playStartsAt) / TICK_MS);
export const perTick = (perSecond) => (perSecond * TICK_MS) / 1000;

export const radiansOf = (angle) => (angle / ANGLES) * 2 * Math.PI;
export const angleOf = (radians) => {
  const turns = Math.round((radians / (2 * Math.PI)) * ANGLES) % ANGLES;
  return turns < 0 ? turns + ANGLES : turns;
};
export const angleTo = (from, to) => angleOf(Math.atan2(to.y - from.y, to.x - from.x));

// Direcciones de un disparo: una bala, o varias en abanico (el jefe) separadas `spreadDeg` grados.
// Con enteros, el celular y el servidor calculan exactamente las mismas.
export function shotAngles(angle, { bullets, spreadDeg }) {
  const step = Math.round((spreadDeg / 360) * ANGLES);
  return Array.from({ length: bullets }, (_, k) => {
    const a = (angle + Math.round((k - (bullets - 1) / 2) * step)) % ANGLES;
    return a < 0 ? a + ANGLES : a;
  });
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Saca un círculo de radio `r` de los obstáculos (rectángulos { x, y, w, h } y círculos { x, y, r })
// y lo deja dentro de la arena. Dos pasadas: un empujón puede meterlo en el obstáculo vecino.
export function pushOut(x, y, r, { size, obstacles }) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const o of obstacles) {
      if (o.r !== undefined) {
        const dx = x - o.x;
        const dy = y - o.y;
        const min = o.r + r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2);
        if (d === 0) {
          x = o.x + min;
        } else {
          x = o.x + (dx / d) * min;
          y = o.y + (dy / d) * min;
        }
        continue;
      }
      const cx = clamp(x, o.x, o.x + o.w);
      const cy = clamp(y, o.y, o.y + o.h);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 0) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        y = cy + (dy / d) * r;
        continue;
      }
      // El centro quedó dentro del rectángulo: sale por el lado más cercano.
      const left = x - o.x;
      const right = o.x + o.w - x;
      const top = y - o.y;
      const bottom = o.y + o.h - y;
      const nearest = Math.min(left, right, top, bottom);
      if (nearest === left) x = o.x - r;
      else if (nearest === right) x = o.x + o.w + r;
      else if (nearest === top) y = o.y - r;
      else y = o.y + o.h + r;
    }
  }
  return { x: clamp(x, r, size - r), y: clamp(y, r, size - r) };
}

// ¿Un círculo toca algún obstáculo o se sale de la arena? (las balas)
export function blocked(x, y, r, { size, obstacles }) {
  if (x < r || y < r || x > size - r || y > size - r) return true;
  return obstacles.some((o) => {
    if (o.r !== undefined) {
      const dx = x - o.x;
      const dy = y - o.y;
      return dx * dx + dy * dy < (o.r + r) * (o.r + r);
    }
    const dx = x - clamp(x, o.x, o.x + o.w);
    const dy = y - clamp(y, o.y, o.y + o.h);
    return dx * dx + dy * dy < r * r;
  });
}

// Un paso del vehículo `v` ({ x, y, vx, vy }): la velocidad se acerca a la del joystick (`stick`,
// con largo de 0 a 1) y al chocar se desliza por el obstáculo. `speed` en unidades por segundo.
export function moveVehicle(v, stick, { speed, radius }, map) {
  const top = perTick(speed);
  v.vx += (stick.x * top - v.vx) * GRIP;
  v.vy += (stick.y * top - v.vy) * GRIP;
  const next = pushOut(v.x + v.vx, v.y + v.vy, radius, map);
  v.vx = next.x - v.x;
  v.vy = next.y - v.y;
  v.x = next.x;
  v.y = next.y;
  return v;
}

// Bala: sale de (x0, y0) en el tick `tick0` y avanza (dx, dy) por tick.
export function makeBullet({ owner, tick0, k, x, y, angle, rules }) {
  const step = perTick(rules.bulletSpeed);
  const rad = radiansOf(angle);
  const dx = Math.cos(rad) * step;
  const dy = Math.sin(rad) * step;
  // Sale desde el borde del vehículo, no desde su centro.
  const lead = rules.radius + rules.bulletRadius;
  return {
    owner,
    tick0,
    k,
    angle,
    x0: x + (dx / step) * lead,
    y0: y + (dy / step) * lead,
    dx,
    dy,
    radius: rules.bulletRadius,
    lastTick: tick0 + Math.floor(rules.bulletRange / step), // después de esto se apaga sola
  };
}

export const bulletAt = (b, tick) => ({ x: b.x0 + b.dx * (tick - b.tick0), y: b.y0 + b.dy * (tick - b.tick0) });

// Primer tick en que la bala choca con un obstáculo o el borde (o el último de su alcance).
export function bulletEnd(b, map) {
  for (let tick = b.tick0; tick <= b.lastTick; tick += 1) {
    const { x, y } = bulletAt(b, tick);
    if (blocked(x, y, b.radius, map)) return tick;
  }
  return b.lastTick;
}

// Distancia al cuadrado del punto p al segmento a-b (el recorrido de una bala en un tick).
export function segmentDistance2(a, b, p) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * vx + (p.y - a.y) * vy) / len2, 0, 1);
  const dx = a.x + vx * t - p.x;
  const dy = a.y + vy * t - p.y;
  return dx * dx + dy * dy;
}

// Ayuda de puntería: si hay un objetivo a menos de `coneDeg` grados de donde mira el vehículo y
// dentro del alcance, apunta a él (al más alineado); si no, dispara hacia donde mira. Si el objetivo
// se mueve ({ vx, vy } por tick), apunta a donde estará cuando llegue la bala (`bulletStep`: lo que
// avanza la bala por tick): sin eso, a un vehículo que se mueve casi nunca se le pega.
export function aimAngle(from, facing, targets, { coneDeg, range, bulletStep = 0 }) {
  const cone = (coneDeg / 360) * ANGLES;
  let best = null;
  for (const target of targets) {
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > range * range) continue;
    const diff = Math.abs((((angleOf(Math.atan2(dy, dx)) - facing) % ANGLES) + ANGLES + ANGLES / 2) % ANGLES - ANGLES / 2);
    if (diff > cone || (best && diff >= best.diff)) continue;
    const ticks = bulletStep > 0 ? Math.sqrt(d2) / bulletStep : 0;
    const ahead = { x: target.x + (target.vx ?? 0) * ticks, y: target.y + (target.vy ?? 0) * ticks };
    best = { angle: angleTo(from, ahead), diff };
  }
  return best ? best.angle : facing;
}

// Poderes de los retadores. En el fotograma viajan como código: su posición en la lista + 1 (0 = ninguno).
export const POWERS = ['freeze', 'blast', 'double', 'fan', 'shield', 'turbo'];
export const powerCode = (id) => (id ? POWERS.indexOf(id) + 1 : 0);
export const powerOf = (code) => POWERS[code - 1] ?? null;

// Estado del jefe según la vida que le queda: 0 al empezar, y uno más por cada umbral (`below`, una
// fracción de la vida máxima) que ya cruzó.
export function bossStage(hp, maxHp, states = []) {
  let stage = 0;
  states.forEach((state, i) => {
    if (hp < state.below * maxHp) stage = i + 1;
  });
  return stage;
}

// Reglas de un vehículo en un tick: las del jefe cambian con su estado; las del retador, con su poder
// (abanico de balas o más velocidad). `power`: { id, until } (y `from` en el servidor).
export function effectiveRules(rules, { stage = 0, power = null, tick = 0, powers = null } = {}) {
  let out = rules;
  if (stage > 0 && rules.states?.[stage - 1]) {
    const { below, ...over } = rules.states[stage - 1];
    out = { ...out, ...over };
  }
  if (power && powers && tick >= (power.from ?? -Infinity) && tick < power.until) {
    if (power.id === 'fan') out = { ...out, bullets: powers.fan.bullets, spreadDeg: powers.fan.spreadDeg };
    if (power.id === 'turbo') out = { ...out, speed: out.speed * powers.turbo.speed };
  }
  return out;
}
