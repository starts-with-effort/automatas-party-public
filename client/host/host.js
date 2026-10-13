import { h, replace } from '/shared/dom.js';
import { itemStrip, loadCatalog, resolutionList } from '/shared/items.js';
import { connect } from '/shared/net.js';
import { createArenaBoard } from '/shared/arena.js';
import { flappyProgress } from '/shared/flappy.js';
import { highlightCards } from '/shared/highlights.js';
import { clickerBars, introBody, memoriaBoard, resultBody } from '/shared/minigames.js';
import { trazaProgress } from '/shared/traza.js';
import { RANKING_KINDS, phaseTitle, roundLabel } from '/shared/phases.js';
import { difficultyChip, optionBadge, resultsTable, statementBlock } from '/shared/question.js';
import { createTimeSync } from '/shared/timesync.js';
import { $, flash, formatMs, runAt, sendOrToast, setStatus, startClock, startCountdowns, toast } from '/shared/ui.js';
import { countdown, occupancy, rankingTable, starMeter, teamChip } from '/shared/widgets.js';
import { duelHostBody } from '/shared/duel.js';

const TOKEN_KEY = 'automatas-party.hostToken';
const CONSOLE_NAMES = { screen: 'Proyector', host: 'Host' };

let socket = null;
let currentToken = null; // para las descargas: va en la cabecera Authorization, nunca en la URL
let clock = null;
let view = null;
let limitsApplied = false;
let teamsRenderPending = false;
let arena = null; // la Arena montada en el panel: { seq, board }
const syncedClock = { now: () => clock?.now() ?? Date.now() };

await loadCatalog();
startClock($('#clock'), syncedClock);
startCountdowns(syncedClock);

$('#login').addEventListener('submit', (event) => {
  event.preventDefault();
  const token = $('#token').value.trim();
  if (token) start(token);
});

$('#logout').addEventListener('click', () => {
  saveToken(null);
  stop();
  showLogin();
});

$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const room = view?.room;
  const inProgress = Boolean(room?.started && !room.finished);
  const question = inProgress
    ? 'Hay una partida en curso. ¿Descartarla y crear una sala nueva?'
    : '¿Crear una sala nueva? Los equipos actuales se borran.';
  if (room && !confirm(question)) return;
  const names = $('#team-names').value.split('\n').map((name) => name.trim().slice(0, 30)).slice(0, 8);
  const type = $('#practice').value;
  const workshop = type === 'taller';
  const practice = workshop || !type ? null : type;
  const res = await command('createRoom', {
    teamCount: Number($('#team-count').value), names: workshop ? [] : names, confirm: inProgress, practice, workshop,
  });
  if (res.ok) {
    $('#create').open = false;
    toast(practice ? 'Sala de práctica creada. El ingreso está abierto.' : 'Sala creada. El ingreso está abierto.');
  }
});

// Con registro, los equipos los crean los celulares: el número es el máximo y no se piden nombres.
function syncCreateForm() {
  const workshop = $('#practice').value === 'taller';
  $('#team-count-label').textContent = workshop ? 'Número máximo de equipos' : 'Número de equipos';
  $('#team-names-field').hidden = workshop;
}
$('#practice').addEventListener('change', syncCreateForm);
syncCreateForm();

$('#flash').addEventListener('click', () => command('flash'));

// ------------------------------------------------------------------ estadísticas (RF-EST-02…04)

