// Secuencia fija de la partida (sección 2.4, RF-FLU-01): 5 rondas de
// Pregunta → Draft → Pregunta → Ruleta → [Grupos] → Instrucciones → Minijuego → [Duelo] → Ranking → Uso de objetos →
// Resolución → [Duelo] → Ranking y una ronda final: Pregunta 11 → Ranking final. El ranking antes del
// uso de objetos (rediseño, fase 4) deja ver los puestos antes de decidir contra quién usarlos.
// «Formando grupos» (rediseño, fase 5) solo está en los minijuegos en equipos (grouping 'pairs':
// Memoria y Clicker): anima cómo se juntan los equipos antes de las instrucciones. Los Duelos (desempate del
// minijuego y Desafíos) solo se juegan si hay alguno pendiente; si no, el motor los salta.
import { MINIGAMES, isImplemented } from '../minigames/index.js';

export const ROUNDS = 5;
export const FINAL_ROUND = ROUNDS + 1;
export const QUESTION_COUNT = 2 * ROUNDS + 1; // 11

export function buildRoundPlan(config) {
  const plan = [];
  for (let round = 1; round <= ROUNDS; round += 1) {
    const first = 2 * round - 1;
    const minigame = minigameFor(config, round);
    plan.push(
      ...question(round, first),
      { id: `r${round}.draft`, kind: 'draft', round },
      ...question(round, first + 1),
      { id: `r${round}.roulette`, kind: 'roulette', round, minigame },
      ...(MINIGAMES[minigame].grouping === 'pairs' ? [{ id: `r${round}.mg.groups`, kind: 'minigameGroups', round, minigame }] : []),
      { id: `r${round}.mg.intro`, kind: 'minigameIntro', round, minigame },
      { id: `r${round}.mg`, kind: 'minigame', round, minigame },
      { id: `r${round}.mg.duel`, kind: 'duel', round, minigame },
      { id: `r${round}.mg.result`, kind: 'minigameResult', round, minigame },
      { id: `r${round}.ranking.before`, kind: 'ranking', round, before: true },
      { id: `r${round}.use`, kind: 'itemUse', round },
      { id: `r${round}.resolution`, kind: 'resolution', round },
      { id: `r${round}.duel`, kind: 'duel', round },
      { id: `r${round}.ranking`, kind: 'ranking', round },
    );
  }
  plan.push(
    ...question(FINAL_ROUND, 2 * ROUNDS + 1),
    { id: 'final.ranking', kind: 'finalRanking', round: FINAL_ROUND },
  );
  return plan;
}

// Sala de práctica: solo un minijuego, en bucle (instrucciones → juego → [duelo] → resultado → …),
// para probarlo con celulares sin jugar la partida completa. Se juega con la ronda que tiene en la
// partida (la Arena, la 5), así las pantallas se ven igual que en la partida real.
export function buildPracticePlan(config, minigame) {
  const index = config.minigames.findIndex((entry) => entry.id === minigame);
  const round = index >= 0 ? index + 1 : ROUNDS;
  return [
    { id: 'practice.mg.intro', kind: 'minigameIntro', round, minigame, practice: true },
    { id: 'practice.mg', kind: 'minigame', round, minigame, practice: true },
    { id: 'practice.mg.duel', kind: 'duel', round, minigame, practice: true },
    { id: 'practice.mg.result', kind: 'minigameResult', round, minigame, practice: true },
  ];
}

export function planFor(config, room) {
  return room?.practice ? buildPracticePlan(config, room.practice.minigame) : buildRoundPlan(config);
}

function question(round, number) {
  const prefix = round === FINAL_ROUND ? 'final' : `r${round}`;
  return [
    { id: `${prefix}.q${number}`, kind: 'question', round, question: number },
    { id: `${prefix}.q${number}.result`, kind: 'questionResult', round, question: number },
  ];
}

// Un minijuego desactivado se reemplaza por el Clicker (RF-FLU-07); lo mismo mientras un
// minijuego todavía no esté implementado.
function minigameFor(config, round) {
  const entry = config.minigames[round - 1];
  return entry.enabled && isImplemented(entry.id) ? entry.id : 'clicker';
}
