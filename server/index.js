// Arranque: carga .env y la configuración, recupera el snapshot si existe y escucha en HOST:PORT.
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { FAST_OVERLAY, loadConfig } from './core/config.js';
import { log } from './core/log.js';
import { Persistence } from './core/Persistence.js';

loadDotEnv();

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '') || null;
const DATA_DIR = resolve(ROOT_DIR, process.env.DATA_DIR || 'data');
// --fast (o FAST=1): partida rápida para ensayar, con los tiempos de server/config/fast.json.
const FAST = process.argv.includes('--fast') || process.env.FAST === '1';
const config = loadConfig(
  process.env.GAME_CONFIG ? resolve(ROOT_DIR, process.env.GAME_CONFIG) : undefined,
  { overlay: FAST ? FAST_OVERLAY : null },
);

let hostToken = process.env.HOST_TOKEN?.trim();
if (!hostToken) {
  hostToken = randomBytes(16).toString('hex');
  log('warn', 'HOST_TOKEN no está definido; se generó uno temporal para esta ejecución', { hostToken });
} else if (hostToken.length < 32) {
  log('warn', 'HOST_TOKEN es corto: usa al menos 32 caracteres hexadecimales (128 bits)');
}

// Token de la presentación (/slides y /remote), aparte del del host: se puede dar a quienes exponen
// sin darles el control del quiz.
let slidesToken = process.env.SLIDES_TOKEN?.trim();
if (!slidesToken) {
  slidesToken = randomBytes(16).toString('hex');
  log('warn', 'SLIDES_TOKEN no está definido; se generó uno temporal para esta ejecución', { slidesToken });
} else if (slidesToken.length < 32) {
  log('warn', 'SLIDES_TOKEN es corto: usa al menos 32 caracteres hexadecimales (128 bits)');
}

const server = createApp({
  hostToken,
  config,
  publicUrl: PUBLIC_URL,
  persistence: new Persistence(DATA_DIR),
  slides: { token: slidesToken, dataDir: DATA_DIR },
});

server.httpServer.listen(PORT, HOST, () => {
  log('info', 'servidor escuchando', {
    url: `http://${HOST}:${PORT}`,
    fast: FAST || undefined,
    publicUrl: PUBLIC_URL,
    dataDir: DATA_DIR,
    lan: HOST === '0.0.0.0' ? lanUrls(PORT) : undefined,
  });
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'apagando servidor', { signal });
    await server.close();
    process.exit(0);
  });
}

function loadDotEnv() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Direcciones de la red local, para probar con celulares en el mismo WiFi (HOST=0.0.0.0).
function lanUrls(port) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => `http://${iface.address}:${port}`);
}
