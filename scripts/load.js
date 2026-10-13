// Prueba de carga y de reconexión (Fase 9: RNF-01, 02, 03 y 06; secciones 10.1 y 10.2).
//
// 30 clientes (16 jugadores en 8 equipos y 14 proyectores) y el host juegan una partida completa
// contra un servidor, y se mide lo que pide el documento:
//   RNF-01  la partida termina sin errores, con CPU < 50 % y memoria < 500 MB en el servidor
//   RNF-02  p95 de la latencia de entrega servidor → cliente < 250 ms
//   RNF-03  los inicios de fase se ven en todas las pantallas con < 100 ms de diferencia, y el error
//           del reloj sincronizado es < 50 ms
// Con --outages, además, dos cortes de red simulados (sección 10.2), uno en una pregunta y otro en un
// minijuego: el dispositivo debe volver con su equipo, puesto, puntos e inventario en < 3 s (RNF-06).
//
//   npm run load                     servidor local en otro proceso, tiempos rápidos (~2 min)
//   npm run load -- --real           servidor local con los tiempos reales de game.json (~6,5 min)
//   npm run load -- --outages        con los cortes de red (10 s cada uno)
//   npm run load -- --url https://tu-dominio.example --host-token <token> --confirm
//       contra la VM, con su configuración. Crea una sala nueva: descarta la partida que haya.
//
// Opciones: --players (16; 2 por equipo, de 4 a 16), --screens (los que falten para 30),
// --outage-ms (10000), --json <archivo> (guarda el informe completo, con la serie de métricas).
// Termina con código 1 si algún criterio no se cumple.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/core/config.js';
import { buildRoundPlan } from '../server/core/RoundPlan.js';
import { HostBot, PlayerBot, ScreenBot } from './lib/bots.js';
import { createProbe, summarize } from './lib/measure.js';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const CLIENTS = 30; // RNF-01: 30 clientes simulados
const TARGETS = { cpuPercent: 50, rssMb: 500, latencyP95Ms: 250, spreadMs: 100, clockErrorMs: 50, recoveryMs: 3000 };
const METRICS_EVERY_MS = 5000;
const RESYNC_EVERY_MS = 30_000; // como el navegador (client/shared/timesync.js): 7 pings cada 30 s
const HOST_NEXT_DELAY_MS = 1000; // pausa del host en las pantallas de resultados
// Cortes de red (--outages): el dispositivo de opciones al aparecer una pregunta (su compañero debe
// quedar con enunciado y opciones, RF-PRE-04) y un jugador en pleno minijuego de la ronda 4 (Flappy).
const OUTAGES = [
  { phase: 'r2.q3', teamIndex: 1, pick: 'options', label: 'pregunta 3' },
  { phase: 'r4.mg', teamIndex: 2, pick: 'A', delayMs: 2000, label: 'minijuego de la ronda 4' },
];

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    'host-token': { type: 'string', default: process.env.HOST_TOKEN },
    confirm: { type: 'boolean', default: false },
    real: { type: 'boolean', default: false },
    players: { type: 'string', default: '16' },
    screens: { type: 'string' },
    outages: { type: 'boolean', default: false },
    'outage-ms': { type: 'string', default: '10000' },
    json: { type: 'string' },
  },
});

const playerCount = Math.min(16, Math.max(4, 2 * Math.round((Number(args.players) || 16) / 2)));
const screenCount = args.screens === undefined ? Math.max(0, CLIENTS - playerCount) : Math.max(0, Number(args.screens) || 0);
const outageMs = Math.max(0, Number(args['outage-ms']) || 0);
const planIds = buildRoundPlan(loadConfig()).map((step) => step.id); // los ids no dependen de la configuración

const clients = [];
const errors = [];
let server = null;
let exitCode = 1;

process.on('SIGINT', async () => {
  for (const client of clients) client.close();
  await server?.stop();
  process.exit(130);
});

try {
  server = args.url ? remoteServer() : await startLocalServer();
  exitCode = await run();
} catch (err) {
  console.error(`\n✘ ${err.message}`);
} finally {
  for (const client of clients) client.close();
  await server?.stop();
}
process.exit(exitCode);

