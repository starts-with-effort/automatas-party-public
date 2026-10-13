// Presentación (docs/PRESENTACION.md): acceso protegido, canal /slides y posición en el servidor.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createSessions } from '../server/slides/session.js';
import { SlidesState } from '../server/slides/SlidesState.js';
import { SlidesStore } from '../server/slides/store.js';
import { silentLogger, testConfig } from './support/helpers.js';

process.env.LOG_LEVEL = 'silent';
const HOST_TOKEN = 'token-de-prueba-0123456789abcdef';
const SLIDES_TOKEN = 'token-de-diapositivas-0123456789';

// Presentación de prueba: 3 principales (2, 1 y 3 pasos) y 2 de respaldo.
const FAKE_DECK = {
  slides: [
    { id: 'a', steps: ['a0', 'a1'] },
    { id: 'b', steps: ['b0'] },
    { id: 'c', steps: ['c0', 'c1', 'c2'] },
    { id: 'r1', steps: ['r0'], backup: true },
    { id: 'r2', steps: ['r0', 'r1'], backup: true },
  ],
  stepCount: (slide) => slide.steps.length,
  normalizeLive: (raw) => (typeof raw?.input === 'string' ? { pda: 'x', input: raw.input } : null),
};

function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

describe('acceso', () => {
  let server;
  let baseUrl;
  const sockets = [];

  before(async () => {
    server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger, slides: { token: SLIDES_TOKEN } });
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  });

  after(async () => {
    for (const socket of sockets) socket.disconnect();
    await server.close();
  });

  const login = (token, headers = {}) => fetch(`${baseUrl}/api/slides/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ token }),
  });

  async function cookie() {
    const res = await login(SLIDES_TOKEN);
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  }

  function connect(headers, auth = { role: 'remote' }) {
    const socket = connectClient(`${baseUrl}/slides`, {
      auth,
      extraHeaders: headers,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  }

  const firstState = (socket) => new Promise((resolve, reject) => {
    socket.once('slides:state', resolve);
    socket.once('connect_error', reject);
  });

  test('sin sesión, las páginas muestran el ingreso con 401 y el contenido no se descarga', async () => {
    for (const path of ['/slides/', '/remote/', '/slides']) {
      const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
      assert.equal(res.status, 401, path);
      assert.match(res.headers.get('content-type'), /text\/html/, path);
      const html = await res.text();
      assert.match(html, /id="login"/, path);
      assert.equal(res.headers.get('cache-control'), 'no-store', path);
    }
    for (const path of ['/deck/deck.js', '/slides/display.js', '/remote/remote.js', '/deck/position.js']) {
      const res = await fetch(`${baseUrl}${path}`);
      assert.equal(res.status, 401, path);
      assert.deepEqual(await res.json(), { ok: false, error: 'unauthorized' }, path);
    }
  });

  test('GSAP se sirve sin sesión desde node_modules', async () => {
    const res = await fetch(`${baseUrl}/vendor/gsap/index.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.match(await res.text(), /gsap-core.js/);
    assert.equal((await fetch(`${baseUrl}/vendor/gsap/MotionPathPlugin.js`)).status, 200);
  });

  test('token incorrecto: 401 sin cookie', async () => {
    const res = await login('otro-token');
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal((await res.json()).error, 'bad_token');
  });

  test('con el token se entrega una cookie HttpOnly y SameSite=Lax que abre las tres rutas', async () => {
    const res = await login(SLIDES_TOKEN);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, /^ap_slides=v1\.\d+\.[0-9a-f]{64};/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=43200/);
    assert.doesNotMatch(setCookie, /Secure/i, 'en HTTP plano no se marca Secure');
    const headers = { cookie: setCookie.split(';')[0] };
    for (const path of ['/slides/', '/remote/']) {
      const page = await fetch(`${baseUrl}${path}`, { headers });
      assert.equal(page.status, 200, path);
      assert.doesNotMatch(await page.text(), /id="login"/, path);
    }
    const js = await fetch(`${baseUrl}/deck/deck.js`, { headers });
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal(js.headers.get('cache-control'), 'private, no-cache');
    assert.match(await js.text(), /export const SLIDES/);
  });

  test('detrás de HTTPS (Caddy) la cookie lleva Secure', async () => {
    const res = await login(SLIDES_TOKEN, { 'x-forwarded-proto': 'https' });
    assert.match(res.headers.get('set-cookie'), /Secure/);
  });

  test('una cookie alterada o de otro token no sirve', async () => {
    const good = (await cookie()).split('=')[1];
    const tampered = good.replace(/\.(\d+)\./, (_, exp) => `.${Number(exp) + 1000}.`);
    const other = createSessions('otro-token').issue().value;
    for (const value of [tampered, other, 'basura']) {
      const res = await fetch(`${baseUrl}/deck/deck.js`, { headers: { cookie: `ap_slides=${value}` } });
      assert.equal(res.status, 401, value);
    }
  });

  test('la sesión vence a las 12 h', () => {
    const now = fakeClock();
    const sessions = createSessions(SLIDES_TOKEN, { now });
    const { value, expiresAt } = sessions.issue();
    assert.equal(sessions.verify(value), expiresAt);
    now.advance(12 * 60 * 60 * 1000 - 1);
    assert.equal(sessions.verify(value), expiresAt);
    now.advance(1);
    assert.equal(sessions.verify(value), null);
  });

  test('cerrar sesión borra la cookie', async () => {
    const res = await fetch(`${baseUrl}/api/slides/logout`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /^ap_slides=;.*Expires=Thu, 01 Jan 1970/);
  });

  test('el canal /slides exige la cookie, un rol válido y el mismo origen', async () => {
    await assert.rejects(firstState(connect({})), /unauthorized/);
    const headers = { cookie: await cookie() };
    await assert.rejects(firstState(connect(headers, { role: 'host' })), /invalid_role/);
    await assert.rejects(firstState(connect({ ...headers, origin: 'https://otro-sitio.example' })), /bad_origin/);
    const host = new URL(baseUrl).host;
    const state = await firstState(connect({ ...headers, origin: `http://${host}` }, { role: 'display' }));
    assert.equal(state.id, 'portada');
    assert.equal(state.step, 0);
  });

  test('dos toques con el mismo seq avanzan un solo paso', async () => {
    const headers = { cookie: await cookie() };
    const a = connect(headers);
    const b = connect(headers);
    const [state] = await Promise.all([firstState(a), firstState(b)]);
    const start = { id: state.id, step: state.step, index: state.index };
    const results = await Promise.all([
      a.timeout(2000).emitWithAck('nav', { action: 'next', seq: state.seq }),
      b.timeout(2000).emitWithAck('nav', { action: 'next', seq: state.seq }),
    ]);
    assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    assert.equal(results.find((r) => !r.ok).error, 'stale');
    const now = server.slides.state.view();
    assert.equal(now.seq, state.seq + 1);
    assert.ok(now.index === start.index + 1 || now.step === start.step + 1);
    await a.timeout(2000).emitWithAck('nav', { action: 'goto', slide: 0, step: 0 });
  });

  test('mensajes inválidos se responden con error', async () => {
    const socket = connect({ cookie: await cookie() });
    await firstState(socket);
    assert.equal((await socket.timeout(2000).emitWithAck('nav', 'siguiente')).error, 'invalid');
    assert.equal((await socket.timeout(2000).emitWithAck('nav', { action: 'saltar' })).error, 'invalid_action');
    assert.equal((await socket.timeout(2000).emitWithAck('nav', { action: 'goto', slide: 'no-existe' })).error, 'unknown_slide');
    assert.equal((await socket.timeout(2000).emitWithAck('timer', { action: 'romper' })).error, 'invalid_action');
  });

  test('10 intentos fallidos bloquean el ingreso desde esa IP', async () => {
    for (let i = 0; i < 9; i += 1) assert.equal((await login('malo')).status, 401);
    // Más el intento fallido de la prueba de arriba: 10.
    const blocked = await login(SLIDES_TOKEN);
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error, 'too_many_attempts');
  });
});

