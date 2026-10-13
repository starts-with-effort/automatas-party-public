// Simulador de PDA de la presentación: lenguaje de cada ejemplo, las dos construcciones de 3.2 y
// las trazas que se proyectan. Si una de estas falla, alguna diapositiva mostraría algo falso.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_LIVE, SLIDES, normalizeLive, stepCount, stepNotes } from '../presentacion/deck/deck.js';
import { EXAMPLES, anbn, anbnEmpty, anbnStack, leaky, leakyNaive, leakyStack, parens, parensFinal, wwr } from '../presentacion/deck/pda/examples.js';
import { runNotes, treeNotes, verdict } from '../presentacion/deck/pda/narrate.js';
import {
  computationTree, emptyToFinal, finalToEmpty, idText, language, run, symbolText, transitionText,
} from '../presentacion/deck/pda/pda.js';

// Todas las cadenas de largo ≤ n sobre un alfabeto que cumplen una condición.
function strings(alphabet, n, keep) {
  const out = [];
  let layer = [''];
  for (let len = 0; len <= n; len += 1) {
    out.push(...layer.filter(keep));
    layer = layer.flatMap((w) => alphabet.map((c) => w + c));
  }
  return out;
}

const isAnBn = (w) => /^(a+)(b+)$/.test(w) && w.indexOf('b') * 2 === w.length;
const isEvenPalindrome = (w) => w.length % 2 === 0 && w === [...w].reverse().join('');
const isBalanced = (w) => {
  let depth = 0;
  for (const c of w) {
    depth += c === '(' ? 1 : -1;
    if (depth < 0) return false;
  }
  return depth === 0;
};

describe('lenguajes de los ejemplos', () => {
  test('aⁿbⁿ: L(P) = {aⁿbⁿ | n ≥ 1} y N(P) = ∅', () => {
    assert.deepEqual(language(anbn, 'final', 10), strings(['a', 'b'], 10, isAnBn));
    assert.deepEqual(language(anbn, 'empty', 10), []);
  });

  test('P′ (aⁿbⁿ que vacía la pila en q₂): N(P′) = L(P′) = {aⁿbⁿ | n ≥ 1}', () => {
    const expected = strings(['a', 'b'], 10, isAnBn);
    assert.deepEqual(language(anbnEmpty, 'empty', 10), expected);
    assert.deepEqual(language(anbnEmpty, 'final', 10), expected);
  });

  test('wwᴿ: L(P) son los palíndromos de largo par, con ε', () => {
    assert.deepEqual(language(wwr, 'final', 8), strings(['0', '1'], 8, isEvenPalindrome));
  });

  test('paréntesis: N(P) son los balanceados (con ε) y L(P) = ∅ porque F = ∅', () => {
    assert.deepEqual(language(parens, 'empty', 10), strings(['(', ')'], 10, isBalanced));
    assert.deepEqual(language(parens, 'final', 10), []);
  });
});

