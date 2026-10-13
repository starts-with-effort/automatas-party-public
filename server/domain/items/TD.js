// Ticket Dorado: en el siguiente draft el equipo recibe 4 objetos, elige 2 y su suerte sube +1.
export default {
  code: 'TD',
  type: 'POWERUP',
  target: 'SELF',
  timing: 'SIGUIENTE_DRAFT',
  defaults: { extraOffers: 1, extraPicks: 1, luckBonus: 1 },
  apply({ world }) {
    world.arm('draft');
  },
};
