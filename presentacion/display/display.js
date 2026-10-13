// Proyector: sigue la posición del servidor y la muestra con el motor. El teclado (o un clicker USB)
// también navega; sin conexión navega en local y, al volver, le pasa su posición al servidor.
//
//   ?print[=final][&respaldo]  todas las diapositivas paso por paso, para guardar un PDF (print.js)
//   ?debug                     posición, seq y conexión arriba a la izquierda
import { DEFAULT_LIVE, SECTIONS, SLIDES, stepCount } from '/deck/deck.js';
import { DeckEngine, fitStage, footerHtml, loadModules } from '/deck/engine/engine.js';
import { gsap } from '/deck/engine/gsap.js';
import { createNavigator } from '/deck/navigator.js';
import { connectSlides } from '/deck/net.js';
import { nextPosition, prevPosition } from '/deck/position.js';

const params = new URLSearchParams(location.search);
await document.fonts.ready;

if (params.has('print')) {
  const { runPrint } = await import('./print.js');
  await runPrint(params);
} else {
  await runLive();
}

async function runLive() {
  const stage = document.getElementById('stage');
  const foot = document.getElementById('foot');
  const blackout = document.getElementById('blackout');
  const conn = document.getElementById('conn');
  fitStage(stage);

  const deck = { slides: SLIDES, stepCount };
  const engine = new DeckEngine({
    layer: document.getElementById('slides'),
    slides: SLIDES,
    modules: await loadModules(SLIDES),
    stepCount,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    onSlide(index) {
      foot.innerHTML = footerHtml(SLIDES, SECTIONS, index);
      foot.classList.toggle('is-hidden', index === 0);
    },
  });

  const socket = connectSlides('display');
  let server = null; // último estado del servidor
  let local = null; // posición a la que se navegó sin conexión
  let dark = false;
  const navigator = createNavigator(socket, () => server);
  const debug = params.has('debug') ? addDebug(stage) : null;

  socket.on('slides:state', (state) => {
    // Al volver la conexión, si se navegó sin ella, manda la posición del proyector.
    if (local) {
      const { id, step } = local;
      local = null;
      socket.emit('nav', { action: 'goto', slide: id, step });
      return;
    }
    const first = server === null;
    server = state;
    engine.show({ id: state.id, step: state.step, live: state.live ?? DEFAULT_LIVE }, { animate: !first });
    setBlackout(state.blackout, !first);
    showDebug();
  });
  socket.on('connect', () => {
    conn.hidden = true;
    showDebug();
  });
  socket.on('disconnect', () => {
    conn.hidden = false;
    showDebug();
  });
  socket.on('connect_error', (err) => {
    // La sesión venció o se cambió el token: la página de ingreso aparece al recargar.
    if (err.message === 'unauthorized') location.reload();
    conn.hidden = false;
  });

  function move(direction) {
    if (socket.connected && server && !local) return navigator.press(direction);
    const live = server?.live ?? DEFAULT_LIVE;
    const base = local ?? (server ? { id: server.id, step: server.step } : { id: SLIDES[0].id, step: 0 });
    const target = (direction > 0 ? nextPosition : prevPosition)(deck, base, live);
    if (!target) return;
    local = target;
    engine.show({ ...target, live });
    showDebug();
  }

  function toggleBlackout() {
    if (socket.connected && server && !local) socket.emit('blackout', { on: !server.blackout });
    else setBlackout(!dark, true);
  }

  function setBlackout(on, animate) {
    if (on === dark) return;
    dark = on;
    gsap.to(blackout, { autoAlpha: on ? 1 : 0, duration: animate ? 0.3 : 0 });
  }

  const KEYS_NEXT = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter']);
  const KEYS_PREV = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace']);
  addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (KEYS_NEXT.has(key)) move(1);
    else if (KEYS_PREV.has(key)) move(-1);
    else if (key === 'b' || key === 'B' || key === '.') toggleBlackout();
    else if (key === 'f' || key === 'F') toggleFullscreen();
    else return;
    event.preventDefault();
  });

  // El cursor se esconde a los 2,5 s sin moverse.
  let cursorTimer = null;
  addEventListener('mousemove', () => {
    document.body.classList.remove('no-cursor');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('no-cursor'), 2500);
  });

  function showDebug() {
    if (!debug) return;
    const pos = local ?? server;
    debug.textContent = `${pos?.id ?? '—'} · paso ${pos?.step ?? '—'} · seq ${server?.seq ?? '—'} · ${socket.connected ? 'conectado' : 'sin conexión'}${local ? ' · local' : ''}`;
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

function addDebug(stage) {
  const el = document.createElement('div');
  el.className = 'debug';
  stage.append(el);
  return el;
}