const EXPORTS = [
  ['respuestas', 'Respuestas'],
  ['objetos', 'Objetos'],
  ['minijuegos', 'Minijuegos'],
  ['ranking', 'Ranking por ronda'],
  ['equipos', 'Resumen por equipo'],
  ['preguntas', 'Resumen por pregunta'],
  ['taller', 'Taller'],
  ['estudiantes', 'Estudiantes y notas'],
];
// La nota sale de los aciertos en las preguntas (game.json → grading); todo el equipo tiene la misma.
const STUDENT_COLUMNS = [
  ['estudiante', 'Estudiante'], ['equipo', 'Equipo'], ['aciertos', 'Aciertos'], ['preguntas', 'Preguntas'], ['nota', 'Nota'], ['taller', 'Taller'],
];
const TEAM_COLUMNS = [
  ['equipo', 'Equipo'], ['pct_aciertos', '% aciertos'], ['nota', 'Nota'], ['tiempo_medio_ms', 'Tiempo medio'], ['racha_maxima', 'Racha máx.'],
  ['puntos_preguntas', 'Preguntas'], ['puntos_objetos', 'Objetos'], ['puntos_minijuegos', 'Minijuegos'], ['ajustes_host', 'Ajustes'], ['total', 'Total'],
];
const QUESTION_COLUMNS = [
  ['pregunta', 'N.º'], ['dificultad', 'Dificultad'], ['correcta', 'Correcta'], ['pct_acierto', '% acierto'],
  ['tiempo_promedio_ms', 'Tiempo prom.'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'],
];

// Excel abre un CSV con el separador de listas del computador: ";" donde la coma es decimal
// (español) y "," en inglés. Por defecto, el formato de este navegador; se puede cambiar.
const usesDecimalComma = new Intl.NumberFormat().formatToParts(1.5).find((part) => part.type === 'decimal')?.value === ',';
const csvFormat = h('select', { class: 'input small', 'aria-label': 'Formato de los CSV' },
  h('option', { value: ';', selected: usesDecimalComma }, 'Excel en español (;)'),
  h('option', { value: ',', selected: !usesDecimalComma }, 'Excel en inglés (,)'));

replace($('#exports'),
  // Lo que se le entrega al profesor: un solo libro con todas las tablas; la primera hoja, las notas.
  h('button', { class: 'button small', type: 'button', onClick: () => download('format=xlsx') }, 'Todo en Excel (.xlsx)'),
  csvFormat,
  EXPORTS.map(([table, label]) => h('button', {
    class: 'button small secondary', type: 'button', onClick: () => download(`format=csv&table=${table}&sep=${encodeURIComponent(csvFormat.value)}`),
  }, `${label} (CSV)`)),
  h('button', { class: 'button small secondary', type: 'button', onClick: () => download('format=json') }, 'Log completo (JSON)'),
  h('button', { class: 'button small', type: 'button', onClick: showStats }, 'Ver resumen'));

async function exportRequest(query) {
  const res = await fetch(`/api/export?${query}`, { headers: { Authorization: `Bearer ${currentToken}` } });
  if (res.ok) return res;
  toast(res.status === 404 ? 'Todavía no hay sala.' : 'No se pudo descargar las estadísticas.');
  return null;
}

async function download(query) {
  const res = await exportRequest(query);
  if (!res) return;
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'estadisticas';
  const link = h('a', { href: URL.createObjectURL(await res.blob()), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function showStats() {
  const res = await exportRequest('format=json');
  if (!res) return;
  const { summary } = await res.json();
  const cell = (key, value) => (key.endsWith('_ms') && value !== '' ? formatMs(value) : value);
  const table = (rows, columns) => h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map(([, label]) => h('th', {}, label)))),
    h('tbody', {}, rows.map((row) => h('tr', {}, columns.map(([key]) => h('td', { class: 'mono' }, cell(key, row[key]))))))));
  replace($('#stats'),
    h('h3', {}, 'Por equipo'),
    summary.teams.length ? table(summary.teams, TEAM_COLUMNS) : h('p', { class: 'muted' }, 'Sin datos todavía.'),
    h('h3', {}, 'Por pregunta'),
    summary.questions.length ? table(summary.questions, QUESTION_COLUMNS) : h('p', { class: 'muted' }, 'Ninguna pregunta cerrada todavía.'),
    h('h3', {}, 'Por estudiante'),
    summary.students.length ? table(summary.students, STUDENT_COLUMNS) : h('p', { class: 'muted' }, 'Ningún equipo registró integrantes.'),
    h('p', { class: 'muted' }, `Actualizado a las ${new Date().toLocaleTimeString()}. Vuelve a pulsar «Ver resumen» para actualizarlo.`));
}

$('#announce-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#announce-text');
  const res = await command('announce', { text: input.value });
  if (res.ok) input.value = '';
});

