// Duelo de piedra, papel o tijera entre dos o más lados (un lado es un equipo o un grupo de
// equipos). No hay empates: si todos eligen lo mismo o salen las tres opciones, la mano se repite;
// si salen dos opciones, siguen solo los que eligieron la que gana, hasta que quede uno.
export const OPTIONS = ['piedra', 'papel', 'tijera'];
const BEATS = { piedra: 'tijera', papel: 'piedra', tijera: 'papel' };

// alive: lados que siguen; picks: { lado: opción }. Devuelve los lados que siguen tras la mano.
export function playHand(alive, picks) {
  const used = [...new Set(alive.map((side) => picks[side]))];
  if (used.length !== 2) return alive;
  const [a, b] = used;
  const winning = BEATS[a] === b ? a : b;
  return alive.filter((side) => picks[side] === winning);
}

// Pone un duelo en la cola de la sala; lo juega la siguiente fase de Duelo.
//   kind 'minigame': desempate del primer puesto o del fragmento de un minijuego (sides: los
//                    grupos o equipos empatados).
//   kind 'desafio':  el Desafío; sides = [[atacante], [desafiado]].
export function queueDuel(room, duel) {
  room.duelSeq = (room.duelSeq ?? 0) + 1;
  room.duels = [...(room.duels ?? []), { id: `d${room.duelSeq}`, ...duel }];
}
