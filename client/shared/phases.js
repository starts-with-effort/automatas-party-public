// Textos de cada fase para las tres interfaces.
export const FINAL_ROUND = 6;

export const RANKING_KINDS = new Set(['ranking', 'finalRanking']);

export function phaseTitle(phase) {
  switch (phase.kind) {
    case 'question': return `Pregunta ${phase.question}`;
    case 'questionResult': return `Resultado de la pregunta ${phase.question}`;
    case 'draft': return 'Draft de objetos';
    case 'roulette': return 'Ruleta';
    case 'minigameGroups': return 'Formando grupos';
    case 'minigameIntro': return phase.minigameName;
    case 'minigame': return phase.minigameName;
    case 'minigameResult': return `Resultado: ${phase.minigameName}`;
    case 'duel': return '¡Duelo!';
    case 'itemUse': return 'Uso de objetos';
    case 'resolution': return 'Resolución de objetos';
    case 'ranking': return phase.before ? 'Así van antes de los objetos' : `Ranking de la ronda ${phase.round}`;
    case 'finalRanking': return 'Ranking final';
    default: return phase.kind;
  }
}

export function roundLabel(phase) {
  if (phase.practice) return `Práctica · intento ${phase.attempt}`;
  return phase.round === FINAL_ROUND ? 'Ronda final' : `Ronda ${phase.round} de ${FINAL_ROUND - 1}`;
}
