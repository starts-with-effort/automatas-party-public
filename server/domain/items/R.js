// +Racha: la racha del usuario sube.
export default {
  code: 'R',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'INMEDIATO',
  defaults: { streak: 3 },
  apply({ source, params, world }) {
    world.change(source, { streak: params.streak });
  },
};
