// Posiciones por el total: puntos del juego más el pozo de estrellas (stars.js). Los empatados
// comparten puesto (RF-OBJ-03): 1, 1, 3… El desempate visual es el orden de creación de los equipos.
// Cada fila trae el total (score) y sus dos partes (gamePoints y starPoints).
import { totalScore } from './stars.js';

export function rankTeams(teams) {
  const sorted = [...teams].sort((a, b) => totalScore(b) - totalScore(a) || a.order - b.order);
  let position = 0;
  let previousScore = null;
  return sorted.map((team, index) => {
    const score = totalScore(team);
    if (score !== previousScore) {
      position = index + 1;
      previousScore = score;
    }
    return { teamId: team.id, position, score, gamePoints: team.score, starPoints: team.starPoints ?? 0, streak: team.streak };
  });
}
