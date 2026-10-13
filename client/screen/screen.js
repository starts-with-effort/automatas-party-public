import { h, replace } from '/shared/dom.js';
import { itemStrip, loadCatalog, resolutionDiagrams } from '/shared/items.js';
import { connect } from '/shared/net.js';
import {
  countdownOverlay, createAutomatonBoard, createMemoriaPad, groupsBody, introBody, resultBody, rouletteReel,
} from '/shared/minigames.js';
import { createTrazaBoard } from '/shared/traza.js';
import { createFlappyLanes } from '/shared/flappy.js';
import { createArenaBoard } from '/shared/arena.js';
import { duelBody, duelCountdown, duelPendingEndsAt } from '/shared/duel.js';
import { highlightCards } from '/shared/highlights.js';
import { keepScreenOn } from '/shared/wakelock.js';
import { RANKING_KINDS, phaseTitle, roundLabel } from '/shared/phases.js';
import { optionCounts, optionTile, optionsGrid, statementBlock } from '/shared/question.js';
import { createRoundStrip } from '/shared/rounds.js';
import { createTimeSync } from '/shared/timesync.js';
import { announceRound, createPhaseFx, stillMotion } from '/shared/transitions.js';
import { createFinalAlert } from '/shared/urgency.js';
import { $, listenHostBroadcasts, setStatus, startClock, startCountdowns } from '/shared/ui.js';
import { createViewScheduler } from '/shared/view.js';
import { countdown, deltaBadge, occupancy, pauseOverlay, slotDots, starMeter, streakFire, teamChip } from '/shared/widgets.js';

const app = $('#app');
// Con ?debug se ven el reloj del servidor con décimas y la versión (Fase 9); con ?fps, los cuadros
// por segundo de la Arena.
const debug = new URLSearchParams(location.search).has('debug');
const showFps = new URLSearchParams(location.search).has('fps');
const strip = createRoundStrip();
$('#rounds').append(strip.el);
// Un solo <img> para el QR: se reutiliza en cada render y no se vuelve a descargar.
const qr = h('img', { src: '/api/join-qr.svg', alt: 'Código QR con la dirección para jugar' });
const joinUrl = h('span', { class: 'join-url' }, '…');
await loadCatalog();
const socket = connect({ role: 'screen' });
const clock = createTimeSync(socket);
// Al cambiar de fase, la pantalla anterior cae y la nueva aterriza por piezas; al empezar una
// ronda, el autómata aparece en grande (transitions.js).
const phaseFx = createPhaseFx(app);
const onView = createViewScheduler(clock, render, {
  onAhead: (view, delay) => announceRound(shownView, view, delay),
});
let shownView = null;
let rerenderTimer = null;
// Alimenta el Autómata (Clicker): el tablero se monta una vez por fase y luego solo se actualiza,
// para que las vistas a 4 Hz no corten sus animaciones.
let board = null;
let memoria = null; // tablero de la Memoria montado: se actualiza en sitio para animar las cartas
let arena = null; // la Arena montada: su canvas sigue dibujando entre una vista y otra
let live = null; // la Traza a ciegas o el Flappy montados (renderLive)

if (debug) {
  $('#clock').hidden = false;
  $('#version').hidden = false;
  startClock($('#clock'), clock);
}
startCountdowns(clock);
// En los últimos 5 s de la pregunta, el draft y el uso, la ficha de la cuenta late en rojo; el borde
// y el número grande son solo para los celulares de quienes aún tienen que decidir.
const finalAlert = createFinalAlert(clock, { big: false });
listenHostBroadcasts(socket, clock, $('#announce'));
keepScreenOn(); // que el computador del proyector no apague la pantalla (RNF-12)
loadInfo();

socket.on('connect', () => setStatus($('#status'), 'ok'));
socket.on('disconnect', () => setStatus($('#status'), 'off'));
socket.on('state:sync', onView);

function render(view) {
  phaseFx(view, () => draw(view));
}

