// El taller de la exposición (docs/TALLER.md): dos ejercicios que cada equipo hace a su ritmo, sin
// tiempo ni puntos, antes de que empiece el quiz. Aquí está todo lo que decide el servidor, como
// funciones puras sobre el estado del taller de un equipo (team.workshop):
//
//   newWorkshop(now)                        estado inicial, al registrar el equipo
//   workshopAct(state, action, { now, random })   una acción de un celular → { ok, error?, reply?, events }
//   workshopView(state)                     lo que dibujan los dos celulares del equipo
//   workshopSummary(state)                  resumen para el host y la exportación
//
// Ejercicio 1, «Sé la pila»: el autómata lee una cadena y el equipo dice qué le pasa a la pila en
// cada paso (apilar, sacar, queda igual) o que el autómata se detiene; al final, si la cadena se
// acepta. Ejercicio 2, «Repara el autómata»: al PDA le falta una transición y el equipo la arma con
// tres fichas (qué lee, qué hay en el tope, qué deja); cinco cadenas de prueba dicen si ya quedó.
// Un error nunca cuesta nada: se explica y se intenta otra vez.
import {
  WORKSHOP_PDAS, canAccept, formatId, initialId, isAccepting, moves, pdaDiagram, runTrace, stackLabel, stateLabel, symbolLabel,
  transitionLabel,
} from './pda.js';

const fail = (error) => ({ ok: false, error, events: [] });

// ------------------------------------------------------------------ contenido

// Las tres cadenas del ejercicio 1, las mismas para todos los equipos.
export const RUNS = [
  { pda: 'anbn', word: 'aaabbb', mode: 'final' }, // la ejecución normal, con el paso ε al final
  { pda: 'anbn', word: 'abb', mode: 'final' }, // llega a q2 con «b» sin leer: no basta el estado final
  { pda: 'parens', word: '()()', mode: 'empty' }, // por pila vacía; a mitad de camino hay una rama ε que muere
];

// Cadenas para practicar otra vez desde el repaso. Las de paréntesis se aceptan todas: en una que no
// se acepta, ese autómata tendría dos pasos posibles sin que ninguno sea «el correcto».
export const EXTRA_RUNS = [
  { pda: 'anbn', word: 'aabb', mode: 'final' },
  { pda: 'anbn', word: 'ab', mode: 'final' },
  { pda: 'anbn', word: 'aab', mode: 'final' },
  { pda: 'anbn', word: 'aabbb', mode: 'final' },
  { pda: 'anbn', word: 'ba', mode: 'final' },
  { pda: 'parens', word: '(())', mode: 'empty' },
  { pda: 'parens', word: '()', mode: 'empty' },
  { pda: 'parens', word: '(()())', mode: 'empty' },
];
export const EXTRA_COUNT = 3; // cadenas de cada práctica

// Fichas del ejercicio 2: el equipo elige una de cada renglón (por su índice).
export const CHIPS = {
  read: ['a', 'b', ''],
  top: ['A', 'Z0'],
  leave: [[], ['A'], ['A', 'A'], ['Z0'], ['A', 'Z0']],
};

// Los dos retos del ejercicio 2. `at`: el estado donde va la transición que falta (un bucle);
// `missing`: la transición del autómata original que se quita (si el reto es agregar una, ninguna);
// `answer`: los índices de las fichas que lo resuelven; `accept` y `reject`: las cadenas de prueba.
export const LEVELS = [
  {
    pda: 'anbn',
    mode: 'final',
    at: 'q1',
    missing: (tr) => tr.from === 'q1' && tr.to === 'q1',
    answer: [1, 0, 0],
    goal: 'Debe aceptar aⁿbⁿ, pero rechaza aabb. Le falta una transición en q₁.',
    accept: ['ab', 'aabb', 'aaabbb'],
    reject: ['aab', 'abb'],
    solved: '«b, A / ε» saca una A por cada b. Cuando se acaban las A queda Z₀ en el tope y el autómata pasa a q₂.',
  },
  {
    pda: 'anbn',
    mode: 'empty',
    at: 'q2',
    missing: () => false,
    answer: [2, 1, 0],
    goal: 'Ahora el estado final no cuenta: debe aceptar aⁿbⁿ por pila vacía. Agrégale una transición en q₂.',
    accept: ['ab', 'aabb'],
    reject: ['aab', 'abb', 'ba'],
    solved: '«ε, Z₀ / ε» saca Z₀ sin leer nada. A q₂ solo se llega cuando las b igualaron a las a, así que N(P′) = {aⁿbⁿ}.',
  },
];

