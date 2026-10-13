import { h, replace } from '/shared/dom.js';
import { effectLabel, itemCard, itemIcon, itemInfo, itemStrip, loadCatalog, resolutionDiagrams } from '/shared/items.js';
import { createArenaPad } from '/shared/arena.js';
import { duelBody, duelCountdown, duelUrgentEndsAt } from '/shared/duel.js';
import { createFlappyPad } from '/shared/flappy.js';
import { highlightCards } from '/shared/highlights.js';
import { keepScreenOn } from '/shared/wakelock.js';
import { connect, watchTransport } from '/shared/net.js';
import {
  countdownOverlay, createClickerPad, createMemoriaPad, groupsBody, introBody, resultBody, rouletteReel,
} from '/shared/minigames.js';
import { createTrazaPad } from '/shared/traza.js';
import { RANKING_KINDS, phaseTitle, roundLabel } from '/shared/phases.js';
import { formatSeconds, optionTile, optionsGrid, statementBlock, streakText } from '/shared/question.js';
import { createRoundStrip } from '/shared/rounds.js';
import { session } from '/shared/session.js';
import { createTallerLobby } from '/shared/taller.js';
import { createTimeSync } from '/shared/timesync.js';
import { announceRound, createPhaseFx } from '/shared/transitions.js';
import { createFinalAlert } from '/shared/urgency.js';
import { $, formatMs, listenHostBroadcasts, sendOrToast, setStatus, signed, startCountdowns, toast } from '/shared/ui.js';
import { createViewScheduler } from '/shared/view.js';
import { countdown, deltaBadge, occupancy, pauseOverlay, progressDots, slotDots, starMeter, streakFire } from '/shared/widgets.js';

const app = $('#app');
// Con ?debug se ve al pie la latencia y el transporte de la conexión (Fase 9); con ?fps, los cuadros
// por segundo de la Arena.
const debug = new URLSearchParams(location.search).has('debug');
const SHOW_FPS = new URLSearchParams(location.search).has('fps');
const strip = createRoundStrip({ withToken: true });
$('#rounds').append(strip.el);
let transport = '—';
let ended = false;
let shownView = null; // la vista que está en pantalla
let rerenderTimer = null;
let localAnswer = { seq: null, option: null }; // respuesta enviada y aún no confirmada
let optionsEnabled = { seq: null, answersAt: null, perf: 0 }; // cuándo se habilitaron las opciones
let draftSelection = { seq: null, codes: [] }; // objetos marcados en el draft
let targeting = { seq: null, itemId: null }; // objeto al que se le está eligiendo objetivo
let mounted = null; // minijuego en pantalla: se actualiza en sitio, sin rehacer el botón del Clicker
let registry = null; // sala con registro: se monta una vez, para no rehacer el formulario que alguien escribe

await loadCatalog();

// auth como función: en cada reconexión se envía el token guardado más reciente.
const socket = connect((cb) => cb({ role: 'play', token: session.get() }));
const clock = createTimeSync(socket, { onUpdate: renderNet });
// Al cambiar de fase, la pantalla anterior cae y la nueva aterriza por piezas; al empezar una
// ronda, el autómata aparece en grande con la ficha del equipo (transitions.js).
const phaseFx = createPhaseFx(app);
const onView = createViewScheduler(clock, render, {
  onAhead: (view, delay) => announceRound(shownView, view, delay, {
    color: view.teams.find((t) => t.id === view.me.teamId)?.color,
  }),
});

startCountdowns(clock);
const finalAlert = createFinalAlert(clock);
listenHostBroadcasts(socket, clock, $('#announce'));
// Si el navegador no puede mantener la pantalla encendida, el lobby avisa (RNF-12).
let screenLock = null;
keepScreenOn({
  onChange: (state) => {
    if (state === screenLock) return;
    screenLock = state;
    if (shownView && !shownView.room?.started) render(shownView);
  },
});
if (debug) {
  $('#net').hidden = false;
  watchTransport(socket, (name) => {
    transport = name;
    renderNet();
  });
}

socket.on('connect', () => setStatus($('#status'), 'ok'));
socket.on('disconnect', () => {
  if (!ended) setStatus($('#status'), 'off');
});
socket.on('session:welcome', ({ token }) => {
  if (token) session.set(token);
});
socket.on('session:ended', ({ reason }) => showEnded(reason));
socket.on('state:sync', (view) => {
  if (!ended) onView(view);
});

