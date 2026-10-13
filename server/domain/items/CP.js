// Cáscara de plátano: la racha del objetivo baja (mínimo 0).
export default {
  code: 'CP',
  type: 'EFECTO',
  target: 'ONE',
  timing: 'INMEDIATO',
  defaults: { streak: 2 },
  apply({ target, params, world }) {
    world.change(target, { streak: -params.streak });
  },
};
