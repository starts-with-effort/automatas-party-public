import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { GameEngine } from './core/GameEngine.js';
import { createMetrics } from './core/metrics.js';
import { ITEM_DEFS } from './domain/items/index.js';
import { TABLES, highlights, questionSummary, studentsTable, teamSummary, toCsv, workshopTable } from './domain/stats.js';
import { XLSX_TYPE, toXlsx } from './domain/xlsx.js';
import { attachSlides } from './slides/index.js';
import { tokenMatches } from './transport/auth.js';
import { attachGateway } from './transport/gateway.js';

// Hojas del libro de Excel, en orden: primero lo que se le entrega al profesor.
const WORKBOOK = [
  ['Estudiantes', 'estudiantes'], ['Equipos', 'equipos'], ['Taller', 'taller'], ['Preguntas', 'preguntas'],
  ['Respuestas', 'respuestas'], ['Ranking', 'ranking'], ['Minijuegos', 'minijuegos'], ['Objetos', 'objetos'],
];
// La hoja de las notas es la que se entrega: sus columnas llevan título, no la clave de la tabla.
const STUDENT_HEADERS = {
  estudiante: 'Estudiante', equipo: 'Equipo', preguntas: 'Preguntas', aciertos: 'Aciertos', pct_aciertos: '% de aciertos', nota: 'Nota', taller: 'Taller',
};

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const CLIENT_DIR = fileURLToPath(new URL('../client', import.meta.url));

