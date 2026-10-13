import { createHash, timingSafeEqual } from 'node:crypto';

// Compara el token recibido con el del host en tiempo constante (RNF-08).
// Se comparan los hashes para que la longitud del token no influya.
export function tokenMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