function render(view) {
  phaseFx(view, () => draw(view));
}

function draw(view) {
  shownView = view;
  clearTimeout(rerenderTimer);
  const { room, me, teams } = view;
  const team = teams.find((t) => t.id === me.teamId);
  renderTop(view, team);
  finalAlert.set(urgentEndsAt(view, team));

  const registering = Boolean(room && !room.started && room.workshop);
  if (!registering) {
    registry?.destroy();
    registry = null;
    focusExercise(false);
  }
  if (room?.started && team && view.phase?.kind === 'minigame') return renderMinigame(view, team);
  unmountMinigame();
  if (!room) return replace(app, notice('Esperando a que el host cree la sala…'));
  if (registering) return renderRegistry(view);
  if (!room.started) return replace(app, lobby(view, team));
  if (!team) return replace(app, notice('La partida ya empezó. Pide al host que te agregue a un equipo.'));
  replace(app, phaseHead(view), phaseBody(view, team), inkOverlay(view.phase), pauseOverlay(room));
}

// Sala con registro (taller.js): crear el equipo o unirse a uno, hacer el taller y esperar el quiz.
// Los ejercicios reparten el alto de la pantalla, como la Traza a ciegas.
function renderRegistry(view) {
  if (!registry) {
    registry = createTallerLobby({ socket, onFill: focusExercise });
    replace(app, registry.el);
  }
  registry.update(view, { screenLock });
  focusExercise(registry.fill);
}

// Durante un ejercicio del taller el tablero ocupa el alto libre y la tira de rondas se esconde: en
// un celular bajo, ese espacio es para el diagrama.
function focusExercise(on) {
  app.classList.toggle('fill', on);
  document.body.classList.toggle('tl-focus', on);
}

// El minijuego se monta una vez por fase y luego solo se actualiza: el Clicker recibe vistas a
// 4 Hz y rehacer el botón en cada una perdería toques; la Traza a ciegas atiende sus toques, la
// Memoria anima el volteo de cada carta y la Arena mantiene su simulación y sus controles.
function renderMinigame(view, team) {
  const { phase, room } = view;
  if (mounted?.seq !== phase.seq) {
    unmountMinigame();
    mounted = {
      seq: phase.seq,
      head: h('div'),
      body: h('div', { class: 'stack' }),
      overlay: h('div'),
      pad: createPad(phase.minigame, team),
    };
    replace(app, mounted.head, mounted.body, countdownOverlay(phase.playStartsAt, clock), mounted.overlay);
    if (mounted.pad) mounted.body.append(mounted.pad.el);
    // Los minijuegos que reparten el alto de la pantalla (la Traza a ciegas) necesitan que toda la
    // cadena de contenedores lo ocupe.
    app.classList.toggle('fill', Boolean(mounted.pad?.fill));
    mounted.body.classList.toggle('fill', Boolean(mounted.pad?.fill));
  }
  replace(mounted.head, phaseHead(view));
  replace(mounted.overlay, pauseOverlay(room));
  mounted.pad?.update(view);
}

function createPad(minigame, team) {
  if (minigame === 'clicker') return createClickerPad({ socket, clock, teamId: team.id });
  if (minigame === 'traza') return createTrazaPad({ socket, clock, team });
  if (minigame === 'flappy') return createFlappyPad({ socket, clock, team });
  if (minigame === 'arena') return createArenaPad({ socket, clock, team, debug, fps: SHOW_FPS });
  if (minigame === 'memoria') return createMemoriaPad({ socket, clock, teamId: team.id });
  return null;
}

function unmountMinigame() {
  app.classList.remove('fill');
  mounted?.pad?.destroy();
  mounted = null;
}

