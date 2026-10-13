// Datos destacados del ranking final (RF-RNK-03): mejor racha, respuesta correcta más rápida, mayor
// salto de puntos y objeto más usado (sin contar el Desafío). Los calcula el servidor al entrar al
// ranking final. Se dibujan como medallas de cartón, sin tarjetas ni emojis: el fuego con la racha,
// un cronómetro, una flecha que sube y el dibujo del objeto.
import { h } from './dom.js';
import { itemIcon, itemInfo } from './items.js';
import { streakFire, teamChip } from './widgets.js';

const seconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const points = (n) => n.toLocaleString('es-CO');
const roundName = (round) => (round === 6 ? 'la ronda final' : `la ronda ${round}`);

// Dibujos fijos (no llevan texto del servidor), con el contorno de tinta y la sombra dura del juego.
const ICONS = {
  stopwatch: '<svg class="icon" viewBox="0 0 64 64" aria-hidden="true"><g stroke="#1c1640" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">'
    + '<rect x="26" y="4" width="12" height="7" rx="2" fill="#ff4f8b"/><path d="M46 13 l5 -5" fill="none"/>'
    + '<circle cx="32" cy="39.5" r="22" fill="#1c1640"/><circle cx="32" cy="37" r="22" fill="#ffffff"/>'
    + '<path d="M32 37 V22 M32 37 L42 42" fill="none"/><circle cx="32" cy="37" r="3" fill="#1c1640"/>'
    + '<path d="M32 18 v3 M51 37 h-3 M32 56 v-3 M13 37 h3" fill="none" stroke-width="2.4"/></g></svg>',
  jump: '<svg class="icon" viewBox="0 0 64 64" aria-hidden="true"><g stroke="#1c1640" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">'
    + '<path transform="translate(0 2.5)" d="M8 50 L24 34 L33 42 L48 22 L41 20 L56 10 L54 28 L50 23 L35 46 L26 38 L13 55 Z" fill="#1c1640"/>'
    + '<path d="M8 50 L24 34 L33 42 L48 22 L41 20 L56 10 L54 28 L50 23 L35 46 L26 38 L13 55 Z" fill="#3ccf6e"/></g></svg>',
};

function icon(name) {
  const el = h('span', { class: 'medallion-icon' });
  el.innerHTML = ICONS[name];
  return el;
}

export function highlightCards(highlights, teams) {
  if (!highlights) return null;
  const team = (id) => teams.find((t) => t.id === id);
  const chips = (ids) => ids.map((id) => team(id)).filter(Boolean).map((t) => teamChip(t));
  const { bestStreak, fastestAnswer, biggestJump, topItem } = highlights;
  const medal = (tone, picture, label, value, who) => h('div', { class: 'highlight' },
    h('span', { class: `medallion ${tone}` }, picture),
    h('span', { class: 'highlight-label' }, label),
    h('strong', { class: 'highlight-value' }, value),
    h('span', { class: 'highlight-who' }, who));
  const cards = [
    bestStreak && medal('sun', streakFire(bestStreak.value), 'Mejor racha',
      `${bestStreak.value} ${bestStreak.value === 1 ? 'respuesta' : 'respuestas'} seguidas`, chips(bestStreak.teamIds)),
    fastestAnswer && medal('pink', icon('stopwatch'), 'Respuesta más rápida',
      `${seconds(fastestAnswer.t)} · pregunta ${fastestAnswer.question}`, chips([fastestAnswer.teamId])),
    biggestJump && medal('sky', icon('jump'), 'Mayor salto',
      `+${points(biggestJump.points)} pts en ${roundName(biggestJump.round)}`, chips(biggestJump.teamIds)),
    topItem && medal('mint', itemIcon(topItem.code), 'Objeto más usado',
      `${itemInfo(topItem.code).name} · ${topItem.count} ${topItem.count === 1 ? 'vez' : 'veces'}`, 'sin contar el Desafío'),
  ].filter(Boolean);
  return cards.length > 0 ? h('div', { class: 'highlights' }, cards) : null;
}
