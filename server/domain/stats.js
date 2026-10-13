// Estadísticas de la partida (RF-EST-01…04, RF-RNK-03), calculadas desde el log de eventos.
// Funciones puras: reciben los eventos de la sala, los equipos y el catálogo de objetos, y devuelven
// filas listas para mostrar o exportar.

const LETTERS = ['A', 'B', 'C', 'D'];
const ROUND_LABEL = (round) => (round === 6 ? 'Final' : String(round));

const ofType = (events, type) => events.filter((event) => event.type === type);
const average = (values) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);
const percent = (part, total) => (total === 0 ? null : Math.round((100 * part) / total));

// Nota por aciertos en las preguntas: la máxima con todas correctas y 0 con ninguna; una pregunta sin
// responder cuenta como incorrecta. Sin preguntas jugadas todavía no hay nota.
const DEFAULT_GRADING = { max: 5, decimals: 1 };
export function grade(correct, total, { max, decimals } = DEFAULT_GRADING) {
  if (total === 0) return '';
  const factor = 10 ** decimals;
  return Math.round((max * correct * factor) / total) / factor;
}

// Segundos desde que empezó la partida (o desde el primer evento), para ubicar cada evento.
function gameClock(events) {
  const start = events.find((event) => event.type === 'game_started')?.ts ?? events[0]?.ts ?? 0;
  return (ts) => Math.round((ts - start) / 100) / 10;
}

function nameLookup(teams) {
  const names = new Map(teams.map((team) => [team.id, team.name]));
  return (id) => (id ? names.get(id) ?? id : '');
}

// ------------------------------------------------------------------ tablas para exportar

// Una fila por equipo y pregunta (RF-EST-01): opción, t, acierto, puntos y multiplicadores.
export function answersTable({ events, teams, difficultyName = (id) => id }) {
  const nameOf = nameLookup(teams);
  const at = gameClock(events);
  const answeredAt = new Map(ofType(events, 'answer_received').map((e) => [`${e.questionId}:${e.teamId}`, e.ts]));
  return ofType(events, 'question_closed').flatMap((question) => question.results.map((row) => {
    const ts = answeredAt.get(`${question.questionId}:${row.teamId}`);
    return {
      pregunta: question.number,
      id: question.questionId,
      dificultad: question.difficulty ? difficultyName(question.difficulty) : '',
      equipo: nameOf(row.teamId),
      respondio: row.answered,
      opcion: row.option === null ? '' : LETTERS[row.option],
      correcta: LETTERS[question.correct],
      acierto: row.correct,
      t_ms: row.t ?? '',
      puntos: row.points,
      racha: row.streak,
      multiplicador: Math.round(row.multiplier * 10_000) / 10_000,
      modificadores: (row.modifiers ?? []).join(' '),
      segunda_vida: Boolean(row.secondChance),
      ajustes_objetos: (row.adjustments ?? []).map((adj) => `${adj.code} ${adj.points > 0 ? '+' : ''}${adj.points}`).join('; '),
      segundo_respuesta: ts === undefined ? '' : at(ts),
    };
  }));
}

const RESOLUTION_EVENT = {
  defense: 'defensa activada',
  reflected: 'reflejado',
  blocked: 'bloqueado',
  hit: 'efecto aplicado',
  powerup: 'potenciador aplicado',
  armed: 'programado',
};

