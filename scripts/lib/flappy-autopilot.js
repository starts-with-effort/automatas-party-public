// Piloto automático del Flappy: aletea cuando el pájaro cae por debajo del centro del hueco del
// próximo tubo. Lo usan los bots y las pruebas (para comprobar que el nivel se puede completar).
import { HEIGHT } from '../../client/shared/flappy-physics.js';

// Un aleteo sube unas 12 unidades: apuntar 5 por debajo del centro deja al pájaro oscilando
// alrededor del centro del hueco.
const AIM_BELOW = 5;

export function shouldFlap(level, s) {
  const pipe = level.pipes[s.pipe];
  const target = (pipe ? pipe.gapY : HEIGHT / 2) + AIM_BELOW;
  return s.vy >= 0 && s.y > target;
}
