// Integración por Socket.IO: el criterio de salida de la Fase 1 con bots reales.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { HostBot, PlayerBot } from '../scripts/lib/bots.js';
import { createApp } from '../server/app.js';
import { silentLogger, testConfig, testQuestions } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';
const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';

let server;
let url;
const clients = [];

before(async () => {
  server = createApp({
    hostToken: HOST_TOKEN,
    logger: silentLogger,
    config: testConfig({
      timings: { leadMs: 30, draft: 3000, itemUse: 3000, roulette: 40, minigameIntro: 40 },
      minigameRules: { memoria: { cardTimeMs: 1500 }, traza: { maxDurationMs: 15_000 }, flappy: { levelMs: 3000 } },
      questions: { readingMs: 50, answerGraceMs: 100 },
      questionBank: testQuestions({ timeLimitMs: 3000 }),
    }),
  });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
});

// Cada prueba cierra sus clientes: si no, los bots de una se unirían a la sala de la siguiente.
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

after(() => server.close());

async function openHost() {
  const host = new HostBot(url, HOST_TOKEN);
  clients.push(host);
  return host.open();
}

async function openPlayer(options) {
  const bot = new PlayerBot(url, options);
  clients.push(bot);
  return bot.open();
}

const teamOf = (bot) => bot.view.me.teamId;

