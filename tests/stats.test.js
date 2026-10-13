// Estadísticas y CSV (RF-EST-01…04, RF-RNK-03) con un log de ejemplo armado a mano.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  answersTable, grade, highlights, itemsTable, minigamesTable, pointsBySource, questionSummary, rankingTable, studentsTable, teamSummary,
  toCsv,
} from '../server/domain/stats.js';

const teams = [
  { id: 't1', name: 'Turing', score: 2650, streak: 2, maxStreak: 2 },
  { id: 't2', name: 'Chomsky; "el bueno"', score: 360, streak: 0, maxStreak: 1 },
];

const row = (teamId, answered, option, correct, t, points, streak, extra = {}) => ({
  teamId, answered, option, correct, t, points, streak, multiplier: 1, modifiers: [], secondChance: false, adjustments: [], ...extra,
});

const events = [
  { ts: 1000, type: 'room_created' },
  { ts: 2000, type: 'game_started' },
  { ts: 5000, type: 'answer_received', teamId: 't1', questionId: 'q1', option: 1 },
  { ts: 6000, type: 'answer_received', teamId: 't2', questionId: 'q1', option: 2 },
  { ts: 9000, type: 'question_closed', questionId: 'q1', number: 1, difficulty: 'basica', correct: 1, results: [
    row('t1', true, 1, true, 1500, 900, 1),
    row('t2', true, 2, false, 3000, 0, 0),
  ] },
  { ts: 15000, type: 'question_closed', questionId: 'q2', number: 2, difficulty: 'dificil', correct: 0, results: [
    row('t1', true, 0, true, 800, 1850, 2, { multiplier: 1.0693, modifiers: ['DN'] }),
    row('t2', false, null, false, null, 0, 0, { adjustments: [{ code: 'CS', points: -40, teamId: 't1' }] }),
  ] },
  { ts: 16000, type: 'items_offered', round: 1, offers: { t1: { codes: ['CV', 'E'], luck: 1, extra: null }, t2: { codes: ['BN'], luck: 2, extra: 'P' } } },
  { ts: 17000, type: 'items_picked', teamId: 't1', codes: ['CV'] },
  { ts: 18000, type: 'items_assigned', teamId: 't2', codes: ['BN'] },
  { ts: 25000, type: 'items_resolved', round: 1,
    declarations: [{ teamId: 't1', code: 'CV', targetTeamId: 't2' }, { teamId: 't2', code: 'P' }],
    events: [{ kind: 'hit', code: 'CV', source: 't1', target: 't2', changes: [] }, { kind: 'powerup', code: 'P', source: 't2', changes: [] }],
    teams: [
      { teamId: 't1', scoreBefore: 2750, scoreAfter: 2750 },
      { teamId: 't2', scoreBefore: 0, scoreAfter: 50 },
    ] },
  { ts: 30000, type: 'minigame_closed', round: 1, minigame: 'memoria', metric: 'parejas',
    groups: [{ teamIds: ['t1', 't2'], score: 3, winner: true }], awards: [{ teamId: 't2', points: 1000, streak: 0 }] },
  { ts: 31000, type: 'score_adjusted', teamId: 't1', requested: -100, applied: -100 },
  { ts: 31500, type: 'score_adjusted', teamId: 't2', requested: -650, applied: -650 },
  { ts: 32000, type: 'ranking', round: 1, ranking: [
    { teamId: 't1', position: 1, score: 2650, streak: 2, delta: null },
    { teamId: 't2', position: 2, score: 360, streak: 0, delta: null },
  ] },
];

