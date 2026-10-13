// Cortes de red en plena partida (RNF-06, sección 10.2 «modo avión»): mientras un celular está sin
// conexión su compañero cumple los dos roles, y al volver el celular recupera su equipo, su puesto y
// una vista al día en menos de 3 s. Los bots cierran la conexión limpiamente, así que el servidor
// nota el corte al instante; el modo avión de verdad se prueba con celulares en el ensayo.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { after, afterEach, before, describe, test } from 'node:test';
import { HostBot, PlayerBot } from '../scripts/lib/bots.js';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/core/config.js';
import { TRAZA_PDA, acceptingTrace } from '../server/domain/pda.js';
import { silentLogger, testConfig, testQuestions } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';
const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';
const RECOVERY_LIMIT_MS = 3000; // RNF-06

let server;
let url;
const clients = [];

before(async () => {
  const { minigames } = loadConfig();
  server = createApp({
    hostToken: HOST_TOKEN,
    logger: silentLogger,
    config: testConfig({
      timings: { leadMs: 30, draft: 3000, itemUse: 3000, roulette: 40, minigameIntro: 40 },
      questions: { readingMs: 300, answerGraceMs: 100 },
      questionBank: testQuestions({ timeLimitMs: 3000 }),
      // La Traza a ciegas en la ronda 1, para llegar pronto.
      minigames: [minigames.find((m) => m.id === 'traza'), ...minigames.slice(1)],
      minigameRules: { traza: { maxDurationMs: 5000 } },
    }),
  });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
});

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

after(() => server.close());

async function open(client) {
  clients.push(client);
  return client.open();
}

// Sala de 2 equipos con 2 celulares cada uno; la partida empieza y el host avanza solo.
async function startGame({ t1 = {}, t2 = {} } = {}) {
  const host = await open(new HostBot(url, HOST_TOKEN));
  assert.equal((await host.command('createRoom', { teamCount: 2, confirm: true })).ok, true);
  const team = (teamId, options) => Promise.all([0, 1].map((i) =>
    open(new PlayerBot(url, { label: `${teamId}-${i}`, preferredTeam: teamId, ...options }))));
  const teams = { t1: await team('t1', t1), t2: await team('t2', t2) };
  await host.waitFor(({ teams: all }) => all.every((t) => t.slots.A && t.slots.B));
  host.drive({ nextDelayMs: 5 });
  assert.equal((await host.command('start')).ok, true);
  return { host, ...teams };
}

// Vuelve a conectar y mide cuánto tarda en recibir su vista.
async function reopen(bot) {
  const t0 = Date.now();
  const firstView = new Promise((resolve) => bot.once('view', (_, receivedAt) => resolve(receivedAt)));
  await bot.open();
  return (await firstView) - t0;
}

async function eventually(condition, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const waitUntil = (bot, at) => new Promise((resolve) => setTimeout(resolve, Math.max(0, at - bot.serverNow())));
const seatOf = (bot) => ({ deviceId: bot.deviceId, teamId: bot.view.me.teamId, slot: bot.view.me.slot });

describe('cortes de red en plena partida', () => {
  test('en una pregunta: el compañero ve enunciado y opciones y responde; al volver, todo está al día', async () => {
    // El equipo 1 no actúa solo: la prueba decide qué hace cada uno de sus celulares.
    const { t1 } = await startGame({ t1: { autoAct: false } });
    await Promise.all(t1.map((bot) => bot.waitFor(({ phase }) => phase?.id === 'r1.q1')));
    const options = t1.find((bot) => bot.view.phase.data.role === 'options');
    const statement = t1.find((bot) => bot !== options);
    assert.equal(statement.view.phase.data.role, 'statement');
    const seat = seatOf(options);

    options.close();
    // RF-PRE-04: con el compañero desconectado, el otro celular tiene enunciado y opciones.
    const { phase } = await statement.waitFor((view) => view.phase.data.role === 'both');
    assert.ok(phase.data.statement && phase.data.options);
    await waitUntil(statement, phase.answersAt);
    const answer = await statement.send('question:answer', { questionId: phase.data.questionId, option: 0, tClient: 50 });
    assert.equal(answer.ok, true, `respuesta rechazada: ${answer.error}`);

    const recoveryMs = await reopen(options);
    assert.ok(recoveryMs < RECOVERY_LIMIT_MS, `tardó ${recoveryMs} ms en recibir su vista`);
    assert.deepEqual(seatOf(options), seat, 'vuelve con su dispositivo, equipo y puesto');
    await eventually(() => options.view.phase.seq === statement.view.phase.seq
      && isDeepStrictEqual(options.view.teams, statement.view.teams)
      && isDeepStrictEqual(options.view.me.inventory, statement.view.me.inventory),
    'su vista no coincide con la de su compañero (fase, puntos o inventario)');
    await eventually(() => server.engine.room.questionResults[1], 'la pregunta 1 no cerró');
    const row = server.engine.room.questionResults[1].results.find((r) => r.teamId === seat.teamId);
    assert.equal(row.answered, true, 'la respuesta del compañero contó para el equipo');
  });

  test('en la Traza a ciegas: la cadena pasa a ver y tocar el diagrama, y el del diagrama vuelve a su papel', async () => {
    const { t2 } = await startGame();
    // El equipo 2 juega solo hasta las instrucciones de la Traza; ahí la prueba toma el control.
    for (const bot of t2) {
      bot.on('view', ({ phase }) => {
        if (phase?.kind === 'minigameIntro') bot.autoAct = false;
      });
    }
    await Promise.all(t2.map((bot) => bot.waitFor(({ phase }) => phase?.id === 'r1.mg', 20_000)));
    const diagram = t2.find((bot) => bot.view.phase.data.game.role === 'diagram');
    const string = t2.find((bot) => bot !== diagram);
    assert.equal(string.view.phase.data.game.role, 'string');
    assert.equal(string.view.phase.data.game.pda, null, 'la cadena no ve el diagrama');
    const seat = seatOf(diagram);

    diagram.close();
    const { phase } = await string.waitFor((view) => view.phase.data.game.role === 'both');
    const { game } = phase.data;
    assert.ok(game.pda && game.word, 'sin el del diagrama, ve el diagrama y la cadena');
    await waitUntil(string, phase.playStartsAt);
    const [first] = acceptingTrace(TRAZA_PDA, game.word, game.mode);
    const tapped = await string.send('mg:input', { type: 'tap', state: TRAZA_PDA.transitions[first.transition].to });
    assert.equal(tapped.correct, true, 'y puede tocar');

    const recoveryMs = await reopen(diagram);
    assert.ok(recoveryMs < RECOVERY_LIMIT_MS, `tardó ${recoveryMs} ms en recibir su vista`);
    assert.deepEqual(seatOf(diagram), seat);
    const back = diagram.view.phase.data.game;
    assert.equal(back.role, 'diagram');
    assert.equal(back.word, null, 'el del diagrama sigue sin ver la cadena');
    assert.deepEqual(back.current, { state: first.next.state, stack: first.next.stack }, 've el paso que dio su compañero');
    await string.waitFor((view) => view.phase.data.game.role === 'string' && view.phase.data.game.pda === null);
  });
});
