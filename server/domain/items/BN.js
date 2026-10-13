// Bomba Nuclear: todos los equipos pierden un porcentaje (share, 8 %) de sus puntos, incluido el
// usuario. La parte que sufre el usuario no se puede bloquear ni reflejar; a los demás los protegen
// sus defensas (AMB-15). Se calcula sobre los puntos que tiene cada uno en ese momento de la resolución.
export default {
  code: 'BN',
  type: 'FISICO',
  target: 'ALL',
  timing: 'INMEDIATO',
  defaults: { share: 0.08 },
  apply({ target, params, world }) {
    world.change(target, { points: -Math.round(params.share * Math.max(0, world.score(target))) });
  },
};
