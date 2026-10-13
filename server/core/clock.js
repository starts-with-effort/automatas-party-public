// Reloj y temporizadores inyectables: las pruebas usan un reloj falso para avanzar el
// tiempo sin esperar.
export const systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};
