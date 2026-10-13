// Suerte y ofertas del draft (RF-OBJ-02…08, sección 5.3).
import { itemParams } from './items/index.js';
import { pickDistinct } from './random.js';

export const MAX_LUCK = 6; // la pool "6" vale para suerte 6 o más

export const OFFER_SIZE = 3;

// Objetos posibles para una suerte, sin los desactivados en items.json (RF-FLU-07) ni los que se
// reparten aparte (`perDraft`: el Desafío).
export function poolFor(config, luck) {
  const usable = new Set(config.itemCatalog.filter((item) => item.enabled && !item.perDraft).map((item) => item.code));
  const key = String(Math.min(Math.max(luck, 1), MAX_LUCK));
  return config.pools[key].filter((code) => usable.has(code));
}

// Reglas de aparición de items.json, además de la pool:
//   maxPerGame: veces que puede aparecer en toda la partida (las defensas: 1). Cuenta cada vez que
//               se ofrece, aunque el equipo no lo elija. `offered(code)` → veces que ya apareció.
//   onlyLeader: solo se ofrece a quien va 1.º en el ranking (la Poción).
export function canAppear(config, code, { position, offered }) {
  const entry = config.itemCatalog.find((item) => item.code === code);
  if (!entry) return false;
  if (entry.onlyLeader && position !== 1) return false;
  return entry.maxPerGame === undefined || offered(code) < entry.maxPerGame;
}

// Oferta de un equipo. Suerte = puesto (los empatados comparten puesto) + bonificación del
// Ticket Dorado, que además ofrece 4 objetos y deja elegir 2. Si el equipo no respondió una
// pregunta, recibe además un objeto al azar de su pool distinto de los ofrecidos.
// allowed(code): filtra la pool (canAppear); include: objetos que van sí o sí en la oferta (el
// Desafío), en una posición al azar.
export function buildOffer({ config, position, goldenTicket = false, extraItem = false, random, allowed = () => true, include = [] }) {
  const ticket = goldenTicket ? itemParams(config, 'TD') : { luckBonus: 0, extraOffers: 0, extraPicks: 0 };
  const luck = position + ticket.luckBonus;
  const pool = poolFor(config, luck).filter((code) => allowed(code) && !include.includes(code));
  const codes = pickDistinct(pool, OFFER_SIZE + ticket.extraOffers - include.length, random);
  for (const code of include) codes.splice(Math.floor(random() * (codes.length + 1)), 0, code);
  const extra = extraItem ? pickDistinct(pool.filter((code) => !codes.includes(code)), 1, random)[0] ?? null : null;
  return { luck, codes, picks: Math.min(1 + ticket.extraPicks, codes.length), extra };
}

// Equipos que reciben el Desafío en este reparto: entre min y max (al azar), primero los que no
// tienen ningún fragmento (ni estrellas); si no alcanzan, los demás. Orden al azar dentro de cada grupo.
export function challengeTeams({ config, teams, random }) {
  const entry = config.itemCatalog.find((item) => item.code === 'DS');
  if (!entry?.enabled || !entry.perDraft) return [];
  const { min, max } = entry.perDraft;
  const count = Math.min(teams.length, min + Math.floor(random() * (max - min + 1)));
  const shuffled = pickDistinct(teams, teams.length, random);
  const empty = (team) => !(team.fragments > 0) && !(team.stars > 0);
  return [...shuffled.filter(empty), ...shuffled.filter((team) => !empty(team))].slice(0, count).map((team) => team.id);
}
