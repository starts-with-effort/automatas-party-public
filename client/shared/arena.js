// Arena en la interfaz: el vehículo y los controles en el celular, y la arena completa en el
// proyector y el host.
//
// El celular mueve su vehículo al instante con la física compartida (arena-physics.js) y cada
// reportMs informa sus posiciones y disparos. Lo demás llega en los fotogramas del servidor
// (mg:frame, 20 por segundo): los otros vehículos se dibujan un poco en el pasado, interpolando
// entre las posiciones que informaron, con un retraso que se ajusta solo a lo que tardan en llegar;
// en el celular, las balas se dibujan en el presente, porque su recorrido se conoce desde que salen.
// Los impactos los decide el servidor; la pantalla oculta una bala en cuanto toca a un enemigo para no
// verla atravesarlo mientras llega la confirmación.
import { h, replace } from './dom.js';
import {
  TICK_MS, aimAngle, angleOf, bulletAt, bulletEnd, effectiveRules, makeBullet, moveVehicle, perTick, powerCode, powerOf,
  radiansOf, shotAngles, ticksOf,
} from './arena-physics.js';
import {
  EFFECT_MS, INK, PILA_CELLS, PINK, SUN, STAGE_FILLS, circle, drawBanner, drawBoss, drawBullet, drawChallenger, drawEffect,
  drawFloor, drawObstacles, drawPad, drawPilaRow, pilaFilled, powerIcon, stateLabel,
} from './arena-draw.js';
import { send } from './ui.js';
import { teamChip } from './widgets.js';

const STATUS = { dead: 0, alive: 1, out: 2 };
const ROCK = '#c9c2ec'; // obstáculos en el minimapa
const POP_MS = 420; // lo que tarda en salir una celda de la pila del jefe
// Poderes: nombre y qué hace (el emoji va solo en el aviso de texto; en la arena se dibuja el ícono).
export const POWER_INFO = {
  freeze: { icon: '❄️', name: 'Estado trampa', text: 'tus balas congelan al jefe' },
  blast: { icon: '💥', name: 'Desbordamiento', text: 'si caes, explotas junto al jefe' },
  double: { icon: '×2', name: 'Apilar doble', text: 'tus golpes valen doble' },
  fan: { icon: '🔱', name: 'No determinismo', text: 'disparas tres balas' },
  shield: { icon: '🛡️', name: 'Lazo', text: 'absorbes golpes del jefe' },
  turbo: { icon: '⚡', name: 'Transición ε', text: 'te mueves más rápido' },
};
const WAVE_SHOW_MS = 2600; // cuánto se ve el aviso de una oleada
const SAMPLES = 16; // posiciones guardadas por vehículo para interpolar
const MIN_DELAY_TICKS = 3; // los demás vehículos se dibujan al menos ~100 ms en el pasado
const GAP_SAMPLES = 90; // atrasos recientes con los que se ajusta el retraso (~2 s con 16 vehículos)
const MAX_AHEAD_TICKS = 6; // si faltan posiciones, se proyecta como mucho ~200 ms
const MAX_INFLIGHT = 4; // envíos sin respuesta a la vez
const MAX_CATCHUP = 15; // tras un corte largo (pestaña oculta) el vehículo no recupera todo de golpe
const MAX_PENDING = 60; // posiciones sin confirmar que se reenvían (2 s)
const STICK_PX = 56; // recorrido del joystick, en px CSS
const DEAD_ZONE = 0.12;
const MAX_DPR = 2;
const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
};

const teamOf = (teams, id) => teams.find((t) => t.id === id);
const stillMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tick de juego (con decimales) que se dibuja: congelado en pausa y hasta que todas las pantallas
// retoman (resumeAt); nunca pasa del final.
function gameTick({ phase, room }, clock, endTick) {
  const now = room.paused ? room.paused.at : Math.max(clock.now(), phase.resumeAt ?? -Infinity);
  return Math.min((now - phase.playStartsAt) / TICK_MS, endTick + 0.999);
}

// ------------------------------------------------------------------ mundo compartido

