// Números aleatorios con semilla (mulberry32): con la misma semilla salen los mismos
// resultados, lo que permite reproducir una partida y escribir pruebas deterministas.
export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Combina varios enteros en una semilla (p. ej. semilla de la sala + número de fase).
export function mixSeed(...parts) {
  let hash = 2166136261;
  for (const part of parts) {
    hash ^= part >>> 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// `count` elementos distintos de `list`, todos con la misma probabilidad (RF-OBJ-04).
export function pickDistinct(list, count, random) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}
