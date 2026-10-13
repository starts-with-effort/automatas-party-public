// Simula jugadores contra un servidor local o desplegado.
//
//   node scripts/bots.js --bots 14
//       14 jugadores se unen a la sala abierta y juegan cada fase (responden, eligen y usan
//       objetos, juegan los minijuegos); tú manejas /host.
//   node scripts/bots.js --bots 14 --create-room --drive --host-token <token>
//       además crea la sala, inicia y avanza la partida sola hasta el ranking final.
//
//   node scripts/bots.js --bots 4 --create-room --practice arena --room-teams 3 --teams t2,t3
//       sala de práctica de la Arena con 3 equipos: tus celulares entran al equipo 1 y los bots
//       ocupan los equipos 2 y 3. Inicias y eliges quién es jefe desde /host.
//
//   node scripts/bots.js --bots 6 --create-room --taller --room-teams 4 --host-token <token>
//       sala con registro (docs/TALLER.md) para 4 equipos: los bots registran 3 («Bots 1»…), hacen
//       el taller y queda un lugar para registrar un equipo desde tus celulares.
//
// En una sala con registro (la cree este script o el host), cada pareja de bots registra su equipo
// «Bots N» y hace el taller antes de que empiece la partida.
//
// Opciones: --url (por defecto http://localhost:3000), --host-token (o HOST_TOKEN en el entorno),
// --taller (con --create-room: sala con registro),
// --skip-timed (salta ruleta e instrucciones para terminar antes), --practice <minijuego> (con
// --create-room: sala de práctica de ese minijuego), --room-teams <n> (equipos de la sala nueva; por
// defecto, los que llenan los bots), --teams t2,t3 (equipos que ocupan los bots, en orden) y
// --per-team <1|2> (bots por equipo; por defecto 2).
import { parseArgs } from 'node:util';
import { HostBot, PlayerBot } from './lib/bots.js';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    bots: { type: 'string', default: '14' },
    'host-token': { type: 'string', default: process.env.HOST_TOKEN },
    'create-room': { type: 'boolean', default: false },
    drive: { type: 'boolean', default: false },
    'skip-timed': { type: 'boolean', default: false },
    practice: { type: 'string' },
    taller: { type: 'boolean', default: false },
    'room-teams': { type: 'string' },
    teams: { type: 'string' },
    'per-team': { type: 'string', default: '2' },
  },
});

const count = Number(args.bots);
const perTeam = Math.min(2, Math.max(1, Number(args['per-team']) || 2));
const teamList = args.teams?.split(',').map((id) => id.trim()).filter(Boolean) ?? null;
// Equipo de cada bot: los de --teams en orden (perTeam por equipo) o, sin --teams, desde el t1.
const teamFor = (i) => (teamList ? teamList[Math.floor(i / perTeam) % teamList.length] : `t${Math.floor(i / perTeam) + 1}`);
if (args.practice && !args['create-room']) fail('--practice crea una sala: úsalo con --create-room.');
if (args.taller && !args['create-room']) fail('--taller crea una sala: úsalo con --create-room.');
if (args.taller && args.practice) fail('Una sala de práctica no tiene registro: usa --taller o --practice.');
const startedAt = Date.now();
const elapsed = () => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

let host = null;
if (args['create-room'] || args.drive) {
  if (!args['host-token']) fail('Para --create-room o --drive hace falta --host-token (o HOST_TOKEN).');
  host = await new HostBot(args.url, args['host-token']).open().catch((err) => fail(`Host rechazado: ${err.message}`));
}

if (args['create-room']) {
  const teamCount = Number(args['room-teams']) || Math.ceil(count / perTeam);
  const kind = args.practice ? `de práctica (${args.practice}) ` : args.taller ? 'con registro ' : '';
  console.log(`Creando una sala ${kind}nueva ${args.taller ? `para ${teamCount} equipos` : `con ${teamCount} equipos`} (descarta la partida que hubiera)…`);
  const res = await host.command('createRoom', { teamCount, confirm: true, practice: args.practice ?? null, workshop: args.taller });
  if (!res.ok) fail(`No se pudo crear la sala: ${res.error}`);
}

console.log(`Conectando ${count} bots a ${args.url}…`);
// En una sala con registro, cada grupo de bots (perTeam) crea su equipo con este nombre.
const botTeam = (i) => {
  const n = Math.floor(i / perTeam) + 1;
  return { name: `Bots ${n}`, members: [`Bot ${2 * n - 1}`, `Bot ${2 * n}`] };
};
const bots = await Promise.all(Array.from({ length: count }, (_, i) =>
  new PlayerBot(args.url, { label: `bot${i + 1}`, preferredTeam: teamFor(i), onlyPreferred: Boolean(teamList), team: botTeam(i) }).open()));
const rtts = bots.map((bot) => bot.rtt).sort((a, b) => a - b);
console.log(`RTT de los bots: mín ${rtts[0]} ms · mediana ${rtts[Math.floor(rtts.length / 2)]} ms · máx ${rtts.at(-1)} ms`);

let lastPhase = null;
bots[0].on('view', ({ phase }) => {
  if (phase && phase.id !== lastPhase) {
    lastPhase = phase.id;
    console.log(`[${elapsed()}] ${phase.id} (${phase.kind})`);
  }
});

if (args.drive) {
  await bots[0].waitFor(({ room, teams }) => room && !room.started
    && teams.reduce((sum, team) => sum + Number(team.slots.A !== null) + Number(team.slots.B !== null), 0) >= count);
  // Sala con registro: la partida empieza cuando los equipos de los bots terminaron el taller.
  await host.waitFor(({ room, teams }) => !room?.workshop || teams.filter((team) => team.workshopDone).length >= Math.ceil(count / perTeam), 5 * 60_000);
  host.drive({ nextDelayMs: 1500, skipTimedAfterMs: args['skip-timed'] ? 500 : null });
  const res = await host.command('start', { force: true });
  if (!res.ok) fail(`No se pudo iniciar: ${res.error}`);
  if (args.practice) {
    // La práctica no termina: da la vuelta después de cada resultado.
    console.log('Práctica en bucle; Ctrl+C para terminar.');
    process.on('SIGINT', finish);
  } else {
    await Promise.all(bots.map((bot) => bot.waitFor(({ phase }) => phase?.kind === 'finalRanking', 60 * 60_000)));
    finish();
  }
} else {
  console.log('Bots listos. Maneja la partida desde /host; Ctrl+C para terminar.');
  process.on('SIGINT', finish);
}

function finish() {
  const errors = bots.flatMap((bot) => bot.errors.map((error) => `${bot.label}: ${error}`));
  console.log(`\nDuración: ${elapsed()} · fases vistas por bot: ${[...new Set(bots.map((bot) => bot.phaseIds.length))].join(', ')}`);
  const allPhases = [...new Set(bots.flatMap((bot) => bot.phaseIds))];
  for (const bot of bots) {
    const missing = allPhases.filter((id) => !bot.phaseIds.includes(id));
    if (missing.length) console.log(`${bot.label} no vio: ${missing.join(', ')}`);
  }
  console.log(errors.length ? `Errores:\n  ${errors.join('\n  ')}` : 'Sin errores.');
  for (const client of [...bots, host]) client?.close();
  process.exit(errors.length ? 1 : 0);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