// Una fila por cada paso de la vida de un objeto (RF-EST-01): ofrecido, elegido, asignado, usado,
// bloqueado, reflejado…
export function itemsTable({ events, teams, itemName = (code) => code }) {
  const nameOf = nameLookup(teams);
  const at = gameClock(events);
  const rows = [];
  const add = (event, round, teamId, code, evento, target = '', detalle = '') => rows.push({
    segundo: at(event.ts), ronda: round, equipo: nameOf(teamId), codigo: code, objeto: itemName(code), evento, objetivo: nameOf(target), detalle,
  });
  let round = null;
  for (const event of events) {
    if (event.type === 'items_offered') {
      round = event.round;
      for (const [teamId, offer] of Object.entries(event.offers)) {
        for (const code of offer.codes) add(event, round, teamId, code, 'ofrecido', '', `suerte ${offer.luck}`);
        if (offer.extra) add(event, round, teamId, offer.extra, 'adicional por no responder');
      }
    } else if (event.type === 'items_picked') {
      for (const code of event.codes) add(event, round, event.teamId, code, 'elegido');
    } else if (event.type === 'items_assigned') {
      for (const code of event.codes) add(event, round, event.teamId, code, 'asignado al azar');
    } else if (event.type === 'items_resolved') {
      for (const d of event.declarations) add(event, event.round, d.teamId, d.code, 'usado', d.targetTeamId ?? '');
      for (const e of event.events) {
        const detalle = [e.by ? `por ${nameOf(e.by)}` : '', e.self ? 'contra sí mismo' : ''].filter(Boolean).join(' ');
        add(event, event.round, e.source, e.code, RESOLUTION_EVENT[e.kind] ?? e.kind, e.target ?? '', detalle);
      }
    } else if (event.type === 'duel_finished' && event.kind === 'desafio') {
      const [[attacker], [target]] = event.sides;
      const won = event.winner === 0;
      const { fragments = 0, stars = 0 } = event.outcome ?? {};
      add(event, event.round, attacker, 'DS', won ? 'duelo ganado' : 'duelo perdido', target,
        won ? `robó ${fragments} fragmentos y ${stars} estrellas` : '');
    } else if (event.type === 'duel_skipped' && event.kind === 'desafio') {
      const [[attacker], [target]] = event.sides;
      add(event, event.round, attacker, 'DS', 'duelo no jugado', target, 'el desafiado no tenía nada que robar');
    }
  }
  return rows;
}

// Una fila por equipo y minijuego (RF-EST-01).
export function minigamesTable({ events, teams, minigameName = (id) => id }) {
  const nameOf = nameLookup(teams);
  return ofType(events, 'minigame_closed').flatMap((result) => result.groups.flatMap((group) => group.teamIds.map((teamId) => {
    const award = result.awards.find((a) => a.teamId === teamId);
    return {
      ronda: result.round,
      minijuego: minigameName(result.minigame),
      equipo: nameOf(teamId),
      grupo: group.teamIds.map(nameOf).join(' + '),
      resultado: group.label ?? `${group.score ?? ''} ${result.metric ?? ''}`.trim(),
      gano: Boolean(group.winner),
      puntos: award?.points ?? 0,
      compensacion: award?.catchUp ? Math.round(award.catchUp * 100) / 100 : '',
      racha: award?.streak ?? 0,
      fragmento: (result.fragments ?? []).some((f) => f.teamId === teamId),
      desempate: result.duel ? 'Duelo' : '',
      titular: result.headline ?? '',
    };
  })));
}

// Puntaje de cada equipo antes del uso de objetos y al final de cada ronda (RF-EST-01).
export function rankingTable({ events, teams }) {
  const nameOf = nameLookup(teams);
  return ofType(events, 'ranking').flatMap((event) => event.ranking.map((row) => ({
    ronda: ROUND_LABEL(event.round),
    momento: event.before ? 'antes de los objetos' : 'fin de ronda',
    puesto: row.position,
    equipo: nameOf(row.teamId),
    puntos: row.score,
    puntos_estrellas: row.starPoints ?? 0,
    racha: row.streak,
    cambio: row.delta ?? '',
  })));
}

// ------------------------------------------------------------------ resúmenes

// Puntos de cada equipo por fuente. Suman exactamente el total final: cada evento guarda lo que se
// aplicó de verdad (después de los pisos), y las estrellas son el pozo que el equipo tiene al final
// (fragmentos y estrellas, después de los robos del Desafío).
export function pointsBySource({ events, teams }) {
  const sources = Object.fromEntries(teams.map((team) => [team.id, { preguntas: 0, objetos: 0, minijuegos: 0, estrellas: 0, host: 0 }]));
  const add = (teamId, key, points) => {
    if (sources[teamId]) sources[teamId][key] += points;
  };
  for (const event of events) {
    if (event.type === 'question_closed') {
      for (const row of event.results) {
        add(row.teamId, 'preguntas', row.points);
        for (const adj of row.adjustments ?? []) add(row.teamId, 'objetos', adj.points);
      }
    } else if (event.type === 'items_resolved') {
      for (const row of event.teams ?? []) add(row.teamId, 'objetos', row.scoreAfter - row.scoreBefore);
    } else if (event.type === 'minigame_closed') {
      for (const award of event.awards) add(award.teamId, 'minijuegos', award.points);
    } else if (event.type === 'score_adjusted') {
      add(event.teamId, 'host', event.applied);
    }
  }
  for (const team of teams) add(team.id, 'estrellas', team.starPoints ?? 0);
  return sources;
}

