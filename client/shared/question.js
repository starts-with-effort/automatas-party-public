// Piezas de interfaz de las preguntas, comunes a jugador, proyector y host.
import { h } from './dom.js';
import { itemIcon } from './items.js';
import { signed } from './ui.js';
import { teamChip } from './widgets.js';

// Cada opción se distingue por color, letra y forma, no solo por color (RF-PRE-05, RNF-13).
// La C es amarilla y lleva texto oscuro; las demás, texto blanco.
export const OPTION_STYLES = [
  { letter: 'A', shape: '▲', color: '#e8384f', text: '#ffffff' },
  { letter: 'B', shape: '◆', color: '#2f6fed', text: '#ffffff' },
  { letter: 'C', shape: '●', color: '#ffc233', text: '#1c1640' },
  { letter: 'D', shape: '■', color: '#14955a', text: '#ffffff' },
];

export function optionBadge(index) {
  const { letter, shape } = OPTION_STYLES[index];
  return h('span', { class: 'option-badge', 'aria-hidden': 'true' }, `${shape} ${letter}`);
}

// Opción como botón (si recibe onClick) o como tarjeta.
// state: '' | 'waiting' | 'chosen' | 'dim' | 'correct' | 'wrong'
export function optionTile(index, text, { state = '', disabled = false, onClick = null, count = null } = {}) {
  const { letter, color, text: ink } = OPTION_STYLES[index];
  return h(onClick ? 'button' : 'div', {
    class: `option ${state}`.trim(),
    type: onClick ? 'button' : null,
    disabled: Boolean(onClick) && disabled,
    style: { '--option': color, '--option-text': ink },
    'aria-label': `Opción ${letter}: ${text}`,
    onClick,
  },
  optionBadge(index),
  h('span', { class: 'option-text' }, text),
  count !== null && h('span', { class: 'option-count', title: 'Equipos que la eligieron' }, count),
  state === 'correct' && h('span', { class: 'option-stamp', 'aria-hidden': 'true' }, '✓'));
}

export function optionsGrid(options, tileFor) {
  return h('div', { class: 'options-grid' }, options.map((text, index) => tileFor(index, text)));
}

export function statementBlock(statement) {
  return h('div', { class: 'statement' },
    statement.image && h('img', { src: `/assets/${statement.image}`, alt: 'Imagen de la pregunta' }),
    h('p', {}, statement.text));
}

export function difficultyChip({ difficulty, difficultyLabel, basePoints }) {
  return h('span', { class: `difficulty ${difficulty}` }, `${difficultyLabel} · ${basePoints} pts`);
}

export function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

// Racha de un equipo para el celular: "Racha 4". El multiplicador no se muestra a los jugadores
// (sigue en el cálculo, en el host y en los CSV).
export function streakText({ streak }) {
  return `Racha ${streak}`;
}

// Tabla de resultados de una pregunta: quién acertó, en cuánto tiempo y cuántos puntos (RF-PRE-09).
// La columna "Objetos" aparece si hubo Doble o nada, Segunda Vida o Chupa-Sangre.
export function resultsTable(teams, results) {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const rows = [...results].sort((a, b) => b.points - a.points || Number(b.correct) - Number(a.correct));
  const withItems = rows.some((row) => row.modifiers?.length || row.adjustments?.length || row.secondChance);
  const headers = ['Equipo', 'Respuesta', 'Tiempo', 'Puntos', 'Racha', ...(withItems ? ['Objetos'] : [])];
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'results' },
      h('thead', {}, h('tr', {}, headers.map((text) => h('th', {}, text)))),
      h('tbody', {}, rows.map((row) => h('tr', {},
        h('td', {}, teamChip(byId.get(row.teamId))),
        h('td', { class: row.correct ? 'good' : row.answered ? 'bad' : 'muted' },
          row.answered ? [optionBadge(row.option), row.correct ? ' ✓' : ' ✗'] : 'Sin respuesta'),
        h('td', { class: 'mono' }, row.t === null ? '—' : formatSeconds(row.t)),
        h('td', { class: 'mono' }, row.points > 0 ? `+${row.points}` : '0'),
        h('td', { class: 'mono' }, row.multiplier > 1 ? `${row.streak} (×${row.multiplier.toFixed(2)})` : row.streak),
        withItems && h('td', {}, itemNotes(row, byId)),
      )))));
}

export function itemNotes(row, byId) {
  const notes = [];
  if (row.modifiers?.includes('DN') && row.correct) notes.push(h('span', {}, itemIcon('DN'), ' ×2'));
  if (row.secondChance) notes.push(h('span', {}, itemIcon('SV')));
  for (const adjustment of row.adjustments ?? []) {
    const other = adjustment.teamId ? ` (${byId.get(adjustment.teamId)?.name ?? adjustment.teamId})` : '';
    notes.push(h('span', {}, itemIcon(adjustment.code), ` ${signed(adjustment.points)}${other}`));
  }
  return h('span', { class: 'row' }, notes);
}

// Cuántos equipos eligieron cada opción (para el proyector al cerrar la pregunta).
export function optionCounts(results) {
  const counts = [0, 0, 0, 0];
  for (const row of results) if (row.answered) counts[row.option] += 1;
  return counts;
}
