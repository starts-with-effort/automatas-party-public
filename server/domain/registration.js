// Registro de equipos en la sala con taller (docs/TALLER.md): limpia y valida el nombre del equipo
// y los nombres de sus integrantes. Funciones puras; el motor decide qué hacer con el resultado.

export const TEAM_NAME_MAX = 24;
export const MEMBER_NAME_MAX = 40;

// Espacios repetidos y saltos de línea quedan en un solo espacio.
const tidy = (text) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '');

// El nombre limpio, o null si queda vacío o es demasiado largo.
export function cleanTeamName(name) {
  const clean = tidy(name);
  return clean.length >= 1 && clean.length <= TEAM_NAME_MAX ? clean : null;
}

// La lista de integrantes sin renglones vacíos, o null si alguno es demasiado largo o la cantidad
// se sale de { min, max } (config.workshop.members).
export function cleanMembers(members, { min, max }) {
  if (!Array.isArray(members)) return null;
  const clean = members.map(tidy).filter((name) => name.length > 0);
  if (clean.some((name) => name.length > MEMBER_NAME_MAX)) return null;
  return clean.length >= min && clean.length <= max ? clean : null;
}

// Dos equipos no pueden llamarse igual, sin importar mayúsculas ni tildes.
export function sameName(a, b) {
  return a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0;
}
