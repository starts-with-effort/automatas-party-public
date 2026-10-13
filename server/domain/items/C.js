// Calamar: en la siguiente pregunta, manchas de tinta sobre las dos pantallas de cada equipo
// afectado (AMB-16). Salpica al aparecer el enunciado y otra vez al habilitarse las opciones; la
// tinta sigue sólida hasta durationMs después de habilitarse y se desvanece en los últimos fadeMs.
export default {
  code: 'C',
  type: 'EFECTO',
  target: 'OTHERS',
  timing: 'SIGUIENTE_PREGUNTA',
  defaults: { durationMs: 6000, fadeMs: 3000 },
  apply({ world }) {
    world.arm('question');
  },
};