// Mientras el host usa un <select> de la tabla, no se redibuja (perdería la selección).
$('#teams').addEventListener('focusout', () => setTimeout(() => {
  if (teamsRenderPending && !selectFocused()) renderTeams();
}));

const savedToken = loadToken();
if (savedToken) start(savedToken);
else showLogin();

function start(token) {
  stop();
  currentToken = token;
  socket = connect({ role: 'host', token });
  clock = createTimeSync(socket);

  socket.on('connect', () => {
    saveToken(token);
    setStatus($('#status'), 'ok');
    $('#login').hidden = true;
    $('#panel').hidden = false;
  });
  socket.on('disconnect', () => setStatus($('#status'), 'off'));
  socket.on('connect_error', (err) => {
    // Los errores del middleware no se reintentan solos; los de red sí.
    if (err.message !== 'unauthorized') return setStatus($('#status'), 'off');
    saveToken(null);
    stop();
    showLogin('Token inválido.');
  });
  socket.on('state:sync', (next) => {
    view = next;
    render();
  });
  socket.on('host:flash', ({ n, startsAt }) => runAt(startsAt, syncedClock, () => flash(n)));
}

function stop() {
  dropArena();
  clock?.stop();
  socket?.disconnect();
  socket = null;
  clock = null;
}

function showLogin(error) {
  setStatus($('#status'), error ? 'bad' : 'off');
  $('#panel').hidden = true;
  $('#login').hidden = false;
  $('#login-error').hidden = !error;
  $('#login-error').textContent = error ?? '';
  $('#token').focus();
}

function command(action, data = {}) {
  return sendOrToast(socket, 'host:command', { action, data });
}

// ------------------------------------------------------------------ render

function render() {
  applyTeamLimits();
  renderGame();
  renderLobby();
  if (selectFocused()) teamsRenderPending = true;
  else renderTeams();
}

function applyTeamLimits() {
  if (limitsApplied) return;
  const { minCount, maxCount, defaultCount } = view.teamLimits;
  Object.assign($('#team-count'), { min: minCount, max: maxCount, value: defaultCount });
  $('#practice').append(...view.minigames.map(({ id, name }) => h('option', { value: id }, `Práctica: ${name}`)));
  limitsApplied = true;
}

function renderGame() {
  const { room, phase } = view;
  const box = $('#game');
  if (!room) {
    $('#create').open = true;
    return replace(box, h('h2', {}, 'No hay sala'), h('p', { class: 'muted' }, 'Crea una sala para abrir el ingreso.'));
  }
  if (!room.started) {
    return replace(box,
      h('div', { class: 'eyebrow' }, `Sala ${room.id}`),
      h('h2', {}, 'Lobby'),
      h('p', { class: 'muted' }, !room.lobbyOpen
        ? 'El ingreso está cerrado.'
        : room.workshop
          ? 'El ingreso está abierto: cada grupo registra su equipo desde /play y el segundo celular se une después.'
          : 'El ingreso está abierto: los jugadores eligen equipo desde /play.'));
  }

  const paused = Boolean(room.paused);
  replace(box,
    room.recovered && h('div', { class: 'banner stack' },
      h('strong', {}, 'El servidor se reinició y la partida quedó en pausa.'),
      h('span', {}, `Fase: «${phaseTitle(phase)}». Al reanudar, esa fase empieza de nuevo.`)),
    h('div', { class: 'phase-head' },
      h('div', {},
        h('div', { class: 'eyebrow' }, `${roundLabel(phase)} · fase ${phase.index + 1} de ${room.planLength}`),
        h('h2', {}, phaseTitle(phase))),
      phase.kind !== 'duel' && countdown(phase, room)),
    h('p', { class: 'muted' }, phaseStatus(view)),
    phaseDetails(view),
    h('div', { class: 'row controls' },
      h('button', {
        class: 'button',
        type: 'button',
        disabled: !phase.waitingHost || paused || room.finished,
        onClick: () => command('next'),
      }, 'Siguiente'),
      h('button', {
        class: 'button secondary',
        type: 'button',
        disabled: room.finished,
        onClick: () => command(paused ? 'resume' : 'pause'),
      }, room.recovered ? 'Reanudar partida' : paused ? 'Reanudar' : 'Pausar'),
      h('button', {
        class: 'button secondary',
        type: 'button',
        disabled: paused || room.finished,
        onClick: () => confirm('¿Saltar esta fase?') && command('skip'),
      }, 'Saltar fase')),
    !room.finished && view.upcoming.length > 0 && h('p', { class: 'muted' },
      `Después: ${view.upcoming.map(phaseTitle).join(' → ')}`),
    room.practice?.minigame === 'arena' && bossesPicker(view));
}

