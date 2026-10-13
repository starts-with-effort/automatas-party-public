// Sala con registro y taller en el celular (docs/TALLER.md). El grupo registra su equipo (nombre e
// integrantes) desde un celular, hace los dos ejercicios del taller a su ritmo y, al terminar, queda
// en la ficha del equipo esperando el quiz; el segundo celular se une cuando quiera, tocando el
// equipo en la lista o escaneando el código que muestra el primero. El servidor guarda el estado del
// taller de cada equipo y decide cada respuesta: aquí solo se dibuja lo que trae la vista
// (`view.workshop`), igual en los dos celulares.
//
// Se monta una vez mientras dure el lobby: las vistas que llegan (otros equipos que se registran) no
// rehacen el formulario que alguien escribe, y cada pantalla solo se redibuja si cambió lo suyo.
import { minigameDemo } from './demos.js';
import { h, replace } from './dom.js';
import { errorMessage } from './errors.js';
import { formatId, stackColumn, stateName, travel, trazaDiagram } from './traza.js';
import { send, sendOrToast, toast } from './ui.js';
import { occupancy, slotDots } from './widgets.js';

// Los mismos topes que valida el servidor (server/domain/registration.js).
const TEAM_NAME_MAX = 24;
const MEMBER_NAME_MAX = 40;

const MODE = { final: 'estado final', empty: 'pila vacía' };
const symbol = (s) => (s === 'Z0' ? 'Z₀' : s);
const stillMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Dónde va cada estado de los autómatas del taller, en un lienzo vertical como el de la Traza.
const LAYOUTS = {
  anbn: { pos: { q0: [62, 46], q1: [62, 150], q2: [62, 254] }, view: { w: 270, h: 300 } },
  parens: { pos: { q: [62, 150] }, view: { w: 270, h: 300 } },
};

// Las cuatro respuestas del ejercicio 1: lo que le pasa a la pila en un paso.
const KEYS = [
  ['push', '+', (run) => `Apilar ${symbol(run.pushSymbol)}`, 'la pila queda con un símbolo más.'],
  ['pop', '−', () => 'Sacar', 'queda con un símbolo menos.'],
  ['same', '=', () => 'Queda igual', 'la transición no la cambia.'],
  ['halt', '■', () => 'Se detiene', 'ninguna transición aplica.'],
];

const REPLAY_STEP_MS = 700; // una prueba del ejercicio 2, paso a paso
const STACK_RESULT = { push: 'queda con un símbolo más', pop: 'queda con un símbolo menos', same: 'queda igual' };

// Las ideas del tema, para repasar mientras empieza el quiz.
const NOTES = [
  ['Una transición «a, X / α»', 'Lee a (o nada, si es ε), saca X del tope y pone α en su lugar. Con α = ε solo saca; con α = X la pila queda igual; con más símbolos, apila.'],
  ['Descripción instantánea (q, w, γ)', 'El estado, lo que falta leer y la pila con el tope a la izquierda. Cada paso del autómata lleva de una a la siguiente.'],
  ['Cuándo se detiene', 'Cuando ninguna transición aplica: no hay una para el símbolo que sigue con ese tope, ni una ε. Con la pila vacía tampoco hay pasos.'],
  ['Por estado final', 'Acepta si leyó toda la cadena y quedó en un estado final. Lo que quede en la pila no importa.'],
  ['Por pila vacía', 'Acepta si leyó toda la cadena y la pila quedó vacía. El estado no importa.'],
  ['No determinismo', 'Si hay varios pasos posibles, basta con que una de las ramas acepte.'],
];

// «#equipo=t3» en la dirección: el código que muestra el primer celular de un equipo.
function teamFromLink() {
  return /^#equipo=(t[1-9])$/.exec(location.hash)?.[1] ?? null;
}

// La cinta con el cabezal sobre el símbolo que sigue; lo ya leído, en gris.
function tape(word, left) {
  const read = word.length - left;
  return h('div', { class: 'tz-tape replay tl-tape', 'aria-label': `Cadena ${word}, faltan ${left} símbolos por leer` },
    [...word].map((c, i) => h('span', { class: i < read ? 'read' : i === read ? 'head' : null }, c)),
    h('span', { class: `tl-tape-end${left === 0 ? ' head' : ''}` }, 'fin'));
}