// Hasta cuándo corre la cuenta final de 5 s (urgency.js): solo si el equipo todavía tiene que
// responder, elegir o confirmar. La ven los dos celulares del equipo, también el del enunciado.
// Con Reloj Roto, el plazo es el propio del equipo.
function urgentEndsAt({ room, phase }, team) {
  if (!room?.started || room.paused || !phase || !team || phase.endsAt === null) return null;
  const data = phase.data ?? {};
  if (phase.kind === 'question') {
    const mine = localAnswer.seq === phase.seq && localAnswer.option !== null;
    const answered = mine || (data.myAnswer?.option ?? null) !== null || data.answeredTeamIds?.includes(team.id);
    return answered ? null : data.deadline ?? phase.endsAt;
  }
  if (phase.kind === 'draft') return data.offer && !data.chosen ? phase.endsAt : null;
  if (phase.kind === 'itemUse') return data.confirmedTeamIds?.includes(team.id) ? null : phase.endsAt;
  if (phase.kind === 'duel') return duelUrgentEndsAt(phase); // solo el celular al que le toca elegir
  return null;
}

// Vuelve a dibujar en un instante del reloj del servidor (p. ej. al habilitarse las opciones).
function rerenderAt(serverTime) {
  const delay = serverTime - clock.now();
  if (delay > 0) rerenderTimer = setTimeout(() => render(shownView), delay + 10);
}

const teamName = (view) => (id) => view.teams.find((t) => t.id === id)?.name ?? id;

// Cabecera: la ficha del equipo, la ronda en texto y el autómata de rondas con la ficha encima.
// Fuera de las preguntas, en vez de la ronda va el puesto y el total del equipo (rediseño, fase 4):
// la ronda igual se ve en el autómata.
function renderTop({ room, phase, teams }, team) {
  replace($('#team'), team
    ? h('span', { class: 'team-pill', style: { '--team': team.color } }, h('i', { class: 'pawn' }), team.name)
    : 'Autómatas Party');
  const started = Boolean(room?.started && phase);
  const finished = started && phase.kind === 'finalRanking';
  const showPlace = started && !finished && team && !phase.practice && !['question', 'questionResult'].includes(phase.kind);
  const lobbyLabel = room?.workshop ? (team ? 'Taller' : 'Registro') : 'Lobby';
  replace($('#round'), !started ? lobbyLabel : finished ? 'Fin' : showPlace ? placeChip(teams, team) : roundLabel(phase));
  strip.update({ round: started ? phase.round : 0, finished, color: team?.color ?? null });
}

// Puesto por el total (puntos del juego más el pozo de estrellas); los empatados comparten puesto.
function placeChip(teams, team) {
  const total = (t) => t.total ?? t.score;
  const place = 1 + teams.filter((t) => total(t) > total(team)).length;
  return h('span', { class: 'pos-chip', title: 'Puesto de tu equipo' }, `${place}.º`, h('small', {}, `${points(total(team))} pts`));
}

function lobby({ room, teams, me }, mine) {
  return [
    h('h1', {}, !room.lobbyOpen && !mine ? 'El ingreso está cerrado' : mine ? '¡Listo!' : 'Elige tu equipo'),
    mine && h('p', { class: 'note' }, 'Estás en ', h('strong', {}, mine.name), '. Espera a que el host empiece la partida.'),
    (screenLock === 'unsupported' || screenLock === 'denied') && h('p', { class: 'banner' },
      '💡 Este navegador no puede mantener la pantalla encendida: desactiva el bloqueo automático del celular mientras juegas.'),
    h('div', { class: 'teams-grid' }, teams.map((team) => {
      const isMine = team.id === me.teamId;
      const full = occupancy(team) >= 2;
      return h('button', {
        type: 'button',
        class: `team-card${isMine ? ' mine' : ''}${full && !isMine ? ' full' : ''}`,
        style: { '--team': team.color },
        disabled: !room.lobbyOpen || isMine || full,
        onClick: () => sendOrToast(socket, 'lobby:join', { teamId: team.id }),
      },
      isMine && h('span', { class: 'sticker' }, 'Tú'),
      h('strong', {}, team.name),
      h('span', { class: 'team-card-foot' }, slotDots(team), full && !isMine && h('span', {}, 'Lleno')));
    })),
    mine && room.lobbyOpen && h('button', {
      class: 'button secondary',
      type: 'button',
      onClick: () => sendOrToast(socket, 'lobby:leave'),
    }, 'Cambiar de equipo'),
  ];
}