// ------------------------------------------------------------------ ejercicio 1: sé la pila

// Lo que le hace una transición a la pila: la deja con un símbolo más, con uno menos o igual.
export const stackAct = (tr) => (tr.push.length > 1 ? 'push' : tr.push.length < 1 ? 'pop' : 'same');

// Lo que toca hacer desde una ID: el paso con el que la cadena todavía se puede aceptar; si ninguno
// puede (la cadena no se acepta), el único que hay. Sin pasos posibles, el autómata se detiene.
export function expectedStep(run, id) {
  const pda = WORKSHOP_PDAS[run.pda];
  const all = moves(pda, id);
  if (all.length === 0) return { act: 'halt', move: null, all };
  const move = all.find((m) => canAccept(pda, m.next, run.mode)) ?? all[0];
  return { act: stackAct(pda.transitions[move.transition]), move, all };
}

// Por qué no era eso, con la transición exacta.
function whyStep(run, id, expected, act) {
  const pda = WORKSHOP_PDAS[run.pda];
  const state = stateLabel(id.state);
  const top = id.stack[0];
  const next = id.input[0];
  if (expected.act === 'halt') {
    if (top === undefined) return 'La pila está vacía: sin tope no aplica ninguna transición. El autómata se detiene.';
    return next
      ? `En ${state} no hay transición para «${next}» con ${symbolLabel(top)} en el tope, ni con ε. El autómata se detiene.`
      : `Ya no queda entrada y en ${state} no hay transición ε con ${symbolLabel(top)} en el tope. El autómata se detiene.`;
  }
  const tr = pda.transitions[expected.move.transition];
  const other = expected.all.find((m) => m !== expected.move && stackAct(pda.transitions[m.transition]) === act);
  if (other) return `«${pda.transitions[other.transition].label}» existe, pero por ahí la cadena ya no se acepta. La que sirve es «${tr.label}».`;
  if (act === 'halt') return `Sí hay una transición que aplica: «${tr.label}»${tr.read ? '' : ', que no lee nada'}.`;
  const result = { push: 'con un símbolo más', pop: 'con un símbolo menos', same: 'igual' }[expected.act];
  return `Aplica «${tr.label}»: ${tr.read ? `lee «${tr.read}»` : 'no lee nada'}, sale ${symbolLabel(tr.top)} y ${tr.push.length ? `entra ${stackLabel(tr.push)}` : 'no entra nada'}. La pila queda ${result}.`;
}

// El veredicto de una ejecución que ya se detuvo, con su porqué.
export function verdictText(run, id) {
  const pda = WORKSHOP_PDAS[run.pda];
  const accepted = isAccepting(pda, id, run.mode);
  if (id.input) {
    const final = run.mode === 'final' && pda.final.includes(id.state);
    return `No acepta: quedó «${id.input}» sin leer${final ? `, aunque ${stateLabel(id.state)} sea final` : ''}.`;
  }
  if (run.mode === 'empty') return accepted ? 'Acepta: leyó toda la cadena y la pila quedó vacía.' : 'No acepta: leyó todo, pero la pila no quedó vacía.';
  return accepted ? `Acepta: leyó toda la cadena y ${stateLabel(id.state)} es final.` : `No acepta: leyó todo, pero ${stateLabel(id.state)} no es final.`;
}