const dots = (index, count, done) => h('span', { class: 'tl-dots', 'aria-hidden': 'true' },
  Array.from({ length: count }, (_, i) => h('i', { class: i < index || done ? 'on' : i === index ? 'now' : null })));

// onFill(fill): avisa a la página cuando la pantalla pasa a repartir el alto (los ejercicios) o deja
// de hacerlo (formularios y ficha, que se desplazan).
export function createTallerLobby({ socket, onFill = () => {} }) {
  const el = h('section', { class: 'tl stack' });
  let view = null;
  let notes = {}; // avisos de la página (p. ej. que no puede mantener la pantalla encendida)
  let form = null; // formulario abierto: { el, edit, saved }
  let leaving = false; // «¿seguro?» antes de salir del equipo
  let teamOpen = false; // la ficha del equipo, abierta desde el taller
  let busy = false;
  let shownKey = null;
  let shownScreen = null; // la pantalla que está a la vista (para animar solo los cambios de pantalla)
  let shown = null; // lo último dibujado de un ejercicio, para animar lo que cambió
  let play = null; // prueba del ejercicio 2 que se está viendo correr: { word, i, seq }
  let playTimer = null;
  let reviewing = null; // repaso paso a paso, al terminar: { run, i }
  let fill = false; // los ejercicios reparten el alto de la pantalla
  let joinUrl = '';
  let linkTeam = teamFromLink();

  fetch('/api/info').then((res) => res.json()).then((info) => {
    joinUrl = info.joinUrl.replace(/^https?:\/\//, '');
    if (view) draw();
  }).catch(() => {});

  const redraw = () => {
    shownKey = null;
    draw();
  };

  async function join(teamId) {
    if (busy) return;
    busy = true;
    await sendOrToast(socket, 'lobby:join', { teamId });
    busy = false;
  }

  // Una acción del taller. Lleva el número de estado que se ve en pantalla: si el otro celular se
  // adelantó (o fue un toque doble), el servidor la descarta en vez de aplicarla al paso siguiente.
  async function act(action, node = null) {
    if (busy || !view?.workshop) return null;
    busy = true;
    node?.classList.add('pending');
    const res = await send(socket, 'taller:act', { ...action, seq: view.workshop.seq });
    busy = false;
    node?.classList.remove('pending');
    if (!res.ok && res.error !== 'stale_action') toast(errorMessage(res.error));
    return res;
  }

  // Si la página se abrió con el código de un equipo, entra a ese equipo sin pasar por la lista.
  function joinFromLink(mine) {
    if (!linkTeam || !view.room.lobbyOpen) return;
    const team = view.teams.find((t) => t.id === linkTeam);
    linkTeam = null;
    history.replaceState(null, '', location.pathname + location.search);
    if (mine) return;
    if (!team) return toast('Ese equipo ya no está: búscalo en la lista.');
    if (occupancy(team) >= 2) return toast('Ese equipo ya tiene sus dos celulares.');
    join(team.id);
  }

  function stopPlay() {
    clearInterval(playTimer);
    playTimer = null;
    play = null;
  }

  function draw() {
    const { room, teams, me } = view;
    const mine = teams.find((t) => t.id === me.teamId) ?? null;
    joinFromLink(mine);
    if (form) {
      // El formulario se cierra solo cuando ya no aplica: el equipo quedó creado, o lo quitaron
      // mientras alguien lo corregía.
      const stale = form.edit ? !mine : Boolean(mine);
      if (!stale && !form.saved) return;
      form = null;
      shownKey = null;
    }
    if (!mine) {
      leaving = false;
      teamOpen = false;
    }
    const w = mine ? view.workshop ?? null : null;
    if (play && play.seq !== w?.seq) stopPlay();
    if (w?.stage !== 'done') reviewing = null;
    // Qué pantalla toca: sin equipo; la ficha del equipo, abierta a mano desde el taller; la etapa
    // del taller; o, al terminar, el repaso (y su paso a paso).
    let screen = 'home';
    if (mine) screen = !w || (teamOpen && w.stage !== 'done') ? 'team' : w.stage !== 'done' ? w.stage : reviewing ? 'review' : 'wait';
    const teamKey = (t) => [t.id, t.name, t.members, t.slots];
    const key = JSON.stringify({
      home: [room.lobbyOpen, room.workshop, teams.map(teamKey)],
      team: [mine && teamKey(mine), leaving, joinUrl, notes],
      wait: [mine && teamKey(mine), leaving, joinUrl, notes, w?.summary, w?.seq],
      review: [reviewing, mine?.color],
      intro1: [mine?.name],
      intro2: [mine?.name],
      e1: [w, mine?.color],
      e2: [w, mine?.color, play && [play.word, play.i]],
    }[screen].concat(screen));
    if (key === shownKey) return;
    shownKey = key;
    fill = ['e1', 'e2', 'review'].includes(screen);
    onFill(fill);
    if (!fill) shown = null;
    if (screen === 'home') replace(el, home());
    else if (screen === 'team') replace(el, teamRoom(mine));
    else if (screen === 'wait') replace(el, waitRoom(mine, w));
    else if (screen === 'review') review(w, mine);
    else if (screen === 'e1') exercise1(w, mine);
    else if (screen === 'e2') exercise2(w, mine);
    else replace(el, intro(screen, mine));
    if (shownScreen !== null && shownScreen !== screen) land();
    shownScreen = screen;
  }

  // Al cambiar de pantalla, las piezas de la nueva llegan una tras otra, como en el resto del juego.
  function land() {
    if (stillMotion()) return;
    const root = el.firstElementChild?.classList.contains('tl-ex') ? el.firstElementChild : el;
    [...root.children].forEach((piece, index) => piece.animate(
      [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
      { duration: 320, delay: index * 45, easing: 'cubic-bezier(.34, 1.3, .64, 1)', fill: 'backwards' },
    ));
    scrollTo({ top: 0 });
  }

  // ------------------------------------------------------------------ sin equipo

  function home() {
    const { room, teams } = view;
    const open = room.lobbyOpen;
    const full = teams.length >= room.workshop.maxTeams;
    return [
      h('h1', {}, open ? 'Registra tu equipo' : 'El ingreso está cerrado'),
      open && h('p', { class: 'tl-lead' }, 'Una persona del grupo crea el equipo con su celular. La otra entra después con el suyo y se une.'),
      open && h('button', { class: 'button big-action', type: 'button', disabled: full, onClick: () => openForm(null) }, 'Crear mi equipo'),
      open && full && h('p', { class: 'hint' }, 'Ya están todos los equipos de la sala. Si el tuyo está en la lista, únete.'),
      teams.length > 0 && h('div', { class: 'stack' },
        h('h2', {}, '¿Tu equipo ya está registrado?'),
        open && h('p', { class: 'tl-lead' }, 'Tócalo para entrar como su segundo celular.'),
        h('div', { class: 'teams-grid' }, teams.map((team) => {
          const complete = occupancy(team) >= 2;
          return h('button', {
            type: 'button',
            class: `team-card tl-team${complete ? ' full' : ''}`,
            style: { '--team': team.color },
            disabled: !open || complete,
            onClick: () => join(team.id),
          },
          h('strong', {}, team.name),
          h('span', { class: 'tl-names' }, team.members.join(' · ')),
          h('span', { class: 'team-card-foot' }, slotDots(team), h('span', {}, complete ? 'Completo' : 'Unirme')));
        }))),
    ];
  }

  // ------------------------------------------------------------------ formulario

  // Crear un equipo (team = null) o corregir el nombre y los integrantes del propio.
  function openForm(team) {
    const limits = view.room.workshop.members;
    const name = h('input', {
      class: 'input', type: 'text', required: true, maxlength: TEAM_NAME_MAX, autocomplete: 'off', autocapitalize: 'words',
      enterkeyhint: 'next', placeholder: 'Por ejemplo: Los Autómatas', value: team?.name ?? '',
    });
    const list = h('div', { class: 'tl-members' });
    const inputs = () => [...list.querySelectorAll('input')];
    const add = h('button', { class: 'button small secondary', type: 'button' }, '+ Agregar integrante');
    const remove = h('button', { class: 'button small secondary', type: 'button' }, '− Quitar el último');
    // Se puede agregar hasta el máximo y quitar hasta el mínimo de integrantes.
    const sync = () => {
      add.hidden = list.children.length >= limits.max;
      remove.hidden = list.children.length <= limits.min;
    };
    const addMember = (value = '') => {
      const n = list.children.length + 1;
      list.append(h('label', { class: 'tl-member' }, h('b', {}, n),
        h('input', {
          class: 'input', type: 'text', maxlength: MEMBER_NAME_MAX, autocomplete: 'off', autocapitalize: 'words',
          placeholder: n <= limits.min ? 'Nombre y apellido' : 'Nombre y apellido (opcional)', 'aria-label': `Integrante ${n}`, value,
        })));
      sync();
    };
    const initial = team?.members ?? [];
    for (let i = 0; i < Math.max(limits.min, initial.length); i += 1) addMember(initial[i] ?? '');
    add.addEventListener('click', () => {
      addMember();
      inputs().at(-1).focus();
    });
    remove.addEventListener('click', () => {
      list.lastElementChild.remove();
      sync();
    });
    const submit = h('button', { class: 'button big-action', type: 'submit' }, team ? 'Guardar cambios' : 'Crear equipo');
    const close = h('button', { class: 'button secondary', type: 'button', onClick: () => { form = null; redraw(); } }, 'Volver');

    const body = h('form', {
      class: 'tl-card',
      onSubmit: async (event) => {
        event.preventDefault();
        if (busy) return;
        const members = inputs().map((input) => input.value.trim()).filter(Boolean);
        if (members.length < limits.min) {
          inputs().find((input) => !input.value.trim())?.focus();
          return toast(`Escribe los nombres de al menos ${limits.min} integrantes.`);
        }
        busy = true;
        submit.disabled = true;
        const res = await sendOrToast(socket, 'lobby:register', { name: name.value, members });
        busy = false;
        submit.disabled = false;
        if (!res.ok) return;
        navigator.vibrate?.(15);
        form.saved = true;
        if (form.edit) redraw(); // al crear, el formulario se cierra cuando llega la vista con el equipo
        else submit.disabled = true;
      },
    },
    h('label', { class: 'tl-field' }, h('span', {}, '¿Cómo se llama el equipo?'), name),
    h('div', { class: 'tl-field' },
      h('span', {}, `Integrantes (${limits.min} a ${limits.max})`),
      list, h('div', { class: 'row' }, add, remove)),
    submit, close);

    form = { el: body, edit: Boolean(team), saved: false };
    leaving = false;
    fill = false;
    onFill(fill);
    replace(el, h('h1', {}, team ? 'Corrige tu equipo' : 'Crea tu equipo'), body);
    name.focus();
  }

  // ------------------------------------------------------------------ ficha del equipo

  function teamCard(team) {
    const count = occupancy(team);
    return h('div', { class: 'tl-card tl-mine', style: { '--team': team.color } },
      h('strong', { class: 'tl-name' }, team.name),
      h('ul', { class: 'tl-people' }, team.members.map((name) => h('li', {}, name))),
      h('p', { class: 'tl-phones' }, slotDots(team), `${count} de 2 celulares`));
  }

  // El primer celular muestra el código con el que el segundo entra directo a este equipo.
  function secondPhone(team) {
    return h('div', { class: 'tl-card tl-qr' },
      h('h2', {}, 'Falta el segundo celular'),
      h('img', { src: `/api/join-qr.svg?team=${team.id}`, alt: `Código QR para entrar a ${team.name}`, width: 240, height: 240 }),
      h('p', {}, 'Escanéenlo con el otro celular del equipo.', joinUrl && [' También pueden entrar a ', h('strong', {}, joinUrl), ' y tocar ', h('strong', {}, `«${team.name}»`), '.']));
  }

  const lockNote = () => (notes.screenLock === 'unsupported' || notes.screenLock === 'denied') && h('p', { class: 'banner' },
    '💡 Este navegador no puede mantener la pantalla encendida: desactiva el bloqueo automático del celular mientras juegas.');

  // Corregir los datos del equipo o salir de él (con un «¿seguro?» antes).
  function teamActions(team) {
    const leave = async () => {
      if (busy) return;
      busy = true;
      await sendOrToast(socket, 'lobby:leave');
      busy = false;
    };
    if (leaving) {
      return h('div', { class: 'tl-card' },
        h('p', {}, occupancy(team) > 1
          ? 'Tu compañero sigue en el equipo y tú quedas sin equipo.'
          : 'Eres el único celular del equipo: si sales, el equipo se borra con su taller.'),
        h('div', { class: 'row' },
          h('button', { class: 'button danger', type: 'button', onClick: leave }, 'Sí, salir'),
          h('button', { class: 'button secondary', type: 'button', onClick: () => { leaving = false; redraw(); } }, 'No, quedarme')));
    }
    return h('div', { class: 'row tl-actions' },
      h('button', { class: 'button small secondary', type: 'button', onClick: () => openForm(team) }, 'Corregir nombre o integrantes'),
      h('button', { class: 'button small secondary', type: 'button', onClick: () => { leaving = true; redraw(); } }, 'Salir del equipo'));
  }

  // «Mi equipo», abierta desde el taller: el código del segundo celular y los datos del equipo.
  function teamRoom(team) {
    return [
      h('button', { class: 'button small secondary tl-back', type: 'button', onClick: () => { teamOpen = false; redraw(); } }, '← Volver al taller'),
      h('h1', {}, 'Mi equipo'),
      teamCard(team),
      occupancy(team) < 2 && secondPhone(team),
      lockNote(),
      teamActions(team),
    ];
  }

  // ------------------------------------------------------------------ repaso y espera

  // Al terminar el taller: aquí se queda el equipo hasta que empiece el quiz. Lo primero es que
  // entre el segundo celular; después, repasar: lo que les costó, las ejecuciones paso a paso, más
  // práctica y las ideas clave.
  function waitRoom(team, w) {
    const complete = occupancy(team) === 2;
    const { e1 } = w.summary;
    const again = (exercise, label) => {
      const node = h('button', { class: 'tl-key wide plain', type: 'button', onClick: () => act({ type: 'again', exercise }, node) }, label);
      return node;
    };
    return [
      h('h1', {}, complete ? '¡Listos para el quiz!' : '¡Taller terminado!'),
      complete
        ? h('p', { class: 'note' }, 'Ya están los dos celulares del equipo. El quiz empieza cuando todos los equipos estén listos; mientras tanto, repasen aquí.')
        : secondPhone(team),
      teamCard(team),
      h('div', { class: 'tl-card' },
        h('h2', {}, 'Mientras esperan'),
        h('button', { class: 'tl-key wide', type: 'button', onClick: () => { reviewing = { run: 0, i: 0 }; redraw(); } }, 'Repasar paso a paso'),
        again(1, 'Sé la pila con otras cadenas'),
        again(2, 'Reparar el autómata otra vez')),
      h('div', { class: 'tl-card' },
        h('h2', {}, 'Cómo les fue'),
        h('p', {}, e1.slips.length === 0
          ? `En «Sé la pila» les salieron a la primera los ${e1.total} pasos.`
          : `En «Sé la pila», ${e1.first} de ${e1.total} pasos les salieron a la primera. Estos fueron los que les costaron:`),
        e1.slips.length > 0 && h('ul', { class: 'tl-slips' }, e1.slips.map((slip) => h('li', {},
          h('strong', {}, `${slip.word} · ${slip.at}`), h('span', {}, slip.text))))),
      h('div', { class: 'tl-card' },
        h('h2', {}, 'Para repasar'),
        h('dl', { class: 'tl-notes' }, NOTES.map(([term, text]) => [h('dt', {}, term), h('dd', {}, text)]))),
      lockNote(),
      teamActions(team),
    ];
  }

  // Repaso paso a paso: las tres ejecuciones del ejercicio 1, hacia adelante y hacia atrás, sin
  // preguntas. El equipo avanza cuando quiere.
  function review(w, team) {
    const run = w.review[reviewing.run];
    const layout = LAYOUTS[run.pda.id];
    const { i } = reviewing;
    const step = i > 0 ? run.steps[i - 1] : null;
    const id = step ? step.id : { state: run.pda.start, input: run.word, stack: ['Z0'] };
    const forward = shown?.stage === 'review' && shown.run === reviewing.run && shown.i === i - 1;
    const sameRun = shown?.stage === 'review' && shown.run === reviewing.run;
    const diagram = trazaDiagram(run.pda, { current: id.state, last: step, token: team.color, layout });
    const board = h('div', { class: 'tz-board tl-board' }, diagram, stackColumn(id.stack, sameRun ? shown.stack : id.stack));
    const ended = i === run.steps.length;
    const go = (next) => { reviewing = next; redraw(); };

    let message;
    if (!step) message = h('p', { class: 'tl-msg' }, `Empieza en ${stateName(run.pda.start)} con Z₀ en la pila: `, h('strong', {}, formatId(id)));
    else {
      message = h('p', { class: `tl-msg${ended ? (run.accepted ? ' good' : ' grey') : ''}`, role: 'status' },
        `Paso ${i} de ${run.steps.length} · `, h('strong', {}, formatId(id)), h('br'),
        `«${step.label}»: ${step.read ? `lee «${step.read}»` : 'no lee nada'} y la pila ${STACK_RESULT[step.act]}.`,
        ended && [h('br'), 'Ya no aplica ninguna transición. ', h('strong', {}, run.verdict)]);
    }

    replace(el,
      h('div', { class: 'tl-ex' },
        h('div', { class: 'tl-ex-head' },
          h('p', { class: 'tl-eyebrow' }, 'Repaso · paso a paso'),
          h('button', { class: 'tl-link', type: 'button', onClick: () => go(null) }, 'Volver')),
        h('div', { class: 'tl-chips' }, w.review.map((r, index) => h('button', {
          class: 'tl-chip', type: 'button', 'aria-pressed': String(index === reviewing.run), onClick: () => go({ run: index, i: 0 }),
        }, r.word))),
        h('div', { class: 'tl-taperow' }, tape(run.word, id.input.length),
          h('span', { class: 'tz-ticket tl-ticket' }, 'Acepta por ', h('b', {}, MODE[run.mode]))),
        board, message,
        h('div', { class: 'tl-pad' },
          h('button', { class: 'tl-key plain center', type: 'button', disabled: i === 0, onClick: () => go({ run: reviewing.run, i: i - 1 }) }, '← Anterior'),
          h('button', { class: 'tl-key center', type: 'button', disabled: ended, onClick: () => go({ run: reviewing.run, i: i + 1 }) }, 'Siguiente →'))));

    if (forward && step) travel(diagram, step, 420, layout);
    shown = { stage: 'review', run: reviewing.run, i, stack: id.stack };
  }

  const teamLink = () => h('button', { class: 'tl-link', type: 'button', onClick: () => { teamOpen = true; redraw(); } }, 'Mi equipo');

  // ------------------------------------------------------------------ instrucciones

  function intro(stage, team) {
    const begin = h('button', { class: 'button big-action', type: 'button', onClick: () => act({ type: 'begin' }, begin) }, 'Empezar');
    const calm = h('p', { class: 'note' }, 'Háganlo con calma: no hay tiempo ni puntos. Si se equivocan, el celular explica por qué y lo intentan otra vez.');
    if (stage === 'intro1') {
      return [
        h('p', { class: 'tl-eyebrow' }, 'Equipo registrado · Taller · Ejercicio 1 de 2'),
        h('h1', {}, 'Sé la pila'),
        h('p', { class: 'tl-lead' }, 'El autómata lee una cadena, símbolo por símbolo. Ustedes dicen qué le pasa a la pila en cada paso:'),
        minigameDemo('taller1'),
        h('ul', { class: 'tl-keys-help' }, KEYS.map(([, icon, label, text]) => h('li', {},
          h('i', {}, icon), h('span', {}, h('strong', {}, `${label({ pushSymbol: 'A' }).replace(' A', '')}: `), text)))),
        h('p', { class: 'tl-lead' }, 'Cuando el autómata se detenga, dicen si la cadena se acepta.'),
        calm, begin, teamLink(),
      ];
    }
    return [
      h('p', { class: 'tl-eyebrow' }, 'Taller · Ejercicio 2 de 2'),
      h('h1', {}, 'Repara el autómata'),
      h('p', { class: 'tl-lead' }, 'Al autómata de aⁿbⁿ le falta una transición. Ármenla con tres fichas: qué lee, qué hay en el tope de la pila y qué deja en su lugar.'),
      minigameDemo('taller2'),
      h('p', { class: 'tl-lead' }, 'Abajo hay cadenas de prueba. En verde, el autómata hace lo que debe con esa cadena; en rojo, todavía no. Toquen una para verla correr paso a paso y descubrir dónde se detiene.'),
      calm, begin, teamLink(),
    ];
  }

  // Cabecera de un ejercicio: cuál es y por dónde van. En una práctica, la salida al repaso.
  function exerciseHead(text, index, count, w) {
    return h('div', { class: 'tl-ex-head' },
      h('p', { class: 'tl-eyebrow' }, w.again ? `Práctica · ${text}` : text),
      w.again
        ? h('button', { class: 'tl-link', type: 'button', onClick: () => act({ type: 'back' }) }, 'Volver al repaso')
        : dots(index, count, false));
  }

  // ------------------------------------------------------------------ ejercicio 1: sé la pila

  function exercise1(w, team) {
    const { run, id, last, phase, feedback } = w;
    const layout = LAYOUTS[run.pda.id];
    const sameRun = shown?.stage === 'e1' && shown.again === w.again && shown.run === run.index;
    const diagram = trazaDiagram(run.pda, { current: id.state, last, token: team.color, layout });
    const board = h('div', { class: 'tz-board tl-board' }, diagram, stackColumn(id.stack, sameRun ? shown.stack : id.stack));

    let message;
    if (feedback?.kind === 'wrong') message = h('p', { class: 'tl-msg bad', role: 'status' }, feedback.text);
    else if (phase === 'solved') message = h('p', { class: `tl-msg ${feedback.accepted ? 'good' : 'grey'}`, role: 'status' }, h('strong', {}, feedback.text));
    else if (phase === 'verdict') message = h('p', { class: 'tl-msg' }, 'El autómata se detuvo en ', h('strong', {}, formatId(id)), '. Miren qué quedó por leer, el estado y la pila.');
    else {
      message = h('p', { class: 'tl-msg' }, 'Descripción instantánea: ', h('strong', {}, formatId(id)), h('br'),
        last ? `Último paso: «${last.label}»` : 'Busquen en el diagrama la transición que aplica.');
    }

    const key = (action, name, icon, label, cls = '') => {
      const node = h('button', { class: `tl-key ${cls}`, type: 'button', dataset: { key: name }, onClick: () => act(action, node) },
        icon && h('i', {}, icon), label);
      return node;
    };
    let foot;
    if (phase === 'step') {
      foot = [h('p', { class: 'tl-ask' }, '¿Qué hace la pila en este paso?'),
        h('div', { class: 'tl-pad' }, KEYS.map(([name, icon, label]) => key({ type: 'stack', act: name }, name, icon, label(run))))];
    } else if (phase === 'verdict') {
      foot = [h('p', { class: 'tl-ask' }, `¿Acepta la cadena por ${MODE[run.mode]}?`),
        h('div', { class: 'tl-pad' }, key({ type: 'verdict', accept: true }, 'accept', null, 'Sí, acepta', 'yes'), key({ type: 'verdict', accept: false }, 'reject', null, 'No acepta', 'no'))];
    } else {
      const lastRun = run.index + 1 === run.count;
      foot = h('div', { class: 'tl-pad' }, key({ type: 'next' }, 'next', null, !lastRun ? 'Siguiente cadena' : w.again ? 'Terminar la práctica' : 'Seguir', 'wide'));
    }

    replace(el,
      h('div', { class: 'tl-ex' },
        exerciseHead(`Ejercicio 1 · Cadena ${run.index + 1} de ${run.count}`, run.index, run.count, w),
        h('div', { class: 'tl-taperow' }, tape(run.word, id.input.length),
          h('span', { class: 'tz-ticket tl-ticket' }, 'Acepta por ', h('b', {}, MODE[run.mode]))),
        board, message, h('div', { class: 'tl-foot' }, foot)));

    // Lo que cambió desde lo último dibujado: la ficha recorre el arco del paso nuevo, y un toque
    // equivocado sacude su botón.
    if (sameRun && last && w.steps === shown.steps + 1) travel(diagram, last, 420, layout);
    if (feedback?.kind === 'wrong' && shown && shown.seq !== w.seq) {
      el.querySelector(`.tl-key[data-key="${feedback.tapped}"]`)?.classList.add('wrong');
      navigator.vibrate?.(60);
    }
    shown = { stage: 'e1', again: w.again, run: run.index, steps: w.steps, stack: id.stack, seq: w.seq };
  }

  // ------------------------------------------------------------------ ejercicio 2: repara el autómata

  // Ver correr una prueba: avanza sola, un paso cada REPLAY_STEP_MS, y se queda en el último.
  function startPlay(word, steps) {
    stopPlay();
    play = { word, i: stillMotion() ? steps : 0, seq: view.workshop.seq };
    if (play.i < steps) {
      playTimer = setInterval(() => {
        play.i += 1;
        if (play.i >= steps) clearInterval(playTimer);
        draw();
      }, REPLAY_STEP_MS);
    }
    draw();
  }

  function exercise2(w, team) {
    const { level, pda, options, sel, tests, solved } = w;
    const layout = LAYOUTS[pda.id];
    const test = play ? tests.find((t) => t.word === play.word) : null;
    const step = test && play.i > 0 ? test.steps[play.i - 1] : null;
    const id = step ? step.id : { state: pda.start, input: test?.word ?? '', stack: ['Z0'] };
    const samePlay = Boolean(test) && shown?.stage === 'e2' && shown.word === test.word && shown.i === play.i - 1;
    const diagram = trazaDiagram(pda, { current: id.state, last: step, token: team.color, layout });
    const board = h('div', { class: 'tz-board tl-board' }, diagram, stackColumn(id.stack, samePlay ? shown.stack : id.stack));

    let message;
    if (test) {
      const ended = play.i === test.steps.length;
      const right = test.got === test.want;
      message = h('p', { class: `tl-msg${ended ? (right ? ' good' : ' bad') : ''}`, role: 'status' },
        h('strong', {}, test.word), ` · paso ${play.i} de ${test.steps.length} · `, h('strong', {}, formatId(id)), h('br'),
        ended ? [test.end, !right && h('strong', {}, test.want ? ' Debería aceptar.' : ' Debería rechazar.')] : step ? `Usa «${step.label}».` : `Empieza en ${stateName(pda.start)} con Z₀ en la pila.`);
    } else if (solved) message = h('p', { class: 'tl-msg good', role: 'status' }, level.solvedText);
    else message = h('p', { class: 'tl-msg' }, 'Toquen una prueba para verla correr paso a paso. En verde, el autómata hace lo que debe; en rojo, todavía no.');

    const chips = (slot, labels) => h('div', { class: 'tl-chips' }, labels.map((label, index) => {
      const node = h('button', {
        class: 'tl-chip', type: 'button', 'aria-pressed': String(sel[slot] === index),
        onClick: () => act({ type: 'chip', slot, value: sel[slot] === index ? null : index }, node),
      }, label);
      return node;
    }));
    const row = (caption, body) => h('div', { class: 'tl-row' }, h('span', { class: 'tl-cap' }, caption), body);
    const testChip = (t) => {
      const right = t.got === t.want;
      return h('button', {
        class: `tl-test ${right ? 'pass' : 'fail'}`, type: 'button', 'aria-pressed': String(play?.word === t.word),
        'aria-label': `${t.word}: ${t.got ? 'acepta' : 'rechaza'}, ${right ? 'bien' : 'todavía no'}`,
        onClick: () => startPlay(t.word, t.steps.length),
      }, t.word, h('i', {}, right ? '✓' : '✗'));
    };
    const lastLevel = level.index + 1 === level.count;
    const next = h('button', { class: 'tl-key wide', type: 'button', onClick: () => act({ type: 'next' }, next) },
      !lastLevel ? 'Siguiente reto' : w.again ? 'Terminar la práctica' : 'Terminar el taller');

    replace(el,
      h('div', { class: 'tl-ex' },
        exerciseHead(`Ejercicio 2 · Reto ${level.index + 1} de ${level.count}`, level.index, level.count, w),
        h('p', { class: 'tl-goal' }, level.goal, ' ', h('span', { class: 'tz-ticket tl-ticket' }, 'Acepta por ', h('b', {}, MODE[level.mode]))),
        board, message,
        h('div', { class: 'tl-foot' },
          solved
            ? h('div', { class: 'tl-solved' }, h('strong', {}, '¡Autómata reparado!'), next)
            : h('div', { class: 'tl-build' }, row('Lee', chips(0, options.read)), row('Tope', chips(1, options.top)), row('Deja', chips(2, options.leave))),
          h('div', { class: 'tl-build' },
            row('Acepta', h('div', { class: 'tl-tests' }, tests.filter((t) => t.want).map(testChip))),
            row('Rechaza', h('div', { class: 'tl-tests' }, tests.filter((t) => !t.want).map(testChip)))))));

    if (samePlay && step) travel(diagram, step, 420, layout);
    if (solved && shown?.stage === 'e2' && !shown.solved) navigator.vibrate?.([30, 60, 30]);
    shown = { stage: 'e2', word: test?.word ?? null, i: play?.i ?? null, stack: id.stack, solved };
  }

  return {
    el,
    get fill() {
      return fill;
    },
    update(next, pageNotes = {}) {
      view = next;
      notes = pageNotes;
      draw();
    },
    destroy() {
      stopPlay();
    },
  };
}
