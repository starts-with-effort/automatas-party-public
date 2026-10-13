// Clicker por grupos (RF-MJ3): todos los grupos compiten a la vez durante 30 s; cada dispositivo
// envía sus clics acumulados en lotes y el servidor los suma por grupo. Gana el grupo con más clics.
const fail = (error) => ({ ok: false, error });

// Holgura para el primer lote: el reloj de cada celular puede adelantarse unos milisegundos.
const BURST = 2;

// Con un número impar de equipos, uno queda sin pareja: tiene la mitad de dispositivos que los
// demás grupos, así que sus clics cuentan por settings.soloFactor (clics adicionales).
const playsAlone = (groups, teamIds) => teamIds.length === 1 && groups.some((group) => group.length > 1);

export const clicker = {
  id: 'clicker',
  grouping: 'pairs',
  metric: 'clics',
  fragmentRule: 'Cada equipo del grupo ganador gana un fragmento de estrella.',
  playMs: (settings) => settings.durationMs,
  graceMs: (settings) => settings.graceMs,

  init({ groups }) {
    return {
      teamClicks: Object.fromEntries(groups.flat().map((teamId) => [teamId, 0])),
      deviceClicks: {},
      rejected: 0,
    };
  },

  // Cada dispositivo suma como mucho maxClicksPerSecond por segundo de juego; lo que pase de ahí,
  // o llegue fuera de la ventana de juego (con graceMs de margen), se descarta (RF-MJ3-04).
  onInput(state, { teamId, deviceId, input, now, window, settings }) {
    if (input.type !== 'clicks' || !Number.isInteger(input.count) || input.count < 0) return fail('invalid_input');
    if (now < window.start || now > window.end + settings.graceMs) return fail('outside_window');
    const elapsed = Math.min(now, window.end) - window.start;
    const cap = Math.floor((settings.maxClicksPerSecond * elapsed) / 1000) + BURST;
    const used = state.deviceClicks[deviceId] ?? 0;
    const accepted = Math.max(0, Math.min(input.count, cap - used));
    state.deviceClicks[deviceId] = used + accepted;
    state.teamClicks[teamId] = (state.teamClicks[teamId] ?? 0) + accepted;
    state.rejected += input.count - accepted;
    return { ok: true, quiet: true, accepted };
  },

  scores(state, { groups, settings }) {
    return groups.map((teamIds) => {
      const clicks = teamIds.reduce((sum, teamId) => sum + (state.teamClicks[teamId] ?? 0), 0);
      return playsAlone(groups, teamIds) ? Math.round(clicks * settings.soloFactor) : clicks;
    });
  },

  // El proyector muestra una barra por grupo; cada dispositivo, el conteo de su grupo (RF-MJ3-05).
  view(state, ctx) {
    return { totals: clicker.scores(state, ctx), teamClicks: state.teamClicks, batchMs: ctx.settings.batchMs };
  },
};