async function run() {
  const health = await (await fetch(`${server.url}/health`)).json();
  const mode = server.local ? `servidor local, tiempos ${args.real ? 'reales' : 'rápidos'}` : server.url;
  console.log(`Prueba de carga · ${playerCount} jugadores (${playerCount / 2} equipos) + ${screenCount} proyectores + host · ${mode}`);
  console.log(`Servidor ${health.version} (${health.commit ?? 'sin commit'}) · Node ${health.node}`);
  if (!server.local) console.log('Se crea una sala nueva: la partida que hubiera en el servidor se descarta.');

  const host = track(await new HostBot(server.url, server.token, { label: 'host' }).open());
  const created = await host.command('createRoom', { teamCount: playerCount / 2, confirm: true });
  if (!created.ok) throw new Error(`No se pudo crear la sala: ${created.error}`);

  const probe = createProbe();
  probe.watch(host);
  const screens = await Promise.all(Array.from({ length: screenCount }, (_, i) =>
    new ScreenBot(server.url, { label: `proyector${i + 1}` }).open()));
  const bots = await Promise.all(Array.from({ length: playerCount }, (_, i) =>
    new PlayerBot(server.url, { label: `bot${i + 1}`, preferredTeam: `t${Math.floor(i / 2) + 1}` }).open()));
  for (const client of [...screens, ...bots]) {
    track(client);
    probe.watch(client);
  }
  const seated = ({ teams }) => teams.reduce((sum, t) => sum + Number(t.slots.A !== null) + Number(t.slots.B !== null), 0);
  await host.waitFor((view) => seated(view) >= playerCount, 20_000);
  const rtts = summarize([...screens, ...bots].map((client) => client.rtt));
  console.log(`${clients.length} clientes conectados · RTT mín ${Math.min(...[...screens, ...bots].map((c) => c.rtt))} ms · mediana ${rtts.p50} ms · máx ${rtts.max} ms`);
  // ¿La compresión llega negociada hasta los clientes? En la VM la conexión pasa por Caddy.
  const extensions = bots[0]?.socket.io.engine.transport?.ws?.extensions ?? '';
  console.log(`Compresión del WebSocket: ${/permessage-deflate/.test(extensions) ? 'activa (permessage-deflate)' : 'no negociada'}`);

  // Métricas desde el inicio de la partida, con una muestra cada 5 s para el informe.
  const metricsAvailable = (await hostApi('POST', '/api/metrics/reset')) !== null;
  if (!metricsAvailable) console.log('⚠ El servidor no tiene /api/metrics: no se pueden medir CPU ni memoria (desplieguen esta versión).');
  const timeline = [];
  const startedAt = Date.now();
  const poller = metricsAvailable && setInterval(async () => {
    const snapshot = await hostApi('GET', '/api/metrics').catch(() => null);
    if (snapshot?.last) timeline.push({ s: Math.round((Date.now() - startedAt) / 1000), phase: host.view?.phase?.id, ...snapshot.last });
  }, METRICS_EVERY_MS);
  const resync = setInterval(() => {
    for (const client of clients) client.syncClock(7);
  }, RESYNC_EVERY_MS);

  // Cortes de red: se disparan cuando el host ve la fase indicada.
  const outages = [];
  const outageBots = new Set();
  const pending = args.outages ? OUTAGES.map((plan) => ({ ...plan })) : [];
  host.on('view', ({ phase }) => {
    for (const plan of pending) {
      if (plan.task || phase?.id !== plan.phase) continue;
      plan.task = runOutage(plan, phase, { bots, host, outageBots })
        .then((result) => outages.push(result))
        .catch((err) => errors.push(`corte en ${plan.label}: ${err.message}`));
    }
  });

  host.drive({ nextDelayMs: HOST_NEXT_DELAY_MS });
  const started = await host.command('start');
  if (!started.ok) throw new Error(`No se pudo iniciar: ${started.error}`);
  let lastRound = null;
  host.on('view', ({ phase }) => {
    if (!phase || phase.round === lastRound) return;
    lastRound = phase.round;
    console.log(`[${clock(Date.now() - startedAt)}] ${phase.round === 6 ? 'Pregunta final' : `Ronda ${phase.round}`}`);
  });
  await host.waitFor(({ phase }) => phase?.kind === 'finalRanking', 45 * 60_000);
  const durationMs = Date.now() - startedAt;
  await Promise.all(pending.map((plan) => plan.task));
  await sleep(1500); // que las últimas vistas lleguen a todos
  if (poller) clearInterval(poller);
  clearInterval(resync);
  const metrics = metricsAvailable ? await hostApi('GET', '/api/metrics') : null;

  // Resultados
  for (const bot of bots) errors.push(...bot.errors.map((error) => `${bot.label}: ${error}`));
  const watched = [...screens, ...bots.filter((bot) => !outageBots.has(bot))];
  const incomplete = watched.filter((client) => JSON.stringify(probe.phaseIdsOf(client)) !== JSON.stringify(planIds));
  const notFinished = bots.filter((bot) => bot.view?.phase?.kind !== 'finalRanking');
  const latency = probe.latency();
  const starts = probe.phaseStarts();
  const offsets = [host, ...screens, ...bots].map((client) => client.offset);
  const clockError = server.local
    ? summarize(offsets.map((offset) => Math.abs(offset)))
    : { p95: Math.max(...offsets) - Math.min(...offsets), spread: true };
  const window = metrics?.window;
  const serverErrors = (window?.errors ?? 0) + server.errorLines().length;

  console.log(`\nPartida: ${planIds.length} fases en ${clock(durationMs)}` + (window
    ? ` · ${window.messagesIn} mensajes recibidos y ${window.viewsOut} vistas enviadas por el servidor`
    : ''));
  const checks = [];
  const check = (id, ok, text) => checks.push({ id, ok, text });
  check('RNF-01', incomplete.length === 0 && notFinished.length === 0 && errors.length === 0 && serverErrors === 0,
    `Partida completa: ${watched.length - incomplete.length} de ${watched.length} clientes vieron las ${planIds.length} fases en orden`
    + `${outageBots.size ? ` (sin contar los ${outageBots.size} con corte de red)` : ''}; `
    + `${errors.length} errores en los clientes y ${serverErrors} en el servidor`);
  if (window) {
    check('RNF-01', window.peak.cpuPercent < TARGETS.cpuPercent,
      `CPU del servidor: pico ${dec(window.peak.cpuPercent)} % de un núcleo (media ${dec(window.cpuAvgPercent ?? 0)} %; ${metrics.cores} núcleos) · objetivo < ${TARGETS.cpuPercent} %`);
    check('RNF-01', window.peak.rssMb < TARGETS.rssMb,
      `Memoria del servidor: pico ${Math.round(window.peak.rssMb)} MB (heap ${Math.round(window.peak.heapUsedMb)} MB) · objetivo < ${TARGETS.rssMb} MB`);
  } else {
    check('RNF-01', false, 'CPU y memoria del servidor: no se pudieron medir (falta /api/metrics)');
  }
  check('RNF-02', latency.count > 0 && latency.p95 < TARGETS.latencyP95Ms, latency.count > 0
    ? `Latencia de entrega: p95 ${ms(latency.p95)} (p50 ${ms(latency.p50)}, p99 ${ms(latency.p99)}, máx ${ms(latency.max)}; ${latency.count} vistas) · objetivo < ${TARGETS.latencyP95Ms} ms`
    : 'Latencia de entrega: no se pudo medir (las vistas no traen serverTime: desplieguen esta versión)');
  check('RNF-03', starts.phases > 0 && starts.spreadP95 < TARGETS.spreadMs,
    `Inicio de fase entre pantallas: p95 ${ms(starts.spreadP95)} (máx ${ms(starts.spreadMax)}; ${starts.lateViews} de ${starts.views} vistas llegaron después de startsAt`
    + `${starts.lateViews ? `, hasta ${ms(starts.maxLateMs)} tarde` : `, la más justa ${ms(starts.minMarginMs)} antes`}) · objetivo < ${TARGETS.spreadMs} ms`);
  check('RNF-03', clockError.p95 < TARGETS.clockErrorMs, clockError.spread
    ? `Reloj sincronizado: los clientes (todos en este PC) estiman desfases que difieren en ${ms(clockError.p95)} como máximo · objetivo < ${TARGETS.clockErrorMs} ms`
    : `Error del reloj sincronizado: p95 ${ms(clockError.p95)} (máx ${ms(clockError.max)}; servidor y bots comparten reloj) · objetivo < ${TARGETS.clockErrorMs} ms`);
  for (const outage of outages) check('RNF-06', outage.ok, outageText(outage));
  if (args.outages && outages.length < OUTAGES.length) check('RNF-06', false, `Solo se hicieron ${outages.length} de ${OUTAGES.length} cortes de red`);

  for (const { id, ok, text } of checks) console.log(`${ok ? '✔' : '✘'} ${id}  ${text}`);
  const byPhase = probe.latencyByPhase();
  const frames = probe.frameLatency();
  if (latency.count > 0) {
    console.log(`  Latencia por fase (p95; las 4 más lentas): ${byPhase.slice(0, 4).map((row) => `${row.key} ${ms(row.p95)} (${row.count} vistas)`).join(' · ')}`);
  }
  if (frames.count > 0) {
    console.log(`  Fotogramas de la Arena: p50 ${ms(frames.p50)} · p95 ${ms(frames.p95)} · p99 ${ms(frames.p99)} · máx ${ms(frames.max)} (${frames.count} recibidos)`);
  }
  if (window) {
    console.log(`  Otros datos del servidor: event loop p99 hasta ${dec(window.peak.loopDelayP99Ms)} ms (máx ${dec(window.peak.loopDelayMaxMs)} ms) · `
      + `pico de mensajes: ${window.peak.inPerSec}/s recibidos, ${window.peak.outPerSec}/s vistas enviadas · ${window.peak.connections} conexiones`);
  }
  if (incomplete.length) console.log(`  No vieron todas las fases: ${incomplete.map((c) => c.label).join(', ')}`);
  if (notFinished.length) console.log(`  No llegaron al ranking final: ${notFinished.map((c) => c.label).join(', ')}`);
  if (errors.length) console.log(`  Errores en los clientes:\n    ${errors.slice(0, 20).join('\n    ')}`);
  for (const line of server.errorLines().slice(0, 10)) console.log(`  Error del servidor: ${line}`);
  if (!server.local) console.log('  Nota: los bots corren en este PC; la latencia incluye su red hasta la VM.');

  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n${failed} criterio(s) no se cumplen.` : '\nSe cumplen todos los criterios.');
  if (args.json) {
    const report = {
      at: new Date(startedAt).toISOString(),
      url: server.local ? 'local' : server.url,
      fast: server.local && !args.real,
      players: playerCount,
      screens: screenCount,
      server: health,
      durationMs,
      checks,
      latency,
      latencyByPhase: byPhase,
      frameLatency: frames,
      phaseStarts: starts,
      clockError,
      metrics,
      timeline,
      outages,
      errors,
      serverErrors: server.errorLines(),
    };
    await writeFile(resolve(args.json), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Informe guardado en ${resolve(args.json)}`);
  }
  return failed ? 1 : 0;
}