// Práctica de la Arena: el host elige quién es jefe en el próximo intento, para que cada celular
// pruebe los dos roles sin tener que ajustar puntajes. Se aplica al entrar a las instrucciones.
// El cuadro solo se rehace si cambia lo que muestra, para no desmarcar las casillas mientras el host
// las elige.
let picker = { key: null, el: null };
function bossesPicker({ room, teams, phase }) {
  const groups = phase.kind === 'minigameIntro' || phase.kind === 'minigame' ? phase.data.groups : null;
  const key = JSON.stringify([teams.map((t) => t.id), room.practice.bosses, groups?.[0] ?? null]);
  if (picker.key !== key) picker = { key, el: buildBossesPicker({ room, teams, groups }) };
  return picker.el;
}

function buildBossesPicker({ room, teams, groups }) {
  const chosen = new Set(room.practice.bosses ?? []);
  const boxes = teams.map((team) => h('label', { class: 'row' },
    h('input', { type: 'checkbox', value: team.id, checked: chosen.has(team.id) }), teamChip(team)));
  const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? id;
  return h('div', { class: 'card stack' },
    h('h3', {}, 'Práctica: quién es jefe'),
    groups?.[0] && h('p', { class: 'muted' }, `Ahora es jefe: ${groups[0].map(nameOf).join(', ')}.`),
    h('div', { class: 'row' }, boxes),
    h('div', { class: 'row' },
      h('button', {
        class: 'button small',
        type: 'button',
        onClick: () => command('setBosses', { teamIds: boxes.map((box) => box.firstChild).filter((box) => box.checked).map((box) => box.value) }),
      }, 'Usar en el próximo intento'),
      h('button', { class: 'button small secondary', type: 'button', onClick: () => command('setBosses', { teamIds: [] }) }, 'Según el puntaje')),
    h('p', { class: 'muted' }, room.practice.bosses
      ? `Próximo intento: es jefe ${room.practice.bosses.map(nameOf).join(', ')}.`
      : 'Próximo intento: es jefe quien diga el puntaje, como en la partida (con todos en 0, el primer equipo).'));
}

// La Arena se monta una vez por fase: el panel se rehace con cada vista, pero su canvas sigue
// dibujando con los fotogramas.
function arenaBoard(view) {
  if (arena?.seq !== view.phase.seq) {
    dropArena();
    arena = { seq: view.phase.seq, board: createArenaBoard({ socket, clock: syncedClock, compact: true }) };
  }
  arena.board.update(view);
  return arena.board.el;
}

function dropArena() {
  arena?.board.destroy();
  arena = null;
}

