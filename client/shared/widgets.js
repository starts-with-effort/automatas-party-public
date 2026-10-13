// Piezas de interfaz comunes a jugador, proyector y host.
import { h } from './dom.js';

export function teamDot(team) {
  return h('span', { class: 'team-dot', style: { '--team': team.color }, 'aria-hidden': 'true' });
}

export function teamChip(team, suffix = '') {
  return h('span', { class: 'team-chip' }, teamDot(team), team.name, suffix);
}

export function occupancy(team) {
  return Number(team.slots.A !== null) + Number(team.slots.B !== null);
}

// Un círculo por puesto: lleno si está ocupado, tenue si ese dispositivo está desconectado.
export function slotDots(team) {
  return h('span', { class: 'slots', style: { '--team': team.color }, 'aria-label': `${occupancy(team)} de 2` },
    ['A', 'B'].map((slot) => {
      const device = team.slots[slot];
      const state = device === null ? '' : device.connected ? ' filled' : ' filled away';
      return h('span', { class: `slot${state}` });
    }));
}

// Cuenta regresiva que se actualiza sola (startCountdowns en ui.js). En las preguntas corre
// desde answersAt: durante la lectura muestra el tiempo completo para responder.
export function countdown(phase, room, className = 'countdown') {
  if (phase.endsAt === null) return null;
  return h('span', {
    class: `${className} mono`,
    'aria-label': 'Tiempo restante',
    dataset: {
      endsAt: phase.endsAt,
      startsAt: phase.answersAt ?? phase.startsAt,
      resumeAt: phase.resumeAt ?? 0,
      pausedAt: room.paused?.at ?? '',
    },
  });
}

// "Respondieron 3 de 6" con una marca por equipo, rellena si ya lo hizo.
export function progressDots(done, total, label) {
  return h('div', { class: 'progress-dots' },
    h('span', {}, `${label} ${done} de ${total}`),
    h('span', { class: 'dots', 'aria-hidden': 'true' },
      Array.from({ length: total }, (_, i) => h('i', { class: i < done ? 'on' : null }))));
}

// Estrella de fragmentos (server/domain/stars.js): una estrella de cinco puntas, blanca vacía, que
// pinta de amarillo una punta entera (desde el centro) por cada fragmento; con los cinco queda toda
// amarilla. Solo el contorno de tinta y la sombra dura, sin rayas internas. Al lado, las estrellas
// completas (una estrellita amarilla con «×N»). El SVG se arma solo con números, nunca con texto del
// servidor.
const point = (radius, angle) => {
  const a = (angle * Math.PI) / 180;
  return `${(50 + radius * Math.cos(a)).toFixed(2)},${(54 + radius * Math.sin(a)).toFixed(2)}`;
};

function starSvg(fragments, tips) {
  const R = 46;
  const r = R * 0.382; // estrella regular
  const outer = Array.from({ length: tips }, (_, k) => point(R, -90 + (k * 360) / tips));
  const inner = Array.from({ length: tips }, (_, k) => point(r, -90 + 180 / tips + (k * 360) / tips));
  const outline = outer.flatMap((o, k) => [o, inner[k]]).join(' ');
  const arms = outer.map((o, k) => `<polygon class="arm${k < fragments ? ' on' : ''}" points="50,54 ${inner[(k - 1 + tips) % tips]} ${o} ${inner[k]}"/>`);
  return `<svg viewBox="-2 -2 104 110"><polygon class="shade" points="${outline}" transform="translate(0 4.5)"/>${arms.join('')}<polygon class="outline" points="${outline}"/></svg>`;
}

export function starMeter({ fragments = 0, stars = 0 }, tips = 5) {
  const svg = h('span', { class: 'star-svg', 'aria-hidden': 'true' });
  svg.innerHTML = starSvg(Math.min(Number(fragments) || 0, tips), tips);
  const badge = stars > 0 && h('span', { class: 'star-badge', title: `${stars} ${stars === 1 ? 'estrella completa' : 'estrellas completas'}` });
  if (badge) {
    badge.innerHTML = `<span class="star-svg mini" aria-hidden="true">${starSvg(tips, tips)}</span>`;
    badge.append(`×${Number(stars)}`);
  }
  return h('span', {
    class: 'star-meter',
    title: `${fragments} de ${tips} fragmentos · ${stars} ${stars === 1 ? 'estrella' : 'estrellas'}`,
  }, svg, badge);
}

// Racha en un fuego con el número adentro (el dibujo del objeto +Racha, sin el «+»). Con racha 0
// queda gris. Solo números en el SVG.
export function streakFire(streak) {
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  const size = String(n).length > 1 ? 15 : 19;
  const el = h('span', { class: `streak-fire${n === 0 ? ' cold' : ''}`, title: `Racha ${n}`, 'aria-label': `Racha ${n}` });
  el.innerHTML = '<svg viewBox="10 4 40 57" aria-hidden="true"><g class="flame">'
    + '<path class="shade" transform="translate(0 2.5)" d="M30 7 C35 17 47 22 47 38 C47 50 39 57 30 57 C21 57 13 50 13 38 C13 30 17 25 21 22 C21 28 23 31 26 32 C24 22 25 13 30 7 Z"/>'
    + '<path class="outer" d="M30 7 C35 17 47 22 47 38 C47 50 39 57 30 57 C21 57 13 50 13 38 C13 30 17 25 21 22 C21 28 23 31 26 32 C24 22 25 13 30 7 Z"/>'
    + '<path class="inner" d="M30 24 C35 31 42.5 36 42.5 45 C42.5 52 36.5 56 30 56 C23.5 56 17.5 52 17.5 45 C17.5 37 25 32 30 24 Z"/></g>'
    + `<text x="30" y="${size > 16 ? 52.5 : 51.2}" text-anchor="middle" font-size="${size}">${n}</text></svg>`;
  return el;
}

export function deltaBadge(delta) {
  if (delta === null || delta === undefined) return null;
  if (delta > 0) return h('span', { class: 'delta-up', title: `Subió ${delta}` }, `▲ ${delta}`);
  if (delta < 0) return h('span', { class: 'delta-down', title: `Bajó ${-delta}` }, `▼ ${-delta}`);
  return h('span', { class: 'muted', title: 'Sin cambio' }, '=');
}

export function rankingTable(teams, rows, tips = 5) {
  const byId = new Map(teams.map((team) => [team.id, team]));
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'ranking' },
      h('thead', {}, h('tr', {}, ['#', 'Equipo', 'Puntos', 'Racha', 'Estrella', ''].map((text) => h('th', {}, text)))),
      h('tbody', {}, rows.map((row) => h('tr', {},
        h('td', { class: 'pos' }, `${row.position}.º`),
        h('td', {}, teamChip(byId.get(row.teamId))),
        h('td', { class: 'mono' }, row.score),
        h('td', {}, streakFire(row.streak)),
        h('td', {}, starMeter(byId.get(row.teamId), tips)),
        h('td', {}, deltaBadge(row.delta)),
      )))));
}

export function pauseOverlay(room) {
  if (!room.paused) return null;
  const detail = room.recovered
    ? 'El servidor se reinició. El host reanudará la partida en un momento.'
    : 'El host pausó la partida.';
  return h('div', { class: 'overlay', role: 'status' },
    h('div', { class: 'card stack center' }, h('h2', {}, 'Partida en pausa'), h('p', { class: 'muted' }, detail)));
}