describe('construcciones', () => {
  test('de pila vacía a estado final: L(P_F) = N(P_N) en todos los ejemplos', () => {
    for (const pda of [parens, anbnEmpty]) {
      assert.deepEqual(language(emptyToFinal(pda), 'final', 9), language(pda, 'empty', 9), pda.id);
    }
    assert.deepEqual(language(parensFinal, 'final', 10), strings(['(', ')'], 10, isBalanced));
  });

  test('de estado final a pila vacía: N(P_N) = L(P_F) en todos los ejemplos', () => {
    for (const pda of [anbn, wwr, anbnEmpty, leaky]) {
      assert.deepEqual(language(finalToEmpty(pda), 'empty', 8), language(pda, 'final', 8), pda.id);
    }
    assert.deepEqual(language(anbnStack, 'empty', 10), strings(['a', 'b'], 10, isAnBn));
  });

  test('forma de las construcciones (como en Hopcroft)', () => {
    assert.deepEqual(parensFinal.states, ['p0', 'q', 'pf']);
    assert.deepEqual(parensFinal.final, ['pf']);
    assert.equal(parensFinal.bottom, 'X0');
    assert.deepEqual(parensFinal.transitions.filter((tr) => tr.added).map(transitionText), ['ε, X₀ / Z₀X₀', 'ε, X₀ / ε']);
    assert.deepEqual(anbnStack.states, ['p0', 'q0', 'q1', 'q2', 'p']);
    assert.deepEqual(anbnStack.final, []);
    // Desde q₂ (el final de P_F), ε hacia p con cada símbolo; p vacía la pila.
    assert.deepEqual(
      anbnStack.transitions.filter((tr) => tr.added === 'drain').map((tr) => `${tr.from}→${tr.to} ${transitionText(tr)}`),
      ['q2→p ε, A / ε', 'q2→p ε, Z₀ / ε', 'q2→p ε, X₀ / ε', 'p→p ε, A / ε', 'p→p ε, Z₀ / ε', 'p→p ε, X₀ / ε'],
    );
  });

  test('sin el marcador X₀, un P_F que vacía su pila sin aceptar hace aceptar de más', () => {
    const anbnWords = strings(['a', 'b'], 9, isAnBn);
    assert.deepEqual(language(leaky, 'final', 9), anbnWords, 'la fuga no cambia L(P_F)');
    assert.deepEqual(language(leakyNaive, 'empty', 9), ['b', ...anbnWords], 'sin X₀ acepta «b»');
    assert.deepEqual(language(leakyStack, 'empty', 9), anbnWords, 'con X₀, exactamente L(P_F)');
  });
});

describe('trazas', () => {
  test('aabb en el PDA de aⁿbⁿ: 5 movimientos y aceptada por estado final', () => {
    const result = run(anbn, 'aabb', 'final');
    assert.equal(result.accepted, true);
    assert.deepEqual(result.steps.map((s) => idText(s.id)), [
      '(q₀, aabb, Z₀)', '(q₀, abb, AZ₀)', '(q₀, bb, AAZ₀)', '(q₁, b, AZ₀)', '(q₁, ε, Z₀)', '(q₂, ε, Z₀)',
    ]);
    assert.deepEqual(verdict(result), { ok: true, title: 'Aceptada', detail: 'entrada leída y q₂ es final' });
  });

  test('aab termina en q₁ (no final) y abb llega a q₂ con una b sin leer', () => {
    const aab = run(anbn, 'aab', 'final');
    assert.equal(aab.accepted, false);
    assert.deepEqual(aab.reason, { kind: 'not-final', state: 'q1' });
    assert.equal(idText(aab.steps.at(-1).id), '(q₁, ε, AZ₀)');
    const abb = run(anbn, 'abb', 'final');
    assert.deepEqual(abb.reason, { kind: 'stuck', remaining: 'b' });
    assert.equal(idText(abb.steps.at(-1).id), '(q₂, b, Z₀)');
  });

  test('paréntesis: (()) se acepta por pila vacía; (() deja P en la pila', () => {
    const ok = run(parens, '(())', 'empty');
    assert.equal(ok.accepted, true);
    assert.equal(idText(ok.steps.at(-1).id), '(q, ε, ε)');
    assert.equal(ok.steps.length, 6);
    assert.deepEqual(run(parens, '(()', 'empty').reason, { kind: 'not-empty', stack: ['P', 'Z0'] });
  });

  test('las construcciones: () en P_F y ab en P_N', () => {
    const pf = run(parensFinal, '()', 'final');
    assert.deepEqual(pf.steps.map((s) => idText(s.id)), [
      '(p₀, (), X₀)', '(q, (), Z₀X₀)', '(q, ), PZ₀X₀)', '(q, ε, Z₀X₀)', '(q, ε, X₀)', '(p_f, ε, ε)',
    ]);
    const pn = run(anbnStack, 'ab', 'empty');
    assert.deepEqual(pn.steps.map((s) => idText(s.id)), [
      '(p₀, ab, X₀)', '(q₀, ab, Z₀X₀)', '(q₀, b, AZ₀X₀)', '(q₁, ε, Z₀X₀)', '(q₂, ε, Z₀X₀)', '(p, ε, X₀)', '(p, ε, ε)',
    ]);
  });

  test('árbol de 0110 en wwᴿ: 14 configuraciones, 6 niveles y una sola rama que acepta', () => {
    const tree = computationTree(wwr, '0110', 'final');
    assert.equal(tree.nodes.length, 14);
    assert.equal(tree.depth, 6);
    assert.equal(tree.accepted, true);
    const leaves = tree.nodes.filter((node) => node.children.length === 0);
    assert.deepEqual(leaves.map((node) => `${node.status} ${idText(node.id)}`).sort(), [
      'accept (q₂, ε, Z₀)', 'dead (q₁, 0, 110Z₀)', 'dead (q₁, 110, 0Z₀)', 'dead (q₁, ε, 0110Z₀)', 'dead (q₂, 0110, Z₀)',
    ]);
  });

  test('las notas tienen una entrada por paso: inicio, movimientos y veredicto', () => {
    assert.equal(runNotes(anbn, 'aabb', 'final').length, 7);
    assert.equal(runNotes(anbn, '', 'final').length, 2);
    assert.equal(treeNotes(wwr, '0110', 'final').length, 8);
    assert.match(runNotes(anbn, 'aabb', 'final')[1], /^\*\*Lee «a»\*\* con Z₀ en el tope: apila A y sigue en q₀\. Queda \(q₀, abb, AZ₀\)\.$/);
  });

  test('nombres con subíndice', () => {
    assert.deepEqual(['q0', 'Z0', 'X0', 'pf', 'q', 'A', '0', 'q12'].map(symbolText), ['q₀', 'Z₀', 'X₀', 'p_f', 'q', 'A', '0', 'q₁₂']);
  });

  test('todos los ejemplos tienen transiciones con estados y símbolos declarados', () => {
    for (const pda of Object.values(EXAMPLES)) {
      for (const tr of pda.transitions) {
        assert.ok(pda.states.includes(tr.from) && pda.states.includes(tr.to), `${pda.id}: ${tr.from}→${tr.to}`);
        assert.ok(pda.stack.includes(tr.top) && tr.push.every((s) => pda.stack.includes(s)), `${pda.id}: ${transitionText(tr)}`);
        assert.ok(tr.read === '' || pda.input.includes(tr.read), `${pda.id}: lee ${tr.read}`);
      }
      assert.ok(pda.states.includes(pda.start) && pda.stack.includes(pda.bottom), pda.id);
    }
  });
});

