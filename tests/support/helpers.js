import { loadConfig, parseConfig } from '../../server/core/config.js';

// Configuración real con tiempos cortos, sin anticipación ni tiempo de lectura, y con un banco
// de preguntas propio de las pruebas (las pruebas no dependen del contenido de questions.json).
export function testConfig({ timings = {}, questions = {}, minigames, minigameRules = {}, questionBank, duel = {} } = {}) {
  const base = loadConfig();
  const rules = base.minigameRules;
  return parseConfig({
    ...base,
    timings: {
      ...base.timings,
      leadMs: 0,
      draft: 1000,
      roulette: 1000,
      minigameGroups: 1000,
      minigameIntro: 1000,
      itemUse: 1000,
      ...timings,
    },
    questions: { ...base.questions, readingMs: 0, answerGraceMs: 0, ...questions },
    // Duelo corto: 1 s por mano y sin pausas para mirar.
    duel: { ...base.duel, lineupMs: 0, introMs: 0, pickMs: 1000, revealMs: 0, resultMs: 0, voidMs: 0, ...duel },
    minigames: minigames ?? base.minigames,
    // Minijuegos cortos: Memoria de 2 parejas, Traza a ciegas de 3 s, Flappy de 6 s, Arena de 5 s y Clicker
    // de 1 s, sin cuenta 3-2-1.
    minigameRules: {
      ...rules,
      countdownMs: 0,
      ...minigameRules,
      memoria: { ...rules.memoria, pairs: 2, cardTimeMs: 500, revealMs: 50, maxDurationMs: 3000, ...minigameRules.memoria },
      traza: { ...rules.traza, maxDurationMs: 3000, ...minigameRules.traza },
      flappy: { ...rules.flappy, levelMs: 6000, extraMs: 1000, ...minigameRules.flappy }, // un solo tubo
      arena: { ...rules.arena, durationMs: 5000, ...minigameRules.arena },
      clicker: { ...rules.clicker, durationMs: 1000, graceMs: 0, ...minigameRules.clicker },
    },
    questionBank: questionBank ?? testQuestions(),
  });
}

// 11 preguntas: dificultades básica/intermedia/difícil alternadas; la correcta de la n-ésima
// es la opción (n − 1) % 4.
export function testQuestions({ timeLimitMs = 1000, difficulty } = {}) {
  const difficulties = ['basica', 'intermedia', 'dificil'];
  return Array.from({ length: 11 }, (_, i) => ({
    id: `q${i + 1}`,
    difficulty: difficulty ?? difficulties[i % 3],
    timeLimitMs,
    statement: `Enunciado ${i + 1}`,
    image: null,
    options: ['Opción A', 'Opción B', 'Opción C', 'Opción D'],
    correct: i % 4,
  }));
}

// Reloj falso: advance(ms) ejecuta en orden los temporizadores que vencen en ese lapso.
export function createFakeClock(start = 1_000_000) {
  let now = start;
  let nextId = 1;
  let timers = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      timers = timers.filter((timer) => timer.id !== id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const timer = timers[0];
        if (!timer || timer.at > target) break;
        timers.shift();
        now = timer.at;
        timer.fn();
      }
      now = target;
    },
  };
}

export const silentLogger = () => {};