describe('partida completa con bots', () => {
  test('14 jugadores, proyector y host recorren las 5 rondas y la final', { timeout: 60_000 }, async () => {
    const host = await openHost();
    assert.equal((await host.command('createRoom', { teamCount: 7 })).ok, true);

    const screen = connectClient(url, { auth: { role: 'screen' }, transports: ['websocket'], forceNew: true });
    clients.push(screen);
    const screenPhases = [];
    screen.on('state:sync', (view) => {
      if (view.phase && screenPhases.at(-1) !== view.phase.id) screenPhases.push(view.phase.id);
    });

    const bots = await Promise.all(Array.from({ length: 14 }, (_, i) =>
      openPlayer({ label: `bot${i}`, preferredTeam: `t${Math.floor(i / 2) + 1}`, trazaMistakeRate: 0 })));
    await host.waitFor(({ teams }) => teams.every((team) => team.slots.A && team.slots.B));

    host.drive({ nextDelayMs: 5 });
    assert.equal((await host.command('start')).ok, true);
    await Promise.all(bots.map((bot) => bot.waitFor(({ phase }) => phase?.kind === 'finalRanking', 45_000)));

    // Las fases anunciadas son las del plan, en orden, salvo los Duelos que no hicieron falta.
    const { events } = server.engine;
    const entered = events.filter((e) => e.type === 'phase_entered').map((e) => e.phase);
    const skipped = new Set(events.filter((e) => e.type === 'phase_skipped').map((e) => e.phase));
    const plan = server.engine.plan;
    assert.deepEqual(entered, plan.filter((step) => !skipped.has(step.id)).map((step) => step.id));
    assert.ok(plan.filter((step) => skipped.has(step.id)).every((step) => step.kind === 'duel'), 'solo se saltan Duelos');
    for (const bot of bots) {
      assert.deepEqual(bot.errors, [], `${bot.label} tuvo errores`);
      assert.deepEqual(bot.phaseIds, entered, `${bot.label} no vio todas las fases en orden`);
    }
    assert.deepEqual(screenPhases, entered);

    // Cada equipo respondió las 11 preguntas. Su puntaje es lo que ganó en ellas, más los ajustes de
    // objetos en las preguntas (Doble o nada, Chupa-Sangre), más los cambios de cada resolución.
    const { room } = server.engine;
    assert.equal(room.finished, true);
    for (let n = 1; n <= 11; n += 1) {
      assert.ok(room.questionResults[n].results.every((r) => r.answered), `pregunta ${n}: un equipo no respondió`);
    }
    assert.deepEqual(Object.keys(room.resolutions), ['1', '2', '3', '4', '5']);
    assert.deepEqual(Object.values(room.minigameResults).map((r) => r.minigame), ['memoria', 'traza', 'clicker', 'flappy', 'arena']);
    assert.ok(Object.values(room.minigameResults).some((r) => r.awards.length > 0), 'los bots ganaron algún minijuego');
    assert.equal(room.minigameResults[2].awards.length, room.teams.length, 'todos los equipos aceptaron la cadena');
    assert.ok(room.minigameResults[4].awards.length > 0, 'algún pájaro llegó a la meta del Flappy');
    assert.match(room.minigameResults[5].headline, /resisti|Vaciaron/);
    assert.ok(room.minigameResults[5].groups.some((row) => /golpe/.test(row.label) && row.score > 0), 'los retadores le dieron al jefe');
    assert.ok(room.itemSeq >= 5 * room.teams.length, 'cada equipo recibe al menos un objeto por draft');
    for (const team of room.teams) {
      const fromQuestions = Object.values(room.questionResults).reduce((sum, q) => {
        const row = q.results.find((r) => r.teamId === team.id);
        return sum + row.points + row.adjustments.reduce((acc, adj) => acc + adj.points, 0);
      }, 0);
      const fromItems = Object.values(room.resolutions).reduce((sum, resolution) => {
        const row = resolution.teams.find((r) => r.teamId === team.id);
        return sum + row.scoreAfter - row.scoreBefore;
      }, 0);
      const fromMinigames = Object.values(room.minigameResults)
        .flatMap((result) => result.awards)
        .filter((award) => award.teamId === team.id)
        .reduce((sum, award) => sum + award.points, 0);
      // Los puntos de las estrellas van aparte (pozo de estrellas): no entran en team.score.
      assert.equal(team.score, fromQuestions + fromItems + fromMinigames, `${team.id}: el puntaje no cuadra`);
      const perFragment = server.engine.config.stars.basePoints / server.engine.config.stars.fragmentsPerStar;
      const perStar = server.engine.config.stars.basePoints + server.engine.config.stars.bonusPoints;
      assert.equal(team.starPoints ?? 0, team.fragments * perFragment + team.stars * perStar, `${team.id}: el pozo de estrellas no cuadra`);
      assert.ok(team.score >= 0 && team.streak >= 0);
    }
    // Los 7 fragmentos de la partida (2 + 1 + 2 + 1 + 1) siguen en juego: los Desafíos solo los
    // cambian de dueño y cada estrella completa se lleva 5.
    const perStar = server.engine.config.stars.fragmentsPerStar;
    const held = room.teams.reduce((sum, team) => sum + team.fragments + team.stars * perStar, 0);
    const given = Object.values(room.minigameResults).reduce((sum, result) => sum + result.fragments.length, 0);
    assert.equal(held, given, 'ningún fragmento se pierde ni aparece de la nada');

    // Estadísticas (Fase 8): la exportación pide el token; el resumen por equipo cuadra con el puntaje
    // y las tablas tienen una fila por equipo y pregunta / ronda.
    assert.equal((await fetch(`${url}/api/export?format=json`)).status, 401);
    const auth = { headers: { Authorization: `Bearer ${HOST_TOKEN}` } };
    const full = await (await fetch(`${url}/api/export?format=json`, auth)).json();
    assert.equal(full.events.length, server.engine.events.length);
    for (const row of full.summary.teams) {
      const team = room.teams.find((t) => t.name === row.equipo);
      // El total es el de los puntos del juego más el pozo de estrellas.
      const total = team.score + (team.starPoints ?? 0);
      assert.equal(row.puntos_preguntas + row.puntos_objetos + row.puntos_minijuegos + row.puntos_estrellas + row.ajustes_host, total, `${row.equipo}: fuentes`);
      assert.equal(row.total, total, `${row.equipo}: total`);
    }
    assert.equal(full.summary.questions.length, 11);
    const csv = async (table) => {
      const res = await fetch(`${url}/api/export?format=csv&table=${table}`, auth);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-disposition'), new RegExp(`${table}\\.csv`));
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM para Excel');
      return bytes.subarray(3).toString('utf8').trim().split('\r\n');
    };
    assert.equal((await csv('respuestas')).length, 1 + 11 * room.teams.length);
    assert.equal((await csv('ranking')).length, 1 + 11 * room.teams.length); // 2 rankings por ronda y el final
    assert.equal((await csv('minijuegos')).length, 1 + 5 * room.teams.length);
    assert.ok((await csv('objetos')).length > 5 * room.teams.length);
    assert.equal((await csv('equipos'))[0].split(';')[0], 'equipo');
    assert.equal((await csv('preguntas')).length, 12);
    assert.equal((await fetch(`${url}/api/export?format=csv&table=otra`, auth)).status, 400);
    // Datos destacados del ranking final (RF-RNK-03).
    const { highlights } = room.phase.data;
    assert.ok(highlights.fastestAnswer && highlights.fastestAnswer.t >= 0);
  });
});

