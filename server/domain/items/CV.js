// Caparazón Verde: el objetivo pierde un porcentaje de sus puntos según su puesto antes de la
// resolución: share (7 %) si va 1.º y shareStep (0,5 %) menos por cada puesto más abajo (2.º 6,5 %,
// 3.º 6 %…), nunca menos de 0. Se calcula sobre los puntos que tiene en ese momento de la resolución.
export default {
  code: 'CV',
  type: 'FISICO',
  target: 'ONE',
  timing: 'INMEDIATO',
  defaults: { share: 0.07, shareStep: 0.005 },
  apply({ target, params, world }) {
    const share = Math.max(0, params.share - params.shareStep * (world.position(target) - 1));
    world.change(target, { points: -Math.round(share * Math.max(0, world.score(target))) });
  },
};