function startRun(e1) {
  const run = e1.runs[e1.run];
  Object.assign(e1, { id: initialId(WORKSHOP_PDAS[run.pda], run.word), last: null, phase: 'step', feedback: null, missed: false, steps: 0 });
}

function newExercise1(runs, again) {
  const e1 = { runs, run: 0, again, first: 0, total: 0, slips: [] };
  startRun(e1);
  return e1;
}

// Una respuesta buena: cuenta, y cuenta como «a la primera» si no hubo un intento fallido antes.
function hit(e1) {
  e1.total += 1;
  if (!e1.missed) e1.first += 1;
  e1.missed = false;
}

// Una respuesta equivocada: se explica; el tropiezo se anota una vez por paso.
function miss(e1, slip, text) {
  if (!e1.missed) e1.slips.push({ ...slip, text });
  e1.missed = true;
  e1.feedback = { kind: 'wrong', tapped: slip.tapped, text };
}

function actExercise1(state, action) {
  const e1 = state.e1;
  const run = e1.runs[e1.run];
  const pda = WORKSHOP_PDAS[run.pda];
  const at = formatId(e1.id);
  const base = { exercise: 1, run: e1.run, word: run.word, at, ...(e1.again ? { again: true } : {}) };

  if (action.type === 'stack') {
    if (e1.phase !== 'step') return fail('invalid_action');
    const expected = expectedStep(run, e1.id);
    const correct = action.act === expected.act;
    const event = { type: 'workshop_step', ...base, tapped: action.act, expected: expected.act, correct };
    if (!correct) {
      miss(e1, { word: run.word, at, tapped: action.act, expected: expected.act }, whyStep(run, e1.id, expected, action.act));
      return { ok: true, reply: { correct: false }, events: [event] };
    }
    hit(e1);
    e1.feedback = null;
    if (expected.act === 'halt') {
      e1.phase = 'verdict';
    } else {
      e1.id = expected.move.next;
      e1.last = expected.move.transition;
      e1.steps += 1;
    }
    return { ok: true, reply: { correct: true }, events: [event] };
  }

  if (action.type === 'verdict') {
    if (e1.phase !== 'verdict') return fail('invalid_action');
    const accepted = isAccepting(pda, e1.id, run.mode);
    const correct = action.accept === accepted;
    const tapped = action.accept ? 'accept' : 'reject';
    const event = { type: 'workshop_step', ...base, tapped, expected: accepted ? 'accept' : 'reject', correct };
    const text = verdictText(run, e1.id);
    if (!correct) {
      miss(e1, { word: run.word, at, tapped, expected: accepted ? 'accept' : 'reject' }, text);
      return { ok: true, reply: { correct: false }, events: [event] };
    }
    hit(e1);
    e1.phase = 'solved';
    e1.feedback = { kind: 'verdict', accepted, text };
    return { ok: true, reply: { correct: true }, events: [event] };
  }

  if (action.type === 'next') {
    if (e1.phase !== 'solved') return fail('invalid_action');
    if (e1.run + 1 < e1.runs.length) {
      e1.run += 1;
      startRun(e1);
      return { ok: true, events: [] };
    }
    return finishExercise(state, 1);
  }
  return fail('invalid_action');
}

// ------------------------------------------------------------------ ejercicio 2: repara el autómata

// El autómata del reto con la transición que armó el equipo (si ya eligió las tres fichas), y cómo
// le va con cada cadena de prueba. Depende solo del reto y de las fichas: se calcula una vez.
const evaluations = new Map();