// Corte de red simulado: el bot cierra su conexión, espera y vuelve con su token. Se comprueba que
// recupera su dispositivo y su puesto, y que su vista coincide con la del host (fase y puntos) y su
// inventario con el de su compañero.
async function runOutage(plan, phase, { bots, host, outageBots }) {
  const teamIds = [...new Set(bots.map((bot) => bot.view.me.teamId))].sort();
  const teamId = teamIds[Math.min(plan.teamIndex, teamIds.length - 1)];
  const mates = bots.filter((bot) => bot.view.me.teamId === teamId);
  await Promise.all(mates.map((bot) => bot.waitFor((view) => view.phase?.seq === phase.seq, 5000)));
  const bot = plan.pick === 'options'
    ? mates.find((b) => b.view.phase.data.role === 'options') ?? mates[0]
    : mates.find((b) => b.view.me.slot === plan.pick) ?? mates[0];
  const partner = mates.find((b) => b !== bot) ?? null;
  if (plan.delayMs) await sleep(Math.max(0, (phase.playStartsAt ?? phase.startsAt) + plan.delayMs - bot.serverNow()));

  const before = { deviceId: bot.deviceId, slot: bot.view.me.slot };
  outageBots.add(bot);
  bot.close();
  // Con su compañero desconectado, el otro celular debe tener enunciado y opciones (RF-PRE-04).
  const partnerCheck = plan.pick === 'options' && partner
    ? partner.waitFor((view) => view.phase?.seq !== phase.seq || view.phase.data.role === 'both', 3000)
      .then((view) => view.phase?.seq === phase.seq && view.phase.data.role === 'both')
      .catch(() => false)
    : Promise.resolve(null);
  await sleep(outageMs);
  const partnerTookBoth = await partnerCheck;

  const t0 = Date.now();
  const firstView = new Promise((done) => bot.once('view', (_, receivedAt) => done(receivedAt)));
  await bot.open();
  const recoveryMs = (await firstView) - t0;
  const sameDevice = bot.deviceId === before.deviceId;
  const sameSeat = bot.view.me.teamId === teamId && bot.view.me.slot === before.slot;
  const scores = (view) => JSON.stringify(view.teams.map((t) => [t.id, t.score, t.streak]));
  const consistent = await settle(() => bot.view.phase?.seq === host.view.phase?.seq
    && scores(bot.view) === scores(host.view)
    && (!partner || JSON.stringify(bot.view.me.inventory) === JSON.stringify(partner.view.me.inventory)), 2000);
  return {
    label: plan.label,
    phase: plan.phase,
    bot: bot.label,
    teamId,
    slot: before.slot,
    outageMs,
    recoveryMs,
    sameDevice,
    sameSeat,
    consistent,
    partnerTookBoth,
    ok: recoveryMs < TARGETS.recoveryMs && sameDevice && sameSeat && consistent && partnerTookBoth !== false,
  };
}

