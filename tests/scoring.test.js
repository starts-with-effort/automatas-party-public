// Reglas de puntaje (secciones 5.1, 5.2 y 3.6) y casos de la sección 10.1.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { questionPoints, resolveAnswerTime, streakMultiplier, timePoints } from '../server/domain/Scoring.js';
import { addPoints, setStreak } from '../server/domain/teams.js';

const scoring = { streakDivisor: 10, streakMinimum: 3 };

describe('P(t) = B · (T − t) / T', () => {
  test('extremos: t = 0, t = T, t > T y t < 0', () => {
    const q = { basePoints: 1500, timeLimitMs: 30_000 };
    assert.equal(timePoints({ ...q, t: 0 }), 1500);
    assert.equal(timePoints({ ...q, t: 30_000 }), 0);
    assert.equal(timePoints({ ...q, t: 45_000 }), 0);
    assert.equal(timePoints({ ...q, t: -500 }), 1500);
  });

  test('ejemplo 5.1: B = 1500, T = 30 s, t = 12 s → 900', () => {
    assert.equal(timePoints({ basePoints: 1500, timeLimitMs: 30_000, t: 12_000 }), 900);
  });
});

describe('M(r) = 1 + ln(r) / 10', () => {
  test('vale 1 con racha menor que 3', () => {
    for (const r of [0, 1, 2]) assert.equal(streakMultiplier(r, scoring), 1);
  });

  test('tabla de la sección 5.2', () => {
    const table = { 3: '1.110', 4: '1.139', 5: '1.161', 8: '1.208', 11: '1.240', 20: '1.300' };
    for (const [r, expected] of Object.entries(table)) {
      assert.equal(streakMultiplier(Number(r), scoring).toFixed(3), expected, `r = ${r}`);
    }
  });

  test('crece con la racha para r = 3…20', () => {
    for (let r = 4; r <= 20; r += 1) assert.ok(streakMultiplier(r, scoring) > streakMultiplier(r - 1, scoring));
  });

  test('el divisor es configurable', () => {
    assert.equal(streakMultiplier(20, { streakDivisor: 5, streakMinimum: 3 }).toFixed(2), '1.60');
  });
});

describe('puntos de una respuesta correcta', () => {
  const intermedia = { basePoints: 1500, timeLimitMs: 30_000, t: 12_000, scoring };

  test('ejemplos de la sección 5.2', () => {
    assert.equal(questionPoints({ ...intermedia, streak: 4 }).points, 1025);
    assert.equal(questionPoints({ ...intermedia, streak: 4, modifier: 2 }).points, 2050); // Doble o nada
    assert.equal(questionPoints({ basePoints: 2000, timeLimitMs: 30_000, t: 7500, streak: 11, scoring }).points, 1860);
  });

  test('sin racha suficiente no hay multiplicador', () => {
    assert.deepEqual(questionPoints({ ...intermedia, streak: 2 }), { points: 900, multiplier: 1 });
  });

  test('se redondea una sola vez, al final', () => {
    // P = 999,67 y M(3) = 1,1099 → 1109,498 → 1109. Redondeando P primero daría 1000 × 1,1099 → 1110.
    const { points } = questionPoints({ basePoints: 1000, timeLimitMs: 3000, t: 1, streak: 3, scoring });
    assert.equal(points, Math.round((1000 * 2999 / 3000) * (1 + Math.log(3) / 10)));
    assert.notEqual(points, Math.round(Math.round(1000 * 2999 / 3000) * (1 + Math.log(3) / 10)));
  });
});

describe('validación del tiempo de respuesta (3.6, paso 4)', () => {
  const limits = { slackMs: 150, aheadMs: 20, defaultRttMs: 150 };

  test('acepta el t del cliente si es coherente con lo que vio el servidor', () => {
    assert.deepEqual(resolveAnswerTime({ tClient: 12_000, tServer: 12_080, rtt: 110, ...limits }), { t: 12_000, source: 'client' });
    assert.equal(resolveAnswerTime({ tClient: 12_080 - 110 - 150, tServer: 12_080, rtt: 110, ...limits }).source, 'client');
    assert.equal(resolveAnswerTime({ tClient: 12_100, tServer: 12_080, rtt: 110, ...limits }).source, 'client');
  });

  test('si no cuadra (reloj manipulado), usa tServidor − RTT/2', () => {
    assert.deepEqual(resolveAnswerTime({ tClient: 500, tServer: 12_080, rtt: 110, ...limits }), { t: 12_025, source: 'server' });
    assert.deepEqual(resolveAnswerTime({ tClient: 20_000, tServer: 12_080, rtt: 110, ...limits }), { t: 12_025, source: 'server' });
    assert.deepEqual(resolveAnswerTime({ tServer: 12_080, rtt: 110, ...limits }), { t: 12_025, source: 'server' });
  });

  test('sin RTT medido usa el valor por defecto; nunca da un t negativo', () => {
    assert.equal(resolveAnswerTime({ tServer: 1000, rtt: null, ...limits }).t, 925);
    assert.equal(resolveAnswerTime({ tClient: 900, tServer: -40, rtt: 100, ...limits }).t, 0);
  });
});

describe('pisos de puntos y racha (RF-PUN-05/06)', () => {
  test('el puntaje nunca baja de 0', () => {
    const team = { score: 200, streak: 0, maxStreak: 0 };
    assert.equal(addPoints(team, -250), -200);
    assert.equal(team.score, 0);
  });

  test('la racha nunca es negativa y se guarda la máxima', () => {
    const team = { score: 0, streak: 1, maxStreak: 4 };
    setStreak(team, -1);
    assert.equal(team.streak, 0);
    setStreak(team, 6);
    assert.equal(team.maxStreak, 6);
  });
});
