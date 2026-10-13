// Reloj Roto: en la siguiente pregunta el objetivo tiene 2T/3 para responder; P(t) se sigue
// calculando con la T original. No es acumulable (AMB-13).
export default {
  code: 'RR',
  type: 'EFECTO',
  target: 'ONE',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: { timeFactor: 0.6667 },
  apply({ world }) {
    world.arm('question');
  },
};
