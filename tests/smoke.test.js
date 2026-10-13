import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { silentLogger, testConfig } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';
const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';

let server;
let baseUrl;
const openSockets = [];

before(async () => {
  server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => {
  for (const socket of openSockets) socket.disconnect();
  await server.close();
});

function connect(auth) {
  const socket = connectClient(baseUrl, { auth, transports: ['websocket'], forceNew: true, reconnection: false });
  openSockets.push(socket);
  return socket;
}

function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

test('GET /health responde ok', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, 'automatas-party');
});

test('se sirven las páginas de jugador, proyector y host', async () => {
  for (const path of ['/play/', '/screen/', '/host/']) {
    const res = await fetch(`${baseUrl}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/, path);
  }
});

test('la raíz redirige a /play/', async () => {
  const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/play/');
});

test('el QR apunta a /play/', async () => {
  const info = await fetch(`${baseUrl}/api/info`).then((res) => res.json());
  assert.equal(info.joinUrl, `${baseUrl}/play/`);
  const res = await fetch(`${baseUrl}/api/join-qr.svg`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/);
});

test('time:ping devuelve la hora del servidor', async () => {
  const socket = connect({ role: 'screen' });
  await connected(socket);
  const t0 = Date.now();
  const res = await socket.timeout(2000).emitWithAck('time:ping', { t0 });
  assert.equal(res.t0, t0);
  assert.ok(Math.abs(res.tServer - Date.now()) < 1000);
});

test('un jugador nuevo recibe un token de sesión y su vista', async () => {
  const socket = connect({ role: 'play' });
  const welcome = new Promise((resolve) => socket.once('session:welcome', resolve));
  const view = new Promise((resolve) => socket.once('state:sync', resolve));
  await connected(socket);
  const { deviceId, token } = await welcome;
  assert.match(token, /^[0-9a-f]{32}$/);
  assert.equal((await view).me.deviceId, deviceId);
});

test('se rechaza un rol desconocido', async () => {
  const socket = connect({ role: 'intruso' });
  await assert.rejects(connected(socket), /invalid_role/);
});

test('el host con token incorrecto es rechazado', async () => {
  const socket = connect({ role: 'host', token: 'incorrecto' });
  await assert.rejects(connected(socket), /unauthorized/);
});

test('el destello del host llega a las pantallas con un startsAt futuro', async () => {
  const host = connect({ role: 'host', token: HOST_TOKEN });
  const screen = connect({ role: 'screen' });
  await Promise.all([connected(host), connected(screen)]);
  const flashed = new Promise((resolve) => screen.once('host:flash', resolve));
  const res = await host.timeout(2000).emitWithAck('host:command', { action: 'flash', data: {} });
  assert.equal(res.ok, true);
  const { startsAt } = await flashed;
  assert.equal(startsAt, res.startsAt);
  assert.ok(startsAt > Date.now(), 'startsAt debe estar en el futuro');
});

test('el WebSocket se comprime (permessage-deflate)', async () => {
  const socket = connect({ role: 'screen' });
  await new Promise((resolve) => socket.on('connect', resolve));
  assert.match(socket.io.engine.transport.ws.extensions, /permessage-deflate/);
});

test('cada vista trae la hora del servidor en que se envió (serverTime)', async () => {
  const socket = connect({ role: 'screen' });
  const before = Date.now();
  const view = await new Promise((resolve) => socket.once('state:sync', resolve));
  assert.ok(view.serverTime >= before && view.serverTime <= Date.now(), 'serverTime es la hora de envío');
});

test('GET /api/metrics pide el token del host y da CPU, memoria y mensajes', async () => {
  assert.equal((await fetch(`${baseUrl}/api/metrics`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/metrics/reset`, { method: 'POST' })).status, 401);
  const auth = { headers: { Authorization: `Bearer ${HOST_TOKEN}` } };

  const socket = connect({ role: 'screen' });
  await connected(socket);
  await socket.timeout(2000).emitWithAck('time:ping', { t0: Date.now() });
  server.metrics.sample(); // sin esperar al muestreo de cada segundo
  const metrics = await (await fetch(`${baseUrl}/api/metrics`, auth)).json();
  assert.equal(metrics.ok, true);
  assert.ok(metrics.memory.rssMb > 0 && metrics.cores >= 1);
  assert.ok(metrics.last.cpuPercent >= 0);
  assert.ok(metrics.window.messagesIn >= 1, 'cuenta los mensajes recibidos');
  assert.ok(metrics.window.viewsOut >= 1, 'cuenta las vistas enviadas');
  assert.equal(metrics.window.errors, 0);

  const reset = await (await fetch(`${baseUrl}/api/metrics/reset`, { method: 'POST', ...auth })).json();
  assert.equal(reset.window.messagesIn, 0, 'el reinicio empieza a contar de cero');
  assert.equal(reset.window.samples, 0);
});
