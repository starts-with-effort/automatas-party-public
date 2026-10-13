// Objetos: resolución (sección 5.4 y casos de 10.1), pools y ofertas del draft.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveItemUse } from '../server/domain/EffectResolver.js';
import { ITEM_CODES, ITEM_DEFS } from '../server/domain/items/index.js';
import { buildOffer, poolFor } from '../server/domain/Luck.js';
import { createRng } from '../server/domain/random.js';
import { testConfig } from './support/helpers.js';

const teams = () => [
  { id: 'a', score: 1000, streak: 2 },
  { id: 'b', score: 1000, streak: 4 },
  { id: 'c', score: 1000, streak: 0 },
];

let seq = 0;
const use = (teamId, code, targetTeamId = null) => ({ seq: ++seq, teamId, code, targetTeamId });
const resolve = (declarations, initial = teams()) => resolveItemUse({ teams: initial, declarations });
const finalOf = (result, id) => result.final.find((row) => row.teamId === id);
const eventsFor = (result, target) => result.events.filter((e) => e.target === target);

describe('catálogo', () => {
  test('18 objetos con tipo, objetivo y momento de efecto', () => {
    assert.equal(ITEM_CODES.length, 18);
    for (const def of Object.values(ITEM_DEFS)) {
      assert.match(def.type, /^(FISICO|EFECTO|DEFENSA|POWERUP|IMPARABLE)$/, def.code);
      assert.match(def.target, /^(SELF|ONE|OTHERS|ALL)$/, def.code);
      assert.match(def.timing, /^(INMEDIATO|SIGUIENTE_PREGUNTA|SIGUIENTE_DRAFT|DUELO|REACTIVO)$/, def.code);
    }
  });
});

describe('matriz de defensas (sección 5.4)', () => {
  // Ataque de "a" contra "b" (la Bomba y el Calamar afectan también a "c").
  const attacks = { CV: 'FISICO', BN: 'FISICO', RR: 'EFECTO', CS: 'EFECTO', GL: 'EFECTO', CP: 'EFECTO', C: 'EFECTO' };

  for (const [code, type] of Object.entries(attacks)) {
    test(`${code} (${type.toLowerCase()}): Escudo Físico, Anti-hechizos y Espejo`, () => {
      const target = ITEM_DEFS[code].target === 'ONE' ? 'b' : null;
      const against = (defense) => {
        const result = resolve([use('b', defense), use('a', code, target)]);
        return eventsFor(result, 'b').find((e) => e.code === code).kind;
      };
      const plain = resolve([use('a', code, target)]);
      const expectedHit = ITEM_DEFS[code].timing === 'INMEDIATO' ? 'hit' : 'armed';
      assert.equal(eventsFor(plain, 'b').find((e) => e.code === code).kind, expectedHit, 'sin defensa');
      assert.equal(against('EF'), type === 'FISICO' ? 'blocked' : expectedHit, 'Escudo Físico');
      assert.equal(against('EA'), type === 'EFECTO' ? 'blocked' : expectedHit, 'Escudo Anti-hechizos');
      assert.equal(against('E'), 'reflected', 'Espejo');
    });
  }

  test('las defensas se gastan aunque no haya ataques', () => {
    const result = resolve([use('a', 'EF'), use('b', 'E')]);
    assert.deepEqual(result.events.map((e) => [e.kind, e.code]), [['defense', 'EF'], ['defense', 'E']]);
  });
});