export function evaluateLevel(levelIndex, sel) {
  const key = `${levelIndex}|${sel.join(',')}`;
  if (evaluations.has(key)) return evaluations.get(key);
  const level = LEVELS[levelIndex];
  const original = WORKSHOP_PDAS[level.pda];
  const base = original.transitions.filter((tr) => !level.missing(tr));
  const complete = sel.every((index) => index !== null);
  const parts = complete ? { read: CHIPS.read[sel[0]], top: CHIPS.top[sel[1]], push: CHIPS.leave[sel[2]] } : null;
  const custom = parts ? { from: level.at, to: level.at, ...parts, label: transitionLabel(parts) } : null;
  const pda = { ...original, transitions: custom ? [...base, custom] : base };
  const tests = [...level.accept.map((word) => [word, true]), ...level.reject.map((word) => [word, false])].map(([word, want]) => {
    const { accepted, steps } = runTrace(pda, word, level.mode);
    const end = steps.length ? steps.at(-1).next : initialId(pda, word);
    return {
      word,
      want,
      got: accepted,
      steps: steps.map(({ transition, next }) => {
        const tr = pda.transitions[transition];
        return { from: tr.from, to: tr.to, label: tr.label, read: tr.read, custom: tr === custom, id: next };
      }),
      end: endText(pda, end, accepted, level.mode),
    };
  });
  const result = { base: { ...original, transitions: base }, custom, tests, solved: tests.every((test) => test.got === test.want) };
  evaluations.set(key, result);
  return result;
}

// Cómo terminó una prueba: aceptó, o dónde y por qué se detuvo.
function endText(pda, id, accepted, mode) {
  const state = stateLabel(id.state);
  if (accepted) return `Acepta: leyó todo y ${mode === 'empty' ? 'la pila quedó vacía' : `${state} es final`}.`;
  if (id.input) {
    return id.stack.length
      ? `Se detiene: en ${state} no hay transición para «${id.input[0]}» con ${symbolLabel(id.stack[0])} en el tope.`
      : `Se detiene: la pila se vació y quedó «${id.input}» sin leer.`;
  }
  return mode === 'empty' ? 'Leyó todo, pero la pila no quedó vacía: no acepta.' : `Leyó todo, pero ${state} no es final: no acepta.`;
}

function newExercise2(again) {
  return { level: 0, sel: [null, null, null], solved: false, changes: 0, again, done: [] };
}

function actExercise2(state, action) {
  const e2 = state.e2;
  if (action.type === 'chip') {
    if (e2.solved) return fail('invalid_action');
    const options = [CHIPS.read, CHIPS.top, CHIPS.leave][action.slot];
    if (action.value !== null && action.value >= options.length) return fail('invalid_action');
    e2.sel[action.slot] = action.value;
    e2.changes += 1;
    const { custom, solved } = evaluateLevel(e2.level, e2.sel);
    e2.solved = solved;
    if (!solved) return { ok: true, events: [] };
    e2.done.push({ level: e2.level, changes: e2.changes });
    return {
      ok: true,
      reply: { solved: true },
      events: [{ type: 'workshop_level', exercise: 2, level: e2.level, changes: e2.changes, transition: custom.label, ...(e2.again ? { again: true } : {}) }],
    };
  }
  if (action.type === 'next') {
    if (!e2.solved) return fail('invalid_action');
    if (e2.level + 1 < LEVELS.length) {
      Object.assign(e2, { level: e2.level + 1, sel: [null, null, null], solved: false, changes: 0 });
      return { ok: true, events: [] };
    }
    return finishExercise(state, 2);
  }
  return fail('invalid_action');
}

// ------------------------------------------------------------------ el recorrido del taller

// Etapas: intro1 → e1 → intro2 → e2 → done (repaso y espera). Desde el repaso se puede practicar otra
// vez cualquiera de los dos ejercicios (again) y volver; lo de la primera vez queda en `summary`.
export function newWorkshop(now) {
  return { stage: 'intro1', seq: 0, startedAt: now, finishedAt: null, e1: null, e2: null, summary: { e1: null, e2: null }, practices: 0 };
}

