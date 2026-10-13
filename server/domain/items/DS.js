// Desafío: el usuario reta a otro equipo a un Duelo (piedra, papel o tijera) después de la
// resolución. Si gana, le roba todos sus fragmentos y estrellas; si pierde, no pasa nada. Es
// imparable: ningún escudo lo bloquea y el Espejo no lo devuelve.
// No sale de las pools: el draft lo ofrece a 1 o 2 equipos por reparto (perDraft en items.json).
export default {
  code: 'DS',
  type: 'IMPARABLE',
  target: 'ONE',
  timing: 'DUELO',
  defaults: {},
  apply({ world }) {
    world.arm('duel');
  },
};
