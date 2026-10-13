// Resolución como diagrama (rediseño, fase 4): cómo se agrupan los eventos de la resolución.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupEvents, setCatalog } from '../client/shared/items.js';
import { ITEM_DEFS } from '../server/domain/items/index.js';

setCatalog(Object.entries(ITEM_DEFS).map(([code, def]) => ({ code, name: code, target: def.target })));
const names = (id) => ({ t1: 'Equipo 1', t2: 'Equipo 2', t3: 'Equipo 3', t4: 'Equipo 4' })[id] ?? id;

test('contra todos: un solo diagrama con los bloqueos y los Espejos', () => {
  const events = [
    { kind: 'defense', code: 'EA', source: 't4', target: 't4', changes: [] },
    { kind: 'armed', code: 'C', source: 't3', target: 't1', changes: [] },
    { kind: 'armed', code: 'C', source: 't3', target: 't2', changes: [] },
    { kind: 'blocked', code: 'C', source: 't3', target: 't4', by: 'EA', changes: [] },
  ];
  const groups = groupEvents(events);
  assert.deepEqual(groups.map((g) => [g.type, g.code]), [['self', 'EA'], ['all', 'C']]);
  const calamar = groups[1];
  assert.deepEqual(calamar.sources, ['t3']);
  assert.match(calamar.fx(names), /tinta en las pantallas de los demás/);
  assert.match(calamar.fx(names), /Equipo 4 lo bloqueó/);
});

test('para uno mismo: los equipos que usan el mismo objeto van juntos', () => {
  const events = [
    { kind: 'hit', code: 'P', source: 't2', target: 't2', changes: [{ teamId: 't2', points: 300, streak: 0 }] },
    { kind: 'hit', code: 'P', source: 't4', target: 't4', changes: [{ teamId: 't4', points: 300, streak: 0 }] },
  ];
  const [group] = groupEvents(events);
  assert.deepEqual([group.type, group.sources], ['self', ['t2', 't4']]);
  assert.equal(group.fx(names), '+300 pts cada uno');
});

test('contra un equipo: un diagrama por uso, con el efecto corto', () => {
  const events = [
    { kind: 'hit', code: 'CV', source: 't1', target: 't2', changes: [{ teamId: 't2', points: -111, streak: 0 }] },
    { kind: 'hit', code: 'GL', source: 't1', target: 't3', changes: [{ teamId: 't3', points: 0, streak: -4 }, { teamId: 't1', points: 0, streak: 4 }] },
    { kind: 'blocked', code: 'CV', source: 't2', target: 't4', by: 'EF', changes: [] },
    { kind: 'armed', code: 'RR', source: 't3', target: 't1', changes: [] },
  ];
  const groups = groupEvents(events);
  assert.deepEqual(groups.map((g) => [g.type, g.source, g.target]), [['one', 't1', 't2'], ['one', 't1', 't3'], ['one', 't2', 't4'], ['one', 't3', 't1']]);
  assert.deepEqual(groups.map((g) => g.fx(names)), [
    '−111 pts',
    'Equipo 3: racha −4 · Equipo 1: racha +4',
    'bloqueado por Escudo Físico',
    'menos tiempo en la próxima pregunta',
  ]);
});
