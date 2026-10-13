// Sala con registro (docs/TALLER.md): cada grupo crea su equipo desde un celular, con su nombre y
// sus integrantes; el segundo celular se une después.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { GameEngine } from '../server/core/GameEngine.js';
import { projectView } from '../server/core/ViewProjector.js';
import { cleanMembers, cleanTeamName, sameName } from '../server/domain/registration.js';
import { createFakeClock, silentLogger, testConfig } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';

function setup({ teamCount = 4 } = {}) {
  const engine = new GameEngine({ config: testConfig(), clock: createFakeClock(), logger: silentLogger });
  assert.equal(engine.createRoom({ teamCount, workshop: true }).ok, true);
  const device = () => engine.registerDevice().deviceId;
  return { engine, device };
}

const LOS_PILAS = { name: 'Los Pilas', members: ['Ana Gómez', 'Luis Pérez'] };

describe('nombres del registro', () => {
  test('el nombre del equipo se limpia y tiene tope de largo', () => {
    assert.equal(cleanTeamName('  Los   Pilas \n'), 'Los Pilas');
    assert.equal(cleanTeamName('   '), null);
    assert.equal(cleanTeamName('x'.repeat(25)), null);
    assert.equal(cleanTeamName(42), null);
  });

  test('los integrantes: sin renglones vacíos y dentro de los límites', () => {
    const limits = { min: 2, max: 3 };
    assert.deepEqual(cleanMembers([' Ana ', '', 'Luis  Pérez'], limits), ['Ana', 'Luis Pérez']);
    assert.equal(cleanMembers(['Ana'], limits), null, 'faltan integrantes');
    assert.equal(cleanMembers(['a', 'b', 'c', 'd'], limits), null, 'sobran integrantes');
    assert.equal(cleanMembers(['Ana', 'x'.repeat(41)], limits), null, 'nombre demasiado largo');
    assert.equal(cleanMembers('Ana', limits), null);
  });

  test('dos nombres son el mismo sin importar mayúsculas ni tildes', () => {
    assert.equal(sameName('Autómatas', 'automatas'), true);
    assert.equal(sameName('Los Pilas', 'Las Pilas'), false);
  });
});

