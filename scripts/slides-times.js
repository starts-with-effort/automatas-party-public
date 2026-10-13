// Tiempos de un ensayo de la presentación (docs/PRESENTACION.md): cuánto duró cada diapositiva y
// cada integrante contra el tiempo asignado en presentacion/deck/deck.js.
//
//   npm run slides:tiempos                          último ensayo de data/slides-log.jsonl
//   npm run slides:tiempos -- --ensayo 2            otro ensayo (la lista sale al principio)
//   npm run slides:tiempos -- --log <archivo>       otro log (p. ej. el copiado desde la VM)
//
// Al terminar un ensayo, pausen el cronómetro en el celular: así cuenta también la última diapositiva.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PRESENTERS, SECTIONS, SLIDES } from '../presentacion/deck/deck.js';
import { slideLabel } from '../presentacion/deck/ui.js';
import { measureRehearsals } from './lib/slides-times.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: args } = parseArgs({
  options: {
    log: { type: 'string' },
    ensayo: { type: 'string' },
  },
});

const path = args.log ? resolve(args.log) : resolve(ROOT, process.env.DATA_DIR || 'data', 'slides-log.jsonl');
let text;
try {
  text = readFileSync(path, 'utf8');
} catch {
  console.error(`No se encontró el log de la presentación: ${path}`);
  process.exit(1);
}
const events = text.split('\n').flatMap((line) => {
  try {
    return line.trim() ? [JSON.parse(line)] : [];
  } catch {
    return [];
  }
});
const rehearsals = measureRehearsals(events, SLIDES);
if (!rehearsals.length) {
  console.log('Todavía no hay ensayos: el cronómetro no ha arrancado (empieza con el primer «Siguiente» desde la portada).');
  process.exit(0);
}

console.log('Ensayos en el log:');
rehearsals.forEach((r, i) => console.log(`  ${i + 1}. ${when(r.startedAt)} · ${clock(r.totalMs)} con el cronómetro corriendo`));
const n = args.ensayo ? Number(args.ensayo) : rehearsals.length;
const rehearsal = rehearsals[n - 1];
if (!rehearsal) {
  console.error(`No existe el ensayo ${args.ensayo}.`);
  process.exit(1);
}

console.log(`\nEnsayo ${n} (${when(rehearsal.startedAt)}) · pausas: ${clock(rehearsal.pausedMs)}\n`);
table(
  ['#', 'Diapositiva', 'Expone', 'Real', 'Asignado', 'Diferencia'],
  rehearsal.rows.map((row) => [
    label(row.index),
    row.title + (row.visits > 1 ? ` (${row.visits} veces)` : ''),
    row.presenter ? PRESENTERS[row.presenter - 1] : sectionOf(row.id),
    clock(row.realMs),
    row.budgetMs ? clock(row.budgetMs) : '—',
    row.budgetMs ? diff(row.realMs - row.budgetMs) : '',
  ]),
  ['', 'Total', '', clock(rehearsal.totalMs), clock(rehearsal.budgetMs), diff(rehearsal.totalMs - rehearsal.budgetMs)],
);
console.log('\nPor integrante:');
table(
  ['Integrante', 'Real', 'Asignado', 'Diferencia'],
  rehearsal.byPresenter.map((p) => [PRESENTERS[p.presenter - 1], clock(p.realMs), clock(p.budgetMs), diff(p.realMs - p.budgetMs)]),
);
const missing = SLIDES.filter((slide) => slide.presenter && !rehearsal.rows.some((row) => row.id === slide.id));
if (missing.length) console.log(`\nNo se mostraron: ${missing.map((slide) => slide.title).join(', ')}.`);

function table(header, rows, footer) {
  const all = footer ? [header, ...rows, footer] : [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  const left = header.map((title) => ['Diapositiva', 'Expone', 'Integrante'].includes(title));
  const line = (row) => row.map((cell, i) => (left[i] ? String(cell).padEnd(widths[i]) : String(cell).padStart(widths[i]))).join('   ');
  console.log(line(header));
  for (const row of rows) console.log(line(row));
  if (footer) console.log(line(footer));
}

// Las diapositivas sin integrante (respaldo y quiz) muestran su sección.
function sectionOf(id) {
  const slide = SLIDES.find((entry) => entry.id === id);
  return slide ? SECTIONS[slide.section].toLowerCase() : '—';
}

// «8» en las de la exposición, «Q1» en las del quiz y «R1» en las de respaldo, como en el proyector.
function label(index) {
  return index === Infinity ? '?' : slideLabel(SLIDES, index).split(' ')[0];
}

function clock(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function diff(ms) {
  if (Math.abs(ms) < 1000) return '0:00';
  return `${ms > 0 ? '+' : '-'}${clock(Math.abs(ms))}`;
}

function when(t) {
  return new Date(t).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}