describe('tablas', () => {
  test('respuestas: una fila por equipo y pregunta, con la hora de la respuesta', () => {
    const rows = answersTable({ events, teams });
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[0], {
      pregunta: 1, id: 'q1', dificultad: 'basica', equipo: 'Turing', respondio: true, opcion: 'B', correcta: 'B', acierto: true,
      t_ms: 1500, puntos: 900, racha: 1, multiplicador: 1, modificadores: '', segunda_vida: false, ajustes_objetos: '', segundo_respuesta: 3,
    });
    assert.equal(rows[3].opcion, '');
    assert.equal(rows[3].ajustes_objetos, 'CS -40');
    assert.equal(rows[2].modificadores, 'DN');
  });

  test('objetos: ofrecido, elegido, asignado, adicional, usado y lo que pasó en la resolución', () => {
    const rows = itemsTable({ events, teams, itemName: (code) => `obj-${code}` });
    const summary = rows.map((r) => `${r.equipo}|${r.codigo}|${r.evento}|${r.objetivo}`);
    assert.deepEqual(summary, [
      'Turing|CV|ofrecido|', 'Turing|E|ofrecido|', 'Chomsky; "el bueno"|BN|ofrecido|', 'Chomsky; "el bueno"|P|adicional por no responder|',
      'Turing|CV|elegido|', 'Chomsky; "el bueno"|BN|asignado al azar|',
      'Turing|CV|usado|Chomsky; "el bueno"', 'Chomsky; "el bueno"|P|usado|',
      'Turing|CV|efecto aplicado|Chomsky; "el bueno"', 'Chomsky; "el bueno"|P|potenciador aplicado|',
    ]);
    assert.equal(rows[0].objeto, 'obj-CV');
    assert.equal(rows[0].ronda, 1);
  });

  test('objetos: el Desafío ganado y el que no se jugó porque el desafiado no tenía nada', () => {
    const duels = [
      { ts: 26000, type: 'duel_finished', kind: 'desafio', round: 1, sides: [['t1'], ['t2']], winner: 0, outcome: { stolen: true, fragments: 2, stars: 0 } },
      { ts: 27000, type: 'duel_skipped', kind: 'desafio', round: 2, sides: [['t2'], ['t1']], reason: 'nothing_to_steal' },
    ];
    const rows = itemsTable({ events: [...events, ...duels], teams }).slice(-2);
    assert.deepEqual(rows.map((r) => [r.ronda, r.equipo, r.codigo, r.evento, r.objetivo, r.detalle]), [
      [1, 'Turing', 'DS', 'duelo ganado', 'Chomsky; "el bueno"', 'robó 2 fragmentos y 0 estrellas'],
      [2, 'Chomsky; "el bueno"', 'DS', 'duelo no jugado', 'Turing', 'el desafiado no tenía nada que robar'],
    ]);
  });

  test('minijuegos y ranking por ronda', () => {
    const games = minigamesTable({ events, teams, minigameName: () => 'Memoria de parejas' });
    assert.deepEqual(games.map((g) => [g.equipo, g.resultado, g.gano, g.puntos]), [['Turing', '3 parejas', true, 0], ['Chomsky; "el bueno"', '3 parejas', true, 1000]]);
    const ranking = rankingTable({ events, teams });
    assert.deepEqual(ranking.map((r) => [r.ronda, r.puesto, r.equipo, r.puntos]), [['1', 1, 'Turing', 2650], ['1', 2, 'Chomsky; "el bueno"', 360]]);
  });
});

