// Conexión al canal /slides. La cookie de sesión viaja sola (mismo origen).
import { io } from '/socket.io/socket.io.esm.min.js';

export function connectSlides(role) {
  return io('/slides', { auth: { role } });
}
