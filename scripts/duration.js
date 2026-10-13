// Duración de la partida (sección 9.3, RNF-18): cuánto dura con la configuración actual y cuánto duró
// una partida jugada, para ajustar los tiempos de game.json al tiempo que dé el profesor.
//
//   npm run duration                       estimación con server/config/game.json
//   npm run duration -- --fast             con los tiempos rápidos de fast.json
//   npm run duration -- --log <archivo>    duración real de una partida: data/events-<sala>.jsonl
//                                          (en la VM, en la carpeta de datos) o el JSON completo
//                                          que se descarga en /host → Estadísticas
//
// Supuestos para las pantallas que esperan al host, en segundos (por defecto, los de la tabla 9.3):
//   --lobby 300 --resultado 10 --resultado-minijuego 15 --resolucion 30 --ranking 20
// Si game.json tiene autoAdvanceMs, las pantallas de resultados usan ese valor.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FAST_OVERLAY, loadConfig } from '../server/core/config.js';
import { HOST_SCREENS_MS, estimateDuration, measureDuration } from './lib/duration.js';

const { values: args } = parseArgs({
  options: {
    fast: { type: 'boolean', default: false },
    log: { type: 'string' },
    lobby: { type: 'string' },
    resultado: { type: 'string' },
    'resultado-minijuego': { type: 'string' },
    resolucion: { type: 'string' },
    ranking: { type: 'string' },
  },
});

const seconds = (value, fallback) => (value === undefined ? fallback : Math.max(0, Number(value) || 0) * 1000);
const hostMs = {
  lobby: seconds(args.lobby, HOST_SCREENS_MS.lobby),
  questionResult: seconds(args.resultado, HOST_SCREENS_MS.questionResult),
  minigameResult: seconds(args['resultado-minijuego'], HOST_SCREENS_MS.minigameResult),
  resolution: seconds(args.resolucion, HOST_SCREENS_MS.resolution),
  ranking: seconds(args.ranking, HOST_SCREENS_MS.ranking),
};
const config = loadConfig(undefined, { overlay: args.fast ? FAST_OVERLAY : null });
const estimate = estimateDuration(config, { hostMs });
const source = args.fast ? 'game.json + fast.json' : 'game.json';

if (args.log) {
  const measured = measureDuration(readEvents(resolve(args.log)), config);
  const maxOf = new Map(estimate.rows.map((row) => [row.key, row.maxMs]));
  console.log(`Duración real de la partida (${basename(args.log)})\n`);
  table(['Fase', 'Veces', 'Real', 'Máximo*'], measured.rows.map((row) => [
    row.label, row.count, clock(row.realMs), maxOf.has(row.key) ? clock(maxOf.get(row.key)) : '—',
  ]), ['Total', '', clock(measured.rows.reduce((total, row) => total + row.realMs, 0)), clock(estimate.maxMs)]);
  console.log();
  if (!measured.finished) console.log('La partida no llegó al ranking final: se cuenta hasta el último evento del log.');
  if (measured.gameMs !== null) console.log(`Del inicio al ranking final: ${clock(measured.gameMs)} (sin el lobby).`);
  console.log(`Pausas: ${clock(measured.pausedMs)} (incluidas en las fases) · fases saltadas: ${measured.skipped}`
    + `${measured.recovered ? ` · reinicios del servidor: ${measured.recovered}` : ''}`);
  console.log(`* Máximo con la configuración actual (${source}), si se agotan todos los plazos.`);
  console.log('El ranking final cuenta hasta que aparece: el log termina ahí.');
} else {
  console.log(`Duración estimada de la partida con ${source} (sección 9.3)\n`);
  table(['Fase', 'Veces', 'Fijo', 'Máximo'],
    estimate.rows.map((row) => [row.label, row.count, clock(row.fixedMs), clock(row.maxMs)]),
    ['Total', '', clock(estimate.fixedMs), clock(estimate.maxMs)]);
  console.log(`
Fijo: lo que dura aunque todos respondan y elijan al instante y los minijuegos terminen antes.
Máximo: si se agotan todos los plazos. Con personas, preguntas, draft y uso suelen acercarse al máximo.
Cada fase incluye la anticipación con que se anuncia (leadMs): ${clock(estimate.leadMs)} en total (${estimate.phases} fases).
Supuestos (en segundos; se cambian con las opciones): lobby ${hostMs.lobby / 1000}, resultado de cada pregunta `
    + `${shownHost('questionResult')}, resultado del minijuego ${shownHost('minigameResult')}, resolución de objetos `
    + `${shownHost('resolution')}, cada ranking ${hostMs.ranking / 1000}.
Para medir una partida jugada: npm run duration -- --log data/events-<sala>.jsonl`);
}

// Las pantallas de resultados usan autoAdvanceMs si está definido.
function shownHost(kind) {
  const auto = config.timings.autoAdvanceMs;
  return auto === null ? hostMs[kind] / 1000 : `${auto / 1000} (autoAdvanceMs)`;
}

// Un .jsonl con un evento por línea, o el JSON exportado desde /host (campo events).
function readEvents(path) {
  const text = readFileSync(path, 'utf8');
  if (path.endsWith('.jsonl')) return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const data = JSON.parse(text);
  if (!Array.isArray(data.events)) throw new Error(`${path} no tiene la lista de eventos (campo events)`);
  return data.events;
}

function table(header, rows, footer) {
  const all = [header, ...rows, footer];
  const widths = header.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  const line = (row) => row.map((cell, i) => (i === 0 ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]))).join('   ');
  console.log(line(header));
  for (const row of rows) console.log(line(row));
  console.log(line(footer));
}

function clock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
