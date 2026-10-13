// Cambios de puntos y racha de un equipo, con los pisos de RF-PUN-05 y RF-PUN-06.
// Los objetos (Fase 3) también deben pasar por aquí.

// Suma (o resta) puntos sin bajar de 0. Devuelve lo que realmente cambió.
export function addPoints(team, delta) {
  const before = team.score;
  team.score = Math.max(0, before + delta);
  return team.score - before;
}

export function setStreak(team, value) {
  team.streak = Math.max(0, value);
  team.maxStreak = Math.max(team.maxStreak ?? 0, team.streak);
}

// Agrega un objeto al inventario; los no usados se conservan entre rondas (RF-OBJ-10, AMB-08).
export function giveItem(room, team, code, round) {
  room.itemSeq = (room.itemSeq ?? 0) + 1;
  const item = { id: `i${room.itemSeq}`, code, round };
  (team.inventory ??= []).push(item);
  return item;
}
