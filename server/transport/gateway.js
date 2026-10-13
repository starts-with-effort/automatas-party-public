// Gateway Socket.IO (sección 3.3): autentica cada conexión, valida y limita cada mensaje,
// lo entrega al GameEngine y reenvía a cada dispositivo su vista cuando el estado cambia.
import { log } from '../core/log.js';
import { projectView } from '../core/ViewProjector.js';
import { tokenMatches } from './auth.js';
import { createRateLimiter } from './rateLimit.js';
import { HOST_ACTIONS, INBOUND } from './schemas.js';

const ROLES = new Set(['play', 'screen', 'host']);
const FLASH_LEAD_MS = 1500;

export function attachGateway(io, { engine, hostToken }) {
  const connections = new Map(); // socket.id → conexión
  const socketOfDevice = new Map(); // deviceId → socket.id
  // Mensajes recibidos, vistas enviadas, errores y fotogramas difundidos (métricas).
  const counts = { in: 0, out: 0, errors: 0, frames: 0 };
  let flushQueued = false;
  let flashSeq = 0;

  const hostActions = {
    createRoom: (data) => engine.createRoom(data),
    setLobby: ({ open }) => engine.setLobbyOpen(open),
    start: (data) => engine.start(data),
    next: () => engine.next(),
    skip: () => engine.skip(),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    move: ({ deviceId, teamId }) => engine.move(deviceId, teamId),
    adjust: ({ teamId, points, reason }) => engine.adjustScore(teamId, points, reason),
    setBosses: ({ teamIds }) => engine.setBosses(teamIds),
    renameTeam: ({ teamId, name }) => engine.renameTeam(teamId, name),
    removeTeam: ({ teamId }) => engine.removeTeam(teamId),
    kick: ({ deviceId }) => {
      const result = engine.kick(deviceId);
      if (result.ok) endSession(socketOfDevice.get(deviceId), 'kicked');
      return result;
    },
    // Prueba de sincronización de la Fase 0: todas las pantallas destellan en startsAt.
    flash: () => {
      const startsAt = Date.now() + FLASH_LEAD_MS;
      flashSeq += 1;
      io.emit('host:flash', { n: flashSeq, startsAt });
      return { ok: true, startsAt };
    },
    announce: ({ text }) => {
      io.emit('host:announce', { text });
      return { ok: true };
    },
  };

  io.use(authenticate);
  io.on('connection', onConnection);
  engine.on('change', queueFlush);
  // Fotogramas de la Arena: el mismo para todos (no tiene secretos) y volátil: si la conexión de un
  // celular está ocupada, ese fotograma se descarta en vez de acumularse; el siguiente lo reemplaza.
  engine.on('frame', (frame) => {
    counts.frames += 1;
    io.volatile.emit('mg:frame', frame);
  });

  function authenticate(socket, next) {
    const { role, token } = socket.handshake.auth ?? {};
    if (!ROLES.has(role)) return next(new Error('invalid_role'));
    if (role === 'host' && !tokenMatches(token, hostToken)) {
      log('warn', 'token de host rechazado', { ip: socket.handshake.address });
      return next(new Error('unauthorized'));
    }
    socket.data.role = role;
    if (role === 'play') {
      // Sesión del dispositivo (RF-ACC-09): con un token válido recupera su identidad;
      // sin token o con uno desconocido se crea un dispositivo nuevo.
      const known = engine.authenticate(token);
      if (known) {
        socket.data.deviceId = known;
      } else {
        const created = engine.registerDevice();
        socket.data.deviceId = created.deviceId;
        socket.data.newToken = created.token;
      }
    }
    next();
  }

  function onConnection(socket) {
    const { role, deviceId = null, newToken = null } = socket.data;
    const conn = {
      socket,
      role,
      deviceId,
      rtt: null,
      platform: platformOf(socket.handshake.headers['user-agent']),
      lastJson: null,
    };
    connections.set(socket.id, conn);

    if (deviceId) {
      // Si el mismo dispositivo abre otra pestaña, la nueva reemplaza a la anterior.
      endSession(socketOfDevice.get(deviceId), 'replaced');
      socketOfDevice.set(deviceId, socket.id);
      socket.emit('session:welcome', { deviceId, token: newToken });
      engine.setPresence(deviceId, { connected: true, platform: conn.platform, lastSeen: Date.now() });
    }
    log('info', 'conexión', { role, deviceId, platform: conn.platform });

    handle(conn, 'time:ping', ({ t0 }) => ({ t0, tServer: Date.now() }));
    handle(conn, 'time:report', ({ rtt, offset }) => {
      conn.rtt = Math.round(rtt);
      if (deviceId) engine.setPresence(deviceId, { rtt: conn.rtt, offset: Math.round(offset) });
      else queueFlush(); // latencia del proyector y del host para el panel
    });
    handle(conn, 'lobby:join', ({ teamId }) => engine.join(deviceId, teamId));
    handle(conn, 'lobby:leave', () => engine.leave(deviceId));
    handle(conn, 'lobby:register', (team) => engine.registerTeam(deviceId, team));
    handle(conn, 'taller:act', (action) => engine.workshopAction(deviceId, action));
    handle(conn, 'question:answer', (answer) => engine.action(deviceId, { type: 'answer', ...answer }));
    handle(conn, 'item:pick', (pick) => engine.action(deviceId, { type: 'pick', ...pick }));
    handle(conn, 'item:declare', (declaration) => engine.action(deviceId, { type: 'declare', ...declaration }));
    handle(conn, 'item:undeclare', ({ itemId }) => engine.action(deviceId, { type: 'undeclare', itemId }));
    handle(conn, 'item:confirm', () => engine.action(deviceId, { type: 'confirm' }));
    handle(conn, 'duel:pick', ({ option }) => engine.action(deviceId, { type: 'duel', option }));
    handle(conn, 'mg:input', (input) => engine.action(deviceId, { type: 'input', input }));
    handle(conn, 'host:command', ({ action, data }) => {
      const schema = HOST_ACTIONS[action];
      if (!schema) return { ok: false, error: 'unknown_action' };
      const parsed = schema.safeParse(data ?? {});
      if (!parsed.success) return { ok: false, error: 'invalid_payload' };
      return hostActions[action](parsed.data);
    });

    socket.on('disconnect', (reason) => {
      connections.delete(socket.id);
      if (deviceId && socketOfDevice.get(deviceId) === socket.id) {
        socketOfDevice.delete(deviceId);
        if (engine.state.devices[deviceId]) {
          engine.setPresence(deviceId, { connected: false, lastSeen: Date.now() });
        }
      } else {
        queueFlush();
      }
      log('info', 'desconexión', { role, deviceId, reason });
    });

    sendView(conn);
  }

  // Registra un manejador con control de rol, límite de frecuencia y validación de esquema.
  // La respuesta llega por acknowledgement: { ok: true, ... } o { ok: false, error }.
  function handle(conn, event, handler) {
    const rule = INBOUND[event];
    const allow = createRateLimiter(rule.perSecond, 1000);
    conn.socket.on(event, (payload, ack) => {
      counts.in += 1;
      if (typeof payload === 'function') [payload, ack] = [undefined, payload];
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!rule.roles.includes(conn.role)) return reply({ ok: false, error: 'forbidden' });
      if (!allow()) return reply({ ok: false, error: 'rate_limited' });
      const parsed = rule.schema.safeParse(payload ?? {});
      if (!parsed.success) return reply({ ok: false, error: 'invalid_payload' });
      try {
        reply(handler(parsed.data) ?? { ok: true });
      } catch (err) {
        counts.errors += 1;
        log('error', 'error al procesar un mensaje', { event, error: err.stack });
        reply({ ok: false, error: 'server_error' });
      }
    });
  }

  function endSession(socketId, reason) {
    const conn = socketId && connections.get(socketId);
    if (!conn) return;
    conn.socket.emit('session:ended', { reason });
    conn.socket.disconnect(true);
  }

  // Varios cambios seguidos se agrupan en un solo envío.
  function queueFlush() {
    if (flushQueued) return;
    flushQueued = true;
    setImmediate(() => {
      flushQueued = false;
      const serverTime = Date.now();
      for (const conn of connections.values()) sendView(conn, serverTime);
    });
  }

  // Solo se envía la vista si cambió para ese dispositivo. serverTime es la hora en que el servidor
  // empezó a enviar este cambio (sección 3.10): con ella, la prueba de carga mide la latencia de
  // entrega. No cuenta para decidir si la vista cambió.
  function sendView(conn, serverTime = Date.now()) {
    const consoles = conn.role === 'host' ? consoleList() : [];
    const view = projectView(engine, { role: conn.role, deviceId: conn.deviceId }, { consoles });
    const json = JSON.stringify(view);
    if (json === conn.lastJson) return;
    conn.lastJson = json;
    counts.out += 1;
    conn.socket.emit('state:sync', { ...view, serverTime });
  }

  function consoleList() {
    return [...connections.values()]
      .filter((conn) => conn.role !== 'play')
      .map((conn) => ({ id: conn.socket.id.slice(0, 6), role: conn.role, rtt: conn.rtt, platform: conn.platform }));
  }

  return {
    connectedCount: () => connections.size,
    counters: () => ({ ...counts, connections: connections.size }),
  };
}

function platformOf(userAgent = '') {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Otro';
}