// Con Reloj Roto, la cuenta regresiva del equipo termina en su propio plazo. La ronda ya se ve
// en la cabecera; en el ranking final el autómata llega a qF y la partida queda «aceptada». En el
// Duelo el plazo de la fase es un tope: la cuenta es la de la mano, mientras se elige. La pregunta no
// dice su dificultad ni cuánto vale (solo el host lo ve).
function phaseHead({ phase, room }) {
  const ownDeadline = phase.kind === 'question' && phase.data.deadline ? { ...phase, endsAt: phase.data.deadline } : phase;
  return h('div', { class: 'phase-head' },
    h('div', { class: 'stack' },
      h('h1', {}, phase.kind === 'finalRanking' ? '¡Aceptado!' : phaseTitle(phase))),
    phase.kind === 'duel' ? duelCountdown(phase, room) : countdown(ownDeadline, room));
}

function phaseBody(view, team) {
  const { phase } = view;
  switch (phase.kind) {
    case 'question': return questionBody(view, team);
    case 'questionResult': return questionResultBody(view, team);
    case 'draft': return draftBody(view, team);
    case 'itemUse': return itemUseBody(view, team);
    case 'resolution': return resolutionBody(view, team);
    case 'roulette': return h('section', { class: 'stack' }, rouletteReel(phase.data, phase.startsAt, clock));
    case 'minigameGroups': return h('section', { class: 'stack' }, groupsBody(phase.data, view.teams, { startsAt: phase.startsAt, clock, myTeamId: team.id }));
    case 'minigameIntro': return introBody(phase.data, view.teams, team.id, { key: phase.seq });
    case 'minigameResult': return resultBody(phase.data, view.teams, team.id, view.room.fragmentsPerStar);
    case 'duel': return duelBody(view, { socket, clock, rerender: () => render(shownView) });
    default:
  }
  if (RANKING_KINDS.has(phase.kind)) {
    const { ranking } = phase.data;
    const row = ranking.find((r) => r.teamId === team.id);
    const final = phase.kind === 'finalRanking';
    return h('section', { class: 'stack' },
      h('div', { class: 'card place-card' },
        h('span', { class: 'place' }, `${row.position}.º`),
        h('div', { class: 'stack' },
          h('span', { class: 'eyebrow' }, final ? 'Puesto final' : 'Puesto de tu equipo'),
          h('span', {}, h('strong', {}, `${points(row.score)} pts`), ' ', deltaBadge(row.delta)),
          // El total con sus dos partes si tiene pozo de estrellas; la racha y la estrella como dibujos.
          row.starPoints > 0 && h('span', { class: 'muted place-split' },
            `${points(row.gamePoints)} del juego + ${points(row.starPoints)} de estrellas`),
          h('span', { class: 'place-badges' }, streakFire(row.streak), starMeter(team, view.room.fragmentsPerStar)))),
      !final && inventoryLine(view),
      final && topList(ranking, view.teams, team.id),
      final && highlightCards(phase.data.highlights, view.teams),
      final && h('p', { class: 'hint' }, 'Mira el proyector'));
  }
  return h('section', { class: 'stack' }, phase.waitingHost && h('p', { class: 'muted center' }, 'Esperando al host…'));
}

// 12450 → "12.450"
function points(n) {
  return n.toLocaleString('es-CO');
}

// Los tres primeros, y el equipo propio si quedó más abajo.
function topList(ranking, teams, myTeamId) {
  const rows = ranking.filter((r, i) => i < 3 || r.teamId === myTeamId);
  return h('ol', { class: 'top-list' }, rows.map((r) => {
    const t = teams.find((x) => x.id === r.teamId);
    return h('li', { class: r.teamId === myTeamId ? 'mine' : null, style: { '--team': t.color } },
      h('span', { class: 'top-pos' }, r.position),
      h('i', { class: 'team-dot' }),
      h('span', { class: 'top-name' }, t.name, r.teamId === myTeamId ? ' (tú)' : ''),
      h('strong', { class: 'mono' }, points(r.score)));
  }));
}

function inventoryLine(view) {
  return h('p', { class: 'row' }, h('span', { class: 'muted' }, 'Tus objetos:'), itemStrip(view.me.inventory.map((i) => i.code)));
}

// ------------------------------------------------------------------ pregunta