describe('simulador en vivo', () => {
  const live = SLIDES.find((slide) => slide.live);

  test('los pasos dependen de la cadena: ejecución (aⁿbⁿ, paréntesis) o árbol (wwᴿ)', () => {
    assert.equal(stepCount(live, DEFAULT_LIVE), 7);
    assert.equal(stepCount(live, { pda: 'anbn', input: '' }), 2);
    assert.equal(stepCount(live, { pda: 'parens', input: '(())' }), 7);
    assert.equal(stepCount(live, { pda: 'wwr', input: '0110' }), 8);
    assert.deepEqual(stepNotes(live, { pda: 'wwr', input: '0110' }), treeNotes(wwr, '0110', 'final'));
  });

  test('solo acepta cadenas del alfabeto del PDA y del largo permitido', () => {
    assert.deepEqual(normalizeLive({ pda: 'anbn', input: 'abab' }), { pda: 'anbn', input: 'abab' });
    assert.deepEqual(normalizeLive({ pda: 'parens', input: '' }), { pda: 'parens', input: '' });
    for (const bad of [{ pda: 'anbn', input: 'abc' }, { pda: 'wwr', input: '0101010' }, { pda: 'nada', input: '' }, { pda: '__proto__', input: '' }, { pda: 'anbn', input: 3 }, null]) {
      assert.equal(normalizeLive(bad), null, JSON.stringify(bad));
    }
  });

  test('las cadenas más largas permitidas no explotan el árbol ni la pila', () => {
    for (const input of ['000000', '010010', '111111']) assert.ok(stepCount(live, { pda: 'wwr', input }) <= 12, input);
    assert.ok(stepCount(live, { pda: 'anbn', input: 'aaaaaaaaaa' }) <= 14);
  });
});
