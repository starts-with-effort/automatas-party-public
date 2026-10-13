// Flappy en la interfaz (RF-MJ4): el juego en el celular y el avance de todos en el proyector.
import { h } from './dom.js';
import { CRASH_TILT, FLAP_MS, PUFF_MS, birdSvg, drawScene, tiltFor, wingAngle } from './flappy-draw.js';
import { SPEED_PER_MS, TICK_MS, initialState, step } from './flappy-physics.js';
import { send } from './ui.js';
import { teamChip } from './widgets.js';

const MAX_FRAME_MS = 250; // tras un corte largo (pestaña oculta) no se recupera todo de golpe
const AUTO_START_MS = 2000; // el pájaro flota hasta el primer toque, o como mucho esto (también al recargar)

const percent = (x, length) => Math.min(100, Math.round((100 * x) / length));
// /play/?fps muestra los cuadros por segundo (criterio de salida de la Fase 6, RNF-05).
const SHOW_FPS = new URLSearchParams(location.search).has('fps');

// Celular (RF-MJ4-01/03/05): la física corre aquí con paso fijo de 60 Hz, sin depender de la tasa
// de refresco de la pantalla. Cada progressMs se informa el tick alcanzado y los aleteos que el
// servidor aún no confirmó; al chocar o llegar se informa de inmediato. Se monta una vez por fase.
export function createFlappyPad({ socket, clock, team }) {
  let view = null;
  let level = null;
  let sim = null;
  let prev = null; // posición y velocidad en el tick anterior: el dibujo interpola entre los dos
  let flapAt = -Infinity; // cuándo fue el último aleteo (para el movimiento del ala)
  let puffs = []; // plumitas que quedan detrás al aletear
  let tilt = 0;
  let flaps = []; // aleteos aún sin confirmar
  let acked = 0; // tick hasta el que el servidor ya simuló
  let pending = false; // aleteo pedido para el próximo tick
  let inflight = false;
  let started = false; // la simulación empieza (o se retoma) con el primer toque
  let hoverUntil = 0;
  let lastFrame = null;
  let acc = 0;
  let timer = null;
  let destroyed = false;
  const fps = { frames: 0, since: performance.now(), el: SHOW_FPS ? h('span', { class: 'flappy-fps mono' }) : null };

  const canvas = h('canvas', { class: 'flappy-canvas', role: 'img', 'aria-label': 'Toca para aletear' });
  const overlay = h('div', { class: 'flappy-overlay', hidden: true });
  const hud = h('p', { class: 'hint' }, 'Toca la pantalla o la barra espaciadora para aletear.');
  const board = h('div', {
    class: 'flappy',
    onPointerdown: (event) => {
      event.preventDefault();
      flap();
    },
  }, canvas, overlay, fps.el);
  const el = h('section', { class: 'stack' }, hud, board);
  const ctx = canvas.getContext('2d');

  const playing = () => {
    const { phase, room } = view;
    const now = clock.now();
    return sim.status === 'playing' && !room.paused && now >= phase.playStartsAt && now < phase.endsAt;
  };

  function flap() {
    if (view && sim && playing()) pending = true;
  }
  const onKey = (event) => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!event.repeat) flap();
  };
  document.addEventListener('keydown', onKey);

  // Tamaño del canvas en píxeles reales de la pantalla (nítido en pantallas de alta densidad).
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(board.clientWidth * ratio);
    canvas.height = Math.round(board.clientHeight * ratio);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(board);

  function frame() {
    if (destroyed) return;
    requestAnimationFrame(frame);
    if (fps.el) countFrame();
    if (!view || !sim) return;
    let alpha = 1;
    if (playing() && !started && (pending || clock.now() >= hoverUntil)) started = true;
    if (playing() && started) {
      const now = performance.now();
      if (lastFrame !== null) acc += Math.min(now - lastFrame, MAX_FRAME_MS);
      lastFrame = now;
      while (acc >= TICK_MS && sim.status === 'playing') {
        prev = { x: sim.x, y: sim.y, vy: sim.vy };
        if (pending) {
          flaps.push(sim.tick);
          flapAt = now;
          puffs = puffs.filter((puff) => now - puff.born < PUFF_MS);
          for (let i = 0; i < 3; i += 1) {
            puffs.push({ x: sim.x - 2.6 - i * 0.9, y: sim.y + 1.2 + (i - 1) * 1.1, s: 1 - i * 0.2, born: now + i * 30 });
          }
        }
        step(level, sim, pending);
        pending = false;
        acc -= TICK_MS;
      }
      if (sim.status !== 'playing') finish();
      else alpha = acc / TICK_MS;
    } else {
      lastFrame = null;
      acc = 0;
    }
    draw(alpha, started ? 0 : Math.sin(performance.now() / 180) * 1.5);
  }
  requestAnimationFrame(frame);

  function countFrame() {
    fps.frames += 1;
    const elapsed = performance.now() - fps.since;
    if (elapsed < 1000) return;
    fps.el.textContent = `${Math.round((fps.frames * 1000) / elapsed)} FPS`;
    fps.frames = 0;
    fps.since = performance.now();
  }

  async function report() {
    if (inflight || !sim || sim.tick <= acked) return;
    inflight = true;
    const res = await send(socket, 'mg:input', { type: 'fly', tick: sim.tick, flaps: flaps.filter((t) => t >= acked) });
    inflight = false;
    if (!res.ok) return; // p. ej. en pausa: los aleteos se reenvían en el próximo informe
    acked = Math.max(acked, res.tick);
    flaps = flaps.filter((t) => t >= acked);
    // Lo que cuenta es la simulación del servidor (RF-MJ4-07).
    if (res.status !== 'playing' && sim.status === 'playing') {
      sim.status = res.status;
      finish();
    }
    if (sim.status !== 'playing' && acked < sim.tick) report();
  }

  function finish() {
    report(); // evento final de inmediato (RF-MJ4-05)
    showOverlay();
  }

  function showOverlay() {
    const { phase } = view;
    const timeUp = sim.status === 'playing' && clock.now() >= phase.endsAt;
    if (sim.status === 'playing' && !timeUp) {
      overlay.hidden = true;
      return;
    }
    const lines = sim.status === 'arrived'
      ? [h('div', { class: 'verdict good' }, '🏁 ¡Llegaste!'), h('p', {}, 'Tu equipo suma puntos.')]
      : [h('div', { class: 'verdict bad' }, timeUp ? '⏱ Se acabó el tiempo' : '💥 ¡Chocaste!'),
        h('p', {}, `Llegaste al ${percent(sim.x, level.length)} % del nivel.`)];
    overlay.replaceChildren(...lines);
    overlay.hidden = false;
  }

  // bob: vaivén del pájaro mientras flota antes de empezar (solo dibujo, no es física).
  function draw(alpha, bob) {
    const { width, height } = canvas;
    if (width === 0) return;
    const now = performance.now();
    const vy = prev.vy + (sim.vy - prev.vy) * alpha;
    const crashed = sim.status === 'crashed';
    tilt += ((crashed ? CRASH_TILT : tiltFor(vy)) - tilt) * 0.3; // suavizado: el giro no salta al aletear
    drawScene(ctx, width, height, {
      level,
      firstPipe: Math.max(0, sim.pipe - 1),
      x: prev.x + (sim.x - prev.x) * alpha,
      y: prev.y + (sim.y - prev.y) * alpha + bob,
      team: team.color,
      tilt,
      wing: wingAngle((now - flapAt) / FLAP_MS, vy, !started, now),
      crashed,
      faded: sim.tick < sim.safeUntil && Math.floor(sim.tick / 6) % 2 === 0, // invulnerable (más de una vida)
      puffs,
      now,
    });
  }

  return {
    el,
    update(next) {
      view = next;
      const { game } = next.phase.data;
      if (!level) {
        level = game.level;
        // Tras recargar la página, el pájaro sigue desde donde lo dejó el servidor (RF-MJ-04).
        sim = game.me ? { ...game.me } : initialState(level);
        prev = { x: sim.x, y: sim.y, vy: sim.vy };
        tilt = tiltFor(sim.vy);
        hoverUntil = Math.max(next.phase.playStartsAt, clock.now()) + AUTO_START_MS;
        acked = sim.tick;
        timer = setInterval(report, game.progressMs);
        resize();
      }
      if (game.me && game.me.status !== 'playing' && sim.status === 'playing') {
        sim = { ...game.me };
        prev = { x: sim.x, y: sim.y, vy: sim.vy };
      }
      const arrived = game.players.filter((row) => row.status === 'arrived').length;
      hud.textContent = sim.status === 'playing'
        ? 'Toca la pantalla o la barra espaciadora para aletear.'
        : `Llegaron ${arrived} de ${game.players.length} jugadores.`;
      showOverlay();
    },
    destroy() {
      destroyed = true;
      report();
      clearInterval(timer);
      observer.disconnect();
      document.removeEventListener('keydown', onKey);
    },
  };
}

