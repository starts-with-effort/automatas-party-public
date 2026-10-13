// Límite de frecuencia por ventana fija: permite `max` eventos cada `windowMs`.
// Devuelve una función que responde true si el evento se acepta.
export function createRateLimiter(max, windowMs) {
  let windowStart = 0;
  let count = 0;
  return (now = Date.now()) => {
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}