// Resumen por equipo (RF-EST-03): % de aciertos, tiempo medio de respuesta, racha máxima y puntos por fuente.
export function teamSummary({ events, teams, grading = DEFAULT_GRADING }) {
  const questions = ofType(events, 'question_closed');
  const sources = pointsBySource({ events, teams });
  return teams.map((team) => {
    const rows = questions.map((q) => q.results.find((r) => r.teamId === team.id)).filter(Boolean);
    const answered = rows.filter((r) => r.answered);
    const correct = rows.filter((r) => r.correct).length;
    const time = average(answered.map((r) => r.t).filter((t) => t !== null));
    const maxStreak = Math.max(team.maxStreak ?? 0, ...rows.map((r) => r.streak));
    const s = sources[team.id];
    return {
      equipo: team.name,
      integrantes: (team.members ?? []).join(', '),
      preguntas: rows.length,
      respondidas: answered.length,
      aciertos: correct,
      pct_aciertos: percent(correct, rows.length) ?? '',
      nota: grade(correct, rows.length, grading),
      tiempo_medio_ms: time === null ? '' : Math.round(time),
      racha_maxima: maxStreak,
      puntos_preguntas: s.preguntas,
      puntos_objetos: s.objetos,
      puntos_minijuegos: s.minijuegos,
      puntos_estrellas: s.estrellas,
      ajustes_host: s.host,
      fragmentos: team.fragments ?? 0,
      estrellas: team.stars ?? 0,
      total: team.score + (team.starPoints ?? 0),
    };
  });
}

// Una fila por estudiante, para entregar las notas: cada integrante que el equipo escribió al
// registrarse, con los aciertos y la nota de su equipo (todos los de un equipo tienen la misma). En
// orden alfabético, para cotejarla con la lista del curso. Los equipos sin integrantes (sala de
// equipos fijos) no tienen filas.
export function studentsTable({ events, teams, grading = DEFAULT_GRADING }) {
  const summary = teamSummary({ events, teams, grading });
  return teams
    .flatMap((team, index) => (team.members ?? []).map((name) => ({
      estudiante: name,
      equipo: team.name,
      preguntas: summary[index].preguntas,
      aciertos: summary[index].aciertos,
      pct_aciertos: summary[index].pct_aciertos,
      nota: summary[index].nota,
      taller: !team.workshop ? '' : team.workshop.finishedAt !== null ? 'terminado' : 'sin terminar',
    })))
    .sort((a, b) => a.estudiante.localeCompare(b.estudiante, 'es', { sensitivity: 'base' }));
}

const WORKSHOP_ANSWER = { push: 'Apilar', pop: 'Sacar', same: 'Queda igual', halt: 'Se detiene', accept: 'Acepta', reject: 'No acepta' };

// El taller de cada equipo registrado (docs/TALLER.md): quiénes son, si lo terminaron y cómo les
// fue. No es un puntaje: sirve para saber qué pasos conviene repasar con el salón. Sale del estado
// del taller de cada equipo; en una sala de equipos fijos no hay filas.
export function workshopTable({ teams }) {
  return teams.filter((team) => team.workshop).map((team) => {
    const { stage, startedAt, finishedAt, summary, practices } = team.workshop;
    const { e1, e2 } = summary;
    const changes = (level) => e2?.levels.find((row) => row.level === level)?.changes ?? '';
    return {
      equipo: team.name,
      integrantes: (team.members ?? []).join(', '),
      termino: finishedAt !== null,
      etapa: { intro1: 'instrucciones 1', e1: 'ejercicio 1', intro2: 'instrucciones 2', e2: 'ejercicio 2', done: 'repaso' }[stage] ?? stage,
      minutos: finishedAt === null ? '' : Math.round((finishedAt - startedAt) / 6000) / 10,
      pasos_a_la_primera: e1?.first ?? '',
      pasos: e1?.total ?? '',
      tropiezos: e1?.slips.length ?? '',
      // Dónde tropezó: la cadena, la descripción instantánea, lo que tocó y lo que era.
      donde: (e1?.slips ?? []).map((slip) => `${slip.word} ${slip.at}: ${WORKSHOP_ANSWER[slip.tapped]} en vez de ${WORKSHOP_ANSWER[slip.expected]}`).join(' | '),
      fichas_reto_1: changes(0),
      fichas_reto_2: changes(1),
      practicas: practices,
    };
  });
}

