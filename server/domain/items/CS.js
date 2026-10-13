// Chupa-Sangre: apuesta por otro equipo en la siguiente pregunta. Si el objetivo acierta, el
// usuario gana el 50 % de los puntos que obtuvo (el objetivo no pierde nada); si falla o no
// responde, el usuario pierde el 10 % de su total (AMB-11).
export default {
  code: 'CS',
  type: 'EFECTO',
  target: 'ONE',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: { gainShare: 0.5, lossShare: 0.1 },
  apply({ world }) {
    world.arm('question');
  },
};
