// Tiempos de un ensayo de la presentación (npm run slides:tiempos).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureRehearsals } from '../scripts/lib/slides-times.js';

const SLIDES = [
  { id: 'a', title: 'A', presenter: 1, budget: 30 },
  { id: 'b', title: 'B', presenter: 1, budget: 60 },
  { id: 'c', title: 'C', presenter: 2, budget: 45 },
  { id: 'r', title: 'R', presenter: 0, budget: 0, backup: true },
];
const s = (seconds) => 1_000_000 + seconds * 1000;

test('mide cada diapositiva con el cronómetro corriendo y descuenta las pausas', () => {
  const [rehearsal] = measureRehearsals([
    { t: s(0), type: 'pos', id: 'a', step: 1 }, // antes de arrancar: no cuenta
    { t: s(5), type: 'timer', action: 'start' },
    { t: s(5), type: 'pos', id: 'b', step: 0 },
    { t: s(40), type: 'pos', id: 'b', step: 1 },
    { t: s(70), type: 'timer', action: 'pause' }, // pregunta del público: 20 s en pausa
    { t: s(90), type: 'timer', action: 'start' },
    { t: s(100), type: 'pos', id: 'c', step: 0 },
    { t: s(150), type: 'pos', id: 'b', step: 1 }, // vuelve a B
    { t: s(160), type: 'pos', id: 'c', step: 0 },
    { t: s(170), type: 'timer', action: 'pause' },
  ], SLIDES);
  const byId = Object.fromEntries(rehearsal.rows.map((row) => [row.id, row]));
  assert.equal(byId.b.realMs, (65 + 10 + 10) * 1000);
  assert.equal(byId.b.visits, 2);
  assert.equal(byId.c.realMs, (50 + 10) * 1000);
  assert.equal(rehearsal.pausedMs, 20_000);
  assert.equal(rehearsal.totalMs, 145_000);
  assert.equal(rehearsal.budgetMs, 135_000);
  assert.deepEqual(rehearsal.byPresenter, [
    { presenter: 1, budgetMs: 90_000, realMs: 85_000 },
    { presenter: 2, budgetMs: 45_000, realMs: 60_000 },
  ]);
});

test('«Reiniciar» separa los ensayos; sin arrancar el cronómetro no hay ensayo', () => {
  assert.deepEqual(measureRehearsals([{ t: s(0), type: 'pos', id: 'b', step: 0 }], SLIDES), []);
  const rehearsals = measureRehearsals([
    { t: s(0), type: 'timer', action: 'start' },
    { t: s(10), type: 'pos', id: 'b', step: 0 },
    { t: s(20), type: 'timer', action: 'reset' },
    { t: s(30), type: 'pos', id: 'a', step: 0 },
    { t: s(40), type: 'timer', action: 'start' },
    { t: s(55), type: 'pos', id: 'r', step: 0 },
    { t: s(60), type: 'timer', action: 'pause' },
  ], SLIDES);
  assert.equal(rehearsals.length, 2);
  assert.deepEqual(rehearsals[0].rows.map((row) => [row.id, row.realMs]), [['a', 10_000], ['b', 10_000]]);
  assert.deepEqual(rehearsals[1].rows.map((row) => [row.id, row.realMs]), [['a', 15_000], ['r', 5_000]]);
});
