// Estrellas y fragmentos. Cada estrella tiene fragmentsPerStar fragmentos (5: las puntas del
// dibujo); al juntarlos, se convierten en una estrella y los que sobren cuentan para la siguiente.
// Los fragmentos salen de los minijuegos (7 en toda la partida: 2 de la Memoria, 1 de la Traza a ciegas,
// 2 del Clicker, 1 del Flappy y 1 de la Arena) y el Desafío roba todos los de otro equipo, estrellas
// incluidas.
//
// Pozo de estrellas (rediseño, fase 3): los puntos de fragmentos y estrellas van aparte de los
// puntos del juego (team.score). Cada fragmento vale basePoints / fragmentsPerStar (1000) y cada
// estrella basePoints + bonusPoints (6000): al completarla, sus 5 fragmentos (5000) pasan a valer
// 6000. El pozo no se guarda por separado: sale de lo que el equipo tiene en este momento, así que
// los puntos se van con los fragmentos y las estrellas cuando el Desafío se los lleva. Los objetos
// que quitan un porcentaje solo tocan los puntos del juego. El total del equipo es la suma.
// team.starPoints se mantiene al día en cada cambio para que el ranking no necesite la configuración.

export function poolPoints({ fragments = 0, stars = 0 }, { fragmentsPerStar, basePoints, bonusPoints }) {
  return fragments * Math.round(basePoints / fragmentsPerStar) + stars * (basePoints + bonusPoints);
}

// Puntos del juego más el pozo de estrellas: lo que ordena el ranking.
export function totalScore(team) {
  return team.score + (team.starPoints ?? 0);
}

function sync(team, rules) {
  team.fragments ??= 0;
  team.stars ??= 0;
  team.starPoints = poolPoints(team, rules);
}

// Suma fragmentos y completa las estrellas que alcancen. Devuelve { completed, points }: estrellas
// completadas y lo que creció el pozo.
export function giveFragments(team, count, rules) {
  const before = poolPoints(team, rules);
  team.fragments = (team.fragments ?? 0) + count;
  const { completed } = completeStars(team, rules);
  return { completed, points: team.starPoints - before };
}

export function completeStars(team, rules) {
  team.stars ??= 0;
  const completed = Math.floor((team.fragments ?? 0) / rules.fragmentsPerStar);
  if (completed > 0) {
    team.fragments -= completed * rules.fragmentsPerStar;
    team.stars += completed;
  }
  sync(team, rules);
  return { completed };
}

// Desafío ganado: el atacante se lleva todos los fragmentos y estrellas del desafiado, y con ellos
// sus puntos del pozo. Los fragmentos robados pueden completarle una estrella al atacante.
// Devuelve lo robado, las estrellas completadas y cuánto pasó de un pozo al otro (points).
export function stealAll(thief, victim, rules) {
  const stolen = { fragments: victim.fragments ?? 0, stars: victim.stars ?? 0 };
  const before = poolPoints(thief, rules);
  victim.fragments = 0;
  victim.stars = 0;
  sync(victim, rules);
  thief.fragments = (thief.fragments ?? 0) + stolen.fragments;
  thief.stars = (thief.stars ?? 0) + stolen.stars;
  const { completed } = completeStars(thief, rules);
  return { ...stolen, completed, points: thief.starPoints - before };
}
