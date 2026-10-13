// Bala: la racha del usuario sube muchísimo.
export default {
  code: 'B',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'INMEDIATO',
  defaults: { streak: 8 },
  apply({ source, params, world }) {
    world.change(source, { streak: params.streak });
  },
};