// Lo que se sabe de la arena por los fotogramas: posiciones recientes de cada vehículo, balas e
// impactos. Lo usan el celular y el tablero. `maxDelay`: cuánto en el pasado (en ticks) se pueden
// llegar a dibujar los demás; el retraso real se ajusta solo según lo que tardan sus posiciones.
function createWorld(socket, { maxDelay }) {
  const gaps = []; // edad de la posición más nueva de un vehículo justo cuando llega la siguiente
  const world = {
    delay: Math.min(maxDelay, 4), // ticks en el pasado a los que se dibuja a los demás
    delayTarget: Math.min(maxDelay, 4),
    tickNow: null, // la pantalla dice en qué tick va (para medir con cuánto atraso llegan)
    drawn: 0, // vehículos dibujados y cuántos de ellos proyectados, sin posición más nueva (?fps)
    projected: 0,
    game: null,
    seq: null,
    teams: [],
    frame: null,
    frames: 0, // fotogramas recibidos (diagnóstico)
    lastFrameAt: 0,
    tracks: [], // por vehículo: { samples: [[tick, x, y, mira]], row, flashAt }
    bullets: new Map(), // `${dueño}:${tick0}:${k}` → bala
    effects: [],
    onHit: null,
    waves: 0, // oleadas de poderes que ya salieron (según los fotogramas)
    waveAt: -1e9, // cuándo llegó la última (para el aviso)
    waveStrong: false,
  };
  const seenHits = new Set();
  const map = () => ({ size: world.game.size, obstacles: world.game.obstacles });
  const rulesOf = (idx) => (world.game.vehicles[idx].boss ? world.game.rules.boss : world.game.rules.challenger);
  const keyOf = (owner, tick0, k) => `${owner}:${tick0}:${k}`;

  world.rulesOf = rulesOf;
  world.colorOf = (idx) => teamOf(world.teams, world.game.vehicles[idx]?.teamId)?.color ?? INK;

  world.setGame = (game, seq, teams) => {
    world.teams = teams;
    if (world.seq === seq) {
      world.game = game;
      return;
    }
    Object.assign(world, { game, seq, frame: null, waves: 0, waveAt: -1e9, tracks: game.vehicles.map(() => ({ samples: [], row: null, flashAt: -1e9 })) });
    gaps.length = 0;
    world.bullets.clear();
    world.effects = [];
    seenHits.clear();
  };

  function addBullet(b) {
    world.bullets.set(keyOf(b.owner, b.tick0, b.k), { ...b, boss: world.game.vehicles[b.owner].boss, end: bulletEnd(b, map()) });
  }

  // Disparo propio: las balas salen al instante en este celular; el fotograma que las confirma trae
  // la misma clave y no se duplican.
  world.shoot = (owner, tick, angle, at, rules = rulesOf(owner)) => {
    shotAngles(angle, rules).forEach((a, k) => {
      if (!world.bullets.has(keyOf(owner, tick, k))) addBullet(makeBullet({ owner, tick0: tick, k, x: at.x, y: at.y, angle: a, rules }));
    });
  };

  function bulletFromRow([owner, tick0, k, x0, y0, angle]) {
    const rules = rulesOf(owner);
    const step = perTick(rules.bulletSpeed);
    const rad = radiansOf(angle);
    return {
      owner, tick0, k, angle, x0, y0,
      dx: Math.cos(rad) * step,
      dy: Math.sin(rad) * step,
      radius: rules.bulletRadius,
      lastTick: tick0 + Math.floor(rules.bulletRange / step),
    };
  }

  world.onFrame = (frame) => {
    if (!world.game || frame.seq !== world.seq) return;
    world.frame = frame;
    world.frames += 1;
    world.lastFrameAt = performance.now();
    const nowTick = world.tickNow?.() ?? null;
    frame.v.forEach((row, idx) => {
      const track = world.tracks[idx];
      if (!track) return;
      const old = track.row;
      if (old && old[6] !== row[6]) track.samples = []; // reapareció: no se interpola desde donde cayó
      if (old && old[5] === STATUS.alive && row[5] !== STATUS.alive) {
        world.effects.push({ kind: 'boom', x: old[1], y: old[2], r: rulesOf(idx).radius, color: world.colorOf(idx), at: performance.now() });
        // Cayó con Desbordamiento: explota.
        if (old[10] === powerCode('blast')) world.effects.push({ kind: 'blast', x: old[1], y: old[2], r: world.game.powers.blast.radius, color: SUN, at: performance.now() });
      }
      // El jefe cambió de estado: un aro y su estado nuevo encima.
      if (old && row[14] > old[14]) world.effects.push({ kind: 'stage', idx, stage: row[14], x: row[1], y: row[2], r: rulesOf(idx).radius, at: performance.now() });
      track.row = row;
      const last = track.samples.at(-1);
      if (row[5] === STATUS.alive && (!last || row[0] > last[0])) {
        // Para dibujar siempre entre dos posiciones conocidas, el retraso debe cubrir lo vieja que era
        // la más nueva cuando llegó la siguiente.
        if (last && nowTick !== null) gaps.push(nowTick - last[0]);
        track.samples.push([row[0], row[1], row[2], row[3]]);
        if (track.samples.length > SAMPLES) track.samples.shift();
      }
    });
    if (gaps.length > GAP_SAMPLES) gaps.splice(0, gaps.length - GAP_SAMPLES);
    if (frame.w && frame.w[0] > world.waves) {
      // La primera vez (p. ej. al recargar la página) no se avisa una oleada vieja.
      if (world.waves > 0 || frame.n - (world.game.waves[frame.w[0] - 1] ?? 0) < 30) world.waveAt = performance.now();
      world.waves = frame.w[0];
      world.waveStrong = frame.w[1] === 1;
    }
    if (gaps.length >= 8) {
      const sorted = [...gaps].sort((a, b) => a - b);
      const p90 = sorted[Math.floor(sorted.length * 0.9)];
      world.delayTarget = Math.min(maxDelay, Math.max(MIN_DELAY_TICKS, p90 + 0.5));
    }
    for (const row of frame.b) if (!world.bullets.has(keyOf(row[0], row[1], row[2]))) addBullet(bulletFromRow(row));
    for (const row of frame.h) {
      const key = keyOf(row[0], row[1], row[2]);
      if (seenHits.has(key)) continue;
      seenHits.add(key);
      const bullet = world.bullets.get(key);
      if (bullet) bullet.end = Math.min(bullet.end, row[4]);
      if (world.tracks[row[3]]) world.tracks[row[3]].flashAt = performance.now();
      world.onHit?.(row);
    }
  };
  socket.on('mg:frame', world.onFrame);
  world.destroy = () => socket.off('mg:frame', world.onFrame);

  // Dónde dibujar al vehículo `idx` en el tick `rt`: entre las dos posiciones que lo rodean o, si
  // todavía no llegan, proyectado con su última velocidad (poco tiempo).
  world.positionOf = (idx, rt) => {
    const samples = world.tracks[idx]?.samples ?? [];
    if (samples.length === 0) return null;
    const first = samples[0];
    if (rt <= first[0]) return { x: first[1], y: first[2], f: first[3] };
    for (let i = samples.length - 1; i > 0; i -= 1) {
      const a = samples[i - 1];
      const b = samples[i];
      if (a[0] <= rt && rt <= b[0]) {
        const t = (rt - a[0]) / (b[0] - a[0]);
        return { x: a[1] + (b[1] - a[1]) * t, y: a[2] + (b[2] - a[2]) * t, f: b[3] };
      }
    }
    const b = samples.at(-1);
    const a = samples.at(-2);
    if (!a) return { x: b[1], y: b[2], f: b[3] };
    const ahead = Math.min(rt - b[0], MAX_AHEAD_TICKS);
    const span = b[0] - a[0];
    return { x: b[1] + ((b[1] - a[1]) / span) * ahead, y: b[2] + ((b[2] - a[2]) / span) * ahead, f: b[3], projected: true };
  };

  // Todos los vehículos vivos como se dibujan en el tick `ft` (los demás, `delay` ticks atrás). `mine`
  // reemplaza la posición del vehículo propio (la del celular, sin retraso). Se llama una vez por
  // cuadro: el retraso se acerca a su objetivo, rápido si hay que esperar más y despacio si puede
  // bajar (así los demás no aceleran de golpe).
  world.layout = (ft, mine = null) => {
    world.delay += (world.delayTarget - world.delay) * (world.delayTarget > world.delay ? 0.08 : 0.01);
    const rt = ft - world.delay;
    const out = [];
    world.game.vehicles.forEach((meta, idx) => {
      const row = world.tracks[idx]?.row;
      if (mine && idx === mine.idx) {
        if (mine.alive) out.push({ idx, meta, row, x: mine.x, y: mine.y, f: mine.f, vx: 0, vy: 0, r: rulesOf(idx).radius });
        return;
      }
      if (!row || row[5] !== STATUS.alive) return;
      const at = world.positionOf(idx, rt);
      const before = world.positionOf(idx, rt - 1);
      if (!at) return;
      world.drawn += 1;
      if (at.projected) world.projected += 1;
      out.push({ idx, meta, row, ...at, vx: at.x - before.x, vy: at.y - before.y, r: rulesOf(idx).radius });
    });
    return out;
  };

  // Balas en el tick `ft`. Una bala que toca a un enemigo dibujado se oculta ahí (el servidor
  // confirmará el impacto en un momento) y deja una chispa.
  world.liveBullets = (ft, drawn) => {
    const live = [];
    for (const [key, b] of world.bullets) {
      if (ft > b.end + 1 || ft > b.lastTick + 1) {
        world.bullets.delete(key);
        continue;
      }
      if (ft < b.tick0 || ft > b.end) continue;
      const at = bulletAt(b, ft);
      const target = drawn.find((v) => v.meta.boss !== b.boss && (v.x - at.x) ** 2 + (v.y - at.y) ** 2 < (v.r + b.radius) ** 2);
      if (target) {
        b.end = ft;
        world.effects.push({ kind: 'spark', x: at.x, y: at.y, r: b.radius * 2.2, color: b.boss ? PINK : SUN, at: performance.now() });
        continue;
      }
      live.push({ ...at, b });
    }
    return live;
  };

  return world;
}

