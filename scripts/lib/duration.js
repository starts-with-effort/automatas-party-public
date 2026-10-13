// Duración de la partida (sección 9.3, RNF-18): estimación a partir de la configuración y medición
// real a partir del log de eventos de una partida jugada. La usa scripts/duration.js.
//
// Las filas son las de la tabla 9.3. Cada fase incluye la anticipación con que se anuncia (leadMs):
// en el log no se puede separar, porque la fase siguiente se anuncia al cerrar la anterior.
import { buildRoundPlan } from '../../server/core/RoundPlan.js';
import { MINIGAMES } from '../../server/minigames/index.js';
import { PHASES } from '../../server/phases/index.js';
import { minigameName } from '../../server/phases/minigame.js';

// Pantallas que esperan al host: cuánto las deja el expositor. Por defecto, lo que supone la tabla
// 9.3 (33 s por pregunta = lectura + ~20 s + 10 s de resultado; 75 s de uso + resolución = 45 + 30).
export const HOST_SCREENS_MS = {
  lobby: 300_000,
  questionResult: 10_000,
  minigameResult: 15_000,
  resolution: 30_000,
  ranking: 20_000,
};

const ROW_OF_KIND = {
  question: 'question',
  questionResult: 'question',
  draft: 'draft',
  roulette: 'roulette',
  minigameGroups: 'roulette',
  minigameIntro: 'roulette',
  minigame: 'minigame',
  minigameResult: 'minigameResult',
  itemUse: 'itemUse',
  resolution: 'itemUse',
  duel: 'duel',
  ranking: 'ranking',
  finalRanking: 'ranking',
};
// Fases que cuentan como una vez de su fila (la pregunta y su resultado son una pregunta).
const COUNTED = new Set(['question', 'draft', 'roulette', 'minigame', 'minigameResult', 'itemUse', 'duel', 'ranking', 'finalRanking']);
const ORDER = ['lobby', 'question', 'draft', 'roulette', 'minigame', 'minigameResult', 'itemUse', 'duel', 'ranking'];
const LABELS = {
  lobby: 'Lobby y explicación de reglas',
  question: 'Preguntas (lectura, respuesta y resultado)',
  draft: 'Draft de objetos',
  roulette: 'Ruleta, grupos e instrucciones',
  minigameResult: 'Resultado del minijuego',
  itemUse: 'Uso de objetos + resolución',
  duel: 'Duelos (solo si hay empate o Desafío)',
  ranking: 'Rankings',
};
// Los Duelos solo se juegan si hay alguno pendiente: lo fijo es 0 (se saltan sin anunciarse) y el
// máximo supone un duelo de DUEL_HANDS manos en cada uno (el tope real, maxRounds manos, casi nunca
// se alcanza: cada mano se decide con probabilidad 2/3).
const DUEL_HANDS = 2;
// Lo que dura el juego aunque termine antes: el Clicker siempre dura lo mismo y en el Flappy, si
// alguien llega, se recorre el nivel entero.
const FIXED_PLAY = { clicker: (settings) => settings.durationMs, flappy: (settings) => settings.levelMs };

// Estimación con la configuración: por fila, cuántas veces ocurre, lo fijo (lo que dura aunque todos
// actúen al instante y los minijuegos terminen antes) y el máximo (si se agotan todos los plazos).
export function estimateDuration(config, { hostMs = HOST_SCREENS_MS } = {}) {
  const plan = buildRoundPlan(config);
  const lead = config.timings.leadMs;
  const rows = createRows(config);
  rows.add('lobby', { count: 1, fixedMs: hostMs.lobby, maxMs: hostMs.lobby });
  for (const step of plan) {
    if (step.kind === 'duel') {
      const { introMs, pickMs, revealMs, resultMs } = config.duel;
      rows.add('duel', { count: 0, fixedMs: 0, maxMs: lead + introMs + DUEL_HANDS * (pickMs + revealMs) + resultMs });
      continue;
    }
    const { fixedMs, maxMs } = phaseSpan(config, step, hostMs);
    rows.add(rowKey(step), { count: COUNTED.has(step.kind) ? 1 : 0, fixedMs: lead + fixedMs, maxMs: lead + maxMs });
  }
  const list = rows.list();
  return {
    rows: list,
    fixedMs: sum(list, 'fixedMs'),
    maxMs: sum(list, 'maxMs'),
    leadMs: lead * plan.length,
    phases: plan.length,
  };
}