function draw(view) {
  shownView = view;
  clearTimeout(rerenderTimer);
  const { room, phase } = view;
  const started = Boolean(room?.started && phase);
  finalAlert.set(started ? pendingEndsAt(view) : null);
  strip.update({ round: started ? phase.round : 0, finished: started && phase.kind === 'finalRanking' });
  if (!room) return replace(app, lobbyLayout(h('h2', {}, 'Esperando a que el host cree la sala…')));
  if (!room.started) return replace(app, lobbyLayout(lobbyTeams(view)));
  if (phase.kind === 'minigame' && phase.minigame === 'memoria') return renderMemoria(view);
  memoria?.pad.destroy();
  memoria = null;
  if (phase.kind === 'minigame' && phase.minigame === 'arena') return renderArena(view);
  arena?.board.destroy();
  arena = null;
  app.classList.remove('fill');
  if (phase.kind === 'minigame' && phase.minigame === 'clicker') return renderBoard(view);
  board = null;
  if (phase.kind === 'minigame' && phase.minigame === 'traza') return renderLive(view, () => createTrazaBoard({ clock }));
  if (phase.kind === 'minigame' && phase.minigame === 'flappy') return renderLive(view, () => createFlappyLanes({ clock }));
  live = null;
  const go = phase.kind === 'minigame' ? countdownOverlay(phase.playStartsAt, clock) : null;
  replace(app, phaseHead(view), phaseBody(view), go, pauseOverlay(room));
}

// Plazo de la fase si todavía falta algún equipo por responder, elegir o confirmar.
function pendingEndsAt({ room, phase }) {
  if (room.paused || phase.endsAt === null) return null;
  const { data } = phase;
  const pending = (done) => done.length < data.expectedTeamIds.length;
  if (phase.kind === 'question') return pending(data.answeredTeamIds) ? phase.endsAt : null;
  if (phase.kind === 'draft') return pending(data.pickedTeamIds) ? phase.endsAt : null;
  if (phase.kind === 'itemUse') return pending(data.confirmedTeamIds) ? phase.endsAt : null;
  if (phase.kind === 'duel') return duelPendingEndsAt(phase);
  return null;
}

// Traza a ciegas y Flappy (rediseño, fase 6): el tablero se monta una vez por fase y se dibuja en cada
// cuadro (cronómetros y pájaros en movimiento); las vistas solo le pasan los datos nuevos.
function renderLive(view, create) {
  const { phase, room } = view;
  if (live?.seq !== phase.seq) {
    live = { seq: phase.seq, head: h('div'), overlay: h('div'), board: create() };
    replace(app, live.head, live.board.el, countdownOverlay(phase.playStartsAt, clock), live.overlay);
  }
  replace(live.head, phaseHead(view));
  replace(live.overlay, pauseOverlay(room));
  live.board.update(view);
}

function renderBoard(view) {
  const { phase, room, teams } = view;
  if (board?.seq !== phase.seq) {
    board = { seq: phase.seq, head: h('div'), tapes: createAutomatonBoard(), overlay: h('div') };
    replace(app, board.head, board.tapes.el, countdownOverlay(phase.playStartsAt, clock), board.overlay);
  }
  replace(board.head, phaseHead(view));
  replace(board.overlay, pauseOverlay(room));
  board.tapes.update(phase.data, teams);
}

// La Memoria se monta una vez por fase y el tablero ocupa el alto que queda en la pantalla.
function renderMemoria(view) {
  const { phase, room } = view;
  if (memoria?.seq !== phase.seq) {
    memoria = { seq: phase.seq, head: h('div'), overlay: h('div'), pad: createMemoriaPad({ clock }) };
    replace(app, memoria.head, memoria.pad.el, countdownOverlay(phase.playStartsAt, clock), memoria.overlay);
    app.classList.add('fill');
  }
  replace(memoria.head, phaseHead(view));
  replace(memoria.overlay, pauseOverlay(room));
  memoria.pad.update(view);
}

// La Arena: la arena completa con la vida del jefe y los golpes de cada equipo; ocupa el alto libre.
function renderArena(view) {
  const { phase, room } = view;
  if (arena?.seq !== phase.seq) {
    arena?.board.destroy();
    arena = { seq: phase.seq, head: h('div'), overlay: h('div'), board: createArenaBoard({ socket, clock, fps: showFps }) };
    replace(app, arena.head, arena.board.el, countdownOverlay(phase.playStartsAt, clock), arena.overlay);
    app.classList.add('fill');
  }
  replace(arena.head, phaseHead(view));
  replace(arena.overlay, pauseOverlay(room));
  arena.board.update(view);
}

