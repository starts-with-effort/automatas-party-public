// Los PDA de la exposición. Las pruebas (tests/pda.test.js) comprueban el lenguaje de cada uno.
import { emptyToFinal, finalToEmpty, t } from './pda.js';

// {aⁿbⁿ | n ≥ 1}, por estado final y determinista: apila una A por cada a, saca una por cada b y,
// cuando vuelve a ver Z₀, pasa al estado final.
export const anbn = {
  id: 'anbn',
  name: 'aⁿbⁿ',
  states: ['q0', 'q1', 'q2'],
  input: ['a', 'b'],
  stack: ['A', 'Z0'],
  start: 'q0',
  bottom: 'Z0',
  final: ['q2'],
  transitions: [
    t('q0', 'a', 'Z0', 'q0', ['A', 'Z0']),
    t('q0', 'a', 'A', 'q0', ['A', 'A']),
    t('q0', 'b', 'A', 'q1', []),
    t('q1', 'b', 'A', 'q1', []),
    t('q1', '', 'Z0', 'q2', ['Z0']),
  ],
};

// {wwᴿ | w ∈ {0,1}*}, por estado final y no determinista: el ejemplo 6.2 de Hopcroft. q₀ apila lo
// que lee; en cualquier momento «adivina» que llegó a la mitad (ε hacia q₁); q₁ compara y saca; al
// ver Z₀ pasa a q₂.
export const wwr = {
  id: 'wwr',
  name: 'wwᴿ',
  states: ['q0', 'q1', 'q2'],
  input: ['0', '1'],
  stack: ['0', '1', 'Z0'],
  start: 'q0',
  bottom: 'Z0',
  final: ['q2'],
  transitions: [
    t('q0', '0', 'Z0', 'q0', ['0', 'Z0']),
    t('q0', '1', 'Z0', 'q0', ['1', 'Z0']),
    t('q0', '0', '0', 'q0', ['0', '0']),
    t('q0', '0', '1', 'q0', ['0', '1']),
    t('q0', '1', '0', 'q0', ['1', '0']),
    t('q0', '1', '1', 'q0', ['1', '1']),
    t('q0', '', 'Z0', 'q1', ['Z0']),
    t('q0', '', '0', 'q1', ['0']),
    t('q0', '', '1', 'q1', ['1']),
    t('q1', '0', '0', 'q1', []),
    t('q1', '1', '1', 'q1', []),
    t('q1', '', 'Z0', 'q2', ['Z0']),
  ],
};

// Paréntesis balanceados, por pila vacía y con un solo estado: apila una P por cada «(», saca una
// por cada «)» y, con Z₀ en el tope, puede vaciar la pila (ε) para aceptar. F no se usa.
export const parens = {
  id: 'parens',
  name: 'paréntesis',
  states: ['q'],
  input: ['(', ')'],
  stack: ['P', 'Z0'],
  start: 'q',
  bottom: 'Z0',
  final: [],
  transitions: [
    t('q', '(', 'Z0', 'q', ['P', 'Z0']),
    t('q', '(', 'P', 'q', ['P', 'P']),
    t('q', ')', 'P', 'q', []),
    t('q', '', 'Z0', 'q', []),
  ],
};

// P′: el de aⁿbⁿ con una transición más en q₂ que vacía la pila. N(P′) = {aⁿbⁿ} (con el original,
// N(P) = ∅ porque nunca saca Z₀).
export const anbnEmpty = {
  ...anbn,
  id: 'anbn-empty',
  name: 'aⁿbⁿ (P′)',
  transitions: [...anbn.transitions, t('q2', '', 'Z0', 'q2', [])],
};

// Las dos construcciones de 3.2, aplicadas a los ejemplos.
export const parensFinal = emptyToFinal(parens);
export const anbnStack = finalToEmpty(anbn);

// Respaldo «¿Qué falla sin X₀?»: un P_F que vacía su pila sin aceptar (al empezar con «b» saca Z₀).
// Acepta lo mismo que el de aⁿbⁿ, pero la construcción sin marcador aceptaría también «b».
export const leaky = {
  ...anbn,
  id: 'leaky',
  name: 'aⁿbⁿ con fuga',
  transitions: [...anbn.transitions, t('q0', 'b', 'Z0', 'q0', [])],
};
export const leakyNaive = finalToEmpty(leaky, { marker: false });
export const leakyStack = finalToEmpty(leaky);

export const EXAMPLES = { anbn, wwr, parens, anbnEmpty, parensFinal, anbnStack, leaky, leakyNaive, leakyStack };
