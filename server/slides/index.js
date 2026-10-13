// Presentación (docs/PRESENTACION.md): rutas protegidas, ingreso con SLIDES_TOKEN y el canal
// /slides de Socket.IO. Va aparte del juego: otro token, otra carpeta y otro namespace, así los
// mensajes del quiz no llegan a la presentación ni al revés.
//
//   /slides/  → presentacion/display/   proyector
//   /remote/  → presentacion/remote/    control en el celular
//   /deck/    → presentacion/deck/      motor, diapositivas y manifiesto
// Las tres piden la cookie de sesión. Sin ella, las páginas responden 401 con la de ingreso y el
// resto 401 en JSON: el contenido no se puede descargar sin el token.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SLIDES, normalizeLive, stepCount } from '../../presentacion/deck/deck.js';
import { log } from '../core/log.js';
import { tokenMatches } from '../transport/auth.js';
import { createRateLimiter } from '../transport/rateLimit.js';
import { COOKIE_NAME, createSessions, readCookie } from './session.js';
import { SlidesState } from './SlidesState.js';
import { SlidesStore } from './store.js';

const dir = (path) => fileURLToPath(new URL(path, import.meta.url));
const MOUNTS = {
  '/slides': dir('../../presentacion/display/'),
  '/remote': dir('../../presentacion/remote/'),
  '/deck': dir('../../presentacion/deck/'),
};
const LOGIN_PAGE = dir('../../presentacion/login.html');
// GSAP (licencia gratuita de GSAP 3): público, como cualquier biblioteca. Sin CDN.
const GSAP_DIR = dirname(fileURLToPath(import.meta.resolve('gsap')));
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const ROLES = new Set(['display', 'remote']);
const DECK = { slides: SLIDES, stepCount, normalizeLive };

export function attachSlides({ app, io, token, dataDir = null, deck = DECK, now = Date.now }) {
  const sessions = createSessions(token, { now });
  const store = dataDir ? new SlidesStore(dataDir) : null;
  const state = new SlidesState({ deck, store, now });
  const failures = createFailureCounter({ max: LOGIN_MAX_FAILURES, windowMs: LOGIN_WINDOW_MS, now });

  app.post('/api/slides/login', express.json({ limit: '2kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (failures.blocked(req.ip)) return res.status(429).json({ ok: false, error: 'too_many_attempts' });
    if (!tokenMatches(req.body?.token, token)) {
      failures.add(req.ip);
      log('warn', 'token de la presentación rechazado', { ip: req.ip });
      return res.status(401).json({ ok: false, error: 'bad_token' });
    }
    const session = sessions.issue();
    res.cookie(COOKIE_NAME, session.value, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      maxAge: sessions.ttlMs,
    });
    res.json({ ok: true, expiresAt: session.expiresAt });
  });

  app.post('/api/slides/logout', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.use(Object.keys(MOUNTS), (req, res, next) => {
    res.set('X-Robots-Tag', 'noindex');
    if (sessions.verify(readCookie(req.get('cookie')))) return next();
    res.set('Cache-Control', 'no-store');
    const isPage = req.baseUrl !== '/deck'
      && (req.method === 'GET' || req.method === 'HEAD')
      && (req.path === '/' || req.path.endsWith('.html'));
    if (isPage) return res.status(401).sendFile(LOGIN_PAGE, { cacheControl: false });
    res.status(401).json({ ok: false, error: 'unauthorized' });
  });
  app.use('/vendor/gsap', express.static(GSAP_DIR, { index: false }));
  for (const [mount, path] of Object.entries(MOUNTS)) {
    // private, no-cache: el navegador revalida (ETag) y ningún proxy guarda el contenido.
    app.use(mount, express.static(path, { cacheControl: false, setHeaders: (res) => res.set('Cache-Control', 'private, no-cache') }));
  }

  const nsp = io.of('/slides');
  nsp.use((socket, next) => {
    const { role } = socket.handshake.auth ?? {};
    if (!ROLES.has(role)) return next(new Error('invalid_role'));
    if (!sameOrigin(socket.handshake.headers)) {
      log('warn', 'conexión a la presentación desde otro origen', { origin: socket.handshake.headers.origin });
      return next(new Error('bad_origin'));
    }
    const expiresAt = sessions.verify(readCookie(socket.handshake.headers.cookie));
    if (!expiresAt) return next(new Error('unauthorized'));
    socket.data.role = role;
    socket.data.expiresAt = expiresAt;
    next();
  });

  nsp.on('connection', (socket) => {
    const allow = createRateLimiter(20, 1000);
    const handle = (event, action) => {
      socket.on(event, (msg, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (socket.data.expiresAt <= now()) {
          reply({ ok: false, error: 'expired' });
          socket.disconnect(true);
          return;
        }
        if (!allow()) return reply({ ok: false, error: 'rate_limited' });
        if (!msg || typeof msg !== 'object') return reply({ ok: false, error: 'invalid' });
        reply(action(msg));
      });
    };
    handle('nav', (msg) => state.nav(msg));
    handle('blackout', (msg) => state.setBlackout(msg.on));
    handle('timer', (msg) => state.timer(msg.action));
    handle('live', (msg) => state.setLive(msg));
    socket.emit('slides:state', state.view());
  });

  state.on('change', () => nsp.emit('slides:state', state.view()));

  return {
    state,
    async close() {
      await store?.close();
    },
  };
}

// Un navegador siempre manda Origin al abrir un WebSocket: si no es este mismo sitio, se rechaza
// (otra página no puede manejar la presentación con la cookie de quien la visita). Sin Origin
// (clientes que no son navegadores) decide solo la cookie.
function sameOrigin(headers) {
  if (!headers.origin) return true;
  try {
    return new URL(headers.origin).host === (headers['x-forwarded-host'] ?? headers.host);
  } catch {
    return false;
  }
}

// Intentos fallidos de ingreso por IP en una ventana fija.
function createFailureCounter({ max, windowMs, now }) {
  const byIp = new Map();
  const current = (ip) => {
    const entry = byIp.get(ip);
    if (entry && now() - entry.start < windowMs) return entry;
    byIp.delete(ip);
    return null;
  };
  return {
    blocked: (ip) => (current(ip)?.count ?? 0) >= max,
    add(ip) {
      const entry = current(ip) ?? { start: now(), count: 0 };
      entry.count += 1;
      byIp.set(ip, entry);
      if (byIp.size > 5000) for (const key of byIp.keys()) current(key);
    },
  };
}