// Crea Express + Socket.IO + GameEngine sin empezar a escuchar, para poder usarlo en las pruebas.
// slides: { token, dataDir } activa la presentación (docs/PRESENTACION.md); sin él no existe.
export function createApp({ hostToken, config, publicUrl = null, persistence = null, clock, logger, slides = null }) {
  if (!hostToken) throw new Error('hostToken es obligatorio');

  const app = express();
  app.disable('x-powered-by');
  // Caddy corre en la misma máquina: confiar en su X-Forwarded-Proto para construir URLs https.
  app.set('trust proxy', 'loopback');

  const httpServer = createServer(app);
  // Compresión de cada mensaje del WebSocket (permessage-deflate): las vistas y los fotogramas de la
  // Arena son JSON muy repetitivo, y con el contexto compartido entre mensajes ocupan de 6 a 17 veces
  // menos. Menos bytes por la red del salón y menos cola cuando muchos celulares comparten el WiFi.
  // Los mensajes de menos de 256 bytes van sin comprimir.
  const io = new Server(httpServer, { perMessageDeflate: { threshold: 256 } });
  const engine = new GameEngine({ config, persistence, clock, logger });
  const gateway = attachGateway(io, { engine, hostToken });
  const metrics = createMetrics({ counters: gateway.counters });
  const info = buildInfo();

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      ...info,
      uptimeSec: Math.round(process.uptime()),
      connections: gateway.connectedCount(),
      phase: engine.room?.phase?.id ?? null,
      serverTime: Date.now(),
    });
  });

  app.get('/api/info', (req, res) => {
    res.json({ ...info, joinUrl: joinUrl(req) });
  });

  // Catálogo público de objetos (nombre, texto, ícono y reglas) para las tres interfaces.
  app.get('/api/items', (req, res) => {
    res.json({
      items: config.itemCatalog.map(({ code, name, text, icon, image, enabled }) => {
        const { type, target, timing } = ITEM_DEFS[code];
        return { code, name, text, icon, image: image ?? null, enabled, type, target, timing };
      }),
    });
  });

  // ?team=t3: el QR que muestra el primer celular de un equipo para que el segundo entre directo a
  // ese equipo (sala con registro): la página lee «#equipo=t3» y se une.
  app.get('/api/join-qr.svg', async (req, res) => {
    const team = /^t[1-9]$/.test(req.query.team ?? '') ? `#equipo=${req.query.team}` : '';
    const svg = await QRCode.toString(`${joinUrl(req)}${team}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });

  // Exportación de estadísticas (RF-EST-02…04), solo para el host.
  //   ?format=json                       log completo + resúmenes
  //   ?format=csv&table=<tabla>[&sep=,]  respuestas, objetos, minijuegos, ranking, equipos, preguntas, taller, estudiantes
  //   ?format=xlsx                       un libro de Excel con todas las tablas; la primera hoja, las notas
  app.get('/api/export', (req, res) => {
    if (!isHost(req, res)) return;
    const { room } = engine;
    if (!room) return res.status(404).json({ ok: false, error: 'no_room' });
    const data = {
      events: engine.events,
      teams: room.teams,
      itemName: (code) => config.itemCatalog.find((item) => item.code === code)?.name ?? code,
      minigameName: (id) => config.minigames.find((m) => m.id === id)?.name ?? id,
      difficultyName: (id) => config.questions.difficulties[id]?.label ?? id,
      grading: config.grading,
    };
    const file = (suffix) => `automatas-party-${room.id}-${suffix}`;
    if (req.query.format === 'xlsx') {
      const decimals = { nota: config.grading.decimals };
      const sheets = WORKBOOK.map(([name, table]) => ({
        name, rows: TABLES[table](data), decimals, headers: table === 'estudiantes' ? STUDENT_HEADERS : {},
      }));
      res.type(XLSX_TYPE).attachment(file('estadisticas.xlsx'));
      return res.send(toXlsx(sheets));
    }
    if (req.query.format === 'csv') {
      const build = TABLES[req.query.table];
      if (!build) return res.status(400).json({ ok: false, error: 'unknown_table', tables: Object.keys(TABLES) });
      res.type('text/csv; charset=utf-8').attachment(file(`${req.query.table}.csv`));
      return res.send(toCsv(build(data), { sep: req.query.sep === ',' ? ',' : ';' }));
    }
    res.attachment(file('completo.json')).json({
      exportedAt: new Date().toISOString(),
      room: {
        id: room.id,
        createdAt: room.createdAt,
        seed: room.seed,
        finished: room.finished,
        teams: room.teams.map(({ id, name, color, members = [], score, streak, maxStreak }) => ({ id, name, color, members, score, streak, maxStreak })),
      },
      summary: {
        teams: teamSummary(data),
        questions: questionSummary(data),
        highlights: highlights(data),
        workshop: workshopTable(data),
        students: studentsTable(data),
      },
      events: engine.events,
    });
  });

  // Métricas del proceso (RNF-01, RNF-15), solo para el host: CPU, memoria, event loop y mensajes por
  // segundo, con picos y promedios desde el último reinicio de las métricas. La usa `npm run load`.
  app.get('/api/metrics', (req, res) => {
    if (!isHost(req, res)) return;
    res.json({ ok: true, version: info.version, commit: info.commit, ...metrics.snapshot() });
  });

  app.post('/api/metrics/reset', (req, res) => {
    if (!isHost(req, res)) return;
    metrics.reset();
    res.json({ ok: true, ...metrics.snapshot() });
  });

  const presentation = slides?.token
    ? attachSlides({ app, io, token: slides.token, dataDir: slides.dataDir ?? null })
    : null;

  // La raíz lleva directo a la vista del jugador; proyector, host y presentación no se enlazan desde
  // ninguna página: solo se llega a ellos escribiendo su URL.
  app.get('/', (req, res) => res.redirect('/play/'));

  app.use(express.static(CLIENT_DIR));

  // Rutas solo para el host: el token va en la cabecera Authorization (no en la URL, que quedaría en
  // los logs del proxy). Si no coincide, responde 401 y devuelve false.
  function isHost(req, res) {
    res.set('Cache-Control', 'no-store');
    const given = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (tokenMatches(given, hostToken)) return true;
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }

  function joinUrl(req) {
    const origin = publicUrl ?? `${req.protocol}://${req.get('host')}`;
    return `${origin}/play/`;
  }

  async function close() {
    metrics.stop();
    engine.stop();
    await new Promise((resolve) => io.close(() => resolve()));
    await persistence?.close();
    await presentation?.close();
  }

  return { app, httpServer, io, engine, metrics, slides: presentation, close };
}

function buildInfo() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return {
    name: pkg.name,
    version: pkg.version,
    commit: process.env.GIT_COMMIT || gitCommit(),
    node: process.version,
    startedAt: new Date().toISOString(),
  };
}

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch {
    return null;
  }
}
