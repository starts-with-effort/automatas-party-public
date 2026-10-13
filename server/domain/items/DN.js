// Doble o nada: en la siguiente pregunta, acierto = puntos × 2; fallo o sin respuesta = pierde 0,5 · B (AMB-14).
export default {
  code: 'DN',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: { multiplier: 2, penaltyShare: 0.5 },
  apply({ world }) {
    world.arm('question');
  },
};
