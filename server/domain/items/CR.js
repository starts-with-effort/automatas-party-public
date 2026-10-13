// Contrarreloj: en la siguiente pregunta se elimina una opción incorrecta al azar en T/4, T/2 y 3T/4.
export default {
  code: 'CR',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: {},
  apply({ world }) {
    world.arm('question');
  },
};