// ------------------------------------------------------------------ dibujo

// Arena, obstáculos, cajas, balas, vehículos y efectos con la cámara `cam` ({ w, h, scale, cx, cy } en
// píxeles del canvas), con el dibujo de arena-draw.js. `min`: tamaño mínimo en píxeles de vehículos,
// balas y cajas, para que se vean en el proyector aunque a escala midan muy poco. `delayBullets`: las
// balas van en el mismo tiempo que los demás vehículos (el proyector: nadie maneja ahí, y así cada
// bala toca al vehículo que golpea).
function drawScene(ctx, world, cam, { ft, mine = null, now, min = { boss: 0, challenger: 0, bullet: 0, pad: 0 }, delayBullets = false }) {
  const { game } = world;
  const { w, h, scale, cx, cy } = cam;
  const sx = (x) => (x - cx) * scale + w / 2;
  const sy = (y) => (y - cy) * scale + h / 2;
  const still = stillMotion();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawFloor(ctx, cam, game.size);
  drawObstacles(ctx, cam, game.obstacles);

  const padPowers = world.frame?.p ?? [];
  game.pads.forEach((pad, i) => {
    const power = powerOf(padPowers[i] ?? 0);
    const side = Math.max(min.pad ?? 0, game.powers.padRadius * 1.5 * scale);
    if (power) drawPad(ctx, sx(pad.x), sy(pad.y), side, { power, ring: pad.ring, now, still });
  });

  const drawn = world.layout(ft, mine);
  const lw = Math.max(1, 3 * scale);
  for (const { x, y, b } of world.liveBullets(delayBullets ? ft - world.delay : ft, drawn)) {
    drawBullet(ctx, sx(x), sy(y), Math.max(min.bullet * (b.boss ? 1.5 : 1), b.radius * scale), { boss: b.boss, color: world.colorOf(b.owner), lw });
  }

  for (const v of drawn) {
    const track = world.tracks[v.idx];
    const { row } = v;
    const r = Math.max(v.meta.boss ? min.boss : min.challenger, v.r * scale);
    const common = {
      angle: radiansOf(v.f),
      color: world.colorOf(v.idx),
      mine: v.idx === mine?.idx,
      flash: Math.max(0, 1 - (now - (track?.flashAt ?? -1e9)) / 110),
      now,
      still,
    };
    if (v.meta.boss) {
      drawBoss(ctx, sx(v.x), sy(v.y), r, {
        ...common,
        stage: row?.[14] ?? 0,
        hp: row ? row[4] / v.meta.maxHp : null,
        frozen: Boolean(row && row[13] > 0 && ft <= row[13]),
      });
    } else {
      drawChallenger(ctx, sx(v.x), sy(v.y), r, {
        ...common,
        label: v.meta.slot,
        shield: row && row[5] === STATUS.alive && row[7] > ft,
        power: row ? powerOf(row[10]) : null,
      });
    }
  }

  // Efectos. El del cambio de estado sigue al jefe mientras dura.
  world.effects = world.effects.filter((fx) => now - fx.at < EFFECT_MS[fx.kind]);
  for (const fx of world.effects) {
    const at = fx.kind === 'stage' ? drawn.find((v) => v.idx === fx.idx) ?? fx : fx;
    const minR = fx.kind === 'stage' ? min.boss / Math.max(1e-6, fx.r * scale) : 1;
    drawEffect(ctx, fx, { x: sx(at.x), y: sy(at.y), scale: scale * Math.max(1, minR), now, still });
  }
  return drawn;
}

const waveText = (world) => (world.waveStrong ? '¡Última oleada: poderes fuertes!' : '¡Poderes en el mapa!');