// El pájaro del carril, con los colores de su equipo; caído y gris si chocó.
function laneBird(team, pct, crashed) {
  const el = h('span', { class: 'lane-bird', style: { left: `${pct}%` } });
  el.innerHTML = birdSvg(team.color, { crashed }); // el color viene de la configuración, no del usuario
  return el;
}

// Proyector y host: un carril por jugador con su avance (RF-MJ4-09), actualizado a 4 Hz.
export function flappyProgress({ game }, teams) {
  const count = (status) => game.players.filter((row) => row.status === status).length;
  return h('section', { class: 'stack' },
    h('p', { class: 'eyebrow' }, `Llegaron ${count('arrived')} · Chocaron ${count('crashed')} · En vuelo ${count('playing')}`),
    h('div', { class: 'flappy-lanes' }, game.players.map((row) => {
      const team = teams.find((t) => t.id === row.teamId);
      const pct = percent(row.x, game.length);
      return h('div', { class: `flappy-lane ${row.status}` },
        teamChip(team, ` · ${row.slot}`),
        h('div', { class: 'lane-track' },
          laneBird(team, pct, row.status === 'crashed')),
        h('span', { class: 'mono lane-status' }, `${row.status === 'arrived' ? 100 : pct} %`));
    })));
}

// Proyector (rediseño, fase 6): un carril por jugador que se monta una vez por fase. Entre vista y
// vista, cada pájaro sigue avanzando a la velocidad fija del juego (SPEED_PER_MS) desde la última x
// que llegó; al llegar una vista nueva, la diferencia se corrige de a poco. No arranca hasta que el
// servidor dice que ya se movió (x > 0). Al chocar queda el pájaro caído donde cayó; al llegar, en
// la meta con el porcentaje en verde.
export function createFlappyLanes({ clock }) {
  const head = h('p', { class: 'eyebrow' });
  const list = h('div', { class: 'flappy-lanes live' });
  const el = h('section', { class: 'stack' }, head, list);
  let view = null;
  const lanes = new Map(); // `teamId:slot` → { row, at, shown, status, ... }
  const sync = (teams, game) => {
    for (const row of game.players) {
      const key = `${row.teamId}:${row.slot}`;
      let lane = lanes.get(key);
      if (!lane) {
        const team = teams.find((t) => t.id === row.teamId) ?? { name: row.teamId, color: '#888' };
        const bird = h('span', { class: 'lane-bird' });
        const trail = h('span', { class: 'lane-trail' });
        const pct = h('span', { class: 'lane-status' });
        const box = h('div', { class: 'flappy-lane', style: { '--team': team.color } },
          teamChip(team, ` · ${row.slot}`),
          h('div', { class: 'lane-track' }, trail, h('i', { class: 'lane-goal' }), bird),
          pct);
        lane = { box, bird, trail, pct, team, x: 0, at: 0, shown: 0, status: null };
        lanes.set(key, lane);
        list.append(box);
      }
      if (row.x !== lane.x || row.status !== lane.status) {
        if (row.status !== lane.status) lane.bird.innerHTML = birdSvg(lane.team.color, { crashed: row.status === 'crashed' });
        lane.x = row.x;
        lane.at = clock.now();
        lane.status = row.status;
        lane.box.classList.toggle('crashed', row.status === 'crashed');
        lane.box.classList.toggle('arrived', row.status === 'arrived');
      }
    }
  };
  let last = performance.now();
  const paint = (now) => {
    if (!view) return;
    const { game } = view.phase.data;
    const length = game.length || 1;
    const dt = Math.min(250, now - last);
    last = now;
    const paused = Boolean(view.room.paused);
    for (const lane of lanes.values()) {
      let target = lane.x;
      if (lane.status === 'playing' && lane.x > 0 && !paused) target = Math.min(length, lane.x + SPEED_PER_MS * (clock.now() - lane.at));
      if (lane.status === 'arrived') target = length;
      // Choque y llegada fijan la posición; en vuelo, se acerca de a poco a la predicción.
      lane.shown = lane.status === 'playing' ? lane.shown + (target - lane.shown) * Math.min(1, dt / 120) : target;
      const pct = Math.max(0, Math.min(1, lane.shown / length));
      lane.bird.style.left = `calc(${(pct * 100).toFixed(2)}% - ${(pct * 18).toFixed(1)}px)`;
      lane.trail.style.width = `calc(${(pct * 100).toFixed(2)}% - ${(pct * 18).toFixed(1)}px)`;
      lane.pct.textContent = `${Math.round(pct * 100)} %`;
    }
  };
  let attached = false;
  const frame = (now) => {
    if (el.isConnected) attached = true;
    else if (attached) return;
    paint(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    el,
    update(next) {
      view = next;
      const { game } = next.phase.data;
      sync(next.teams, game);
      const count = (status) => game.players.filter((row) => row.status === status).length;
      head.textContent = `En vuelo ${count('playing')} · Cayeron ${count('crashed')} · En la meta ${count('arrived')}`;
    },
    destroy() {},
  };
}
