// Sesión de la presentación: cookie firmada con HMAC. No se guarda nada en el servidor, así que un
// reinicio no cierra la sesión; cambiar SLIDES_TOKEN invalida todas las cookies.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'ap_slides';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessions(token, { ttlMs = SESSION_TTL_MS, now = Date.now } = {}) {
  const key = createHash('sha256').update(`automatas-party:slides:${token}`).digest();
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('hex');

  return {
    ttlMs,
    // Valor de la cookie: versión, vencimiento y firma.
    issue() {
      const expiresAt = now() + ttlMs;
      const payload = `v1.${expiresAt}`;
      return { value: `${payload}.${sign(payload)}`, expiresAt };
    },
    // Devuelve el vencimiento si la cookie es válida y no ha vencido; si no, null.
    verify(value) {
      if (typeof value !== 'string') return null;
      const match = /^v1\.(\d{1,16})\.([0-9a-f]{64})$/.exec(value);
      if (!match) return null;
      const expiresAt = Number(match[1]);
      const expected = Buffer.from(sign(`v1.${match[1]}`), 'hex');
      if (!timingSafeEqual(Buffer.from(match[2], 'hex'), expected)) return null;
      return expiresAt > now() ? expiresAt : null;
    },
  };
}

// Lee una cookie de la cabecera Cookie (sin dependencias: solo hace falta una).
export function readCookie(header, name = COOKIE_NAME) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