// RF-ACC-05: QR y URL de ingreso mientras el lobby está abierto.
function lobbyLayout(side) {
  return h('div', { class: 'layout' },
    h('section', { class: 'card join' }, h('h2', {}, 'Escanea para entrar'), qr, joinUrl),
    h('section', { class: 'card stack' }, side));
}

// Sala con registro: los equipos aparecen a medida que cada grupo crea el suyo, con sus integrantes
// y sus dos celulares. Sin cuentas ni tiempos: cada grupo va a su ritmo. La tarjeta de un equipo
// aterriza la primera vez que se dibuja (`seenTeams` recuerda los que ya se mostraron en esta sala).
let seenTeams = { room: null, ids: new Set() };

function registryTeams({ room, teams }) {
  if (seenTeams.room !== room.id) seenTeams = { room: room.id, ids: new Set() };
  const fresh = new Set(teams.map((team) => team.id).filter((id) => !seenTeams.ids.has(id)));
  for (const id of fresh) seenTeams.ids.add(id);
  const left = room.workshop.maxTeams - teams.length;
  return [
    h('div', { class: 'phase-head' },
      h('h2', {}, room.lobbyOpen ? 'Registren su equipo' : 'Ingreso cerrado'),
      h('span', { class: 'muted' }, teams.length === 1 ? '1 equipo' : `${teams.length} equipos`)),
    h('ol', { class: 'tl-steps' },
      h('li', {}, 'Una persona del grupo escanea el código y crea el equipo: su nombre y sus integrantes.'),
      h('li', {}, 'Hagan el taller en ese celular, con calma: no hay tiempo ni puntos.'),
      h('li', {}, 'Al terminar, entra el segundo celular: toca el nombre del equipo o escanea el código del primero.')),
    teams.length === 0
      ? h('p', { class: 'placeholder' }, 'Aquí aparecen los equipos a medida que se registran.')
      : h('div', { class: 'teams-grid tl-grid' }, teams.map((team) => {
        // «Listos»: terminaron el taller y ya tienen sus dos celulares. No se muestra por dónde va cada uno.
        const ready = team.workshopDone && occupancy(team) === 2;
        return h('div', { class: `team-card tl-team${ready ? ' ready' : ''}${fresh.has(team.id) ? ' tl-new' : ''}`, style: { '--team': team.color } },
          ready && h('span', { class: 'sticker' }, '¡Listos!'),
          h('strong', {}, team.name), h('span', { class: 'tl-names' }, team.members.join(' · ')), slotDots(team));
      })),
    room.lobbyOpen && left > 0 && teams.length > 0 && h('p', { class: 'muted' }, left === 1 ? 'Queda lugar para un equipo más.' : `Queda lugar para ${left} equipos más.`),
  ];
}

function lobbyTeams({ room, teams }) {
  if (room.workshop) return registryTeams({ room, teams });
  const devices = teams.reduce((sum, team) => sum + occupancy(team), 0);
  return [
    h('div', { class: 'phase-head' },
      h('h2', {}, room.lobbyOpen ? 'Elijan su equipo' : 'Ingreso cerrado'),
      h('span', { class: 'muted' }, `${devices} de ${teams.length * 2} dispositivos`)),
    h('div', { class: 'teams-grid' }, teams.map((team) => h('div', {
      class: `team-card${occupancy(team) === 2 ? ' ready' : ''}`,
      style: { '--team': team.color },
    }, h('strong', {}, team.name), slotDots(team)))),
  ];
}

