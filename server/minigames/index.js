// Minijuegos como plugins (sección 3.9, patrón Plugin). Cada uno implementa:
//
//   id, grouping ('pairs' = grupos de 2 equipos; 'teams' = cada equipo solo), metric (qué cuenta),
//   fragmentRule (quién gana el fragmento de estrella; documentación: ya no se muestra)
//   makeGroups?({ teams, settings, random, chosen })   arma sus propios grupos (la Arena: jefes y
//                                        retadores; chosen: los jefes que fijó el host en la práctica)
//   playMs(settings)                   duración máxima del juego (sin la cuenta 3-2-1)
//   graceMs?(settings)                 margen tras el final para entradas en camino
//   init({ groups, settings, random, window, slotTaken, slotConnected }) → estado serializable
//                                        slotTaken(teamId, slot): ese puesto tiene un dispositivo
//   onInput(state, ctx)                ctx = { groups, activeTeamIds, settings, window, now, teamId,
//                                        deviceId, slot, input, slotConnected, scoreOf, record }
//                                        → { ok, error?, quiet?, event? }
//                                        quiet: el estado cambia muy seguido (p. ej. clics); la vista
//                                        se difunde con un tope de frecuencia en vez de en cada mensaje
//   nextWakeup?(state, ctx) / onWakeup?(state, ctx)   eventos programados (turnos, plazos)
//   shiftTimes?(state, delta)          desplaza sus instantes absolutos tras una pausa
//   frameMs?(settings) / onFrame(state, ctx) → { frame, events }   tiempo real (la Arena): cada
//                                        frameMs avanza su simulación; el fotograma va a todas las
//                                        pantallas (mg:frame) y los eventos, al log
//   settle?(state, ctx) → eventos      al cerrar, decide lo que tenga pendiente
//   isFinished?(state, ctx)            termina antes del plazo
//   scores(state, ctx) → puntaje por grupo (mismo orden que groups)
//   results?(state, ctx) → { groups: [{ teamIds, score, winner, rank?, label? }], awards, fragments, tie }
//                        si los premios no son "1000 al grupo con más puntaje" (p. ej. por orden de
//                        llegada). awards: puntos de la ronda 1 (el manager los escala con la ronda y
//                        la compensación); fragments: equipos que ganan un fragmento de estrella;
//                        tie: lados empatados por el primer puesto o el fragmento ([[teamId…]…]) o
//                        null. Con un empate se juega un Duelo y luego se vuelve a llamar con
//                        ctx.tiebreak = los equipos del lado que ganó.
//   view(state, ctx)                   ctx.viewer = { role, teamId, slot }; solo lo que puede ver
//
// MinigameManager (server/phases/minigame.js) forma los grupos, enruta las entradas y reparte premios.
import { arena } from './arena.js';
import { clicker } from './clicker.js';
import { flappy } from './flappy.js';
import { memoria } from './memoria.js';
import { traza } from './traza.js';

export const MINIGAMES = { clicker, memoria, traza, flappy, arena };

// Mientras un minijuego no esté implementado, su ronda usa el Clicker (como si estuviera desactivado).
export const isImplemented = (id) => Boolean(MINIGAMES[id]);