describe('casos de la sección 10.1', () => {
  test('Caparazón Verde: 7 % de los puntos al 1.º y 0,5 % menos por cada puesto más abajo', () => {
    // Los empatados comparten el 1.er puesto: 7 % de 1000.
    assert.equal(finalOf(resolve([use('a', 'CV', 'b')]), 'b').score, 930);
    const initial = [{ id: 'a', score: 10_000, streak: 0 }, { id: 'b', score: 8000, streak: 0 }, { id: 'c', score: 4000, streak: 0 }];
    const hit = (target, by = 'c') => finalOf(resolve([use(by, 'CV', target)], initial), target).score;
    assert.equal(hit('a'), 10_000 - 700); // 1.º: 7 %
    assert.equal(hit('b'), 8000 - 520); // 2.º: 6,5 %
    assert.equal(hit('c', 'a'), 4000 - 240); // 3.º: 6 %
  });

  test('Caparazón Verde: el puesto es el de antes de la resolución; el porcentaje, sobre los puntos de ese momento', () => {
    const initial = [{ id: 'a', score: 2000, streak: 0 }, { id: 'b', score: 1000, streak: 0 }];
    // Dos caparazones contra el 1.º: 7 % de 2000 y luego 7 % de 1860 (sigue contando como 1.º).
    const result = resolveItemUse({ teams: initial, declarations: [use('b', 'CV', 'a'), use('b', 'CV', 'a')] });
    assert.equal(finalOf(result, 'a').score, 2000 - 140 - 130);
  });

  test('Espejo contra Espejo: el ataque reflejado no se vuelve a reflejar', () => {
    const result = resolve([use('a', 'E'), use('b', 'E'), use('a', 'CV', 'b')]);
    assert.equal(finalOf(result, 'a').score, 930);
    assert.equal(finalOf(result, 'b').score, 1000);
  });

  test('Desafío: queda para el Duelo y nada lo detiene (ni escudos ni Espejo)', () => {
    const expected = [{ code: 'DS', sourceTeamId: 'a', targetTeamId: 'b', appliesTo: 'duel' }];
    assert.deepEqual(resolve([use('a', 'DS', 'b')]).effects, expected);
    for (const defenses of [['EF'], ['EA'], ['E'], ['EF', 'EA', 'E']]) {
      const result = resolve([...defenses.map((code) => use('b', code)), use('a', 'DS', 'b')]);
      assert.deepEqual(result.effects, expected, `contra ${defenses.join(' + ')}`);
      assert.deepEqual(result.events.filter((e) => e.code === 'DS').map((e) => [e.kind, e.source, e.target]), [['armed', 'a', 'b']]);
    }
  });

  test('un ataque reflejado lo puede bloquear un escudo del emisor', () => {
    const result = resolve([use('a', 'EF'), use('b', 'E'), use('a', 'CV', 'b')]);
    assert.deepEqual(result.events.slice(-2).map((e) => [e.kind, e.source, e.target]), [['reflected', 'a', 'b'], ['blocked', 'b', 'a']]);
    assert.equal(finalOf(result, 'a').score, 1000);
  });

  test('Bomba Nuclear sin defensas: todos pierden el 8 % de sus puntos, también quien la usa', () => {
    const initial = [{ id: 'a', score: 5000, streak: 0 }, { id: 'b', score: 1000, streak: 0 }, { id: 'c', score: 0, streak: 0 }];
    const result = resolve([use('a', 'BN')], initial);
    assert.deepEqual(result.final.map((row) => row.score), [4600, 920, 0]);
  });

  test('Bomba Nuclear: la parte propia no se bloquea; un reflejo le quita otro 8 % al emisor', () => {
    const initial = [{ id: 'a', score: 5000, streak: 0 }, { id: 'b', score: 5000, streak: 0 }, { id: 'c', score: 5000, streak: 0 }];
    const blocked = resolve([use('a', 'EF'), use('b', 'EF'), use('a', 'BN')], initial);
    assert.deepEqual(blocked.final.map((row) => row.score), [4600, 5000, 4600]);
    const reflected = resolve([use('b', 'E'), use('a', 'BN')], initial);
    assert.deepEqual(reflected.final.map((row) => row.score), [4232, 5000, 4600]);
  });

  test('Guante doble: el segundo guante roba 0', () => {
    const result = resolve([use('a', 'GL', 'b'), use('c', 'GL', 'b')]);
    assert.deepEqual(result.final.map((row) => row.streak), [6, 0, 0]);
  });

  test('Cáscara con racha 1: la racha queda en 0, no negativa', () => {
    const initial = [{ id: 'a', score: 0, streak: 0 }, { id: 'b', score: 0, streak: 1 }];
    assert.equal(finalOf(resolveItemUse({ teams: initial, declarations: [use('a', 'CP', 'b')] }), 'b').streak, 0);
  });

  test('Chupa-Sangre se registra para la siguiente pregunta; reflejado, invierte los roles', () => {
    const armed = resolve([use('a', 'CS', 'b')]);
    assert.deepEqual(armed.effects, [{ code: 'CS', sourceTeamId: 'a', targetTeamId: 'b', appliesTo: 'question' }]);
    const reflected = resolve([use('b', 'E'), use('a', 'CS', 'b')]);
    assert.deepEqual(reflected.effects, [{ code: 'CS', sourceTeamId: 'b', targetTeamId: 'a', appliesTo: 'question' }]);
  });

  test('los power-ups van después de los ataques: la racha recién ganada no se puede robar', () => {
    const result = resolve([use('b', 'R'), use('a', 'GL', 'b')]);
    assert.equal(finalOf(result, 'a').streak, 2 + 4);
    assert.equal(finalOf(result, 'b').streak, 3);
  });

  test('los ataques van antes que los power-ups: la Bomba no toca los puntos de la Poción', () => {
    // 900 − 72 de la Bomba (8 %) + 300 de la Poción = 1128.
    const initial = [{ id: 'a', score: 0, streak: 0 }, { id: 'c', score: 900, streak: 0 }];
    const result = resolveItemUse({ teams: initial, declarations: [use('a', 'BN'), use('c', 'P')] });
    assert.equal(finalOf(result, 'c').score, 1128);
    const alone = resolveItemUse({ teams: initial, declarations: [use('a', 'BN')] });
    assert.equal(finalOf(alone, 'c').score, 828);
  });

  test('Calamar: a cada uno de los demás; el Anti-hechizos lo bloquea y el Espejo lo devuelve', () => {
    const result = resolve([use('b', 'EA'), use('c', 'E'), use('a', 'C')]);
    assert.deepEqual(result.effects.map((e) => [e.code, e.targetTeamId]), [['C', 'a']]);
  });

  test('los power-ups diferidos quedan como efectos activos', () => {
    const result = resolve([use('a', 'DN'), use('a', 'SV'), use('a', 'CR'), use('a', 'TD'), use('a', 'RR', 'b')]);
    assert.deepEqual(result.effects.map((e) => [e.code, e.targetTeamId, e.appliesTo]), [
      ['RR', 'b', 'question'], ['DN', 'a', 'question'], ['SV', 'a', 'question'], ['CR', 'a', 'question'], ['TD', 'a', 'draft'],
    ]);
  });

  test('no modifica lo que recibe', () => {
    const initial = teams();
    resolveItemUse({ teams: initial, declarations: [use('a', 'CV', 'b'), use('a', 'GL', 'b')] });
    assert.deepEqual(initial, teams());
  });
});

