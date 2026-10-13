// Guante de Ladrón: la racha del objetivo se suma a la del usuario y la del objetivo queda en 0.
// Si dos guantes apuntan al mismo equipo, el segundo roba 0 (AMB-12).
export default {
  code: 'GL',
  type: 'EFECTO',
  target: 'ONE',
  timing: 'INMEDIATO',
  defaults: {},
  apply({ source, target, world }) {
    const stolen = world.streak(target);
    world.change(target, { streak: -stolen });
    world.change(source, { streak: stolen });
  },
};
