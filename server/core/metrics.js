// Métricas del proceso para la prueba de carga (RNF-01, RNF-15): CPU, memoria, retraso del event loop
// y mensajes por segundo, muestreados cada segundo. Las lee GET /api/metrics (solo el host).
//
// La CPU es la del proceso de Node en porcentaje de un núcleo (100 % = un núcleo entero), que es lo
// que puede usar un servidor de un solo hilo. Los picos y promedios se acumulan desde el último
// reset(): la prueba de carga reinicia al empezar la partida y lee al terminar.
import { availableParallelism, loadavg, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

const MB = 1024 * 1024;
const LOOP_RESOLUTION_MS = 10;
const PEAK_KEYS = ['cpuPercent', 'rssMb', 'heapUsedMb', 'loopDelayP99Ms', 'loopDelayMaxMs', 'inPerSec', 'outPerSec', 'connections'];

// counters() → { in, out, errors, connections }: mensajes recibidos y vistas enviadas (acumulados),
// errores al procesar mensajes y conexiones abiertas. Los da el gateway.
export function createMetrics({ counters = () => ({}), sampleMs = 1000 } = {}) {
  const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  loop.enable();
  let previous = { at: performance.now(), cpu: process.cpuUsage(), counts: counters() };
  let last = null; // última muestra
  let window = null; // agregados desde el último reset
  reset();

  const timer = setInterval(sample, sampleMs);
  timer.unref();

  function sample() {
    const at = performance.now();
    const cpu = process.cpuUsage();
    const counts = counters();
    const seconds = (at - previous.at) / 1000;
    if (seconds <= 0) return;
    const usedUs = cpu.user - previous.cpu.user + cpu.system - previous.cpu.system;
    const rate = (key) => ((counts[key] ?? 0) - (previous.counts[key] ?? 0)) / seconds;
    const memory = process.memoryUsage();
    // Retraso del event loop más allá del intervalo con que se mide (en Windows queda además la
    // resolución de sus temporizadores, ~15 ms).
    const loopDelay = (ns) => (loop.count > 0 ? round1(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS)) : 0);
    last = {
      cpuPercent: round1((usedUs / (seconds * 1e6)) * 100),
      rssMb: round1(memory.rss / MB),
      heapUsedMb: round1(memory.heapUsed / MB),
      loopDelayP99Ms: loopDelay(loop.percentile(99)),
      loopDelayMaxMs: loopDelay(loop.max),
      inPerSec: Math.round(rate('in')),
      outPerSec: Math.round(rate('out')),
      connections: counts.connections ?? 0,
    };
    loop.reset();
    previous = { at, cpu, counts };
    window.samples += 1;
    window.cpuSum += last.cpuPercent;
    for (const key of PEAK_KEYS) window.peak[key] = Math.max(window.peak[key], last[key]);
  }

  function reset() {
    window = {
      since: Date.now(),
      samples: 0,
      cpuSum: 0,
      peak: Object.fromEntries(PEAK_KEYS.map((key) => [key, 0])),
      startCounts: counters(),
    };
  }

  function snapshot() {
    const counts = counters();
    const since = (key) => (counts[key] ?? 0) - (window.startCounts[key] ?? 0);
    const memory = process.memoryUsage();
    return {
      at: Date.now(),
      sampleMs,
      cores: availableParallelism(),
      totalMemMb: Math.round(totalmem() / MB),
      loadavg: loadavg().map(round1), // en Windows siempre 0
      memory: { rssMb: round1(memory.rss / MB), heapUsedMb: round1(memory.heapUsed / MB) },
      connections: counts.connections ?? 0,
      last,
      window: {
        since: window.since,
        seconds: Math.round((Date.now() - window.since) / 1000),
        samples: window.samples,
        cpuAvgPercent: window.samples > 0 ? round1(window.cpuSum / window.samples) : null,
        peak: { ...window.peak },
        messagesIn: since('in'),
        viewsOut: since('out'),
        errors: since('errors'),
      },
    };
  }

  function stop() {
    clearInterval(timer);
    loop.disable();
  }

  return { sample, reset, snapshot, stop };
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