function phaseStatus({ room, phase }) {
  if (room.finished) return 'Partida terminada.';
  if (room.paused) return 'En pausa: los temporizadores están detenidos.';
  if (phase.waitingHost) return 'Esperando a que pulses «Siguiente».';
  if (phase.kind === 'question') {
    const { answeredTeamIds, expectedTeamIds } = phase.data;
    return `${answeredTeamIds.length} de ${expectedTeamIds.length} equipos respondieron. Cierra al terminar el tiempo o cuando todos respondan.`;
  }
  if (phase.kind === 'draft') {
    const { pickedTeamIds, expectedTeamIds } = phase.data;
    return `${pickedTeamIds.length} de ${expectedTeamIds.length} equipos eligieron. Quien no elija recibe uno al azar.`;
  }
  if (phase.kind === 'itemUse') {
    const { confirmedTeamIds, expectedTeamIds } = phase.data;
    return `${confirmedTeamIds.length} de ${expectedTeamIds.length} equipos confirmaron. Las declaraciones son secretas hasta la resolución.`;
  }
  if (phase.kind === 'minigame') {
    if (phase.minigame === 'memoria') return 'Termina cuando no quedan cartas o al agotarse el tiempo máximo.';
    if (phase.minigame === 'traza') return 'Termina cuando todos aceptan la cadena o se quedan sin intentos, o al agotarse el tiempo máximo.';
    if (phase.minigame === 'flappy') return 'Termina cuando todos llegan o chocan, o al agotarse el tiempo máximo.';
    if (phase.minigame === 'arena') return 'Termina cuando derriban al jefe o al agotarse el tiempo.';
    return 'Termina al acabarse el tiempo.';
  }
  if (phase.kind === 'duel') {
    return `Piedra, papel o tijera: ${Math.round(phase.data.pickMs / 1000)} s por mano y elige un celular por lado (se alternan; si el del turno no está conectado, el otro). Quien no elige recibe una opción al azar y un empate repite la mano. Un Desafío contra un equipo sin estrellas no se juega. Avanza sola al haber ganador. «Saltar fase» sortea los duelos que falten.`;
  }
  return 'Avanza sola al terminar el tiempo.';
}

// Contenido de la fase para que el expositor lo comente. Durante la pregunta el host ve el
// enunciado y las opciones, pero no la correcta: no sale del servidor hasta cerrar (RF-PRE-08).
function phaseDetails({ phase, teams, room }) {
  if (phase.kind !== 'minigame' || phase.minigame !== 'arena') dropArena();
  const tips = room.fragmentsPerStar;
  if (phase.kind === 'duel') return duelHostBody({ phase, teams });
  if (phase.kind === 'question') {
    const { statement, options } = phase.data;
    return h('div', { class: 'stack' },
      h('div', { class: 'row' }, difficultyChip(phase.data)),
      statementBlock(statement),
      h('ul', { class: 'plain-list' }, options.map((text, index) => h('li', {}, optionBadge(index), ' ', text))));
  }
  if (phase.kind === 'questionResult') {
    const { correct, options, results } = phase.data;
    return h('div', { class: 'stack' },
      h('p', {}, 'Correcta: ', optionBadge(correct), ` ${options[correct]}`),
      resultsTable(teams, results));
  }
  if (phase.kind === 'draft') {
    const { offers, chosen } = phase.data;
    return h('ul', { class: 'plain-list' }, teams.map((team) => h('li', { class: 'row' },
      teamChip(team),
      h('span', { class: 'muted' }, `suerte ${offers[team.id].luck}:`),
      itemStrip(offers[team.id].codes),
      chosen[team.id] ? h('span', {}, '→ ', itemStrip(chosen[team.id])) : h('span', { class: 'muted' }, 'eligiendo…'))));
  }
  if (phase.kind === 'resolution') {
    const nameOf = (id) => teams.find((t) => t.id === id)?.name ?? id;
    return resolutionList(phase.data.events, nameOf);
  }
  if (phase.kind === 'minigameIntro') return introBody(phase.data, teams, null, { host: true });
  if (phase.kind === 'minigameGroups') return introBody({ ...phase.data, grouping: 'pairs', instructions: 'Formando grupos' }, teams, null, { host: true });
  if (phase.kind === 'minigame') {
    if (phase.minigame === 'clicker') return clickerBars(phase.data, teams);
    if (phase.minigame === 'traza') return trazaProgress(phase.data, teams);
    if (phase.minigame === 'flappy') return flappyProgress(phase.data, teams);
    if (phase.minigame === 'arena') return arenaBoard(view);
    return memoriaBoard({ phase, room: view.room, teams, clock });
  }
  if (phase.kind === 'minigameResult') return resultBody(phase.data, teams, null, tips, { host: true });
  if (phase.kind === 'finalRanking') {
    return h('div', { class: 'stack' }, highlightCards(phase.data.highlights, teams), rankingTable(teams, phase.data.ranking, tips));
  }
  if (RANKING_KINDS.has(phase.kind)) return rankingTable(teams, phase.data.ranking, tips);
  return null;
}