// Canvas que sigue el tamaño de su contenedor, en píxeles reales (con tope de densidad).
function fitCanvas(canvas, box) {
  const resize = () => {
    const ratio = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(box.clientWidth * ratio);
    canvas.height = Math.round(box.clientHeight * ratio);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(box);
  resize();
  return () => observer.disconnect();
}

// /play/?fps y /screen/?fps: cuadros por segundo, cuánto tarda en dibujarse cada uno, cuánto en el
// pasado se dibuja a los demás vehículos y qué parte de ellos se dibujó proyectada (sin una posición
// más nueva entre la cual interpolar: ahí se ven saltos).
function createFpsMeter() {
  const el = h('span', { class: 'arena-fps mono' });
  let frames = 0;
  let drawMs = 0;
  let since = performance.now();
  return {
    el,
    count(ms, world) {
      frames += 1;
      drawMs += ms;
      const elapsed = performance.now() - since;
      if (elapsed < 1000) return;
      const projected = world.drawn > 0 ? Math.round((100 * world.projected) / world.drawn) : 0;
      el.textContent = `${Math.round((frames * 1000) / elapsed)} FPS · dibujo ${(drawMs / frames).toFixed(1)} ms · `
        + `los demás ${Math.round(world.delay * TICK_MS)} ms atrás · ${projected} % proyectado`;
      world.drawn = 0;
      world.projected = 0;
      frames = 0;
      drawMs = 0;
      since = performance.now();
    },
  };
}

// Vida de un grupo de vehículos según el último fotograma.
function hpOf(world, ids) {
  let hp = 0;
  let max = 0;
  world.game.vehicles.forEach((meta, idx) => {
    if (!ids.includes(meta.teamId)) return;
    const row = world.frame?.v[idx];
    max += meta.maxHp;
    if (row && row[5] !== STATUS.out) hp += row[4];
    else if (!row) hp += meta.maxHp;
  });
  return { hp, max };
}

// ------------------------------------------------------------------ celular

// Celular: el vehículo propio en el centro de la pantalla. Mitad izquierda: joystick flotante (aparece
// donde se apoya el pulgar); mitad derecha: mantener para disparar. Con teclado: WASD o flechas y la
// barra espaciadora. Se monta una vez por fase.
export function createArenaPad({ socket, clock, team, debug = false, fps = false }) {
  let view = null;
  let game = null;
  let me = null; // índice del vehículo propio
  let sim = null; // { tick, x, y, vx, vy }
  let prev = null; // posición en el tick anterior (para dibujar entre los dos)
  let life = 0;
  let status = 'alive';
  let facing = 0;
  let pending = []; // posiciones sin confirmar: [tick, x, y]
  let shots = []; // disparos sin confirmar: [tick, ángulo]
  let lastShot = -1e9;
  let inflight = 0; // envíos sin respuesta
  let sentUpTo = 0; // último tick enviado (aunque no esté confirmado)
  let acked = 0; // último tick que confirmó el servidor
  let snapAt = -1; // tick de la última corrección: las de mensajes anteriores ya no cuentan
  let lastHp = null;
  let hurtAt = -1e9;
  let enemies = []; // enemigos como se dibujan (para la ayuda de puntería)
  let timer = null;
  let destroyed = false;
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let fireId = null;
  let fireKey = false;
  const keys = new Set();

  const world = createWorld(socket, { maxDelay: 8 }); // como mucho ~270 ms: los demás se ven casi en el presente
  const canvas = h('canvas', { class: 'arena-canvas', role: 'img', 'aria-label': 'Arena: mitad izquierda para moverte, mitad derecha para disparar' });
  const message = h('div', { class: 'arena-msg', hidden: true });
  const diag = debug ? h('p', { class: 'arena-diag mono' }) : null;
  const meter = fps ? createFpsMeter() : null;
  const stage = h('div', { class: 'arena-stage' }, canvas, message, diag, meter?.el);
  const hint = h('p', { class: 'arena-hint' });
  const el = h('section', { class: 'arena-play' }, hint, stage);
  const ctx = canvas.getContext('2d');
  const stopFit = fitCanvas(canvas, stage);

  // Reglas del propio vehículo según el último fotograma: el jefe, por su estado; el retador, por
  // su poder (abanico o Transición ε).
  const rules = (tick = sim?.tick ?? 0) => {
    const row = world.frame?.v[me];
    if (game.vehicles[me]?.boss) return effectiveRules(game.rules.boss, { stage: row?.[14] ?? 0 });
    const power = row && row[6] === life && row[10] ? { id: powerOf(row[10]), until: row[11] } : null;
    return effectiveRules(game.rules.challenger, { power, tick, powers: game.powers });
  };
  // El jefe congelado no se mueve ni dispara (el servidor lo corrige si se adelantó).
  const frozen = (tick) => Boolean(game.vehicles[me]?.boss && tick <= (world.frame?.v[me]?.[13] ?? -1));
  let powerKey = null; // poder propio que ya se avisó
  let lastFilled = null; // celdas de la pila del jefe en el cuadro anterior
  let pops = []; // celdas que están saliendo de la pila: { k, at }
  let frozenKey = null; // congelamiento que ya se avisó
  let hintTimer = null;
  let baseHint = '';
  // Un aviso pasajero en la línea de arriba de la arena; después vuelve la indicación de siempre.
  function showHint(text, ms) {
    hint.textContent = text;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintTimer = null;
      hint.textContent = baseHint;
    }, ms);
  }
  const map = () => ({ size: game.size, obstacles: game.obstacles });
  const canPlay = () => {
    const { phase, room } = view;
    const now = clock.now();
    return !room.paused && now >= (phase.resumeAt ?? 0) && now >= phase.playStartsAt && now < phase.endsAt;
  };

  // ---------------------------------------------------------------- controles

  const local = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width };
  };
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const p = local(event);
    if (p.x < p.width / 2 && stick.id === null) Object.assign(stick, { id: event.pointerId, ox: p.x, oy: p.y, x: 0, y: 0 });
    else if (p.x >= p.width / 2 && fireId === null) fireId = event.pointerId;
    else return;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stick.id) return;
    const p = local(event);
    let dx = p.x - stick.ox;
    let dy = p.y - stick.oy;
    const d = Math.hypot(dx, dy);
    // Si el dedo se pasa del recorrido, la base lo sigue: cambiar de dirección no exige volver.
    if (d > STICK_PX) {
      stick.ox += (dx / d) * (d - STICK_PX);
      stick.oy += (dy / d) * (d - STICK_PX);
      dx = p.x - stick.ox;
      dy = p.y - stick.oy;
    }
    const still = Math.hypot(dx, dy) / STICK_PX < DEAD_ZONE;
    stick.x = still ? 0 : dx / STICK_PX;
    stick.y = still ? 0 : dy / STICK_PX;
  });
  const release = (event) => {
    if (event.pointerId === stick.id) Object.assign(stick, { id: null, x: 0, y: 0 });
    if (event.pointerId === fireId) fireId = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  const onKey = (event) => {
    const down = event.type === 'keydown';
    if (event.code === 'Space') {
      event.preventDefault();
      fireKey = down;
    } else if (KEYS[event.code]) {
      event.preventDefault();
      if (down) keys.add(KEYS[event.code]);
      else keys.delete(KEYS[event.code]);
    }
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);

  function stickVector() {
    if (stick.id !== null) return { x: stick.x, y: stick.y };
    const x = Number(keys.has('right')) - Number(keys.has('left'));
    const y = Number(keys.has('down')) - Number(keys.has('up'));
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  // ---------------------------------------------------------------- simulación y envío

  function step() {
    prev = { x: sim.x, y: sim.y };
    const s = stickVector();
    if (s.x !== 0 || s.y !== 0) facing = angleOf(Math.atan2(s.y, s.x));
    const still = frozen(sim.tick + 1);
    if (still) Object.assign(sim, { vx: 0, vy: 0 });
    else moveVehicle(sim, s, rules(sim.tick + 1), map());
    sim.tick += 1;
    pending.push([sim.tick, Math.round(sim.x), Math.round(sim.y)]);
    if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
    const current = rules(sim.tick);
    if (!still && (fireId !== null || fireKey) && sim.tick - lastShot >= ticksOf(current.fireMs)) {
      const angle = aimAngle(sim, facing, enemies, { coneDeg: game.aimConeDeg, range: current.bulletRange, bulletStep: perTick(current.bulletSpeed) });
      shots.push([sim.tick, angle]);
      lastShot = sim.tick;
      world.shoot(me, sim.tick, angle, sim, current);
    }
  }

  // Cada reportMs se envía lo nuevo sin esperar la respuesta anterior (hasta MAX_INFLIGHT envíos en
  // camino): las posiciones llegan al servidor más frescas y parejas aunque la red tarde. Si un envío
  // falla, se reenvía desde lo último confirmado (el servidor ignora lo que ya conoce).
  async function report() {
    if (!sim || status !== 'alive' || inflight >= MAX_INFLIGHT) return;
    const fresh = pending.filter(([tick]) => tick > sentUpTo);
    // Los ticks deben ser seguidos: si hubo un salto (pestaña oculta), se manda desde el salto.
    let start = 0;
    for (let i = 1; i < fresh.length; i += 1) if (fresh[i][0] !== fresh[i - 1][0] + 1) start = i;
    const batch = fresh.slice(start);
    const upTo = batch.length > 0 ? batch.at(-1)[0] : sentUpTo;
    const sending = shots.filter(([tick]) => tick > sentUpTo && tick <= upTo);
    if (batch.length === 0 && sending.length === 0) return;
    const sentLife = life;
    sentUpTo = upTo;
    inflight += 1;
    const res = await send(socket, 'mg:input', {
      type: 'drive',
      life,
      from: batch.length > 0 ? batch[0][0] : upTo + 1,
      pos: batch.flatMap(([, x, y]) => [x, y]),
      f: facing,
      shots: sending.slice(-20),
    });
    inflight -= 1;
    if (destroyed || sentLife !== life) return;
    if (!res.ok) {
      if (res.error === 'implausible_progress') pending = pending.filter(([tick]) => tick > upTo);
      else sentUpTo = Math.min(sentUpTo, acked); // se reenvía en el próximo envío
      return;
    }
    acked = Math.max(acked, res.tick);
    pending = pending.filter(([tick]) => tick > acked);
    shots = shots.filter(([tick]) => tick > acked);
    if (res.life !== life || res.status !== 'alive') {
      if (res.life === life) status = res.status; // lo destruyeron: lo cuenta el fotograma
      return;
    }
    if (res.fix && res.fix.tick > snapAt) {
      Object.assign(sim, { x: res.fix.x, y: res.fix.y, vx: 0, vy: 0 });
      prev = { x: sim.x, y: sim.y };
      pending = [];
      sentUpTo = sim.tick;
      snapAt = sim.tick;
    }
  }

  // El fotograma dice cuándo el propio vehículo cayó o reapareció (y desde dónde sigue tras recargar
  // la página).
  function syncSelf() {
    const row = world.frame?.v[me];
    if (!row) return;
    const [tick, x, y, f, hp, st, rowLife] = row;
    const rowStatus = st === STATUS.alive ? 'alive' : st === STATUS.out ? 'out' : 'dead';
    if (sim === null || rowLife > life) {
      // Al empezar (o tras recargar la página) y en cada reaparición, sigue desde donde dice el servidor.
      Object.assign(sim ?? (sim = {}), { tick, x, y, vx: 0, vy: 0 });
      prev = { x, y };
      life = rowLife;
      status = rowStatus;
      facing = f;
      pending = [];
      shots = [];
      lastShot = -1e9;
      lastHp = hp;
      sentUpTo = tick;
      acked = tick;
      snapAt = tick;
      return;
    }
    if (rowLife !== life) return;
    if (rowStatus !== 'alive') status = rowStatus;
    // Poder nuevo: arriba se explica qué hace por unos segundos.
    const key = row[10] ? `${row[10]}:${row[11]}` : null;
    if (key && key !== powerKey) {
      const info = POWER_INFO[powerOf(row[10])];
      showHint(`${info.icon} ${info.name}: ${info.text}`, 4000);
    }
    powerKey = key;
    if (game.vehicles[me]?.boss && row[13] > 0 && row[13] !== frozenKey) {
      frozenKey = row[13];
      showHint('❄️ ¡Te congelaron!', Math.max(600, (row[13] - tick) * TICK_MS + 300));
    }
    if (lastHp !== null && hp < lastHp) {
      hurtAt = performance.now();
      navigator.vibrate?.(120);
    }
    lastHp = hp;
  }

  // ---------------------------------------------------------------- dibujo

  function frame() {
    if (destroyed) return;
    requestAnimationFrame(frame);
    if (!view || !game || canvas.width === 0) return;
    const startedAt = performance.now();
    syncSelf();
    const ft = gameTick(view, clock, game.endTick);
    const target = Math.min(game.endTick, Math.floor(ft));
    if (sim && status === 'alive' && canPlay()) {
      if (target - sim.tick > MAX_CATCHUP) {
        sim.tick = target - 1;
        sim.vx = 0;
        sim.vy = 0;
      }
      while (sim.tick < target) step();
    }
    const alpha = sim && sim.tick === target ? ft - Math.floor(ft) : 1;
    const own = sim && prev ? { x: prev.x + (sim.x - prev.x) * alpha, y: prev.y + (sim.y - prev.y) * alpha } : null;
    const now = performance.now();
    const { width: w, height: hgt } = canvas;
    const spectator = me === null || !own;
    const cam = spectator
      ? { w, h: hgt, scale: Math.min(w, hgt) / game.size, cx: game.size / 2, cy: game.size / 2 }
      : { w, h: hgt, scale: Math.min(w, hgt) / game.view, cx: own.x, cy: own.y };
    const mine = spectator ? null : { idx: me, x: own.x, y: own.y, f: facing, alive: status === 'alive' };
    const drawn = drawScene(ctx, world, cam, { ft, mine, now });
    const iAmBoss = game.vehicles[me]?.boss;
    // La ayuda de puntería apunta adonde están ahora (se dibujan `delay` ticks en el pasado).
    enemies = drawn
      .filter((v) => v.meta.boss !== iAmBoss)
      .map((v) => ({ ...v, x: v.x + v.vx * world.delay, y: v.y + v.vy * world.delay }));
    drawHud(cam, ft, now, drawn);
    showMessage(ft);
    if (diag) drawDiag(ft);
    meter?.count(performance.now() - startedAt, world);
  }
  requestAnimationFrame(frame);

  // Indicaciones sobre la escena, en px CSS: arriba a la izquierda la vida del jefe, la propia y los
  // golpes del equipo; arriba a la derecha el minimapa; en los bordes, flechas hacia los jefes que no
  // se ven; abajo, el joystick y el botón de disparo.
  function drawHud(cam, ft, now, drawn) {
    const ratio = canvas.width / Math.max(1, canvas.clientWidth);
    const w = canvas.width / ratio;
    const hgt = canvas.height / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const pad = 10;
    const m = Math.min(w, hgt) * 0.27; // lado del minimapa

    // Daño recibido: borde rojo un momento.
    const hurt = Math.max(0, 1 - (now - hurtAt) / 350);
    if (hurt > 0) {
      ctx.lineWidth = 18;
      ctx.strokeStyle = `rgba(232, 56, 79, ${0.7 * hurt})`;
      ctx.strokeRect(0, 0, w, hgt);
    }

    // Pila del jefe (la meta común de los retadores; para el jefe, su propia vida): Z₀ y una celda por
    // cada 10 % de la vida que les queda a los vehículos jefe. Las que salen suben y se desvanecen.
    // Al lado, el estado más avanzado de los jefes.
    const bosses = view.phase.data.groups[0] ?? [];
    const { hp, max } = hpOf(world, bosses);
    const filled = pilaFilled(hp, max);
    if (lastFilled !== null && filled < lastFilled && !stillMotion()) {
      for (let k = filled; k < lastFilled; k += 1) pops.push({ k, at: now });
    }
    lastFilled = filled;
    pops = pops.filter((p) => now - p.at < POP_MS);
    hudText(bosses.length > 1 ? 'PILA DE LOS JEFES' : 'PILA DEL JEFE', pad, pad + 6, 'left', 11);
    const bossIdx = game.vehicles.findIndex((v) => v.boss);
    const cw = Math.max(8, Math.min(14, (w - m - 3 * pad - 34) / (PILA_CELLS + 2)));
    const pilaW = drawPilaRow(ctx, pad, pad + 15, {
      filled,
      color: bossIdx >= 0 ? world.colorOf(bossIdx) : PINK,
      cw,
      ch: 16,
      popping: pops.map((p) => [p.k, (now - p.at) / POP_MS]),
    });
    const stage = Math.max(0, ...game.vehicles.map((v, idx) => (v.boss ? world.frame?.v[idx]?.[14] ?? 0 : 0)));
    circle(ctx, pad + pilaW + 17, pad + 23, 11);
    ctx.fillStyle = STAGE_FILLS[stage] ?? SUN;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    stateLabel(ctx, stage, pad + pilaW + 17, pad + 23, 13);

    // Vida propia (retador: puntos; jefe: va en la barra de arriba).
    const row = world.frame?.v[me];
    if (row && !game.vehicles[me].boss) {
      for (let i = 0; i < game.vehicles[me].maxHp; i += 1) {
        circle(ctx, pad + 9 + i * 21, pad + 47, 8);
        ctx.fillStyle = i < row[4] && row[5] === STATUS.alive ? PINK : '#fff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    // Golpes del propio equipo (o derribos, si es jefe).
    const mineIdx = game.vehicles.map((v, i) => (v.teamId === team.id ? i : null)).filter((i) => i !== null);
    const sum = (k) => mineIdx.reduce((acc, i) => acc + (world.frame?.v[i]?.[k] ?? 0), 0);
    if (game.vehicles[me]) {
      const boss = game.vehicles[me].boss;
      hudText(boss ? `Derribos: ${sum(9)}` : `Golpes del equipo: ${sum(8)}`, boss ? pad : pad + 74, pad + 47, 'left', 12);
    }

    // Minimapa.
    const mx = w - m - pad;
    const my = pad;
    const k = m / game.size;
    ctx.fillStyle = 'rgba(248, 246, 255, 0.92)';
    ctx.fillRect(mx, my, m, m);
    ctx.fillStyle = ROCK;
    for (const o of game.obstacles) {
      if (o.r !== undefined) {
        circle(ctx, mx + o.x * k, my + o.y * k, o.r * k);
        ctx.fill();
      } else {
        ctx.fillRect(mx + o.x * k, my + o.y * k, o.w * k, o.h * k);
      }
    }
    for (const v of drawn) {
      circle(ctx, mx + v.x * k, my + v.y * k, v.meta.boss ? 4.5 : v.idx === me ? 3.5 : 2.5);
      ctx.fillStyle = v.idx === me ? '#fff' : world.colorOf(v.idx);
      ctx.fill();
      if (v.meta.boss || v.idx === me) {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
    }
    (world.frame?.p ?? []).forEach((code, i) => {
      if (!code) return;
      const spot = game.pads[i];
      ctx.fillStyle = spot.ring === 'axis' ? PINK : SUN;
      ctx.fillRect(mx + spot.x * k - 3, my + spot.y * k - 3, 6, 6);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = INK;
      ctx.strokeRect(mx + spot.x * k - 3, my + spot.y * k - 3, 6, 6);
    });
    ctx.strokeStyle = 'rgba(28, 22, 64, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx + (cam.cx - cam.w / 2 / cam.scale) * k, my + (cam.cy - cam.h / 2 / cam.scale) * k, (cam.w / cam.scale) * k, (cam.h / cam.scale) * k);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = INK;
    ctx.strokeRect(mx, my, m, m);

    // Flechas hacia los jefes que no se ven (solo para los retadores), en el borde de la zona libre
    // (debajo de las indicaciones de arriba).
    if (game.vehicles[me] && !game.vehicles[me].boss) {
      const box = { left: 22, right: w - 22, top: Math.max(62, m + pad + 18), bottom: hgt - 22 };
      for (const v of drawn.filter((x) => x.meta.boss)) {
        const sx = (v.x - cam.cx) * (cam.scale / ratio) + w / 2;
        const sy = (v.y - cam.cy) * (cam.scale / ratio) + hgt / 2;
        if (sx > 0 && sx < w && sy > 0 && sy < hgt) continue;
        const a = Math.atan2(sy - hgt / 2, sx - w / 2);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const reach = Math.min(
          cos > 0 ? (box.right - w / 2) / cos : cos < 0 ? (box.left - w / 2) / cos : Infinity,
          sin > 0 ? (box.bottom - hgt / 2) / sin : sin < 0 ? (box.top - hgt / 2) / sin : Infinity,
        );
        ctx.save();
        ctx.translate(w / 2 + cos * reach, hgt / 2 + sin * reach);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-8, -11);
        ctx.lineTo(-8, 11);
        ctx.closePath();
        ctx.fillStyle = SUN;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Controles: el joystick donde está el pulgar (o una guía a la izquierda) y el botón de disparo.
    const baseX = stick.id !== null ? stick.ox : w * 0.2;
    const baseY = stick.id !== null ? stick.oy : hgt - 90;
    ctx.globalAlpha = stick.id !== null ? 0.9 : 0.45;
    circle(ctx, baseX, baseY, STICK_PX);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    circle(ctx, baseX + stick.x * STICK_PX, baseY + stick.y * STICK_PX, 24);
    ctx.fillStyle = SUN;
    ctx.fill();
    ctx.stroke();
    const firing = fireId !== null || fireKey;
    ctx.globalAlpha = firing ? 0.95 : 0.5;
    circle(ctx, w * 0.8, hgt - 90, 44);
    ctx.fillStyle = firing ? PINK : 'rgba(255, 79, 139, 0.55)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.globalAlpha = 1;
    hudText('DISPARAR', w * 0.8, hgt - 90, 'center', 13, '#fff');
    if (stick.id === null) hudText('MOVER', baseX, baseY, 'center', 13);

    // Poder propio: abajo al centro, con un aro que se vacía (tiempo) y sus cargas si tiene.
    if (row && row[10] && row[5] === STATUS.alive && row[6] === life) {
      const power = powerOf(row[10]);
      const total = ticksOf(game.powers[power].ms);
      const left = Math.max(0, Math.min(1, (row[11] - ft) / total));
      const px = w / 2;
      const py = hgt - 82;
      circle(ctx, px, py, 24);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 29, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.lineWidth = 4;
      ctx.strokeStyle = power === 'freeze' || power === 'shield' ? '#40c4ff' : SUN;
      ctx.stroke();
      powerIcon(ctx, power, px, py, 32);
      hudText(POWER_INFO[power].name.toUpperCase(), px, py - 42, 'center', 11);
      if (row[12] > 0) {
        circle(ctx, px + 19, py - 18, 9);
        ctx.fillStyle = SUN;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
        hudText(String(row[12]), px + 19, py - 17.5, 'center', 11);
      }
    }
    // Oleada de poderes.
    if (now - world.waveAt < WAVE_SHOW_MS) drawBanner(ctx, waveText(world), w / 2, m + pad + 22, 14, world.waveStrong);
  }

  function hudText(text, x, y, align, size, fill = INK) {
    ctx.font = `900 ${size}px Nunito, system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = fill === INK ? '#fff' : INK;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  let shownMessage = null;
  function showMessage(ft) {
    const row = world.frame?.v[me];
    let text = null;
    if (me === null) text = 'Tu celular no tiene vehículo en este intento: mira la arena.';
    else if (ft >= game.endTick) text = '⏱ ¡Tiempo!';
    else if (status === 'out') text = '💥 Te derribaron. Tu equipo conserva lo que sumó.';
    else if (status === 'dead') {
      const left = row && row[5] === STATUS.dead && row[6] === life ? Math.max(0, ((row[7] - ft) * TICK_MS) / 1000) : null;
      text = left === null ? '💥 ¡Te destruyeron!' : `💥 ¡Te destruyeron! Vuelves en ${Math.ceil(left)} s`;
    }
    if (text === shownMessage) return;
    shownMessage = text;
    message.hidden = text === null;
    message.textContent = text ?? '';
  }

  function drawDiag(ft) {
    const { rtt, offset } = clock.state;
    const lag = world.frame ? Math.round((ft - world.frame.r) * TICK_MS) : null;
    diag.textContent = `RTT ${rtt ?? '—'} ms · reloj ${offset >= 0 ? '+' : ''}${offset} ms · fotogramas ${world.frames} · los demás ${Math.round(world.delay * TICK_MS)} ms atrás · impactos ${lag ?? '—'} ms atrás · sin confirmar ${pending.length}`;
  }

  return {
    el,
    fill: true, // play.js le da todo el alto de la pantalla
    update(next) {
      view = next;
      game = next.phase.data.game;
      world.setGame(game, next.phase.seq, next.teams);
      world.tickNow = () => gameTick(view, clock, game.endTick);
      me = game.me ?? null;
      const boss = game.vehicles[me]?.boss;
      baseHint = me === null ? 'Arena' : boss ? '👑 Eres el jefe: ¡resiste y aplasta las cajas!' : '🎯 Ataca al jefe 👑 y toma las cajas';
      if (!hintTimer) hint.textContent = baseHint;
      if (!timer) timer = setInterval(report, game.reportMs);
    },
    destroy() {
      destroyed = true;
      report();
      clearInterval(timer);
      clearTimeout(hintTimer);
      stopFit();
      world.destroy();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKey);
    },
  };
}

// ------------------------------------------------------------------ proyector y host

// Pila de un vehículo jefe en el lateral: deja `filled` celdas sobre Z₀. Las que sobran salen con
// una animación (sin ella, con «reducir movimiento»); el tope queda en amarillo.
function setPila(p, filled) {
  while (p.cells.length < filled) {
    const cell = h('span', { class: 'arena-cell' }, 'X');
    p.cells.push(cell);
    p.pila.append(cell);
  }
  while (p.cells.length > filled) {
    const cell = p.cells.pop();
    if (stillMotion()) {
      cell.remove();
    } else {
      cell.classList.add('leave');
      setTimeout(() => cell.remove(), POP_MS);
    }
  }
  p.cells.forEach((cell, i) => cell.classList.toggle('top', i === p.cells.length - 1));
}

// Diagrama de los estados del jefe, de arriba abajo (q₀ → q₁ → q₂, con los umbrales de vida); el
// actual en amarillo, como el estado actual de la Traza. q₂ es la furia: doble círculo.
function statesDiagram() {
  const el = h('div', { class: 'arena-states', 'aria-label': 'Estados del jefe' });
  el.innerHTML = `<svg viewBox="0 0 74 150" aria-hidden="true">
    <path class="arena-arrow" d="M22 36 V56"/><path class="arena-head" d="M16 54 L22 62 L28 54 Z"/>
    <path class="arena-arrow" d="M22 91 V111"/><path class="arena-head" d="M16 109 L22 117 L28 109 Z"/>
    <text class="arena-th" x="32" y="52">66 %</text><text class="arena-th" x="32" y="107">33 %</text>
    ${[0, 1, 2].map((n) => `<g class="arena-state" data-n="${n}"><circle cx="22" cy="${20 + 55 * n}" r="16"/>${n === 2 ? `<circle class="inner" cx="22" cy="${20 + 55 * n}" r="11.5"/>` : ''}<text x="22" y="${26 + 55 * n}">q<tspan dy="3" font-size="10">${n}</tspan></text></g>`).join('')}
  </svg>`;
  const nodes = [...el.querySelectorAll('.arena-state')];
  return {
    el,
    set(stage) {
      nodes.forEach((node, n) => node.classList.toggle('now', n === stage));
    },
  };
}

// La arena completa y, al lado, la vida del jefe y los golpes de cada equipo retador. Se monta una
// vez por fase; el lateral se rehace solo cuando cambian sus números.
export function createArenaBoard({ socket, clock, compact = false, fps = false }) {
  let view = null;
  let destroyed = false;
  let sideAt = 0;
  // Nadie maneja en el proyector: puede dibujar hasta medio segundo en el pasado para que todo se
  // mueva parejo aunque las posiciones lleguen a saltos.
  const world = createWorld(socket, { maxDelay: 15 });
  const canvas = h('canvas', { class: 'arena-canvas', role: 'img', 'aria-label': 'La arena completa' });
  const meter = fps ? createFpsMeter() : null;
  const stage = h('div', { class: 'arena-board-stage' }, canvas, meter?.el);
  const side = h('div', { class: 'arena-side stack' });
  const el = h('section', { class: `arena-board${compact ? ' compact' : ''}` }, stage, side);
  const ctx = canvas.getContext('2d');
  const stopFit = fitCanvas(canvas, stage);

  function frame() {
    if (destroyed) return;
    requestAnimationFrame(frame);
    if (!view || !world.game || canvas.width === 0) return;
    const { game } = world;
    const ft = gameTick(view, clock, game.endTick);
    const short = Math.min(canvas.width, canvas.height);
    const now = performance.now();
    // A escala, un retador mide ~1 % de la arena: en el proyector se dibuja más grande para que se vea.
    const min = { boss: short * 0.032, challenger: short * 0.015, bullet: short * 0.004, pad: short * 0.034 };
    drawScene(ctx, world, { w: canvas.width, h: canvas.height, scale: short / game.size, cx: game.size / 2, cy: game.size / 2 }, { ft, now, min, delayBullets: true });
    if (now - world.waveAt < WAVE_SHOW_MS) drawBanner(ctx, waveText(world), canvas.width / 2, short * 0.07, Math.round(short * 0.035), world.waveStrong);
    if (now - sideAt > 200) {
      sideAt = now;
      drawSide();
    }
    meter?.count(performance.now() - now, world);
  }
  requestAnimationFrame(frame);

  // Lateral: la pila de cada vehículo jefe (una celda por cada 10 % de su vida, sobre Z₀, con el
  // tope en amarillo, como la de la Traza), el diagrama de sus estados con el actual en amarillo y los
  // golpes de cada equipo retador. Se arma una vez por fase y se actualiza en su lugar, así las
  // celdas que salen alcanzan a animarse.
  let parts = null;
  function buildSide() {
    const [bossIds = [], challengerIds = []] = view.phase.data.groups;
    const vehiclesOf = (teamId) => world.game.vehicles.filter((meta) => meta.teamId === teamId);
    const bosses = bossIds.map((teamId) => {
      const kills = h('span', { class: 'mono' });
      const diagram = statesDiagram();
      const pilas = vehiclesOf(teamId).map((meta) => {
        const pila = h('div', { class: 'arena-pila' }, h('span', { class: 'arena-cell z0' }, 'Z', h('small', {}, '0')));
        const col = h('div', { class: 'arena-pila-col' }, pila, h('span', { class: 'arena-pila-name' }, meta.slot));
        return { idx: meta.idx, col, pila, cells: [] };
      });
      const el = h('div', { class: 'arena-boss', style: { '--team': teamOf(view.teams, teamId)?.color } },
        h('div', { class: 'arena-row-head' }, teamChip(teamOf(view.teams, teamId)), kills),
        h('div', { class: 'arena-boss-body' }, h('div', { class: 'arena-pilas' }, pilas.map((p) => p.col)), diagram.el));
      return { teamId, el, kills, diagram, pilas };
    });
    const hits = h('div', { class: 'stack arena-hits' });
    replace(side,
      h('p', { class: 'eyebrow' }, bossIds.length > 1 ? 'Pilas de los jefes' : 'Pila del jefe'),
      h('div', { class: 'arena-bosses' }, bosses.map((b) => b.el)),
      challengerIds.length > 0 && h('p', { class: 'eyebrow' }, 'Golpes al jefe'),
      hits);
    parts = { seq: view.phase.seq, bosses, hits, challengerIds, hitsKey: null };
  }

  function drawSide() {
    if (parts?.seq !== view.phase.seq) buildSide();
    const ft = gameTick(view, clock, world.game.endTick);
    const sum = (teamId, k) => world.game.vehicles.reduce((acc, meta, idx) => acc + (meta.teamId === teamId ? world.frame?.v[idx]?.[k] ?? 0 : 0), 0);
    for (const boss of parts.bosses) {
      const kills = sum(boss.teamId, 9);
      boss.kills.textContent = `${kills} ${kills === 1 ? 'derribo' : 'derribos'}`;
      let stage = 0;
      for (const p of boss.pilas) {
        const row = world.frame?.v[p.idx];
        const meta = world.game.vehicles[p.idx];
        const out = row ? row[5] === STATUS.out : false;
        setPila(p, row ? (out ? 0 : pilaFilled(row[4], meta.maxHp)) : PILA_CELLS);
        p.col.classList.toggle('frozen', Boolean(row && row[13] > 0 && ft <= row[13]));
        p.col.classList.toggle('out', out);
        if (!out) stage = Math.max(stage, row?.[14] ?? 0);
      }
      boss.diagram.set(stage);
    }
    const rows = parts.challengerIds.map((teamId) => ({ teamId, hits: sum(teamId, 8) })).sort((a, b) => b.hits - a.hits);
    const key = JSON.stringify(rows);
    if (key === parts.hitsKey) return;
    parts.hitsKey = key;
    const best = Math.max(1, ...rows.map((row) => row.hits));
    // Una línea por equipo (equipo, barra y golpes), para que el lateral quepa junto a las pilas.
    replace(parts.hits, rows.map(({ teamId, hits }) => h('div', { class: 'arena-row hit', style: { '--team': teamOf(view.teams, teamId)?.color } },
      teamChip(teamOf(view.teams, teamId)),
      h('div', { class: 'arena-bar' }, h('span', { style: { width: `${(100 * hits) / best}%` } })),
      h('strong', { class: 'mono' }, String(hits)))));
  }

  return {
    el,
    update(next) {
      view = next;
      world.setGame(next.phase.data.game, next.phase.seq, next.teams);
      world.tickNow = () => gameTick(view, clock, world.game.endTick);
    },
    destroy() {
      destroyed = true;
      stopFit();
      world.destroy();
    },
  };
}