// Un dispositivo ve el enunciado y el otro las opciones; si el compañero no está conectado,
// este ve ambos (RF-PRE-03/04). Las opciones se habilitan en answersAt (RF-PRE-06).
function questionBody(view, team) {
  const { phase } = view;
  const data = phase.data;
  const now = clock.now();
  const deadline = data.deadline ?? phase.endsAt;
  const open = now >= phase.answersAt;
  const closed = now >= deadline;
  if (!open) rerenderAt(phase.answersAt);
  else if (!closed) rerenderAt(deadline);
  if (open) markOptionsEnabled(phase);

  const chosen = data.myAnswer?.option ?? (localAnswer.seq === phase.seq ? localAnswer.option : null);
  const answered = chosen !== null || data.answeredTeamIds.includes(team.id);
  const canAnswer = data.role !== 'statement' && open && !closed && !answered;
  const eliminated = data.eliminated ?? [];
  const myEffects = (data.effects ?? []).filter((e) => e.targetTeamId === team.id || (e.code === 'CS' && e.sourceTeamId === team.id));

  return h('section', { class: 'stack' },
    myEffects.length > 0 && h('div', { class: 'effect-chips' }, myEffects.map((effect) =>
      h('span', { class: 'effect-chip' }, itemIcon(effect.code), effectLabel(effect, team.id, teamName(view))))),
    data.statement && statementBlock(data.statement),
    data.role === 'statement' && !answered && h('p', { class: 'note' }, 'Léele la pregunta a tu compañero: él tiene las opciones.'),
    data.role === 'options' && !answered && h('p', { class: 'note' }, 'Tu compañero tiene la pregunta. Escúchalo y elige.'),
    data.options && !open && h('p', { class: 'hint' }, 'Las opciones se habilitan en un momento…'),
    data.secondChanceUsed && !answered && h('p', { class: 'done' }, '💖 ¡Segunda Vida! Esa no era: elijan otra.'),
    data.options && optionsGrid(data.options, (index, text) => optionTile(index, text, {
      state: eliminated.includes(index) ? 'gone'
        : !open ? 'waiting' : chosen === null ? '' : chosen === index ? 'chosen' : 'dim',
      disabled: !canAnswer || eliminated.includes(index),
      onClick: () => submitAnswer(phase, index),
    })),
    // Ya respondieron: solo «esperando», sin dificultad ni puntaje.
    answered && h('p', { class: 'done' }, data.options ? '✓ Respuesta enviada' : '✓ Tu equipo ya respondió'),
    answered && h('p', { class: 'muted center' }, 'Esperando a los demás equipos…'),
    progressDots(data.answeredTeamIds.length, data.expectedTeamIds.length, 'Respondieron'));
}

// t se mide en el celular desde que se habilitaron las opciones (sección 3.6, paso 3). Si la
// vista llega tarde (reconexión, pausa), se toma como inicio el answersAt del servidor.
function markOptionsEnabled(phase) {
  if (optionsEnabled.seq === phase.seq && optionsEnabled.answersAt === phase.answersAt) return;
  optionsEnabled = {
    seq: phase.seq,
    answersAt: phase.answersAt,
    perf: performance.now() - Math.max(0, clock.now() - phase.answersAt),
  };
}

async function submitAnswer(phase, option) {
  const tClient = Math.max(0, Math.round(performance.now() - optionsEnabled.perf));
  localAnswer = { seq: phase.seq, option };
  render(shownView); // respuesta visual inmediata (RNF-02)
  navigator.vibrate?.(15);
  const res = await sendOrToast(socket, 'question:answer', { questionId: phase.data.questionId, option, tClient });
  if (res.secondChance) toast('¡Segunda Vida! Esa no era: elijan otra.');
  if (res.secondChance || (!res.ok && res.error !== 'already_answered')) {
    localAnswer = { seq: null, option: null };
    if (shownView) render(shownView);
  }
}