function renderLobby() {
  const { room, teams } = view;
  const box = $('#lobby');
  if (!room) return replace(box, h('p', { class: 'muted' }, 'Todavía no hay sala.'));
  if (room.started) {
    return replace(box, h('p', { class: 'muted' }, `Sala ${room.id}: partida ${room.finished ? 'terminada' : 'en curso'}.`));
  }
  const devices = teams.reduce((sum, team) => sum + occupancy(team), 0);
  const full = teams.length > 0 && teams.every((team) => occupancy(team) === 2);
  const complete = teams.filter((team) => occupancy(team) === 2).length;
  const finished = teams.filter((team) => team.workshopDone).length;
  // Iniciar con equipos que siguen en el taller es decisión del host: se le avisa antes.
  const start = (data) => {
    const pending = teams.length - finished;
    const warning = room.workshop && pending > 0
      ? `${pending === 1 ? 'Un equipo no ha' : `${pending} equipos no han`} terminado el taller. ¿Iniciar la partida de todos modos?`
      : null;
    if (!warning || confirm(warning)) command('start', data);
  };
  replace(box,
    h('p', {}, room.workshop
      ? `${teams.length} de ${room.workshop.maxTeams} equipos registrados · ${finished} terminaron el taller · ${complete} con sus 2 celulares.`
      : `${devices} de ${teams.length * 2} dispositivos en equipos.`),
    h('div', { class: 'row controls' },
      h('button', {
        class: 'button secondary',
        type: 'button',
        onClick: () => command('setLobby', { open: !room.lobbyOpen }),
      }, room.lobbyOpen ? 'Cerrar ingreso' : 'Abrir ingreso'),
      h('button', { class: 'button', type: 'button', disabled: !full, onClick: () => start({}) }, 'Iniciar partida'),
      !full && h('button', {
        class: 'button danger',
        type: 'button',
        disabled: devices === 0,
        onClick: () => confirm('Hay equipos incompletos. ¿Iniciar de todos modos?') && start({ force: true }),
      }, 'Forzar inicio')),
    !full && h('p', { class: 'muted' }, room.workshop
      ? '«Iniciar» se habilita cuando hay equipos y todos tienen sus 2 celulares. Al forzar, en los incompletos un solo celular cumple ambos roles.'
      : '«Iniciar» se habilita cuando todos los equipos tienen 2 dispositivos. Al forzar, los equipos vacíos quedan fuera y en los incompletos un solo dispositivo cumple ambos roles.'));
}

// Renombrar sirve en cualquier sala; quitar un equipo, solo en la sala con registro y antes de empezar.
function teamTools(team, room) {
  return h('div', { class: 'row' },
    h('button', {
      class: 'button small secondary',
      type: 'button',
      onClick: () => {
        const name = prompt('Nuevo nombre del equipo', team.name)?.trim();
        if (name && name !== team.name) command('renameTeam', { teamId: team.id, name });
      },
    }, 'Renombrar'),
    room.workshop && !room.started && h('button', {
      class: 'button small secondary',
      type: 'button',
      onClick: () => confirm(`¿Quitar el equipo «${team.name}»? Sus celulares quedan sin equipo.`) && command('removeTeam', { teamId: team.id }),
    }, 'Quitar'));
}