function outageText(o) {
  const parts = [
    `Corte de ${dec(o.outageMs / 1000, 0)} s en ${o.label} (${o.bot}, equipo ${o.teamId}, ${o.slot}): volvió en ${o.recoveryMs} ms`,
    o.sameDevice && o.sameSeat ? 'con su equipo y su puesto' : 'SIN su equipo o su puesto',
    o.consistent ? 'puntos, fase e inventario al día' : 'puntos, fase o inventario DISTINTOS',
  ];
  if (o.partnerTookBoth !== null) parts.push(o.partnerTookBoth ? 'su compañero tuvo enunciado y opciones' : 'su compañero NO tuvo enunciado y opciones');
  return `${parts.join('; ')} · objetivo < ${TARGETS.recoveryMs} ms`;
}

// Registra el cliente para cerrarlo al final y anota las desconexiones que no pidió el script.
function track(client) {
  clients.push(client);
  client.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') errors.push(`${client.label}: desconexión inesperada (${reason})`);
  });
  return client;
}

async function hostApi(method, path) {
  const res = await fetch(`${server.url}${path}`, { method, headers: { Authorization: `Bearer ${server.token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}${res.status === 401 ? ' (token del host incorrecto)' : ''}`);
  return res.json();
}

function remoteServer() {
  if (!args['host-token']) throw new Error('Contra un servidor remoto hace falta --host-token (o HOST_TOKEN en el entorno).');
  if (!args.confirm) {
    throw new Error(`Esto crea una sala nueva en ${args.url} y descarta la partida que haya. Si es lo que quieres, repite con --confirm.`);
  }
  if (args.real) console.log('--real no aplica a un servidor remoto: se usan sus tiempos.');
  return { url: args.url.replace(/\/+$/, ''), token: args['host-token'], local: false, errorLines: () => [], stop: async () => {} };
}

// Servidor local en otro proceso (así su CPU no se mezcla con la de los bots), con una carpeta de
// datos temporal y un token propio.
async function startLocalServer() {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), 'automatas-party-carga-'));
  const token = randomBytes(16).toString('hex');
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      HOST_TOKEN: token,
      DATA_DIR: dataDir,
      FAST: args.real ? '' : '1',
      GAME_CONFIG: '',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => output.push(...chunk.split('\n').filter(Boolean)));
  }
  const errorLines = () => output.filter((line) => /"level":"error"/.test(line));
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, 'exit'), sleep(5000)]);
    }
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  };
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`El servidor local no arrancó:\n${output.join('\n')}`);
    if (await fetch(`${url}/health`).then((res) => res.ok, () => false)) break;
    if (Date.now() > deadline) {
      await stop();
      throw new Error('El servidor local no respondió en 15 s');
    }
    await sleep(100);
  }
  return { url, token, local: true, errorLines, stop };
}

function freePort() {
  return new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

// Espera a que se cumpla una condición (revisa cada 50 ms); devuelve si se cumplió.
async function settle(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (condition()) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function clock(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function dec(value, digits = 1) {
  return value.toFixed(digits).replace('.', ',');
}

function ms(value) {
  return `${Math.round(value)} ms`;
}