test('sin la opción slides la presentación no existe', async () => {
  const server = createApp({ hostToken: HOST_TOKEN, config: testConfig(), logger: silentLogger });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  try {
    for (const path of ['/slides/', '/remote/', '/deck/deck.js']) {
      assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${baseUrl}/api/slides/login`, { method: 'POST' })).status, 404);
  } finally {
    await server.close();
  }
});

describe('posición', () => {
  const create = (options = {}) => new SlidesState({ deck: FAKE_DECK, now: fakeClock(), ...options });
  const at = (state) => `${state.state.id}:${state.state.step}`;

  test('siguiente recorre pasos y diapositivas y se detiene al final de las principales', () => {
    const state = create();
    const visited = [at(state)];
    while (state.nav({ action: 'next', seq: state.state.seq }).ok) visited.push(at(state));
    assert.deepEqual(visited, ['a:0', 'a:1', 'b:0', 'c:0', 'c:1', 'c:2']);
    assert.equal(state.nav({ action: 'next', seq: state.state.seq }).error, 'end');
  });

  test('anterior desde el paso 0 va al último paso de la anterior', () => {
    const state = create();
    state.goto('c', 0);
    state.nav({ action: 'prev', seq: state.state.seq });
    assert.equal(at(state), 'b:0');
    state.nav({ action: 'prev', seq: state.state.seq });
    assert.equal(at(state), 'a:1');
    state.goto('a', 0);
    assert.equal(state.nav({ action: 'prev', seq: state.state.seq }).error, 'start');
  });

  test('un seq viejo se descarta sin mover nada', () => {
    const state = create();
    const { seq } = state.state;
    assert.ok(state.nav({ action: 'next', seq }).ok);
    assert.deepEqual(state.nav({ action: 'next', seq }), { ok: false, error: 'stale', seq: seq + 1 });
    assert.equal(at(state), 'a:1');
  });

  test('las de respaldo son un bloque aparte, al que se llega con ir a', () => {
    const state = create();
    state.goto('r1');
    assert.equal(state.nav({ action: 'prev', seq: state.state.seq }).error, 'start');
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(at(state), 'r2:0');
    state.goto(4, 99);
    assert.equal(at(state), 'r2:1', 'el paso se acota');
    assert.equal(state.nav({ action: 'next', seq: state.state.seq }).error, 'end');
  });

  test('el cronómetro arranca con el primer siguiente desde la portada, se pausa y se reinicia', () => {
    const now = fakeClock();
    const state = create({ now });
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(state.state.timer.running, false, 'un paso dentro de la portada no lo arranca');
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(state.state.timer.running, true);
    now.advance(5000);
    state.timer('pause');
    assert.deepEqual(state.state.timer, { running: false, startedAt: null, elapsedMs: 5000 });
    state.goto('a', 1);
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(state.state.timer.running, false, 'ya había corrido: no vuelve a arrancar solo');
    state.timer('start');
    now.advance(1000);
    state.timer('pause');
    assert.equal(state.state.timer.elapsedMs, 6000);
    state.timer('reset');
    assert.equal(state.state.timer.elapsedMs, 0);
  });

  test('slideSince cambia solo al cambiar de diapositiva', () => {
    const now = fakeClock();
    const state = create({ now });
    const since = state.state.slideSince;
    now.advance(1000);
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(state.state.slideSince, since);
    now.advance(1000);
    state.nav({ action: 'next', seq: state.state.seq });
    assert.equal(state.state.slideSince, since + 2000);
  });

  test('la cadena del simulador se valida', () => {
    const state = create();
    assert.equal(state.setLive({ input: 42 }).error, 'invalid_live');
    assert.ok(state.setLive({ input: 'ab' }).ok);
    assert.deepEqual(state.view().live, { pda: 'x', input: 'ab' });
  });

  test('la posición se guarda en disco y se recupera; el log registra cada cambio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'slides-'));
    try {
      const store = new SlidesStore(dir);
      const state = create({ store });
      state.goto('c', 2);
      state.setBlackout(true);
      await store.close();
      const again = create({ store: new SlidesStore(dir) });
      assert.equal(at(again), 'c:2');
      assert.equal(again.state.blackout, true);
      assert.equal(again.state.seq, state.state.seq);
      const events = readFileSync(join(dir, 'slides-log.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      assert.deepEqual(events.map((e) => e.type), ['pos', 'blackout']);
      assert.deepEqual({ id: events[0].id, step: events[0].step }, { id: 'c', step: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('una posición guardada que ya no existe vuelve a la portada; un paso de más se acota', () => {
    const load = (saved) => create({ store: { load: () => saved, save() {}, append() {} } });
    assert.equal(at(load({ id: 'borrada', step: 3, seq: 9 })), 'a:0');
    assert.equal(at(load({ id: 'c', step: 99, seq: 9 })), 'c:2');
  });
});
