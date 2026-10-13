// Segunda Vida: en la siguiente pregunta, el primer error elimina esa opción y permite
// responder otra vez sin perder la racha. Un segundo error cuenta como fallo.
export default {
  code: 'SV',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: {},
  apply({ world }) {
    world.arm('question');
  },
};