function finishExercise(state, exercise) {
  const events = [];
  if (exercise === 1) {
    const { first, total, slips, again } = state.e1;
    if (!again) state.summary.e1 = { first, total, slips };
    events.push({ type: 'workshop_exercise', exercise: 1, first, total, slips: slips.length, ...(again ? { again: true } : {}) });
    state.e1 = null;
    state.stage = again ? 'done' : 'intro2';
  } else {
    const { done, again } = state.e2;
    if (!again) state.summary.e2 = { levels: done };
    events.push({ type: 'workshop_exercise', exercise: 2, levels: done, ...(again ? { again: true } : {}) });
    state.e2 = null;
    state.stage = 'done';
  }
  return { ok: true, events };
}

// Tres cadenas al azar para practicar, sin repetir y con al menos una de paréntesis.
function pickExtraRuns(random) {
  const pool = [...EXTRA_RUNS];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, EXTRA_COUNT);
  if (!picked.some((run) => run.pda === 'parens')) picked[EXTRA_COUNT - 1] = pool.slice(EXTRA_COUNT).find((run) => run.pda === 'parens');
  // Primero las de aⁿbⁿ: es el autómata que se acaba de ver.
  return picked.sort((a, b) => Number(a.pda === 'parens') - Number(b.pda === 'parens'));
}

// Una acción de cualquiera de los dos celulares del equipo. `action.seq` es el número de estado que
// tenía el celular al tocar: si ya cambió (el otro celular se adelantó, o fue un toque doble), la
// acción se descarta en vez de aplicarse al paso siguiente.
export function workshopAct(state, action, { now, random = Math.random }) {
  if (action.seq !== state.seq) return fail('stale_action');
  let result;
  if (action.type === 'begin') {
    if (state.stage === 'intro1') {
      state.e1 = newExercise1(RUNS, false);
      state.stage = 'e1';
    } else if (state.stage === 'intro2') {
      state.e2 = newExercise2(false);
      state.stage = 'e2';
    } else return fail('invalid_action');
    result = { ok: true, events: [{ type: 'workshop_begin', exercise: state.stage === 'e1' ? 1 : 2 }] };
  } else if (action.type === 'again') {
    if (state.stage !== 'done') return fail('invalid_action');
    if (action.exercise === 1) state.e1 = newExercise1(pickExtraRuns(random), true);
    else state.e2 = newExercise2(true);
    state.stage = action.exercise === 1 ? 'e1' : 'e2';
    state.practices += 1;
    result = { ok: true, events: [{ type: 'workshop_begin', exercise: action.exercise, again: true }] };
  } else if (action.type === 'back') {
    // Solo se puede dejar a medias una práctica; la primera vez los ejercicios se terminan.
    const exercise = state.stage === 'e1' ? state.e1 : state.stage === 'e2' ? state.e2 : null;
    if (!exercise?.again) return fail('invalid_action');
    state.e1 = null;
    state.e2 = null;
    state.stage = 'done';
    result = { ok: true, events: [] };
  } else if (state.stage === 'e1') {
    result = actExercise1(state, action);
  } else if (state.stage === 'e2') {
    result = actExercise2(state, action);
  } else {
    return fail('invalid_action');
  }
  if (!result.ok) return result;
  state.seq += 1;
  if (state.stage === 'done' && state.finishedAt === null) {
    state.finishedAt = now;
    const { e1 } = state.summary;
    result.events.push({ type: 'workshop_done', first: e1.first, total: e1.total, slips: e1.slips.length, ms: now - state.startedAt });
  }
  return result;
}

// ------------------------------------------------------------------ vistas

const diagrams = new Map(Object.values(WORKSHOP_PDAS).map((pda) => [pda.id, pdaDiagram(pda)]));
const stepView = (pda, transition) => {
  const { from, to, label, read } = pda.transitions[transition];
  return { from, to, label, read };
};