// En el Duelo el plazo de la fase es un tope: la cuenta es la de la mano, mientras se elige.
function phaseHead({ phase, room }) {
  return h('div', { class: 'phase-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, roundLabel(phase)), h('h1', {}, phaseTitle(phase))),
    phase.kind === 'duel' ? duelCountdown(phase, room) : countdown(phase, room));
}

function phaseBody(view) {
  const { phase, teams, room } = view;
  const tips = room.fragmentsPerStar;
  if (phase.kind === 'duel') return duelBody(view, { clock });
  if (phase.kind === 'question') return questionBody(phase);
  if (phase.kind === 'questionResult') return questionResultBody(phase);
  // Draft y uso: solo cuántos equipos faltan; ni quién ya eligió o confirmó, ni qué.
  if (phase.kind === 'draft') {
    const { pickedTeamIds, expectedTeamIds } = phase.data;
    return h('section', { class: 'stack' },
      waiting(phase, pickedTeamIds.length, expectedTeamIds.length, { verb: 'elegir su objeto', done: '¡Todos eligieron!' }));
  }
  if (phase.kind === 'itemUse') {
    const { confirmedTeamIds, expectedTeamIds } = phase.data;
    return h('section', { class: 'stack' },
      h('p', { class: 'hint' }, 'Cada equipo decide en secreto qué objetos usar.'),
      waiting(phase, confirmedTeamIds.length, expectedTeamIds.length, { verb: 'confirmar', done: '¡Todos confirmaron!' }));
  }
  if (phase.kind === 'resolution') return h('section', { class: 'stack' }, resolutionDiagrams(phase.data.events, teams));
  if (phase.kind === 'roulette') return h('section', { class: 'stack' }, rouletteReel(phase.data, phase.startsAt, clock));
  if (phase.kind === 'minigameGroups') return groupsBody(phase.data, teams, { startsAt: phase.startsAt, clock });
  if (phase.kind === 'minigameIntro') return introBody(phase.data, teams, null, { key: phase.seq });
  if (phase.kind === 'minigame') {
    return null; // la Memoria, la Arena, la Traza a ciegas y el Flappy se dibujan aparte (render…)
  }
  if (phase.kind === 'minigameResult') return resultBody(phase.data, teams, null, tips);
  if (phase.kind === 'finalRanking') {
    return h('section', { class: 'stack' },
      podium(teams, phase.data.ranking),
      highlightCards(phase.data.highlights, teams),
      rankingBars(teams, phase.data.ranking, tips));
  }
  if (RANKING_KINDS.has(phase.kind)) return rankingBars(teams, phase.data.ranking, tips);
  return null;
}

// Mientras la pregunta está abierta: número, cronómetro y cuántos equipos faltan, sin el
// enunciado ni las opciones (RF-PRE-10, AMB-29) y sin la dificultad ni el puntaje: solo «esperando».
// No se ve quién respondió ni qué.
function questionBody(phase) {
  const { answeredTeamIds, expectedTeamIds } = phase.data;
  const reading = clock.now() < phase.answersAt;
  if (reading) {
    const delay = phase.answersAt - clock.now();
    rerenderTimer = setTimeout(() => render(shownView), delay + 10);
  }
  return h('section', { class: 'stack' },
    waiting(phase, answeredTeamIds.length, expectedTeamIds.length,
      { verb: 'responder', done: '¡Todos respondieron!', reading }));
}

// Mientras los equipos responden, eligen o confirman: una cinta que se lee sola bajo el cabezal y
// cuántos equipos faltan, sin decir cuáles. La cinta sigue el reloj de la página, así que no
// salta al redibujar; cuando baja la cuenta, el número nuevo sube desde abajo.
const TAPE_BITS = '0110100111010110100101101101';
const TAPE_LOOP_MS = TAPE_BITS.length * 400;
let pending = { seq: null, left: null };

function waiting(phase, done, total, { verb, done: allDone, reading = false }) {
  const left = Math.max(0, total - done);
  const before = pending.seq === phase.seq ? pending.left : null;
  pending = { seq: phase.seq, left };
  const cells = () => [...TAPE_BITS].map((bit) => h('span', {}, bit));
  const track = h('div', { class: 'waiting-track' }, cells(), cells());
  track.style.animationDelay = `-${Math.round(performance.now() % TAPE_LOOP_MS)}ms`;
  track.style.animationDuration = `${TAPE_LOOP_MS}ms`;
  const tape = h('div', { class: 'waiting-tape', 'aria-hidden': 'true' }, track, h('i', { class: 'waiting-head' }));

  let label;
  if (reading) {
    label = 'Lean la pregunta en sus celulares…';
  } else if (left === 0) {
    label = allDone;
  } else {
    const count = h('span', { class: 'waiting-count' }, h('span', {}, String(left)));
    if (before !== null && before !== left && !stillMotion()) {
      const old = h('span', {}, String(before));
      count.prepend(old);
      old.animate([{ transform: 'none' }, { transform: 'translateY(-100%)', opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' })
        .finished.then(() => old.remove(), () => {});
      count.lastChild.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 320, delay: 80, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'backwards' });
    }
    label = [left === 1 ? 'Falta ' : 'Faltan ', count, left === 1 ? ' equipo' : ' equipos', ` por ${verb}`];
  }
  return h('div', { class: 'waiting' }, tape, h('p', { class: 'waiting-label' }, label));
}

// Al cerrar: enunciado, respuesta correcta y cuántos equipos eligieron cada opción (7.2). Los
// puntos de cada equipo no se muestran aquí: cada uno ve los suyos en su celular y todos se ven en
// el ranking.
function questionResultBody(phase) {
  const { statement, options, correct, results } = phase.data;
  const counts = optionCounts(results);
  return h('section', { class: 'stack q-result' },
    statementBlock(statement),
    optionsGrid(options, (index, text) => optionTile(index, text, {
      state: index === correct ? 'correct' : 'dim',
      count: `${counts[index]} ${counts[index] === 1 ? 'equipo' : 'equipos'}`,
    })));
}

// Podio del ranking final: 2.º, 1.º, 3.º (RF-RNK-03). data-place dice en qué orden sube cada
// escalón al entrar a la fase (transitions.js).
function podium(teams, ranking) {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const heights = ['9rem', '12rem', '7rem'];
  const order = [ranking[1], ranking[0], ranking[2]];
  return h('div', { class: 'podium' }, order.map((row, i) => row && h('div', {
    class: 'step',
    dataset: { place: [2, 1, 3][i] },
    style: { '--team': byId.get(row.teamId).color, minHeight: heights[i] },
  }, h('span', { class: 'big-number' }, `${row.position}.º`), teamChip(byId.get(row.teamId)), h('span', { class: 'mono' }, `${points(row.score)} pts`))));
}

// 12450 → "12.450"
function points(n) {
  return n.toLocaleString('es-CO');
}

// Ranking con barras proporcionales al total: a 8 m se lee mejor que una tabla. Una línea por equipo
// con la medalla, el nombre, la racha en un fuego y la estrella de fragmentos. La barra tiene dos
// tramos, los puntos del juego y el pozo de estrellas (con «★×N» si tiene estrellas completas), y el
// total va al final. 88 % del ancho como máximo: el total cabe a la derecha (transitions.js usa lo mismo).
function rankingBars(teams, rows, tips) {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const best = Math.max(1, ...rows.map((row) => row.score));
  return h('ol', { class: 'rank-bars' }, rows.map((row) => {
    const team = byId.get(row.teamId);
    const total = Math.max(0, row.score);
    const pool = Math.max(0, row.starPoints ?? 0);
    const poolShare = total > 0 ? (100 * pool) / total : 0;
    return h('li', { dataset: { teamId: row.teamId }, style: { '--team': team.color } },
      h('span', { class: `medal m${row.position}` }, row.position),
      h('span', { class: 'rank-name' }, team.name),
      streakFire(row.streak),
      starMeter(team, tips),
      h('div', { class: 'rank-track' },
        h('div', { class: 'rank-bar', style: { width: `${(88 * total) / best}%` } },
          h('span', { class: 'rank-game', style: { width: `${100 - poolShare}%` } }),
          pool > 0 && h('span', { class: 'rank-stars', style: { width: `${poolShare}%` } },
            team.stars > 0 && [starMeter({ fragments: tips }, tips), `×${team.stars}`])),
        h('span', { class: 'rank-score' }, points(row.score))),
      h('span', { class: 'rank-delta' }, deltaBadge(row.delta)));
  }));
}

async function loadInfo() {
  const info = await fetch('/api/info').then((res) => res.json());
  joinUrl.textContent = info.joinUrl.replace(/^https?:\/\//, '');
  if (debug) $('#version').textContent = `v${info.version} · ${info.commit ?? 'sin commit'}`;
}
