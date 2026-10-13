// Poción: puntos al instante para el usuario.
export default {
  code: 'P',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'INMEDIATO',
  defaults: { points: 300 },
  apply({ source, params, world }) {
    world.change(source, { points: params.points });
  },
};