// Las tres ejecuciones del ejercicio 1 completas, para repasarlas paso a paso al terminar.
const REVIEW = RUNS.map((run) => {
  const pda = WORKSHOP_PDAS[run.pda];
  const steps = [];
  let id = initialId(pda, run.word);
  for (let expected = expectedStep(run, id); expected.act !== 'halt'; expected = expectedStep(run, id)) {
    id = expected.move.next;
    steps.push({ ...stepView(pda, expected.move.transition), act: expected.act, id });
  }
  return { word: run.word, mode: run.mode, pdaName: pda.name, pda: diagrams.get(pda.id), steps, accepted: isAccepting(pda, id, run.mode), verdict: verdictText(run, id) };
});

// Las fichas como se muestran: ε por «no lee» y «no deja nada».
const CHIP_LABELS = {
  read: CHIPS.read.map((symbol) => symbol || 'ε'),
  top: CHIPS.top.map(symbolLabel),
  leave: CHIPS.leave.map(stackLabel),
};

// Lo que dibujan los celulares del equipo (los dos ven lo mismo).
export function workshopView(state) {
  const base = { stage: state.stage, seq: state.seq, finished: state.finishedAt !== null };
  if (state.stage === 'e1') {
    const e1 = state.e1;
    const run = e1.runs[e1.run];
    const pda = WORKSHOP_PDAS[run.pda];
    return {
      ...base,
      again: e1.again,
      run: { index: e1.run, count: e1.runs.length, word: run.word, mode: run.mode, pdaName: pda.name, pda: diagrams.get(pda.id), pushSymbol: pda.stack[0] },
      id: e1.id,
      last: e1.last === null ? null : stepView(pda, e1.last),
      steps: e1.steps,
      phase: e1.phase,
      feedback: e1.feedback,
      score: { first: e1.first, total: e1.total },
    };
  }
  if (state.stage === 'e2') {
    const e2 = state.e2;
    const level = LEVELS[e2.level];
    const { base: pda, custom, tests } = evaluateLevel(e2.level, e2.sel);
    const diagram = pdaDiagram(pda);
    const blank = (index, labels) => (index === null ? '?' : labels[index]);
    return {
      ...base,
      again: e2.again,
      level: { index: e2.level, count: LEVELS.length, mode: level.mode, goal: level.goal, solvedText: level.solved },
      pda: {
        ...diagram,
        // El arco por armar: punteado mientras le falten fichas.
        edges: [...diagram.edges, {
          from: level.at,
          to: level.at,
          labels: [custom?.label ?? `${blank(e2.sel[0], CHIP_LABELS.read)}, ${blank(e2.sel[1], CHIP_LABELS.top)} / ${blank(e2.sel[2], CHIP_LABELS.leave)}`],
          hole: true,
          set: Boolean(custom),
        }],
      },
      options: CHIP_LABELS,
      sel: e2.sel,
      tests,
      solved: e2.solved,
    };
  }
  if (state.stage === 'done') return { ...base, summary: state.summary, practices: state.practices, review: REVIEW };
  return base;
}

// Resumen del taller de un equipo para el host y la exportación.
export function workshopSummary(state) {
  if (!state) return null;
  const { e1, e2 } = state.summary;
  let where = 'Leyendo las instrucciones';
  if (state.stage === 'e1') where = `${state.e1.again ? 'Practicando' : 'Ejercicio 1'} · cadena ${state.e1.run + 1} de ${state.e1.runs.length}`;
  else if (state.stage === 'e2') where = `${state.e2.again ? 'Practicando' : 'Ejercicio 2'} · reto ${state.e2.level + 1} de ${LEVELS.length}`;
  else if (state.stage === 'intro2') where = 'Terminó el ejercicio 1';
  else if (state.stage === 'done') where = 'En el repaso';
  return {
    stage: state.stage,
    where,
    finished: state.finishedAt !== null,
    first: e1?.first ?? null,
    total: e1?.total ?? null,
    slips: e1?.slips.length ?? null,
    changes: e2?.levels.map((level) => level.changes) ?? null,
    practices: state.practices,
    ms: state.finishedAt === null ? null : state.finishedAt - state.startedAt,
  };
}
