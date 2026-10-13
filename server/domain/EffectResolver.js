// Resolución de los objetos declarados en la fase de uso (sección 5.4), como función pura:
// recibe puntos y rachas de cada equipo y las declaraciones, y devuelve el estado final, los
// efectos diferidos y la lista de eventos para mostrar. No modifica nada de lo que recibe.
//
// Orden fijo; dentro de cada paso, el de llegada de las declaraciones (seq):
//   1. Defensas: Espejo, Escudo Físico y Escudo Anti-hechizos quedan activos toda la resolución.
//   2. Ataques. Para cada ataque y cada objetivo: (a) con Espejo, se refleja al emisor (un ataque
//      reflejado no se vuelve a reflejar, pero un escudo del emisor sí lo bloquea); (b) si no, con
//      el escudo de su tipo, se bloquea; (c) si no, se aplica (los diferidos se registran). Los
//      imparables (el Desafío) se aplican siempre: ni escudos ni Espejo los detienen.
//   3. Power-ups inmediatos (Poción, +Racha, Bala): después de los ataques, para que una racha
//      recién ganada no se pueda robar en el mismo evento.
//   4. Power-ups diferidos (Segunda Vida, Contrarreloj, Doble o nada, Ticket Dorado).
//   5. Pisos: puntos ≥ 0 y racha ≥ 0.
// Los ataques diferidos (Reloj Roto, Chupa-Sangre, Calamar y el Desafío, que se juega en el Duelo
// de después) quedan como efectos.
import { ITEM_DEFS, isAttack } from './items/index.js';
import { rankTeams } from './ranking.js';

// teams: [{ id, score, streak }]
// declarations: [{ seq, teamId, code, targetTeamId? }]
// paramsFor(code) → parámetros del objeto
export function resolveItemUse({ teams, declarations, paramsFor = (code) => ITEM_DEFS[code].defaults }) {
  const state = new Map(teams.map((team) => [team.id, { score: team.score, streak: team.streak }]));
  const teamIds = teams.map((team) => team.id);
  // Puestos de antes de la resolución (los empatados comparten puesto): el Caparazón depende de ellos.
  const positions = new Map(rankTeams(teams.map((team, order) => ({ ...team, order }))).map((row) => [row.teamId, row.position]));
  const ordered = [...declarations].sort((a, b) => a.seq - b.seq);
  const guards = new Map(teamIds.map((id) => [id, new Set()])); // 'FISICO' | 'EFECTO' | 'MIRROR'
  const events = [];
  const effects = [];
  let current = null;

  const world = {
    streak: (teamId) => state.get(teamId).streak,
    score: (teamId) => state.get(teamId).score,
    position: (teamId) => positions.get(teamId),
    // Los puntos se acotan al final (paso 5); la racha nunca baja de 0 (RF-PUN-05).
    change(teamId, { points = 0, streak = 0 }) {
      const team = state.get(teamId);
      team.score += points;
      const before = team.streak;
      team.streak = Math.max(0, team.streak + streak);
      current.changes.push({ teamId, points, streak: team.streak - before });
    },
    arm(appliesTo) {
      effects.push({ code: current.code, sourceTeamId: current.source, targetTeamId: current.target, appliesTo });
    },
  };

  function run(event, def) {
    current = { ...event, changes: [] };
    events.push(current);
    def?.apply?.({ source: event.source, target: event.target, params: paramsFor(event.code), world });
  }

  function strike(def, source, target, reflected) {
    const guard = guards.get(target);
    if (!reflected && guard.has('MIRROR')) {
      run({ kind: 'reflected', code: def.code, source, target, by: 'E' });
      return strike(def, target, source, true);
    }
    if (guard.has(def.type)) {
      return run({ kind: 'blocked', code: def.code, source, target, by: def.type === 'FISICO' ? 'EF' : 'EA', reflected });
    }
    const kind = def.timing === 'INMEDIATO' ? 'hit' : 'armed';
    return run({ kind, code: def.code, source, target, reflected }, def);
  }

  // 1. Defensas
  for (const declaration of ordered) {
    const def = ITEM_DEFS[declaration.code];
    if (def.type !== 'DEFENSA') continue;
    guards.get(declaration.teamId).add(def.protects);
    run({ kind: 'defense', code: def.code, source: declaration.teamId, target: declaration.teamId });
  }

  // 2. Ataques
  for (const declaration of ordered) {
    const def = ITEM_DEFS[declaration.code];
    if (def.type === 'IMPARABLE') {
      const kind = def.timing === 'INMEDIATO' ? 'hit' : 'armed';
      run({ kind, code: def.code, source: declaration.teamId, target: declaration.targetTeamId }, def);
      continue;
    }
    if (!isAttack(def)) continue;
    const source = declaration.teamId;
    if (def.target === 'ALL') {
      // La parte que sufre el propio usuario no se bloquea ni se refleja (AMB-15).
      run({ kind: 'hit', code: def.code, source, target: source, self: true }, def);
    }
    const targets = def.target === 'ONE' ? [declaration.targetTeamId] : teamIds.filter((id) => id !== source);
    for (const target of targets) strike(def, source, target, false);
  }

  // 3. Power-ups inmediatos y 4. diferidos
  for (const timing of [['INMEDIATO'], ['SIGUIENTE_PREGUNTA', 'SIGUIENTE_DRAFT']]) {
    for (const declaration of ordered) {
      const def = ITEM_DEFS[declaration.code];
      if (def.type !== 'POWERUP' || !timing.includes(def.timing)) continue;
      const kind = def.timing === 'INMEDIATO' ? 'powerup' : 'armed';
      run({ kind, code: def.code, source: declaration.teamId, target: declaration.teamId }, def);
    }
  }

  // 5. Pisos
  const final = teams.map((team) => {
    const after = state.get(team.id);
    return { teamId: team.id, score: Math.max(0, after.score), streak: Math.max(0, after.streak) };
  });
  return { final, effects, events };
}
