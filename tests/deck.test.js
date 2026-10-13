// Manifiesto de la presentación (presentacion/deck/deck.js): orden, reparto, tiempos y notas.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_LIVE, PRESENTERS, SECTIONS, SLIDES, TOTAL_BUDGET, stepCount, stepNotes } from '../presentacion/deck/deck.js';
import { slideGroup, slideLabel } from '../presentacion/deck/ui.js';

const main = SLIDES.filter((slide) => !slide.backup);
const backup = SLIDES.filter((slide) => slide.backup);
// La exposición (lo que se cronometra) y, después del cierre, las que explican el quiz.
const talk = main.filter((slide) => slide.section !== 'quiz');
const quiz = main.filter((slide) => slide.section === 'quiz');

test('19 diapositivas de la exposición, 7 del quiz y 4 de respaldo, todas con su módulo', () => {
  assert.equal(talk.length, 19);
  assert.equal(quiz.length, 7);
  assert.equal(backup.length, 4);
  assert.equal(new Set(SLIDES.map((slide) => slide.id)).size, SLIDES.length, 'ids repetidos');
  for (const slide of SLIDES) {
    assert.ok(existsSync(new URL(`../presentacion/deck/slides/${slide.id}.js`, import.meta.url)), `falta slides/${slide.id}.js`);
    assert.ok(SECTIONS[slide.section], `${slide.id}: sección ${slide.section}`);
  }
  // Las del quiz van después del cierre y las de respaldo, todas al final.
  assert.equal(talk.at(-1).id, 'cierre');
  assert.deepEqual(main, [...talk, ...quiz]);
  assert.deepEqual(SLIDES.slice(main.length), backup);
});

test('el número y el avance cuentan solo la exposición; el quiz y el respaldo llevan Q y R', () => {
  const label = (id) => slideLabel(SLIDES, SLIDES.findIndex((slide) => slide.id === id));
  assert.equal(label('portada'), '1 / 19');
  assert.equal(label('cierre'), '19 / 19');
  assert.deepEqual(quiz.map((slide) => label(slide.id)), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7']);
  assert.deepEqual(backup.map((slide) => label(slide.id)), ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(SLIDES.filter((slide) => slideGroup(slide) === 'talk'), talk);
});

test('el tiempo total es 22:30 y cada integrante expone entre 4 y 7 minutos en un bloque seguido', () => {
  assert.equal(TOTAL_BUDGET, 22 * 60 + 30);
  assert.equal(PRESENTERS.length, 4);
  const order = talk.map((slide) => slide.presenter);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'cada integrante en un solo bloque');
  for (let p = 1; p <= 4; p += 1) {
    const seconds = talk.filter((slide) => slide.presenter === p).reduce((sum, slide) => sum + slide.budget, 0);
    assert.ok(seconds >= 4 * 60 && seconds <= 7 * 60, `integrante ${p}: ${seconds} s`);
  }
  for (const slide of backup) assert.equal(slide.presenter, 0, slide.id);
  // Las del quiz no son parte de la exposición: sin integrante y sin tiempo, no mueven el total.
  for (const slide of quiz) assert.deepEqual([slide.presenter, slide.budget], [0, 0], slide.id);
});

test('cada diapositiva tiene guion y una nota no vacía por paso', () => {
  for (const slide of SLIDES) {
    assert.ok(slide.script?.length > 20, `${slide.id}: guion`);
    const notes = stepNotes(slide, DEFAULT_LIVE);
    assert.equal(notes.length, stepCount(slide, DEFAULT_LIVE));
    assert.ok(notes.length >= 1);
    notes.forEach((note, i) => assert.ok(note.trim().length > 10, `${slide.id}: nota ${i}`));
  }
});

test('no se adelanta el tema del grupo siguiente (3.3 y 3.4) más allá de mencionarlo', () => {
  // Solo la diapositiva de equivalencia anuncia lo que viene; nadie más habla de gramáticas.
  const mentions = SLIDES.filter((slide) => /gramática/i.test(JSON.stringify(slide.steps)));
  assert.deepEqual(mentions.map((slide) => slide.id), ['equivalencia']);
});