describe('sesión y lobby', () => {
  test('al reconectar con su token, el dispositivo recupera su equipo y su puesto', async () => {
    const host = await openHost();
    await host.command('createRoom', { teamCount: 2, confirm: true });
    const bot = await openPlayer({ preferredTeam: 't2' });
    await bot.waitFor((view) => view.me.teamId === 't2');
    const { deviceId, token } = bot;
    const slot = bot.view.me.slot;

    await bot.reconnect();
    assert.equal(bot.deviceId, deviceId);
    assert.equal(bot.token, token);
    assert.equal(teamOf(bot), 't2');
    assert.equal(bot.view.me.slot, slot);
  });

  test('si se abre otra pestaña con la misma sesión, la anterior se cierra', async () => {
    const host = await openHost();
    await host.command('createRoom', { teamCount: 2, confirm: true });
    const first = await openPlayer();
    await first.waitFor((view) => view.me.teamId !== null);
    const ended = new Promise((resolve) => first.once('ended', resolve));
    const second = await openPlayer({ token: first.token, autoJoin: false });
    assert.equal(await ended, 'replaced');
    assert.equal(second.deviceId, first.deviceId);
    assert.equal(second.view.me.teamId, first.view.me.teamId);
  });

  test('tres solicitudes simultáneas al mismo equipo: solo entran dos', async () => {
    const host = await openHost();
    await host.command('createRoom', { teamCount: 2, confirm: true });
    const bots = await Promise.all([0, 1, 2].map(() => openPlayer({ autoJoin: false })));
    const results = await Promise.all(bots.map((bot) => bot.send('lobby:join', { teamId: 't1' })));
    assert.equal(results.filter((res) => res.ok).length, 2);
    assert.deepEqual(results.filter((res) => !res.ok).map((res) => res.error), ['team_full']);
  });

  test('con el ingreso cerrado nadie entra; el host puede mover y expulsar', async () => {
    const host = await openHost();
    await host.command('createRoom', { teamCount: 2, confirm: true });
    await host.command('setLobby', { open: false });
    const bot = await openPlayer({ autoJoin: false });
    assert.equal((await bot.send('lobby:join', { teamId: 't1' })).error, 'lobby_closed');

    assert.equal((await host.command('move', { deviceId: bot.deviceId, teamId: 't2' })).ok, true);
    await bot.waitFor((view) => view.me.teamId === 't2');

    const ended = new Promise((resolve) => bot.once('ended', resolve));
    assert.equal((await host.command('kick', { deviceId: bot.deviceId })).ok, true);
    assert.equal(await ended, 'kicked');
    const again = await openPlayer({ token: bot.token, autoJoin: false });
    assert.notEqual(again.deviceId, bot.deviceId, 'el token expulsado ya no vale');
  });

  test('los jugadores no pueden usar comandos del host ni mandar datos inválidos', async () => {
    const bot = await openPlayer({ autoJoin: false });
    assert.equal((await bot.send('host:command', { action: 'start' })).error, 'forbidden');
    assert.equal((await bot.send('lobby:join', { teamId: 42 })).error, 'invalid_payload');
    const host = await openHost();
    assert.equal((await host.command('createRoom', { teamCount: 'muchos' })).error, 'invalid_payload');
    assert.equal((await host.command('formatear')).error, 'unknown_action');
  });
});

describe('proyección de vistas', () => {
  test('ningún cliente recibe tokens, y un jugador no ve los ids de otros dispositivos', async () => {
    const host = await openHost();
    await host.command('createRoom', { teamCount: 2, confirm: true });
    const [a, b] = await Promise.all([openPlayer({ preferredTeam: 't1' }), openPlayer({ preferredTeam: 't2' })]);
    await host.waitFor(({ teams }) => teams[0].slots.A && teams[1].slots.A);
    await a.waitFor(({ teams }) => teams[1].slots.A !== null);

    const playerJson = JSON.stringify(a.view);
    assert.ok(!playerJson.includes(b.deviceId), 'el jugador ve el id de otro dispositivo');
    for (const client of [a, b, host]) {
      const json = JSON.stringify(client.view);
      assert.ok(!json.includes('tokenHash') && !json.includes(a.token), `${client.label} recibió un token`);
    }
    assert.ok(JSON.stringify(host.view).includes(b.deviceId), 'el host sí ve los dispositivos');
  });
});
