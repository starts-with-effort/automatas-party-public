// La configuración se valida al arrancar (RNF-14): un error en el JSON no debe llegar a la partida.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FAST_OVERLAY, loadConfig, parseConfig } from '../server/core/config.js';

test('game.json y el banco de 11 preguntas del repositorio son válidos', () => {
  const config = loadConfig();
  assert.equal(config.questionBank.length, 11);
  assert.ok(config.questionBank.every((q) => config.questions.difficulties[q.difficulty]));
});

test('un banco con errores se rechaza y el mensaje dice dónde', () => {
  const base = loadConfig();
  const broken = (change) => {
    const questionBank = structuredClone(base.questionBank);
    change(questionBank);
    return () => parseConfig({ ...base, questionBank });
  };
  assert.throws(broken((bank) => { bank[0].correct = 4; }), /questionBank.*correct/s);
  assert.throws(broken((bank) => { bank[1].options.pop(); }), /4 opciones/);
  assert.throws(broken((bank) => { bank[2].difficulty = 'imposible'; }), /dificultad desconocida/);
  assert.throws(broken((bank) => { bank[3].id = bank[0].id; }), /id repetido/);
  assert.throws(broken((bank) => { bank.pop(); }), /exactamente 11 preguntas/);
  assert.throws(broken((bank) => { bank[4].image = '../server/.env'; }), /client\/assets/);
});

// Rediseño, fase 1: el tiempo de cada pregunta sale de su dificultad (30, 45 y 60 s), salvo que la
// pregunta traiga el suyo.
test('cada pregunta tiene el tiempo de su dificultad, salvo que traiga uno propio', () => {
  const base = loadConfig();
  const { difficulties } = base.questions;
  assert.deepEqual([difficulties.basica, difficulties.intermedia, difficulties.dificil].map((d) => d.timeLimitMs), [30_000, 45_000, 60_000]);
  for (const question of base.questionBank) {
    assert.equal(question.timeLimitMs, difficulties[question.difficulty].timeLimitMs, question.id);
  }
  const questionBank = structuredClone(base.questionBank).map(({ timeLimitMs, ...question }) => question);
  questionBank[0].timeLimitMs = 40_000;
  const config = parseConfig({ ...base, questionBank });
  assert.equal(config.questionBank[0].timeLimitMs, 40_000);
  assert.equal(config.questionBank[1].timeLimitMs, difficulties[questionBank[1].difficulty].timeLimitMs);
  questionBank[0].timeLimitMs = 500;
  assert.throws(() => parseConfig({ ...base, questionBank }), /timeLimitMs/);
});

test('la partida rápida (fast.json) es válida y solo cambia lo que dice', () => {
  const real = loadConfig();
  const fast = loadConfig(undefined, { overlay: FAST_OVERLAY });
  assert.equal(fast.minigameRules.memoria.pairs, 6);
  assert.deepEqual(fast.minigameRules.memoria.faces, real.minigameRules.memoria.faces);
  assert.equal(fast.minigameRules.arena.durationMs, 30_000);
  assert.equal(fast.minigameRules.arena.threshold, real.minigameRules.arena.threshold);
  assert.deepEqual(fast.questionBank, real.questionBank);
  assert.ok(fast.timings.draft < real.timings.draft);
});

// Cada objeto tiene su ilustración con el tema del tablero (docs/ICONOS.md).
test('cada objeto de items.json tiene su SVG en client/assets/items con el formato del tema', () => {
  const { itemCatalog } = loadConfig();
  for (const item of itemCatalog) {
    assert.equal(item.image, `items/${item.code.toLowerCase()}.svg`, `${item.code}: falta "image" (docs/ICONOS.md)`);
    const file = new URL(`../client/assets/${item.image}`, import.meta.url);
    assert.ok(existsSync(file), `${item.code}: no existe client/assets/${item.image}`);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64">/, `${item.code}: viewBox de 64`);
    assert.match(svg, /<feDropShadow dx="0" dy="2\.5" stdDeviation="0" flood-color="#1c1640"/, `${item.code}: sombra dura`);
    assert.match(svg, /stroke="#1c1640" stroke-width="3"/, `${item.code}: contorno de tinta`);
    assert.doesNotMatch(svg, /<text|<script|<image|href="http/, `${item.code}: sin texto, scripts ni recursos externos`);
  }
});
