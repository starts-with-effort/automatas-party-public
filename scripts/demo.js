// Partida completa de prueba, sin servidor aparte: levanta el juego en este proceso, conecta un host
// y N bots, y juega las 5 rondas y la final. Imprime el recorrido y un resumen.
//
//   npm run demo                    14 bots, tiempos rápidos (server/config/fast.json): ~3 min
//   npm run demo -- --real          con los tiempos reales de game.json
//   npm run demo -- --bots 20       más jugadores (siempre 2 por equipo, hasta 8 equipos)
//   npm run demo -- --sin-taller    sala de equipos fijos: sin registro ni taller
//
// La sala es con registro (docs/TALLER.md): cada pareja de bots registra su equipo y hace el taller
// antes de que empiece la partida. Después los bots responden al azar, eligen y usan objetos, y
// juegan los minijuegos (Memoria con memoria, Traza a ciegas dictada, Clicker, Flappy con piloto
// automático, la Arena rodeando al jefe y disparándole).
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createApp } from '../server/app.js';
import { FAST_OVERLAY, loadConfig } from '../server/core/config.js';
import { HostBot, PlayerBot } from './lib/bots.js';

process.env.LOG_LEVEL = 'silent';
const { values: args } = parseArgs({
  options: {
    bots: { type: 'string', default: '14' },
    real: { type: 'boolean', default: false },
    'sin-taller': { type: 'boolean', default: false },
  },
});
const workshop = !args['sin-taller'];

