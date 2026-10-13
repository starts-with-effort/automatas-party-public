// Grupos y premios de los minijuegos (RF-MJ-02, RF-MJ-03).
import { pickDistinct } from './random.js';

// Parejas de equipos al azar; con un número impar, un equipo al azar queda solo.
export function makePairs(teamIds, random) {
  const shuffled = pickDistinct(teamIds, teamIds.length, random);
  const groups = [];
  for (let i = 0; i < shuffled.length; i += 2) groups.push(shuffled.slice(i, i + 2));
  return groups;
}

// Gana el grupo con el mayor puntaje del minijuego: cada uno de sus equipos recibe `prize` puntos
// y un fragmento de estrella. Si nadie sumó nada, no hay ganador. Si varios grupos empatan en el
// primer puesto, se desempata con un Duelo: sin `tiebreak` se devuelve el empate (`tie`: los
// grupos empatados, sin premios) y con él (los equipos del grupo que ganó el Duelo) gana ese grupo.
export function groupResults(groups, scores, prize, tiebreak = null) {
  const best = Math.max(0, ...scores);
  const tied = best > 0 ? groups.filter((_, index) => scores[index] === best) : [];
  const tie = tied.length > 1 && !tiebreak ? tied : null;
  const winners = tie ? [] : tied.filter((teamIds) => tied.length === 1 || teamIds.includes(tiebreak[0]));
  const rows = groups.map((teamIds, index) => ({ teamIds, score: scores[index], winner: winners.includes(teamIds) }));
  const winnerTeams = winners.flat();
  return {
    groups: rows,
    awards: winnerTeams.map((teamId) => ({ teamId, points: prize, streak: 0 })),
    fragments: winnerTeams,
    tie,
  };
}

// Lados empatados en el primer puesto con el mayor valor (> 0) de `valueOf(teamId)`, para los
// minijuegos en que cada equipo juega solo. Devuelve { best, tied: [teamId…] }.
export function topTeams(teamIds, valueOf) {
  const best = Math.max(0, ...teamIds.map(valueOf));
  return { best, tied: best > 0 ? teamIds.filter((teamId) => valueOf(teamId) === best) : [] };
}

// Quién se lleva el premio del primer puesto entre los empatados: el único, el que ganó el Duelo
// (`tiebreak`) o nadie todavía (hay que jugar el Duelo: `tie` con un lado por equipo).
export function settleTop(tied, tiebreak) {
  if (tied.length <= 1) return { winner: tied[0] ?? null, tie: null };
  if (tiebreak) return { winner: tied.find((teamId) => tiebreak.includes(teamId)) ?? null, tie: null };
  return { winner: null, tie: tied.map((teamId) => [teamId]) };
}