// Resumen por pregunta (RF-EST-04): % de acierto, tiempo promedio y distribución de opciones.
export function questionSummary({ events, difficultyName = (id) => id }) {
  return ofType(events, 'question_closed').map((question) => {
    const rows = question.results;
    const answered = rows.filter((r) => r.answered);
    const correct = rows.filter((r) => r.correct).length;
    const time = average(answered.map((r) => r.t).filter((t) => t !== null));
    const count = (option) => answered.filter((r) => r.option === option).length;
    return {
      pregunta: question.number,
      id: question.questionId,
      dificultad: question.difficulty ? difficultyName(question.difficulty) : '',
      correcta: LETTERS[question.correct],
      equipos: rows.length,
      respondieron: answered.length,
      aciertos: correct,
      pct_acierto: percent(correct, rows.length) ?? '',
      tiempo_promedio_ms: time === null ? '' : Math.round(time),
      A: count(0),
      B: count(1),
      C: count(2),
      D: count(3),
    };
  });
}

// Datos destacados del ranking final (RF-RNK-03): mejor racha, respuesta correcta más rápida, mayor
// salto de puntos y objeto más usado. null si no hubo ninguno.
export function highlights({ events, teams }) {
  const bestStreak = Math.max(0, ...teams.map((team) => team.maxStreak ?? 0));
  let fastest = null;
  for (const question of ofType(events, 'question_closed')) {
    for (const row of question.results) {
      if (row.correct && row.t !== null && (!fastest || row.t < fastest.t)) {
        fastest = { teamId: row.teamId, question: question.number, t: row.t };
      }
    }
  }
  // El Desafío no cuenta: casi siempre sería el más usado. Si lo es, sale el siguiente.
  const uses = new Map();
  for (const event of ofType(events, 'items_resolved')) {
    for (const d of event.declarations) if (d.code !== 'DS') uses.set(d.code, (uses.get(d.code) ?? 0) + 1);
  }
  const [topCode, topCount] = [...uses.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    bestStreak: bestStreak > 0
      ? { value: bestStreak, teamIds: teams.filter((team) => team.maxStreak === bestStreak).map((team) => team.id) }
      : null,
    fastestAnswer: fastest,
    biggestJump: biggestJump(events),
    topItem: topCode ? { code: topCode, count: topCount } : null,
  };
}

// Mayor salto: lo que más subió el total de un equipo de una ronda a la siguiente, con el último
// ranking de cada ronda (el primero, desde 0). Los empatados salen juntos.
function biggestJump(events) {
  const lastOfRound = new Map();
  for (const event of ofType(events, 'ranking')) lastOfRound.set(event.round, event.ranking);
  let previous = new Map();
  let best = null;
  for (const [round, ranking] of [...lastOfRound.entries()].sort((a, b) => a[0] - b[0])) {
    for (const row of ranking) {
      const points = row.score - (previous.get(row.teamId) ?? 0);
      if (points <= 0) continue;
      if (!best || points > best.points) best = { points, round, teamIds: [row.teamId] };
      else if (points === best.points && !best.teamIds.includes(row.teamId)) best.teamIds.push(row.teamId);
    }
    previous = new Map(ranking.map((row) => [row.teamId, row.score]));
  }
  return best;
}

// ------------------------------------------------------------------ CSV

// CSV para Excel en español (10.3-4): UTF-8 con BOM (para que respete los acentos), separador ";"
// y coma decimal (como lo espera Excel con la configuración regional de Colombia), fin de línea CRLF.
// Con sep: ',' usa punto decimal.
export function toCsv(rows, { sep = ';' } = {}) {
  if (rows.length === 0) return '﻿';
  const columns = Object.keys(rows[0]);
  const cell = (value) => {
    let text;
    if (value === null || value === undefined) text = '';
    else if (typeof value === 'boolean') text = value ? 'Sí' : 'No';
    else if (typeof value === 'number' && !Number.isInteger(value)) text = sep === ';' ? String(value).replace('.', ',') : String(value);
    else text = String(value);
    return text.includes(sep) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(cell).join(sep), ...rows.map((row) => columns.map((column) => cell(row[column])).join(sep))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

// Tablas exportables por nombre (GET /api/export?format=csv&table=…).
export const TABLES = {
  respuestas: answersTable,
  objetos: itemsTable,
  minijuegos: minigamesTable,
  ranking: rankingTable,
  equipos: teamSummary,
  preguntas: questionSummary,
  taller: workshopTable,
  estudiantes: studentsTable,
};