function renderTeams() {
  teamsRenderPending = false;
  const { room, teams, unassigned, consoles } = view;
  replace($('#teams'),
    room && h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Equipo', 'Puntos', 'Estrella', 'Objetos', 'Dispositivo A', 'Dispositivo B'].map((text) => h('th', {}, text)))),
      h('tbody', {}, teams.map((team) => h('tr', {},
        h('td', {}, h('div', { class: 'stack' },
          h('span', { class: 'nowrap' }, teamChip(team)),
          team.members.length > 0 && h('span', { class: 'muted' }, team.members.join(', ')),
          team.workshop && h('span', {}, 'Taller: ', h('strong', {}, team.workshop.stage === 'done' ? 'terminado' : team.workshop.where),
            team.workshop.total !== null && ` · ${team.workshop.first} de ${team.workshop.total} a la primera`),
          teamTools(team, room))),
        // Total = puntos del juego + pozo de estrellas; el ajuste del host toca los puntos del juego.
        h('td', { class: 'mono' }, h('div', { class: 'stack' },
          `${team.total ?? team.score} · racha ${team.streak}`,
          team.starPoints > 0 && h('span', { class: 'muted' }, `${team.score} del juego + ${team.starPoints} de estrellas`),
          room.started && adjustForm(team))),
        h('td', {}, starMeter(team, room.fragmentsPerStar)),
        h('td', {}, itemStrip(team.inventory ?? [], '—')),
        ['A', 'B'].map((slot) => h('td', {},
          team.slots[slot] ? deviceBox(team.slots[slot]) : h('span', { class: 'muted' }, 'libre')))))))),
    h('h3', {}, `Conectados sin equipo (${unassigned.length})`),
    unassigned.length === 0
      ? h('p', { class: 'muted' }, 'Ninguno.')
      : h('div', { class: 'stack' }, unassigned.map(deviceBox)),
    h('h3', {}, 'Proyector y host'),
    consoles.length === 0
      ? h('p', { class: 'muted' }, 'Ninguno.')
      : h('ul', {}, consoles.map((c) => h('li', {}, `${CONSOLE_NAMES[c.role]} · ${c.platform} · ${formatMs(c.rtt)}`))));
}

// Ajuste manual de puntos (RF-HOST-03): positivo suma, negativo resta; queda en el log.
function adjustForm(team) {
  const input = h('input', {
    class: 'input small mono', type: 'number', step: '50', placeholder: '±pts', 'aria-label': `Ajustar puntos de ${team.name}`,
  });
  return h('form', {
    class: 'row adjust',
    onSubmit: async (event) => {
      event.preventDefault();
      const points = Math.trunc(Number(input.value));
      if (!points) return toast('Escribe cuántos puntos sumar (o restar, con un signo menos).');
      if (!confirm(`¿${points > 0 ? 'Sumar' : 'Restar'} ${Math.abs(points)} puntos a ${team.name}? Queda registrado.`)) return;
      const res = await command('adjust', { teamId: team.id, points });
      if (!res.ok) return;
      input.value = '';
      toast(`${team.name}: ${res.applied > 0 ? '+' : ''}${res.applied} (ahora ${res.score}).`);
      if (teamsRenderPending) renderTeams();
    },
  }, input, h('button', { class: 'button small secondary', type: 'submit' }, 'Ajustar'));
}

function deviceBox(device) {
  return h('div', { class: 'device' },
    h('span', {
      class: `presence ${device.connected ? 'on' : 'off'}`,
      title: device.connected ? 'Conectado' : 'Desconectado',
    }),
    h('span', { class: 'mono' }, device.deviceId),
    h('span', { class: 'muted' }, `${device.platform ?? '—'} · ${formatMs(device.rtt)}`),
    view.room && h('select', {
      class: 'input small',
      'aria-label': `Mover ${device.deviceId}`,
      onChange: (event) => {
        const { value } = event.target;
        event.target.value = '';
        if (value) command('move', { deviceId: device.deviceId, teamId: value === '-' ? null : value });
      },
    },
    h('option', { value: '' }, 'Mover a…'),
    view.teams.map((team) => h('option', { value: team.id }, team.name)),
    h('option', { value: '-' }, 'Sin equipo')),
    h('button', {
      class: 'button small secondary',
      type: 'button',
      onClick: () => confirm(`¿Expulsar ${device.deviceId}? Tendrá que volver a entrar.`)
        && command('kick', { deviceId: device.deviceId }),
    }, 'Expulsar'));
}

// Mientras el host usa un <select> o escribe un ajuste en la tabla, no se redibuja (perdería lo que
// está eligiendo o escribiendo).
function selectFocused() {
  const active = document.activeElement;
  return ['SELECT', 'INPUT'].includes(active?.tagName) && $('#teams').contains(active);
}

// El token lo escribe el host; nunca está en el código del cliente (RNF-08).
function loadToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function saveToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* almacenamiento no disponible: se pedirá el token otra vez */ }
}