describe('pools y ofertas', () => {
  const config = testConfig();

  test('cada suerte usa su pool; suerte 6 o más usa la pool "6+"', () => {
    assert.deepEqual(poolFor(config, 1), ['CV', 'EF', 'EA', 'RR', 'CP', 'P', 'TD']);
    assert.deepEqual(poolFor(config, 9), poolFor(config, 6));
  });

  test('un objeto desactivado sale de todas las pools (RF-FLU-07)', () => {
    const disabled = { ...config, itemCatalog: config.itemCatalog.map((item) => ({ ...item, enabled: item.code !== 'CV' })) };
    for (let luck = 1; luck <= 6; luck += 1) assert.ok(!poolFor(disabled, luck).includes('CV'));
  });

  test('3 objetos distintos de la pool de su suerte', () => {
    const random = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const position = 1 + (i % 7);
      const offer = buildOffer({ config, position, random });
      assert.equal(offer.codes.length, 3);
      assert.equal(new Set(offer.codes).size, 3);
      assert.ok(offer.codes.every((code) => poolFor(config, position).includes(code)));
      assert.equal(offer.picks, 1);
    }
  });

  test('Ticket Dorado: 4 objetos, elige 2 y la suerte sube 1', () => {
    const offer = buildOffer({ config, position: 4, goldenTicket: true, random: createRng(3) });
    assert.equal(offer.luck, 5);
    assert.equal(offer.codes.length, 4);
    assert.equal(offer.picks, 2);
    assert.ok(offer.codes.every((code) => poolFor(config, 5).includes(code)));
  });

  test('objeto adicional por no responder: de su pool y distinto de los ofrecidos', () => {
    const random = createRng(11);
    for (let i = 0; i < 100; i += 1) {
      const offer = buildOffer({ config, position: 2, extraItem: true, random });
      assert.ok(poolFor(config, 2).includes(offer.extra));
      assert.ok(!offer.codes.includes(offer.extra));
    }
  });

  test('con la misma semilla salen las mismas ofertas', () => {
    const a = buildOffer({ config, position: 3, random: createRng(42) });
    const b = buildOffer({ config, position: 3, random: createRng(42) });
    assert.deepEqual(a, b);
  });
});