// Calamar: dos salpicones de manchas, uno al aparecer el enunciado (startsAt) y otro al habilitarse
// las opciones (answersAt). La tinta queda sólida y se desvanece en los últimos fadeMs antes de
// endsAt; no bloquea los toques (AMB-16). Cada mancha: [archivo, x %, y %, ancho en vmin, giro].
const INK_SPLASHES = [
  { at: 'startsAt', blots: [[1, 44, 30, 165, 0], [3, 90, 11, 66, 20], [4, 6, 45, 62, -20]] },
  { at: 'answersAt', blots: [[2, 52, 58, 168, -6], [4, 9, 66, 84, 24], [3, 90, 85, 60, -25]] },
];
const INK_STAGGER_MS = 70; // las manchas de un salpicón caen una tras otra
const inkSrc = (n) => `/assets/ink/blot-${n}.svg`;
for (let n = 1; n <= 4; n++) new Image().src = inkSrc(n); // precarga: que no aparezcan tarde

function inkOverlay(phase) {
  const ink = phase?.kind === 'question' ? phase.data.ink : null;
  if (!ink) return null;
  const now = clock.now();
  if (now >= ink.endsAt) return null;
  // Retrasos respecto de ahora: al volver a dibujar, lo que ya cayó queda quieto y lo que falta espera.
  return h('div', {
    class: 'ink',
    'aria-hidden': 'true',
    style: { animationDuration: `${ink.fadeMs}ms`, animationDelay: `${ink.endsAt - ink.fadeMs - now}ms` },
  }, INK_SPLASHES.map(({ at, blots }) => blots.map(([n, x, y, size, turn], i) => h('img', {
    class: 'ink-blot',
    src: inkSrc(n),
    alt: '',
    style: { left: `${x}%`, top: `${y}%`, width: `${size}vmin`, '--turn': `${turn}deg`, animationDelay: `${ink[at] + i * INK_STAGGER_MS - now}ms` },
  }))));
}

// Las cuatro opciones, con la correcta marcada y la del equipo tachada si falló: al entrar a la
// fase, las incorrectas se apagan una por una antes de que llegue la estrella (transitions.js).
function questionResultBody(view, team) {
  const { results, correct, options } = view.phase.data;
  const mine = results.find((row) => row.teamId === team.id);
  const [verdict, tone] = !mine?.answered
    ? ['Sin respuesta', 'neutral']
    : mine.correct ? ['¡Correcto!', 'good'] : ['Incorrecto', 'bad'];
  const grid = optionsGrid(options, (index, text) => optionTile(index, text, {
    state: index === correct ? 'correct' : mine?.answered && mine.option === index ? 'wrong' : 'dim',
  }));
  grid.classList.add('result-options');
  // Racha, tiempo y ajustes de objetos en texto, sin recuadros ni el multiplicador de la racha.
  return h('section', { class: 'stack' },
    h('div', { class: 'burst-wrap' },
      h('div', { class: `burst ${tone}` },
        h('span', { class: 'burst-title' }, verdict),
        h('span', { class: 'burst-points' }, `+${points(mine?.points ?? 0)}`))),
    mine && h('p', { class: 'result-line' },
      streakText(mine),
      mine.answered && mine.t !== null && [' · respondieron en ', h('strong', {}, formatSeconds(mine.t).replace('.', ','))]),
    mine?.adjustments?.length > 0 && mine.adjustments.map((adjustment) =>
      h('p', { class: 'result-adjustment' }, itemIcon(adjustment.code),
        h('span', {}, itemInfo(adjustment.code).name,
          adjustment.teamId ? ` por ${teamName(view)(adjustment.teamId)}` : '', ': ',
          h('strong', {}, `${signed(adjustment.points)} pts`)))),
    grid,
    h('p', { class: 'muted center' }, 'Esperando al host…'));
}

// ------------------------------------------------------------------ objetos

