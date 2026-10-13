// Catálogo de objetos (Strategy + Registry, sección 3.4). Cada archivo define las reglas de un
// objeto: tipo, objetivo, cuándo actúa y qué hace. Nombres, textos, íconos y valores numéricos
// se ajustan en server/config/items.json sin tocar código. Un objeto nuevo necesita también su
// ícono SVG en client/assets/items/, dibujado con las reglas de docs/ICONOS.md (npm test lo exige).
//
// type:   FISICO (lo bloquea EF) · EFECTO (lo bloquea EA) · DEFENSA · POWERUP (no se bloquea)
//         · IMPARABLE (contra otro equipo, pero ningún escudo ni el Espejo lo detienen: el Desafío)
// target: SELF · ONE (otro equipo) · OTHERS (todos los demás) · ALL (todos, incluido el usuario)
// timing: INMEDIATO · SIGUIENTE_PREGUNTA · SIGUIENTE_DRAFT · DUELO (Desafío: tras la resolución)
//         · REACTIVO (defensas)
import B from './B.js';
import BN from './BN.js';
import C from './C.js';
import CP from './CP.js';
import CR from './CR.js';
import CS from './CS.js';
import CV from './CV.js';
import DN from './DN.js';
import DS from './DS.js';
import E from './E.js';
import EA from './EA.js';
import EF from './EF.js';
import GL from './GL.js';
import P from './P.js';
import R from './R.js';
import RR from './RR.js';
import SV from './SV.js';
import TD from './TD.js';

export const ITEM_DEFS = Object.fromEntries(
  [CV, EF, EA, E, RR, SV, CS, R, CR, DN, GL, P, CP, C, B, TD, BN, DS].map((def) => [def.code, def]),
);

export const ITEM_CODES = Object.keys(ITEM_DEFS);

export const isAttack = (def) => def.type === 'FISICO' || def.type === 'EFECTO';

// Parámetros de un objeto: los de su archivo, con lo que diga items.json por encima.
export function itemParams(config, code) {
  const entry = config.itemCatalog.find((item) => item.code === code);
  return { ...ITEM_DEFS[code].defaults, ...entry?.params };
}