describe('registro de equipos', () => {
  test('la sala con registro empieza sin equipos y dice cuántos caben', () => {
    const { engine } = setup({ teamCount: 5 });
    assert.deepEqual(engine.room.teams, []);
    const view = projectView(engine, { role: 'screen' });
    assert.deepEqual(view.room.workshop, { maxTeams: 5, members: { min: 2, max: 6 } });
    assert.equal(engine.events.find((e) => e.type === 'room_created').workshop, true);
  });

  test('un celular registra su equipo y queda en el puesto A', () => {
    const { engine, device } = setup();
    const a = device();
    assert.deepEqual(engine.registerTeam(a, { name: '  Los   Pilas ', members: ['Ana Gómez', ' ', 'Luis Pérez'] }), { ok: true, teamId: 't1', slot: 'A' });
    const [team] = engine.room.teams;
    assert.deepEqual([team.id, team.name, team.members, team.slots.A, team.color], ['t1', 'Los Pilas', ['Ana Gómez', 'Luis Pérez'], a, testConfig().teams.colors[0]]);
    assert.equal(team.score, 0);
    const event = engine.events.find((e) => e.type === 'team_registered');
    assert.deepEqual([event.teamId, event.name, event.members], ['t1', 'Los Pilas', ['Ana Gómez', 'Luis Pérez']]);
    const view = projectView(engine, { role: 'play', deviceId: a });
    assert.equal(view.me.teamId, 't1');
    assert.deepEqual(view.teams[0].members, ['Ana Gómez', 'Luis Pérez']);
  });

  test('rechaza nombres vacíos, repetidos e integrantes de más o de menos', () => {
    const { engine, device } = setup();
    assert.equal(engine.registerTeam(device(), LOS_PILAS).ok, true);
    assert.equal(engine.registerTeam(device(), { name: 'los pilas', members: ['a', 'b'] }).error, 'name_taken');
    assert.equal(engine.registerTeam(device(), { name: ' ', members: ['a', 'b'] }).error, 'invalid_name');
    assert.equal(engine.registerTeam(device(), { name: 'Otro', members: ['solo'] }).error, 'invalid_members');
    assert.equal(engine.registerTeam(device(), { name: 'Otro', members: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).error, 'invalid_members');
    assert.equal(engine.registerTeam('d-inexistente', { name: 'Otro', members: ['a', 'b'] }).error, 'unknown_device');
    assert.equal(engine.room.teams.length, 1);
  });

  test('no caben más equipos que los de la sala, ni se registra con el ingreso cerrado', () => {
    const { engine, device } = setup({ teamCount: 2 });
    assert.equal(engine.registerTeam(device(), { name: 'Uno', members: ['a', 'b'] }).ok, true);
    assert.equal(engine.registerTeam(device(), { name: 'Dos', members: ['a', 'b'] }).ok, true);
    assert.equal(engine.registerTeam(device(), { name: 'Tres', members: ['a', 'b'] }).error, 'teams_full');
    const closed = setup();
    closed.engine.setLobbyOpen(false);
    assert.equal(closed.engine.registerTeam(closed.device(), LOS_PILAS).error, 'lobby_closed');
  });

  test('el segundo celular se une al equipo registrado; el tercero no cabe', () => {
    const { engine, device } = setup();
    engine.registerTeam(device(), LOS_PILAS);
    assert.deepEqual(engine.join(device(), 't1'), { ok: true, slot: 'B' });
    assert.equal(engine.join(device(), 't1').error, 'team_full');
    assert.equal(engine.join(device(), 't2').error, 'unknown_team', 'no hay equipos sin registrar');
  });

  test('cualquiera de los dos celulares corrige el nombre y los integrantes de su equipo', () => {
    const { engine, device } = setup();
    const [a, b] = [device(), device()];
    engine.registerTeam(a, LOS_PILAS);
    engine.join(b, 't1');
    assert.deepEqual(engine.registerTeam(b, { name: 'Las Pilas', members: ['Ana', 'Luis', 'Sara'] }), { ok: true, teamId: 't1', slot: 'B' });
    assert.deepEqual([engine.room.teams[0].name, engine.room.teams[0].members], ['Las Pilas', ['Ana', 'Luis', 'Sara']]);
    assert.equal(engine.room.teams.length, 1, 'no crea otro equipo');
    assert.equal(engine.registerTeam(a, { name: 'las pilas', members: ['Ana', 'Luis'] }).ok, true, 'su propio nombre no choca');
    engine.setLobbyOpen(false);
    assert.equal(engine.registerTeam(a, LOS_PILAS).ok, true, 'corregir no depende del ingreso');
    assert.equal(engine.events.filter((e) => e.type === 'team_updated').length, 3);
  });

  test('si sale el último celular el equipo se deshace y su puesto queda libre', () => {
    const { engine, device } = setup();
    const [a, b, c] = [device(), device(), device()];
    engine.registerTeam(a, LOS_PILAS);
    engine.registerTeam(c, { name: 'Otro', members: ['x', 'y'] });
    engine.join(b, 't1');
    assert.equal(engine.leave(a).ok, true);
    assert.equal(engine.room.teams.length, 2, 'queda el segundo celular: el equipo sigue');
    assert.equal(engine.leave(b).ok, true);
    assert.deepEqual(engine.room.teams.map((t) => t.id), ['t2']);
    assert.equal(engine.events.find((e) => e.type === 'team_removed').reason, 'empty');
    // El puesto t1 (y su color) vuelve a usarse; el orden es el del registro.
    assert.equal(engine.registerTeam(a, { name: 'Nuevo', members: ['x', 'y'] }).teamId, 't1');
    assert.deepEqual(engine.room.teams.map((t) => [t.id, t.order]), [['t2', 1], ['t1', 2]]);
  });

  test('el host renombra un equipo y quita uno antes de empezar', () => {
    const { engine, device } = setup();
    const a = device();
    engine.registerTeam(a, LOS_PILAS);
    engine.registerTeam(device(), { name: 'Otro', members: ['x', 'y'] });
    assert.equal(engine.renameTeam('t1', 'otro').error, 'name_taken');
    assert.equal(engine.renameTeam('t1', '  ').error, 'invalid_name');
    assert.equal(engine.renameTeam('t9', 'X').error, 'unknown_team');
    assert.equal(engine.renameTeam('t1', 'Equipo Uno').ok, true);
    assert.equal(engine.room.teams[0].name, 'Equipo Uno');
    assert.equal(engine.removeTeam('t1').ok, true);
    assert.equal(engine.teamOf(a), null, 'su celular queda sin equipo');
    assert.deepEqual(engine.room.teams.map((t) => t.id), ['t2']);
    assert.equal(engine.removeTeam('t1').error, 'unknown_team');
  });

  test('la partida empieza con los equipos registrados; después ya no se registra', () => {
    const { engine, device } = setup();
    const a = device();
    assert.equal(engine.start().error, 'no_players');
    engine.registerTeam(a, LOS_PILAS);
    assert.equal(engine.start().error, 'teams_incomplete');
    engine.join(device(), 't1');
    assert.equal(engine.start().ok, true);
    assert.equal(engine.room.phase.kind, 'question');
    assert.equal(engine.registerTeam(a, LOS_PILAS).error, 'game_started');
    assert.equal(engine.removeTeam('t1').error, 'game_started');
    assert.equal(engine.renameTeam('t1', 'Con otro nombre').ok, true, 'renombrar sí se puede en cualquier momento');
    const row = projectView(engine, { role: 'screen' }).teams[0];
    assert.deepEqual([row.name, row.members], ['Con otro nombre', ['Ana Gómez', 'Luis Pérez']]);
  });

  test('la sala de equipos fijos no admite registro y sus equipos no tienen integrantes', () => {
    const engine = new GameEngine({ config: testConfig(), clock: createFakeClock(), logger: silentLogger });
    engine.createRoom({ teamCount: 2 });
    const { deviceId } = engine.registerDevice();
    assert.equal(engine.registerTeam(deviceId, LOS_PILAS).error, 'no_registration');
    assert.equal(engine.removeTeam('t1').error, 'no_registration');
    assert.equal(projectView(engine, { role: 'screen' }).room.workshop, null);
    assert.deepEqual(engine.room.teams.map((t) => t.members), [[], []]);
    engine.join(deviceId, 't1');
    engine.leave(deviceId);
    assert.equal(engine.room.teams.length, 2, 'un equipo fijo vacío no se borra');
    assert.equal(engine.createRoom({ teamCount: 2, workshop: true, practice: 'clicker' }).error, 'invalid_room_type');
  });
});

describe('registro por la red', () => {
  const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';
  let server;
  let baseUrl;
  const sockets = [];

  before(async () => {
    server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger });
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  });

  after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  function open(auth) {
    const socket = connectClient(baseUrl, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }
  const ask = (socket, event, payload = {}) => socket.timeout(2000).emitWithAck(event, payload);
  const nextView = (socket, predicate) => new Promise((resolve) => {
    const onView = (view) => {
      if (!predicate(view)) return;
      socket.off('state:sync', onView);
      resolve(view);
    };
    socket.on('state:sync', onView);
  });

  test('el host crea la sala, un celular registra su equipo y el otro se une', async () => {
    const host = await open({ role: 'host', token: HOST_TOKEN });
    const created = await ask(host, 'host:command', { action: 'createRoom', data: { teamCount: 3, workshop: true } });
    assert.equal(created.ok, true);
    const [first, second, screen] = await Promise.all([open({ role: 'play' }), open({ role: 'play' }), open({ role: 'screen' })]);
    const seen = nextView(screen, (view) => view.teams.length === 1 && view.teams[0].slots.B !== null);
    assert.deepEqual(await ask(first, 'lobby:register', LOS_PILAS), { ok: true, teamId: 't1', slot: 'A' });
    assert.equal((await ask(second, 'lobby:register', { name: 'Los Pilas', members: ['x', 'y'] })).error, 'name_taken');
    assert.deepEqual(await ask(second, 'lobby:join', { teamId: 't1' }), { ok: true, slot: 'B' });
    const view = await seen;
    assert.deepEqual([view.teams[0].name, view.teams[0].members], ['Los Pilas', ['Ana Gómez', 'Luis Pérez']]);
    assert.equal((await ask(first, 'lobby:register', { name: 'x'.repeat(81), members: [] })).error, 'invalid_payload');

    assert.equal((await ask(host, 'host:command', { action: 'renameTeam', data: { teamId: 't1', name: 'Pilas' } })).ok, true);
    assert.equal(server.engine.room.teams[0].name, 'Pilas');
    assert.equal((await ask(first, 'host:command', { action: 'removeTeam', data: { teamId: 't1' } })).error, 'forbidden');
  });

  test('el QR de un equipo lleva su id en la dirección', async () => {
    const plain = await (await fetch(`${baseUrl}/api/join-qr.svg`)).text();
    const team = await (await fetch(`${baseUrl}/api/join-qr.svg?team=t1`)).text();
    const bogus = await (await fetch(`${baseUrl}/api/join-qr.svg?team=%3Cscript%3E`)).text();
    assert.match(team, /<svg/);
    assert.notEqual(team, plain, 'codifica otra dirección');
    assert.equal(bogus, plain, 'un equipo inválido se ignora');
  });
});