// Draft: los dos celulares ven la oferta; el primero que confirma elige por el equipo (RF-OBJ-06).
function draftBody(view, team) {
  const { phase } = view;
  const { offer, chosen, pickedTeamIds, expectedTeamIds } = phase.data;
  if (!offer) return notice('Esperando la oferta…');
  const progress = progressDots(pickedTeamIds.length, expectedTeamIds.length, 'Eligieron');
  const extra = offer.extra && h('div', { class: 'stack' },
    h('p', { class: 'eyebrow' }, 'Además, por no responder una pregunta'),
    itemCard(offer.extra));

  if (chosen) {
    return h('section', { class: 'stack' },
      h('p', { class: 'done' }, '✓ Tu equipo eligió'),
      chosen.map((code) => itemCard(code)),
      extra, progress);
  }

  const selected = draftSelection.seq === phase.seq ? draftSelection.codes : [];
  return h('section', { class: 'stack' },
    h('p', { class: 'hint' }, offer.picks > 1
      ? `🎫 Ticket Dorado: elijan ${offer.picks} objetos.`
      : 'Elijan un objeto. Cualquiera de los dos puede confirmar.'),
    h('div', { class: 'stack' }, offer.codes.map((code) => itemCard(code, {
      selected: selected.includes(code),
      onClick: () => toggleDraft(phase, offer, code),
    }))),
    h('button', {
      class: 'button big-action',
      type: 'button',
      disabled: selected.length !== offer.picks,
      onClick: () => submitPick(offer, selected),
    }, offer.picks > 1 ? `Elegir estos ${offer.picks}` : 'Elegir'),
    extra,
    progress);
}

function toggleDraft(phase, offer, code) {
  const current = draftSelection.seq === phase.seq ? draftSelection.codes : [];
  let codes;
  if (offer.picks === 1) codes = [code];
  else if (current.includes(code)) codes = current.filter((c) => c !== code);
  else codes = [...current, code].slice(-offer.picks);
  draftSelection = { seq: phase.seq, codes };
  render(shownView);
}

async function submitPick(offer, codes) {
  const res = await sendOrToast(socket, 'item:pick', { offerId: offer.offerId, codes });
  if (res.ok) navigator.vibrate?.(15);
}

// Uso de objetos: declaraciones secretas; el compañero ve las mismas (RF-USO-01…03).
function itemUseBody(view, team) {
  const { phase, me } = view;
  const data = phase.data;
  const confirmed = data.confirmedTeamIds.includes(team.id);
  const declared = data.declared ?? [];
  const declaredIds = new Set(declared.map((d) => d.itemId));
  const available = me.inventory.filter((item) => !declaredIds.has(item.id));
  const others = view.teams.filter((t) => t.id !== team.id);
  const progress = progressDots(data.confirmedTeamIds.length, data.expectedTeamIds.length, 'Confirmaron');

  const declaredList = declared.length > 0 && h('div', { class: 'stack' },
    h('p', { class: 'eyebrow' }, confirmed ? 'Van a usar' : 'Van a usar (aún pueden cambiarlo)'),
    declared.map((d) => h('div', { class: 'declared' },
      itemIcon(d.code),
      h('span', {}, itemInfo(d.code).name, d.targetTeamId ? ` → ${teamName(view)(d.targetTeamId)}` : ''),
      !confirmed && h('button', {
        class: 'button small secondary',
        type: 'button',
        onClick: () => sendOrToast(socket, 'item:undeclare', { itemId: d.itemId }),
      }, 'Quitar'))));

  if (confirmed) {
    return h('section', { class: 'stack' },
      h('p', { class: 'done' }, '✓ Listo. Esperando a los demás equipos.'),
      declaredList || h('p', { class: 'muted center' }, 'No usarán objetos en esta ronda.'),
      progress);
  }

  return h('section', { class: 'stack' },
    h('p', { class: 'hint' }, 'Lo que elijan es secreto hasta la resolución.'),
    declaredList,
    available.length === 0 && declared.length === 0 && h('p', { class: 'muted center' }, 'No tienen objetos.'),
    available.length > 0 && h('div', { class: 'stack' }, available.map((item) => inventoryCard(phase, item, others))),
    h('button', {
      class: 'button big-action',
      type: 'button',
      onClick: () => sendOrToast(socket, 'item:confirm'),
    }, declared.length > 0 ? `Confirmar (${declared.length})` : 'No usar nada'),
    progress);
}

// Selector de objetivo (rediseño, fase 4): al lado de cada equipo, el dato que importa para el objeto,
// tomado al empezar el uso de objetos (no cambia con lo que declaren los demás).
const TARGET_QUESTION = {
  GL: '¿A qué equipo le roban la racha?',
  CP: '¿A qué equipo le bajan la racha?',
  CV: '¿A qué equipo le quitan puntos?',
  DS: '¿A qué equipo retan?',
  RR: '¿A qué equipo le quitan tiempo?',
  CS: '¿Por qué equipo apuestan?',
};
const TARGET_INFO = {
  GL: (team) => streakFire(team.streak),
  CP: (team) => streakFire(team.streak),
  CV: (team) => h('span', { class: 'target-meta' }, points(team.score)), // puntos del juego: el pozo de estrellas no se toca
  DS: (team, tips) => h('span', { class: 'target-meta' }, starMeter({ fragments: team.fragments, stars: team.stars }, tips)),
};