describe('resúmenes', () => {
  test('los puntos por fuente suman el puntaje final', () => {
    const sources = pointsBySource({ events, teams });
    assert.deepEqual(sources.t1, { preguntas: 2750, objetos: 0, minijuegos: 0, estrellas: 0, host: -100 });
    assert.deepEqual(sources.t2, { preguntas: 0, objetos: 10, minijuegos: 1000, estrellas: 0, host: -650 });
    for (const team of teams) {
      const s = sources[team.id];
      assert.equal(s.preguntas + s.objetos + s.minijuegos + s.host, team.score);
    }
  });

  test('por equipo: aciertos, tiempo medio y racha máxima', () => {
    const [t1, t2] = teamSummary({ events, teams });
    assert.deepEqual([t1.aciertos, t1.pct_aciertos, t1.tiempo_medio_ms, t1.racha_maxima, t1.total], [2, 100, 1150, 2, 2650]);
    assert.deepEqual([t2.respondidas, t2.aciertos, t2.pct_aciertos, t2.tiempo_medio_ms], [1, 0, 0, 3000]);
  });

  test('la nota va de 0 a 5 según los aciertos; sin responder cuenta como incorrecta', () => {
    assert.deepEqual([grade(11, 11), grade(0, 11), grade(6, 11), grade(7, 11), grade(1, 2)], [5, 0, 2.7, 3.2, 2.5]);
    assert.equal(grade(0, 0), '', 'sin preguntas jugadas no hay nota');
    assert.equal(grade(1, 3, { max: 10, decimals: 2 }), 3.33);
    const [t1, t2] = teamSummary({ events, teams });
    assert.deepEqual([t1.aciertos, t1.preguntas, t1.nota], [2, 2, 5]);
    assert.deepEqual([t2.aciertos, t2.preguntas, t2.respondidas, t2.nota], [0, 2, 1, 0]);
    assert.equal(teamSummary({ events, teams, grading: { max: 10, decimals: 0 } })[0].nota, 10);
  });

  test('por estudiante: una fila por integrante, en orden alfabético, con la nota de su equipo', () => {
    const registered = [
      { ...teams[0], members: ['Zoe Ruiz', 'ana Gómez'], workshop: { finishedAt: 5000 } },
      { ...teams[1], members: ['Luis Pérez'], workshop: { finishedAt: null } },
      { id: 't3', name: 'Fijo', score: 0, streak: 0 }, // equipo sin integrantes: no aporta filas
    ];
    assert.deepEqual(studentsTable({ events, teams: registered }), [
      { estudiante: 'ana Gómez', equipo: 'Turing', preguntas: 2, aciertos: 2, pct_aciertos: 100, nota: 5, taller: 'terminado' },
      { estudiante: 'Luis Pérez', equipo: 'Chomsky; "el bueno"', preguntas: 2, aciertos: 0, pct_aciertos: 0, nota: 0, taller: 'sin terminar' },
      { estudiante: 'Zoe Ruiz', equipo: 'Turing', preguntas: 2, aciertos: 2, pct_aciertos: 100, nota: 5, taller: 'terminado' },
    ]);
    assert.deepEqual(studentsTable({ events, teams }), [], 'sala de equipos fijos: sin filas');
    assert.equal(studentsTable({ events: [], teams: registered })[0].nota, '', 'antes de la primera pregunta no hay nota');
  });

  test('por pregunta: % de acierto, tiempo promedio y distribución de opciones', () => {
    const [q1, q2] = questionSummary({ events });
    assert.deepEqual([q1.pct_acierto, q1.tiempo_promedio_ms, q1.A, q1.B, q1.C, q1.D], [50, 2250, 0, 1, 1, 0]);
    assert.deepEqual([q2.respondieron, q2.aciertos, q2.A], [1, 1, 1]);
  });

  test('datos destacados: mejor racha, respuesta más rápida, mayor salto y objeto más usado', () => {
    assert.deepEqual(highlights({ events, teams }), {
      bestStreak: { value: 2, teamIds: ['t1'] },
      fastestAnswer: { teamId: 't1', question: 2, t: 800 },
      biggestJump: { points: 2650, round: 1, teamIds: ['t1'] },
      topItem: { code: 'CV', count: 1 },
    });
    assert.deepEqual(highlights({ events: [], teams: [{ id: 't1', maxStreak: 0 }] }), { bestStreak: null, fastestAnswer: null, biggestJump: null, topItem: null });
  });

  // Rediseño, fase 3: el mayor salto usa el último ranking de cada ronda y el Desafío no cuenta como
  // objeto más usado.
  test('mayor salto entre rondas y objeto más usado sin el Desafío', () => {
    const rank = (round, scores) => ({ type: 'ranking', round, ranking: Object.entries(scores).map(([teamId, score], i) => ({ teamId, position: i + 1, score })) });
    const resolved = (codes) => ({ type: 'items_resolved', declarations: codes.map((code) => ({ teamId: 't1', code })), teams: [] });
    const log = [
      rank(1, { t1: 1000, t2: 500 }),
      rank(2, { t1: 1200, t2: 3000 }), // antes de los objetos: no cuenta, la ronda 2 termina abajo
      rank(2, { t1: 1500, t2: 3500 }),
      rank(3, { t1: 4400, t2: 3600 }),
      resolved(['DS', 'DS', 'DS', 'CV', 'CV', 'P']),
    ];
    const { biggestJump, topItem } = highlights({ events: log, teams });
    assert.deepEqual(biggestJump, { points: 3000, round: 2, teamIds: ['t2'] });
    assert.deepEqual(topItem, { code: 'CV', count: 2 });
    const tie = highlights({ events: [rank(1, { t1: 800, t2: 800 })], teams }).biggestJump;
    assert.deepEqual(tie, { points: 800, round: 1, teamIds: ['t1', 't2'] });
  });
});

describe('CSV para Excel', () => {
  test('BOM, separador ";", coma decimal, Sí/No y comillas donde hace falta', () => {
    const csv = toCsv([{ equipo: 'Chomsky; "el bueno"', acierto: true, t: 1.5, nota: 'línea\notra' }, { equipo: 'Turing', acierto: false, t: 2, nota: '' }]);
    assert.ok(csv.startsWith('﻿'));
    assert.deepEqual(csv.slice(1).split('\r\n'), [
      'equipo;acierto;t;nota',
      '"Chomsky; ""el bueno""";Sí;1,5;"línea\notra"',
      'Turing;No;2;',
      '',
    ]);
  });

  test('con sep "," usa punto decimal', () => {
    assert.equal(toCsv([{ a: 1.25, b: 'x,y' }], { sep: ',' }), '﻿a,b\r\n1.25,"x,y"\r\n');
  });
});