const botCount = Math.max(2, Math.min(16, Number(args.bots) || 14));
const teamCount = Math.ceil(botCount / 2);
const config = loadConfig(undefined, { overlay: args.real ? null : FAST_OVERLAY });
const hostToken = randomBytes(16).toString('hex');
const server = createApp({ hostToken, config, logger: () => {} });
await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.httpServer.address().port}`;

const startedAt = Date.now();
const clock = (ms = Date.now() - startedAt) => {
  const s = ms / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};
const nameOf = (id) => server.engine.room.teams.find((team) => team.id === id)?.name ?? id;
const minigameName = (id) => config.minigames.find((m) => m.id === id)?.name ?? id;

console.log(`Partida de prueba ${args.real ? 'con tiempos reales' : 'rápida'}: ${botCount} bots en ${teamCount} equipos (${url})`);

const host = await new HostBot(url, hostToken).open();
const created = await host.command('createRoom', { teamCount, workshop });
if (!created.ok) fail(`No se pudo crear la sala: ${created.error}`);
// Cada pareja de bots es un equipo: en la sala con registro lo crean ellos con este nombre.
const bots = await Promise.all(Array.from({ length: botCount }, (_, i) => {
  const pair = Math.floor(i / 2) + 1;
  return new PlayerBot(url, {
    label: `bot${i + 1}`,
    preferredTeam: `t${pair}`,
    team: { name: `Bots ${pair}`, members: [`Bot ${2 * pair - 1}`, `Bot ${2 * pair}`] },
  }).open();
}));
await host.waitFor(({ teams }) => teams.reduce((sum, team) => sum + Number(team.slots.A !== null) + Number(team.slots.B !== null), 0) >= botCount);
if (workshop) {
  // El taller no tiene plazo: la partida empieza cuando todos los equipos lo terminaron.
  await host.waitFor(({ teams }) => teams.length === teamCount && teams.every((team) => team.workshopDone), 120_000);
  const firsts = server.engine.room.teams.map(({ workshop: w }) => `${w.summary.e1.first}/${w.summary.e1.total}`);
  console.log(`[${clock()}] Taller: ${teamCount} equipos registrados y con los dos ejercicios hechos · pasos a la primera: ${firsts.join(', ')}`);
}

// Recorrido: cuándo empieza cada fase (según el primer bot) y qué pasó en las que importan.
const phaseLog = [];
bots[0].on('view', ({ phase }) => {
  if (!phase || phaseLog.at(-1)?.seq === phase.seq) return;
  const now = Date.now();
  const previous = phaseLog.at(-1);
  if (previous) previous.ms = now - previous.at;
  phaseLog.push({ seq: phase.seq, id: phase.id, kind: phase.kind, minigame: phase.minigame, round: phase.round, at: now });
  narrate(phase, now);
});

function narrate(phase, now) {
  const { room } = server.engine;
  const at = `[${clock(now - startedAt)}]`;
  if (phase.kind === 'roulette') console.log(`\n${at} Ronda ${phase.round}: ${minigameName(phase.minigame)}`);
  if (phase.kind === 'question' && phase.round === 6) console.log(`\n${at} Pregunta final`);
  if (phase.kind === 'duel') {
    const kinds = room.duels.map((d) => (d.kind === 'minigame' ? 'desempate' : `Desafío ${nameOf(d.sides[0][0])} → ${nameOf(d.sides[1][0])}`));
    console.log(`${at}   Duelo: ${kinds.join(', ')}`);
  }
  if (phase.kind === 'minigameResult') {
    const result = room.minigameResults[phase.round];
    const awards = result.awards.map((a) => `${nameOf(a.teamId)} +${a.points}${a.streak ? ` (+${a.streak} racha)` : ''}`).join(', ');
    console.log(`${at}   ${result.headline ? `${result.headline}. ` : ''}${awards || 'Sin premios.'}`);
    if (phase.minigame === 'arena') console.log(`${at}   ${arenaSummary()}`);
  }
  if (phase.kind === 'ranking' || phase.kind === 'finalRanking') {
    const top = [...room.teams].sort((a, b) => b.score - a.score).slice(0, 3);
    console.log(`${at}   Ranking: ${top.map((team, i) => `${i + 1}.º ${team.name} ${team.score}`).join(' · ')}`);
  }
}

// Arena: lo que pasó con las cajas y el jefe (los bots apuntan mejor que una persona: no calibra).
function arenaSummary() {
  const { events } = server.engine;
  const count = (type) => events.filter((e) => e.type === type).length;
  const summary = events.findLast((e) => e.type === 'arena_summary');
  const end = summary?.downAtMs === null ? `resistió con ${summary.bossHp} de ${summary.bossMaxHp}` : `cayó a los ${(summary?.downAtMs / 1000).toFixed(1)} s`;
  return `${summary?.challengers} retadores contra ${summary?.bossVehicles} jefes (${summary?.bossMaxHp} de vida): ${end} · `
    + `${count('arena_wave')} oleadas, ${count('arena_power')} poderes, ${count('arena_crushed')} cajas aplastadas, `
    + `${count('arena_blast')} explosiones, ${count('arena_stage')} cambios de estado`;
}

host.drive({ nextDelayMs: 150, skipTimedAfterMs: 300 });
const started = await host.command('start');
if (!started.ok) fail(`No se pudo iniciar: ${started.error}`);
await Promise.all(bots.map((bot) => bot.waitFor(({ phase }) => phase?.kind === 'finalRanking', 30 * 60_000)));
phaseLog.at(-1).ms = 0;

// Resumen
const { room } = server.engine;
const totals = {};
for (const { kind, minigame, ms = 0 } of phaseLog) {
  const key = kind === 'minigame' ? minigameName(minigame) : kind;
  totals[key] = (totals[key] ?? 0) + ms;
}
console.log(`\nDuración total: ${clock()} · ${phaseLog.length} fases`);
console.log('Tiempo por tipo de fase:');
for (const [key, ms] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(6)} s`);
}
console.log('Ranking final:');
[...room.teams].sort((a, b) => b.score - a.score).forEach((team, i) => {
  console.log(`  ${String(i + 1).padStart(2)}.º ${team.name.padEnd(12)} ${String(team.score).padStart(6)} pts · racha ${team.streak}`);
});
const duels = server.engine.events.filter((e) => e.type === 'duel_finished');
const stars = server.engine.events.filter((e) => e.type === 'star_completed');
const skipped = server.engine.events.filter((e) => e.type === 'duel_skipped').length;
console.log(`Duelos: ${duels.filter((d) => d.kind === 'minigame').length} desempates y ${duels.filter((d) => d.kind === 'desafio').length} Desafíos (${skipped} sin nada que robar) · estrellas completadas: ${stars.length}`);
// Las fases anunciadas (los Duelos que no hicieron falta se saltan).
const planIds = server.engine.events.filter((e) => e.type === 'phase_entered').map((e) => e.phase);
const incomplete = bots.filter((bot) => JSON.stringify(bot.phaseIds) !== JSON.stringify(planIds)).map((bot) => bot.label);
const errors = bots.flatMap((bot) => bot.errors.map((error) => `${bot.label}: ${error}`));
if (incomplete.length) console.log(`No vieron todas las fases: ${incomplete.join(', ')}`);
console.log(errors.length ? `Errores:\n  ${errors.join('\n  ')}` : 'Sin errores.');

for (const client of [...bots, host]) client.close();
await server.close();
process.exit(errors.length || incomplete.length ? 1 : 0);

function fail(message) {
  console.error(message);
  process.exit(1);
}