function phaseSpan(config, step, hostMs) {
  const handler = PHASES[step.kind];
  const span = handler.durationMs(config, step);
  if (span === null) {
    // Espera al host, o avanza sola con autoAdvanceMs; el ranking final es el cierre de la partida.
    const ms = handler.terminal ? hostMs.ranking : config.timings.autoAdvanceMs ?? hostMs[step.kind];
    return { fixedMs: ms, maxMs: ms };
  }
  if (step.kind === 'question') {
    return { fixedMs: config.questions.readingMs, maxMs: span + config.questions.answerGraceMs };
  }
  if (step.kind === 'minigame') {
    const settings = config.minigameRules[step.minigame];
    const grace = MINIGAMES[step.minigame].graceMs?.(settings) ?? 0;
    return { fixedMs: config.minigameRules.countdownMs + (FIXED_PLAY[step.minigame]?.(settings) ?? 0), maxMs: span + grace };
  }
  if (step.kind === 'draft' || step.kind === 'itemUse') return { fixedMs: 0, maxMs: span };
  return { fixedMs: span, maxMs: span }; // ruleta e instrucciones
}

// Medición con el log de una partida (data/events-<sala>.jsonl o el JSON exportado): cada fase dura
// desde que se anunció hasta que se anunció la siguiente. El ranking final cuenta 0: con él termina
// el log. Una fase que se repite tras reanudar desde el snapshot cuenta una sola vez.
export function measureDuration(events, config) {
  const plan = buildRoundPlan(config);
  const stepOf = new Map(plan.map((step) => [step.id, step]));
  // El minijuego que se jugó en cada ronda (pudo no ser el de la configuración actual).
  const played = new Map(events.filter((e) => e.type === 'minigame_groups').map((e) => [e.round, e.minigame]));
  const entered = events.filter((e) => e.type === 'phase_entered' && stepOf.has(e.phase));
  const created = events.find((e) => e.type === 'room_created');
  const started = events.find((e) => e.type === 'game_started');
  const final = entered.find((e) => stepOf.get(e.phase).kind === 'finalRanking');
  const rows = createRows(config);
  if (created && started) rows.add('lobby', { count: 1, realMs: started.ts - created.ts });
  const counted = new Set();
  entered.forEach((event, i) => {
    const step = stepOf.get(event.phase);
    const until = step.kind === 'finalRanking' ? event.ts : entered[i + 1]?.ts ?? events.at(-1).ts;
    const minigame = step.kind === 'minigame' ? played.get(step.round) ?? step.minigame : step.minigame;
    const first = !counted.has(step.id);
    counted.add(step.id);
    rows.add(rowKey({ ...step, minigame }), { count: first && COUNTED.has(step.kind) ? 1 : 0, realMs: until - event.ts });
  });

  let pausedMs = 0;
  let pausedAt = null;
  for (const event of events) {
    if (event.type === 'game_paused') pausedAt = event.ts;
    if (event.type === 'game_resumed' && pausedAt !== null) {
      pausedMs += event.ts - pausedAt;
      pausedAt = null;
    }
  }
  return {
    rows: rows.list(),
    gameMs: started && final ? final.ts - started.ts : null, // del inicio al ranking final
    lobbyMs: created && started ? started.ts - created.ts : null,
    finished: Boolean(final),
    phasesPlayed: counted.size,
    pausedMs,
    skipped: events.filter((e) => e.type === 'phase_closed' && e.reason === 'skip').length,
    recovered: events.filter((e) => e.type === 'game_recovered').length,
  };
}

function rowKey(step) {
  return step.kind === 'minigame' ? `minigame:${step.minigame}` : ROW_OF_KIND[step.kind];
}

// Filas en el orden de la tabla 9.3; los minijuegos, en el orden en que se juegan.
function createRows(config) {
  const rows = new Map();
  return {
    add(key, { count = 0, ...values }) {
      if (!rows.has(key)) {
        const minigame = key.startsWith('minigame:') ? key.slice('minigame:'.length) : null;
        rows.set(key, {
          key,
          label: minigame ? `Minijuego: ${minigameName(config, minigame)}` : LABELS[key],
          count: 0,
          fixedMs: 0,
          maxMs: 0,
          realMs: 0,
          order: rows.size,
        });
      }
      const row = rows.get(key);
      row.count += count;
      for (const [name, ms] of Object.entries(values)) row[name] += ms;
    },
    list() {
      const rank = (row) => ORDER.indexOf(row.key.startsWith('minigame:') ? 'minigame' : row.key);
      return [...rows.values()]
        .sort((a, b) => rank(a) - rank(b) || a.order - b.order)
        .map(({ order, ...row }) => row);
    },
  };
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + row[field], 0);
}
