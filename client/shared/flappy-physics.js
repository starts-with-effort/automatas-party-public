// Física del Flappy (RF-MJ4-03): la misma en el navegador, para jugar, y en el servidor, para
// re-simular el registro de aleteos (RF-MJ4-07). Paso fijo de 60 Hz y solo sumas, productos y
// comparaciones: con los mismos aleteos sale exactamente lo mismo en cualquier celular y en Node.
//
// Unidades del mundo: el alto mide 100 y la vista 75 de ancho (proporción 3:4); y crece hacia
// abajo. Todo lo que necesita la simulación viaja en el nivel, así ambos lados usan los mismos números.
export const TICK_MS = 1000 / 60;
export const HEIGHT = 100;
export const VIEW_WIDTH = 75;
export const BIRD_X = 22; // dónde se dibuja el pájaro dentro de la vista

const PHYSICS = {
  speed: 0.4, // avance por tick (24 por segundo)
  gravity: 0.07,
  flap: -1.3, // velocidad vertical al aletear
  maxFall: 2.2,
  radius: 3, // tamaño dibujado
  hitbox: 2.4, // un poco menor que el dibujo: los roces no cuentan
  pipeWidth: 10,
  safeTicks: 90, // invulnerable 1,5 s tras perder una vida (si hay más de una)
};
// Avance por milisegundo: es fijo, así que el proyector puede mover los pájaros entre una vista y otra.
export const SPEED_PER_MS = PHYSICS.speed / TICK_MS;
const FIRST_PIPE_X = 60;
const LAST_PIPE_GAP = 40; // espacio libre antes de la meta
const MARGIN = 8; // el hueco nunca toca el techo ni el suelo
const NARROW_EVERY = 3; // uno de cada tres tubos es estrecho, contando hacia atrás desde el penúltimo

// Nivel común (RF-MJ4-02): tubos cada `pipeSpacing` con un hueco que se angosta de `gapStart` a
// `gapEnd`, rápido al principio y más despacio al final (curva `(1 − t)^gapCurve`). Desde
// `narrowFrom` (fracción del recorrido), uno de cada tres tubos es `narrowBy` más estrecho que sus
// vecinos; el último nunca lo es. Ningún hueco baja de `gapMin`. El centro del hueco cambia como
// mucho `maxShift` de un tubo al siguiente.
export function generateLevel(settings, random) {
  const { levelMs, lives, gapStart, gapEnd, gapCurve, gapMin, narrowFrom, narrowBy, pipeSpacing, maxShift } = settings;
  const ticks = Math.round(levelMs / TICK_MS);
  const length = ticks * PHYSICS.speed;
  const count = Math.max(0, Math.floor((length - LAST_PIPE_GAP - FIRST_PIPE_X) / pipeSpacing) + 1);
  const pipes = [];
  let center = HEIGHT / 2;
  for (let i = 0; i < count; i += 1) {
    const t = i / Math.max(1, count - 1);
    const narrow = t >= narrowFrom && (count - 1 - i) % NARROW_EVERY === 1;
    const curve = gapEnd + (gapStart - gapEnd) * (1 - t) ** gapCurve;
    const gap = round1(Math.max(gapMin, curve - (narrow ? narrowBy : 0)));
    const low = MARGIN + gap / 2;
    const high = HEIGHT - MARGIN - gap / 2;
    center = Math.min(high, Math.max(low, center + (random() * 2 - 1) * maxShift));
    pipes.push({ x: FIRST_PIPE_X + i * pipeSpacing, gapY: round1(center), gap });
  }
  return { ticks, length, lives, pipes, physics: { ...PHYSICS } };
}

export function initialState(level) {
  return { tick: 0, x: 0, y: HEIGHT / 2, vy: 0, lives: level.lives, safeUntil: 0, pipe: 0, status: 'playing' };
}

// Un paso de 1/60 s; `flap` indica si el jugador aleteó en este tick. Modifica `s`.
export function step(level, s, flap) {
  if (s.status !== 'playing') return s;
  const p = level.physics;
  if (flap) s.vy = p.flap;
  s.vy = Math.min(s.vy + p.gravity, p.maxFall);
  s.y += s.vy;
  s.tick += 1;
  s.x = s.tick * p.speed;
  if (s.tick >= level.ticks) {
    s.x = level.length;
    s.status = 'arrived';
    return s;
  }
  while (s.pipe < level.pipes.length && level.pipes[s.pipe].x + p.pipeWidth < s.x - p.radius) s.pipe += 1;
  if (s.tick < s.safeUntil) {
    s.y = Math.min(HEIGHT - p.radius, Math.max(p.radius, s.y));
    return s;
  }
  if (!collides(level, s)) return s;
  // Chocar con un tubo, el suelo o el techo cuesta una vida (RF-MJ4-04, AMB-22: 1 por defecto).
  s.lives -= 1;
  if (s.lives <= 0) {
    s.status = 'crashed';
    return s;
  }
  s.y = level.pipes[s.pipe]?.gapY ?? HEIGHT / 2;
  s.vy = 0;
  s.safeUntil = s.tick + p.safeTicks;
  return s;
}

function collides(level, { x, y, pipe }) {
  const { hitbox, pipeWidth } = level.physics;
  if (y - hitbox <= 0 || y + hitbox >= HEIGHT) return true;
  for (let i = pipe; i < level.pipes.length && level.pipes[i].x < x + hitbox; i += 1) {
    const { x: left, gapY, gap } = level.pipes[i];
    const inside = x + hitbox > left && x - hitbox < left + pipeWidth;
    if (inside && (y - hitbox < gapY - gap / 2 || y + hitbox > gapY + gap / 2)) return true;
  }
  return false;
}

// Avanza `s` hasta `untilTick` aplicando los aleteos (ticks en orden creciente).
export function simulate(level, s, flaps, untilTick) {
  let i = 0;
  while (s.status === 'playing' && s.tick < untilTick) {
    while (i < flaps.length && flaps[i] < s.tick) i += 1;
    step(level, s, flaps[i] === s.tick);
  }
  return s;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