function inventoryCard(phase, item, others) {
  const info = itemInfo(item.code);
  const unavailable = item.code === 'TD' && !phase.data.nextDraft;
  const choosing = targeting.seq === phase.seq && targeting.itemId === item.id;
  const snapshot = phase.data.snapshot ?? {};
  const targetInfo = TARGET_INFO[item.code];
  const footer = choosing
    ? h('div', { class: 'target-picker' },
      h('span', { class: 'target-question' }, TARGET_QUESTION[item.code] ?? '¿Contra qué equipo?'),
      h('div', { class: 'targets' },
        others.map((team) => h('button', {
          class: 'target-button',
          type: 'button',
          style: { '--team': team.color },
          onClick: () => declare(item, team.id),
        }, h('span', { class: 'target-name' }, team.name), targetInfo?.(snapshot[team.id] ?? team, shownView.room.fragmentsPerStar))),
        h('button', { class: 'button small secondary', type: 'button', onClick: () => setTargeting(null) }, 'Cancelar')),
      targetInfo && h('span', { class: 'target-note' }, 'Datos del inicio del uso de objetos.'))
    : h('button', {
      class: 'button small',
      type: 'button',
      disabled: unavailable,
      onClick: () => (info.target === 'ONE' ? setTargeting(phase, item.id) : declare(item)),
    }, unavailable ? 'No quedan repartos' : 'Usar');
  return itemCard(item.code, { footer });
}

function setTargeting(phase, itemId = null) {
  targeting = phase ? { seq: phase.seq, itemId } : { seq: null, itemId: null };
  render(shownView);
}

async function declare(item, targetTeamId) {
  targeting = { seq: null, itemId: null };
  const res = await sendOrToast(socket, 'item:declare', targetTeamId ? { itemId: item.id, targetTeamId } : { itemId: item.id });
  if (res.ok) navigator.vibrate?.(15);
  else render(shownView);
}

// Resolución: lo que le pasó al equipo (RF-USO-08).
function resolutionBody(view, team) {
  const { events, teams } = view.phase.data;
  const mine = teams.find((row) => row.teamId === team.id);
  const points = mine ? mine.scoreAfter - mine.scoreBefore : 0;
  const streak = mine ? mine.streakAfter - mine.streakBefore : 0;
  // Lo que cambió en el equipo en una línea, sin tarjeta, y los diagramas donde participa.
  return h('section', { class: 'stack' },
    h('div', { class: 'stack resolution-mine' },
      h('p', { class: 'eyebrow' }, 'A tu equipo'),
      h('p', { class: 'resolution-total' }, points === 0 ? 'Sin cambios de puntos' : `${signed(points)} pts`,
        h('span', {}, streak === 0 ? ' · racha igual' : ` · racha ${signed(streak)}`))),
    resolutionDiagrams(events, view.teams, { onlyTeam: team.id }),
    h('p', { class: 'muted center' }, 'Esperando al host…'));
}

function notice(text) {
  return h('section', { class: 'card center' }, h('p', {}, text));
}

function showEnded(reason) {
  ended = true;
  finalAlert.set(null);
  clearTimeout(rerenderTimer);
  const kicked = reason === 'kicked';
  if (kicked) session.clear();
  setStatus($('#status'), 'off');
  replace(app, h('section', { class: 'card stack center' },
    h('h1', {}, 'Sesión terminada'),
    h('p', {}, kicked ? 'El host te retiró de la partida.' : 'El juego se abrió en otra pestaña con esta misma sesión.'),
    h('button', { class: 'button', type: 'button', onClick: () => location.reload() },
      kicked ? 'Volver a entrar' : 'Seguir aquí')));
}

function renderNet() {
  if (!debug) return;
  $('#net').textContent = `RTT ${formatMs(clock.state.rtt)} · ${transport}`;
}
