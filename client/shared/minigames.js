// Minijuegos en la interfaz: ruleta, cuenta 3-2-1, Alimenta el Autómata (Clicker), Memoria y resultados
// (secciones 4.7 y 4.8).
// Todo lo que se anima usa el reloj sincronizado: las pantallas muestran lo mismo a la vez.
import { minigameDemo } from './demos.js';
import { h, replace } from './dom.js';
import { send, toast } from './ui.js';
import { errorMessage } from './errors.js';
import { trazaReplay } from './traza.js';
import { starMeter, teamChip } from './widgets.js';

const SINGULAR = { parejas: 'pareja', clics: 'clic' };

// "1 pareja", "3 parejas", "1.034 clics".
const amount = (n, metric) => `${n.toLocaleString('es-CO')} ${n === 1 ? SINGULAR[metric] ?? metric : metric}`;

// Repite fn en cada cuadro mientras el elemento siga en la página.
function animate(el, fn) {
  let attached = false;
  const frame = () => {
    if (el.isConnected) attached = true;
    else if (attached) return;
    if (fn() !== false) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ ruleta

// Ruleta vertical (RF-RUL-01/03): los nombres bajan y frenan hasta el minijuego de la ronda.
export function rouletteReel({ reel, targetIndex, spinMs }, startsAt, clock) {
  const items = reel.map((name) => h('li', {}, name));
  const list = h('ul', { class: 'reel-list' }, items);
  const el = h('div', { class: 'reel', 'aria-label': `Ruleta: ${reel[targetIndex]}` }, list);
  let active = -1;
  animate(el, () => {
    const t = Math.min(1, Math.max(0, (clock.now() - startsAt) / spinMs));
    const position = (1 - (1 - t) ** 3) * targetIndex; // frena al final
    // La fila `position` queda centrada en la ventana, con la altura real de cada fila.
    const row = items[0].offsetHeight || 1;
    list.style.transform = `translateY(${el.clientHeight / 2 - (position + 0.5) * row}px)`;
    const nearest = Math.round(position);
    if (nearest !== active) {
      items[active]?.classList.remove('active');
      items[nearest].classList.add('active');
      active = nearest;
    }
    el.classList.toggle('stopped', t >= 1);
    return t < 1 || !el.isConnected; // sigue hasta detenerse ya dibujada en la página
  });
  return el;
}

// ------------------------------------------------------------------ comunes

// "3, 2, 1, ¡Ya!" sobre la pantalla hasta playStartsAt (RF-MJ-01).
export function countdownOverlay(playStartsAt, clock) {
  const label = h('span', {});
  const el = h('div', { class: 'go-overlay', 'aria-live': 'assertive' }, label);
  animate(el, () => {
    const left = playStartsAt - clock.now();
    if (left <= -700) {
      el.hidden = true;
      return false;
    }
    label.textContent = left > 0 ? String(Math.ceil(left / 1000)) : '¡Ya!';
    el.classList.toggle('started', left <= 0); // con el "¡Ya!" el juego ya empezó: deja pasar los toques
    return true;
  });
  return el;
}

export const groupOf = (groups, teamId) => groups.findIndex((group) => group.includes(teamId));

export function groupLabel(group, teams) {
  return h('span', { class: 'row' }, group.map((teamId) => teamChip(teams.find((t) => t.id === teamId))));
}

// Clicker: al equipo que queda sin pareja el servidor le cuenta clics adicionales
// (server/minigames/clicker.js); las pantallas solo lo avisan, sin decir cuántos.
const EXTRA_NOTE = 'clics adicionales por jugar solo';
const hasExtra = (minigame, groups, group) => minigame === 'clicker' && group.length === 1 && groups.some((other) => other.length > 1);
// «juega solo» del diagrama de grupos; en el Clicker, con el aviso debajo.
const aloneLabel = (minigame, groups, group) => h('span', { class: 'pair-alone' }, 'juega solo',
  hasExtra(minigame, groups, group) && h('small', {}, 'con clics adicionales'));
// Etiqueta del grupo en los tableros del Clicker (proyector y host); el que juega solo, con el aviso.
function clickerLabel(groups, group, teams) {
  const label = groupLabel(group, teams);
  if (hasExtra('clicker', groups, group)) label.append(h('small', { class: 'extra-note' }, EXTRA_NOTE));
  return label;
}

const formatPoints = (n) => n.toLocaleString('es-CO');
const formatFactor = (n) => n.toFixed(2).replace('.', ',');

// ------------------------------------------------------------------ instrucciones (rediseño, fase 5)

// Tipo de minijuego según cómo se arman los grupos: cada equipo solo, de a dos o contra el jefe.
const KINDS = {
  teams: { cls: 'solo', label: 'Solitario', side: 'Cada equipo juega solo' },
  pairs: { cls: 'duo', label: 'En equipos', side: 'Grupos' },
  roles: { cls: 'boss', label: 'Contra el jefe', side: 'Todos contra el jefe' },
};
const kindOf = (grouping) => KINDS[grouping] ?? KINDS.teams;
const findTeam = (teams, id) => teams.find((t) => t.id === id) ?? { id, name: id, color: '#888888' };

export function kindBadge(grouping) {
  const kind = kindOf(grouping);
  return h('span', { class: `kind-badge ${kind.cls}` }, kind.label);
}

// Círculo del equipo; el propio, con el peón blanco.
function teamBall(team, mine = false, extra = '') {
  return h('i', { class: `team-ball${mine ? ' me' : ''}${extra}`, style: { '--team': team.color }, 'aria-hidden': 'true' });
}

const LANE = '<svg viewBox="0 0 40 26" aria-hidden="true"><path d="M3 4 H37 V22 H3 Z" fill="none" stroke="#1c1640" stroke-width="2.5" stroke-linejoin="round"/><path d="M3 13 H14 V8 H24 V18 H33" fill="none" stroke="#1c1640" stroke-width="2.5" stroke-dasharray="3 3"/></svg>';
const CROWN = '<svg class="crown" viewBox="0 0 40 26" aria-hidden="true"><path d="M3 23 L6 6 L14 15 L20 3 L26 15 L34 6 L37 23 Z" fill="#ffc93c" stroke="#1c1640" stroke-width="3" stroke-linejoin="round"/></svg>';

// Solitario: cada equipo en su propio recuadro punteado.
export function soloDiagram(groups, teams, myTeamId = null) {
  return h('div', { class: 'solo-diagram' }, groups.flat().map((id) => {
    const team = findTeam(teams, id);
    const lane = h('span', { class: 'solo-lane' });
    lane.innerHTML = LANE;
    return h('div', { class: `solo-cell${id === myTeamId ? ' mine' : ''}` }, teamBall(team, id === myTeamId), h('span', { class: 'who-name' }, team.name), lane);
  }));
}

// En equipos: cada grupo en una pieza amarilla, dos círculos unidos por una transición de ida y
// vuelta. only: solo el grupo de ese equipo (el celular).
export function pairsDiagram(groups, teams, myTeamId = null, { only = null, minigame = null } = {}) {
  const who = (id) => h('span', { class: 'pair-who' }, teamBall(findTeam(teams, id), id === myTeamId), h('span', { class: 'who-name' }, findTeam(teams, id).name));
  return h('div', { class: 'pairs-diagram' }, groups.map((group, index) => (only && !group.includes(only) ? null
    : h('div', { class: `pair-piece${group.includes(myTeamId) ? ' mine' : ''}` },
      h('span', { class: 'pair-label' }, `Grupo ${index + 1}`),
      group.length === 1
        ? [who(group[0]), aloneLabel(minigame, groups, group)]
        : [who(group[0]), h('i', { class: 'pair-link', 'aria-hidden': 'true' }), who(group[1])]))));
}

// Contra el jefe: el jefe (o los dos) con su corona al centro y los retadores alrededor, con flechas
// punteadas hacia el jefe. Coordenadas en un lienzo de 330 × 270 que escala con el recuadro.
export function bossDiagram(groups, teams, myTeamId = null) {
  const [bosses = [], challengers = []] = groups;
  const cx = 165;
  const cy = 140;
  // Con dos jefes van lado a lado, más chicos y con solo el nombre (la corona ya dice que son jefes).
  const bossAt = bosses.map((id, i) => [id, cx + (bosses.length === 1 ? 0 : (i - (bosses.length - 1) / 2) * 112), cy]);
  const several = bosses.length > 1;
  const around = challengers.map((id, i) => {
    const a = ((-90 + (180 / Math.max(challengers.length, 1)) + (i * 360) / Math.max(challengers.length, 1)) * Math.PI) / 180;
    return [id, cx + 128 * Math.cos(a), cy + 100 * Math.sin(a)];
  });
  const svg = h('span', { class: 'boss-arrows' });
  const arrows = around.map(([, x, y]) => {
    const [, bx, by] = bossAt.reduce((best, b) => (Math.hypot(b[1] - x, b[2] - y) < Math.hypot(best[1] - x, best[2] - y) ? b : best), bossAt[0] ?? [null, cx, cy]);
    const d = Math.hypot(bx - x, by - y) || 1;
    const ux = (bx - x) / d;
    const uy = (by - y) / d;
    const reach = several ? 38 : 46;
    return `<line x1="${(x + ux * 24).toFixed(1)}" y1="${(y + uy * 24).toFixed(1)}" x2="${(bx - ux * reach).toFixed(1)}" y2="${(by - uy * reach).toFixed(1)}" stroke="#1c1640" stroke-width="3" stroke-dasharray="6 5" marker-end="url(#boss-head)"/>`;
  });
  svg.innerHTML = `<svg viewBox="0 0 330 270" aria-hidden="true"><defs><marker id="boss-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="#1c1640"/></marker></defs>${arrows.join('')}</svg>`;
  const place = (x, y) => ({ left: `${(100 * x) / 330}%`, top: `${(100 * y) / 270}%` });
  return h('div', { class: 'boss-diagram' }, svg,
    bossAt.map(([id, x, y]) => {
      const ball = teamBall(findTeam(teams, id), id === myTeamId, several ? ' boss two' : ' boss');
      ball.insertAdjacentHTML('beforeend', CROWN);
      return h('span', { class: 'boss-who is-boss', style: place(x, y) }, ball, h('span', { class: 'who-name' }, several ? findTeam(teams, id).name : `Jefe · ${findTeam(teams, id).name}`));
    }),
    around.map(([id, x, y]) => h('span', { class: `boss-who${y < cy ? ' above' : ''}`, style: place(x, y) },
      teamBall(findTeam(teams, id), id === myTeamId), h('span', { class: 'who-name' }, findTeam(teams, id).name))));
}

function diagramFor(grouping, groups, teams, myTeamId, options) {
  if (groups.length === 0) return null;
  if (grouping === 'pairs') return pairsDiagram(groups, teams, myTeamId, options);
  if (grouping === 'roles') return bossDiagram(groups, teams, myTeamId);
  return soloDiagram(groups, teams, myTeamId);
}

// La demo se reutiliza mientras dura la fase, para que las vistas nuevas no la reinicien.
let demoCache = { key: null, el: null };
function demoFor(minigame, teams, key) {
  if (demoCache.key !== key) demoCache = { key, el: minigameDemo(minigame, teams.map((t) => t.color)) };
  return demoCache.el;
}

// Instrucciones (RF-MJ-01): la demo en bucle, las instrucciones cortas y los equipos dibujados según
// el tipo del minijuego. Sin el premio ni el texto del fragmento (se ven en el resultado y en el
// ranking). key: algo que identifique la fase (su seq), para no reiniciar la demo. El host recibe
// una versión en texto (host: true).
export function introBody({ minigame, grouping, instructions, groups }, teams, myTeamId = null, { key = minigame, host = false } = {}) {
  if (host) {
    return h('section', { class: 'stack' },
      h('p', {}, kindOf(grouping).label, ' · ', instructions),
      groups.length > 0 && h('div', { class: 'stack' },
        h('p', { class: 'eyebrow' }, 'Grupos'),
        groups.map((group, index) => h('div', { class: 'row' }, h('strong', {}, `${index + 1}.`), groupLabel(group, teams)))));
  }
  const kind = kindOf(grouping);
  if (myTeamId === null) {
    return h('section', { class: 'intro' },
      h('div', { class: 'intro-main' }, kindBadge(grouping), demoFor(minigame, teams, key), h('p', { class: 'intro-text' }, instructions)),
      groups.length > 0 && h('div', { class: 'intro-teams' }, h('p', { class: 'eyebrow' }, kind.side), diagramFor(grouping, groups, teams, null, { minigame })));
  }
  return h('section', { class: 'stack intro-phone' },
    kindBadge(grouping),
    demoFor(minigame, teams, key),
    h('p', { class: 'intro-text' }, instructions),
    groups.length > 0 && h('p', { class: 'eyebrow' }, grouping === 'pairs' ? 'Tu grupo' : kind.side),
    diagramFor(grouping, groups, teams, myTeamId, { only: myTeamId, minigame }));
}

// ------------------------------------------------------------------ Formando grupos (rediseño, fase 5)

// Antes de las instrucciones de la Memoria y el Clicker. Proyector: los marcos de los grupos aparecen
// uno tras otro y sus dos círculos bajan juntos desde arriba hasta su lugar; al llegar, la línea del
// grupo se dibuja a la altura de los círculos. Celular: los círculos se mezclan y queda, en grande,
// el equipo con el que juega. Todo sigue el reloj sincronizado (todas las pantallas lo ven a la vez)
// y se monta una vez por fase.
let groupsCache = { key: null, el: null };
export function groupsBody({ groups, name, minigame }, teams, { startsAt, clock, myTeamId = null }) {
  const key = `${startsAt}:${myTeamId}`;
  if (groupsCache.key !== key) groupsCache = { key, el: (myTeamId ? phoneGroups : screenGroups)(groups, teams, minigame, myTeamId, name) };
  const { el, animations } = groupsCache.el;
  if (!el.dataset.synced) {
    el.dataset.synced = '1';
    const elapsed = Math.max(0, clock.now() - startsAt);
    for (const animation of animations) animation.currentTime = elapsed;
  }
  return el;
}

const EASE_BACK = 'cubic-bezier(.34,1.56,.64,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function screenGroups(groups, teams, minigame) {
  const animations = [];
  const token = (id) => h('span', { class: 'drop-token' }, teamBall(findTeam(teams, id)), h('span', { class: 'who-name' }, findTeam(teams, id).name));
  const frames = groups.map((group, index) => {
    const tokens = group.map(token);
    const link = group.length > 1 ? h('i', { class: 'pair-link' }) : aloneLabel(minigame, groups, group);
    const frame = h('div', { class: 'drop-frame' },
      h('span', { class: 'pair-label' }, `Grupo ${index + 1}`),
      h('div', { class: 'drop-pair' }, tokens[0], link, tokens[1]));
    if (!reduced()) {
      const base = 250 + index * 700;
      animations.push(frame.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: base, fill: 'backwards', easing: EASE_BACK }));
      tokens.forEach((tok, k) => animations.push(tok.animate([
        { transform: 'translateY(-110vh)' },
        { transform: 'translateY(6%)', offset: 0.82 },
        { transform: 'none' },
      ], { duration: 1150, delay: base + 250 + k * 90, fill: 'backwards', easing: 'cubic-bezier(.45,0,.55,1)' })));
      if (group.length > 1) animations.push(link.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 380, delay: base + 1450, fill: 'backwards', easing: 'ease-out' }));
    }
    return frame;
  });
  return { el: h('div', { class: 'groups-drop', style: { gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, minmax(0, 1fr))` } }, frames), animations };
}

function phoneGroups(groups, teams, minigame, myTeamId, name) {
  const animations = [];
  const index = groupOf(groups, myTeamId);
  const partner = (groups[index] ?? []).find((id) => id !== myTeamId) ?? null;
  const balls = teams.map((team) => teamBall(team, team.id === myTeamId));
  const row = h('div', { class: 'shuffle-row', 'aria-hidden': 'true' }, balls);
  const reveal = partner
    ? h('div', { class: 'partner' }, teamBall(findTeam(teams, partner), false, ' big'),
      h('strong', { class: 'partner-name' }, findTeam(teams, partner).name),
      h('span', { class: 'muted' }, `${name} · Grupo ${index + 1}`))
    : h('div', { class: 'partner' }, h('strong', { class: 'partner-name' }, 'Tu equipo juega solo esta vez'),
      hasExtra(minigame, groups, groups[index] ?? []) && h('span', { class: 'muted' }, 'Por jugar solo, tienen clics adicionales'));
  if (reduced()) {
    row.hidden = true;
  } else {
    balls.forEach((ball, i) => {
      const dx = (k) => ((i * 7 + k * 5) % 5 - 2) * 26;
      animations.push(ball.animate([
        { transform: 'none' },
        { transform: `translate(${dx(1)}px, -18px)` },
        { transform: `translate(${dx(2)}px, 0)` },
        { transform: `translate(${dx(3)}px, -18px)` },
        { transform: `translate(${dx(4)}px, 0)` },
        { transform: 'none' },
      ], { duration: 2400, easing: 'ease-in-out' }));
    });
    animations.push(row.animate([{ opacity: 1 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }], { duration: 2800, fill: 'forwards' }));
    animations.push(reveal.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 2700, fill: 'backwards', easing: EASE_BACK }));
  }
  return {
    el: h('div', { class: 'groups-phone' }, h('p', { class: 'hint' }, partner ? 'Tu equipo juega con…' : 'Formando grupos…'), row, reveal),
    animations,
  };
}

// Resultado del minijuego (rediseño, fase 7). Proyector: solo el ganador (equipo o grupo), al centro
// y sin recuadros: sus nombres, los puntos que ganó cada equipo (ya con la compensación, sin el
// «×1,20») y su desempeño. Celular: el veredicto, los puntos, el desempeño de su equipo o grupo y,
// si ganó, el fragmento; si no ganó, quién ganó. Sin tarjetas, sin lista y sin la compensación.
// El ganador es el que ya decide el servidor: el grupo ganador (Memoria, Clicker), el 1.º en aceptar
// (Traza a ciegas), el equipo que se llevó el fragmento (Flappy: más jugadores en la meta) o el bando
// ganador de la Arena (el jefe si resiste; si no, los retadores que le hicieron daño).
const WIN_LABEL = { memoria: 'Ganó el grupo', clicker: 'Ganó el grupo', traza: 'Primero en aceptar', flappy: 'Más pájaros en la meta' };

function championsOf({ minigame, groups, fragments = [] }) {
  if (groups.some((group) => group.rank !== undefined)) return groups.filter((group) => group.rank === 1);
  if (minigame === 'flappy') return groups.filter((group) => fragments.some((f) => group.teamIds.includes(f.teamId)));
  return groups.filter((group) => group.winner);
}

// Desempeño de un grupo en una línea: «516 clics», «1.º · 18,4 s · 1.er intento», «Llegaron 2 de 2»… short
// (el proyector) quita lo que ya dice la etiqueta: el puesto de la Traza y el «Jefe · … · resistió».
// extra: el grupo sumó con clics adicionales (el equipo sin pareja del Clicker).
function performance(group, metric, { short = false, extra = false } = {}) {
  let text = group.label?.replace(/(\d)\.(\d)/g, '$1,$2') ?? amount(group.score, metric); // «3.6 s» → «3,6 s»
  if (short) text = text.replace(/^\d+\.º · /, '').replace(/^Jefe · /, '').replace(/ · (resistió|derribado)$/, '');
  return group.teamIds.length > 1 ? [text, 'entre los dos equipos'] : [text, extra ? 'con los adicionales por jugar solo' : null];
}

export function resultBody(data, teams, myTeamId = null, tips = 5, { host = false } = {}) {
  if (host) return resultDetail(data, teams, null, tips);
  const { minigame, metric, groups, awards, headline, duel = null, fragments = [] } = data;
  const teamOf = (teamId) => teams.find((t) => t.id === teamId) ?? { id: teamId, name: teamId, color: '#888' };
  const pointsOf = (teamId) => awards.find((award) => award.teamId === teamId)?.points ?? 0;
  const champions = championsOf(data);
  const championIds = champions.flatMap((group) => group.teamIds);
  const boss = minigame === 'arena' && champions.some((group) => /^Jefe/.test(group.label ?? ''));
  const label = minigame === 'arena' ? headline ?? 'Ganó' : WIN_LABEL[minigame] ?? 'Ganó';
  const tie = duel && h('p', { class: 'win-tie' }, 'Hubo empate: lo decidió un Duelo.');
  const extraOf = (group) => hasExtra(minigame, groups.map((other) => other.teamIds), group.teamIds);

  if (myTeamId === null) {
    // Traza a ciegas: al lado del ganador, el repaso de la traza que acepta la cadena.
    const withReplay = (section) => (minigame === 'traza' && data.replay
      ? h('div', { class: 'win-split' }, section, trazaReplay(data.replay))
      : section);
    if (champions.length === 0) {
      return withReplay(h('section', { class: 'win' }, h('p', { class: 'win-none' }, minigame === 'flappy' ? 'Nadie llegó a la meta.' : 'Nadie sumó: no hay premio.')));
    }
    const many = championIds.length > 3;
    const shared = champions.length === 1 && champions[0].teamIds.length > 1;
    const champ = (teamId, group) => {
      const ball = h('i', { class: 'win-ball', style: { '--team': teamOf(teamId).color } });
      if (boss) ball.insertAdjacentHTML('beforeend', CROWN);
      return h('div', { class: `champ${boss ? ' crowned' : ''}` }, ball,
        h('span', { class: 'champ-name' }, teamOf(teamId).name),
        h('span', { class: 'champ-points' }, `+${formatPoints(pointsOf(teamId))}`),
        !shared && champions.length > 1 && h('span', { class: 'champ-perf' }, performance(group, metric, { short: true })[0]));
    };
    const cells = champions.flatMap((group) => group.teamIds.map((teamId, i) => [i > 0 && shared && h('span', { class: 'champ-plus' }, '+'), champ(teamId, group)]));
    const [perf, sub] = champions.length === 1 ? performance(champions[0], metric, { short: true, extra: extraOf(champions[0]) }) : [null, null];
    return withReplay(h('section', { class: 'win' },
      h('span', { class: 'win-label' }, label),
      h('div', { class: `champs${many ? ' many' : ''}` }, cells),
      perf && h('div', { class: 'win-perf' }, perf, sub && h('small', {}, sub)),
      tie));
  }

  // Celular.
  const mine = groups.find((group) => group.teamIds.includes(myTeamId));
  const won = championIds.includes(myTeamId);
  const points = pointsOf(myTeamId);
  const solo = groups.every((group) => group.teamIds.length === 1);
  const verdict = won ? `¡Tu ${solo ? 'equipo' : 'grupo'} ganó!` : points > 0 ? '¡Sumaron puntos!' : 'Esta vez no';
  const myFragment = fragments.some((f) => f.teamId === myTeamId);
  const [myPerf, mySub] = mine ? performance(mine, metric, { extra: extraOf(mine) }) : [null, null];
  return h('section', { class: 'win-phone' },
    h('span', { class: `win-verdict ${won || points > 0 ? 'good' : 'neutral'}` }, verdict),
    h('span', { class: 'win-points' }, `+${formatPoints(points)}`),
    myPerf && h('span', { class: 'win-line' }, myPerf, mySub && ` ${mySub}`),
    myFragment && h('span', { class: 'win-fragment' }, starMeter(teamOf(myTeamId), tips), '+1 fragmento'),
    !won && champions.length > 0 && h('div', { class: 'win-others' },
      h('span', {}, champions.length === 1 && champions[0].teamIds.length === 1 ? 'Ganó' : 'Ganaron'),
      h('span', { class: 'win-names' }, championIds.map((id) => h('span', { style: { '--team': teamOf(id).color } }, h('i', {}), teamOf(id).name))),
      champions.length === 1 && h('span', {}, performance(champions[0], metric, { extra: extraOf(champions[0]) }).filter(Boolean).join(' '))),
    tie);
}

// Host: el detalle completo de siempre, con la compensación de cada equipo.
function resultDetail(data, teams, myTeamId = null, tips = 5) {
  const { metric, groups, awards, headline, everyoneScores = false, fragments = [], duel = null } = data;
  const ranked = groups.some((group) => group.rank !== undefined);
  const order = [...groups].sort((a, b) => (ranked ? (a.rank ?? 1e9) - (b.rank ?? 1e9) : b.score - a.score));
  const awardOf = (teamId) => awards.find((award) => award.teamId === teamId) ?? null;
  const fragmentOf = (teamId) => fragments.find((fragment) => fragment.teamId === teamId) ?? null;
  const teamOf = (teamId) => teams.find((t) => t.id === teamId) ?? { id: teamId, name: teamId, color: '#888' };
  const mine = myTeamId ? awardOf(myTeamId) : null;
  const myFragment = myTeamId ? fragmentOf(myTeamId) : null;
  const solo = groups.every((group) => group.teamIds.length === 1);
  const won = everyoneScores ? groups.some((group) => group.winner && group.teamIds.includes(myTeamId)) : Boolean(mine);
  const verdict = won ? `¡Tu ${solo ? 'equipo' : 'grupo'} ganó!` : mine?.points > 0 ? '¡Sumaron puntos!' : 'Esta vez no';
  const teamResult = (teamId) => {
    const award = awardOf(teamId);
    return h('span', { class: 'team-result' },
      teamChip(teamOf(teamId)),
      award?.points > 0 && h('strong', { class: 'mono' }, `+${formatPoints(award.points)}`),
      award?.catchUp > 1 && h('small', { class: 'muted' }, `×${formatFactor(award.catchUp)}`),
      fragmentOf(teamId) && h('span', { class: 'fragment-tag', title: 'Fragmento de estrella' }, '★'));
  };
  return h('section', { class: 'stack' },
    headline && h('p', { class: 'eyebrow' }, headline),
    duel && h('p', { class: 'hint' }, `Hubo empate: lo desempató un Duelo y ganó ${duel.sides[duel.winner].map((id) => teamOf(id).name).join(' + ')}.`),
    myTeamId && h('div', { class: 'card stack center' },
      h('div', { class: `verdict ${mine || myFragment ? 'good' : 'neutral'}` }, verdict),
      h('div', { class: 'big-number' }, `+${formatPoints(mine?.points ?? 0)}`),
      mine?.catchUp > 1 && h('span', { class: 'pill' }, `Compensación por ir atrás: ×${formatFactor(mine.catchUp)}`),
      myFragment && h('div', { class: 'row fragment-won' },
        starMeter(teamOf(myTeamId), tips),
        h('strong', {}, '¡+1 fragmento de estrella!')),
      myFragment?.starsCompleted > 0 && h('p', { class: 'done' },
        `¡Completaron una estrella! +${formatPoints(myFragment.starPoints)} pts`)),
    h('ol', { class: 'plain-list' }, order.map((group) => h('li', { class: `result-row${group.winner ? ' winner' : ''}` },
      h('span', { class: 'row result-teams' }, group.teamIds.map(teamResult)),
      h('span', { class: 'mono' }, group.label ?? amount(group.score, metric), group.winner && ' · ganó')))),
    awards.length === 0 && fragments.length === 0 && h('p', { class: 'hint' }, 'Nadie sumó: no hay premio.'));
}

// ------------------------------------------------------------------ Alimenta el Autómata (Clicker, RF-MJ3)

// El Clicker con el tema del autómata: cada toque escribe un 0 o un 1 en la cinta y cada
// STATE_CLICKS clics del grupo el autómata pasa al estado siguiente (q0 → q1 → q2…). El celular y
// el proyector usan la misma cuenta, así que los dos celulares del grupo y la pantalla grande
// muestran la misma cinta y el mismo estado. Las animaciones no cambian el conteo.
const STATE_CLICKS = 50;
const FINAL_MS = 5000; // últimos segundos: el botón late en rojo y una cuenta grande marca 5, 4, 3…
const TAPE_CELLS = 9; // la última celda queda vacía, bajo el cabezal
const MAX_FLYING = 24; // símbolos volando a la vez: a 20 toques/s no se acumulan
const SUN = '#ffc93c';

const stateOf = (clicks) => Math.floor(clicks / STATE_CLICKS);
// Símbolo de la casilla `i` de la cinta: fijo por posición, para que todos vean la misma cinta.
const tapeSymbol = (i) => String(Math.imul(i + 1, 0x9e3779b1) >>> 31);
const stateLabel = (n) => h('span', {}, 'q', h('sub', {}, String(n)));
const stillMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rebote corto con WAAPI: no pisa el `translate` con el que el botón se hunde al tocarlo.
function bounce(el, from = 0.5) {
  el.animate([{ transform: `scale(${from})` }, { transform: 'scale(1.15)', offset: 0.5 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease-out' });
}

// Botón grande que cuenta con pointerdown (sin esperar al "click" ni hacer zoom) y envía los
// clics acumulados en lotes cada batchMs (RF-MJ3-02/03).
export function createClickerPad({ socket, clock, teamId }) {
  let pending = 0;
  let mine = 0;
  let phase = null;
  let paused = false;
  let groupTotal = 0;
  let shown = 0; // clics del grupo ya escritos en la cinta; nunca baja durante la fase
  let flying = 0;
  let second = null;
  const still = stillMotion();

  const groupCount = h('span', { class: 'big-number' }, '0');
  const myCount = h('span', { class: 'mono' }, '0');
  const cells = Array.from({ length: TAPE_CELLS }, () => h('span', { class: 'tape-cell' }));
  const track = h('div', { class: 'tape-track' }, cells);
  const head = h('span', { class: 'tape-head' });
  const state = h('span', { class: 'state-label' }, stateLabel(0));
  const button = h('button', { class: 'automaton-button', type: 'button', 'aria-label': 'Alimentar al autómata' }, state);
  const caption = h('p', { class: 'automaton-caption' }, 'Cada toque escribe un 0 o un 1');
  const finalCount = h('div', { class: 'final-count', 'aria-hidden': 'true' });
  const fx = h('div', { class: 'automaton-fx', 'aria-hidden': 'true' });
  const extraNote = h('p', { class: 'extra-note', hidden: true }, `Con ${EXTRA_NOTE}`);
  const el = h('section', { class: 'automaton' },
    h('div', { class: 'automaton-count' }, h('p', { class: 'eyebrow' }, 'Clics de tu grupo'), groupCount, extraNote),
    h('div', { class: 'tape' }, h('div', { class: 'tape-window' }, track), head),
    h('div', { class: 'automaton-stage' }, button),
    caption,
    h('p', { class: 'muted' }, 'Tus toques: ', myCount),
    finalCount, fx);

  // La cinta muestra las últimas casillas escritas y deja vacía la del cabezal.
  const drawTape = (total) => {
    const start = Math.max(0, total - (TAPE_CELLS - 1));
    cells.forEach((cell, i) => {
      const written = start + i < total;
      cell.textContent = written ? tapeSymbol(start + i) : '';
      cell.classList.toggle('written', written);
    });
    head.style.setProperty('--at', Math.min(total, TAPE_CELLS - 1));
  };
  drawTape(0);

  const local = (target) => {
    const box = el.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
  };
  // El símbolo sale del dedo y cae en la casilla nueva de la cinta.
  const fly = (from, cell, symbol) => {
    if (flying >= MAX_FLYING) return;
    const to = local(cell);
    const piece = h('span', { class: 'tape-symbol', style: { left: `${from.x}px`, top: `${from.y}px` } }, symbol);
    fx.append(piece);
    flying += 1;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const anim = piece.animate([
      { transform: 'translate(-50%, -50%) scale(1)' },
      { transform: `translate(calc(-50% + ${dx / 2}px), calc(-50% + ${dy / 2 - 30}px)) scale(1.4)`, offset: 0.5 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)`, opacity: 0.4 },
    ], { duration: 220, easing: 'ease-in' });
    anim.onfinish = () => { piece.remove(); flying -= 1; };
  };
  const transition = (from, to, symbol) => {
    replace(state, stateLabel(to));
    replace(caption, 'δ(', stateLabel(from), `, ${symbol}) = `, stateLabel(to));
    if (still) return;
    bounce(caption, 0.6);
    button.animate([{ backgroundColor: SUN }, { backgroundColor: '#ffffff' }], { duration: 600 });
    const ring = h('span', { class: 'state-ring' });
    button.parentElement.append(ring);
    ring.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.6)', opacity: 0 }], { duration: 500, easing: 'ease-out' })
      .onfinish = () => ring.remove();
  };

  // Escribe en la cinta hasta `total` clics. `from` es el punto del toque (o null si los clics
  // llegan del servidor: los del compañero no vuelan).
  const advance = (total, from = null) => {
    if (total <= shown) return;
    const before = shown;
    shown = total;
    groupCount.textContent = total;
    drawTape(total);
    if (!still) {
      const shift = Math.max(0, total - (TAPE_CELLS - 1)) - Math.max(0, before - (TAPE_CELLS - 1));
      if (shift > 0 && shift <= 3) {
        track.animate([{ transform: `translateX(${(shift * track.offsetWidth) / TAPE_CELLS}px)` }, { transform: 'none' }],
          { duration: 130, easing: 'ease-out' });
      }
      const cell = cells[Math.min(total, TAPE_CELLS - 1) - 1];
      cell.animate([{ transform: 'scale(0.2)', backgroundColor: SUN }, { transform: 'scale(1)' }],
        { duration: 260, delay: from ? 110 : 0, fill: 'backwards' });
      if (from) fly(from, cell, tapeSymbol(total - 1));
    }
    if (stateOf(total) > stateOf(before)) {
      const to = stateOf(total);
      transition(to - 1, to, tapeSymbol(to * STATE_CLICKS - 1));
    }
  };

  const playing = () => {
    const now = clock.now();
    return phase && !paused && now >= phase.playStartsAt && now <= phase.endsAt;
  };
  const tap = (point) => {
    if (!playing()) return;
    pending += 1;
    mine += 1;
    myCount.textContent = mine;
    if (!still) {
      button.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.13, 0.85)', offset: 0.3 }, { transform: 'scale(0.95, 1.06)', offset: 0.65 }, { transform: 'scale(1)' }],
        { duration: 240, easing: 'ease-out' });
    }
    // Cada toque propio suma uno a lo que ya se ve: los clics del compañero llegan con la vista.
    advance(shown + 1, point ?? local(button));
  };
  const onKey = (event) => {
    if (event.code === 'Space' && !event.repeat) {
      event.preventDefault();
      tap(null);
    }
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const box = el.getBoundingClientRect();
    tap({ x: event.clientX - box.left, y: event.clientY - box.top });
  });
  document.addEventListener('keydown', onKey);

  // Últimos 5 segundos: borde y botón en rojo y una cuenta grande; al acabar, «¡Tiempo!».
  animate(el, () => {
    if (!phase) return true;
    const now = clock.now();
    const left = phase.endsAt - now;
    const running = !paused && now >= phase.playStartsAt;
    const final = running && left > 0 && left <= FINAL_MS;
    const over = running && left <= 0;
    el.classList.toggle('final', final);
    el.classList.toggle('over', over);
    button.classList.toggle('idle', !playing());
    const next = over ? 'end' : final ? Math.ceil(left / 1000) : null;
    if (next !== second) {
      second = next;
      finalCount.textContent = next === 'end' ? '¡Tiempo!' : next ?? '';
      if (next !== null && !still) {
        finalCount.animate(next === 'end'
          ? [{ transform: 'scale(0.4)' }, { transform: 'scale(1.1)', offset: 0.6 }, { transform: 'scale(1)' }]
          : [{ transform: 'scale(1.8)', opacity: 0 }, { transform: 'scale(1)', opacity: 0.9, offset: 0.3 }, { transform: 'scale(0.9)', opacity: 0 }],
        { duration: next === 'end' ? 350 : 950 });
      }
    }
    return true;
  });

  const flush = () => {
    if (pending === 0) return;
    socket.emit('mg:input', { type: 'clicks', count: pending });
    pending = 0;
  };
  let timer = null;

  return {
    el,
    update(view) {
      phase = view.phase;
      paused = Boolean(view.room.paused);
      const { game, groups } = phase.data;
      const index = groupOf(groups, teamId);
      groupTotal = game.totals[index] ?? 0;
      extraNote.hidden = !hasExtra('clicker', groups, groups[index] ?? []);
      advance(groupTotal + pending);
      timer ??= setInterval(flush, game.batchMs);
      button.classList.toggle('idle', !playing());
    },
    destroy() {
      flush();
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
    },
  };
}

// Proyector: una cinta por grupo con su estado. Se monta una vez por fase y se actualiza en sitio
// (las vistas llegan a 4 Hz), para que el cabezal se deslice y el estado nuevo rebote.
export function createAutomatonBoard() {
  const CELLS = 16;
  const el = h('section', { class: 'automaton-board' });
  let rows = null;
  const still = stillMotion();
  return {
    el,
    update({ groups, game }, teams) {
      if (!rows) {
        rows = groups.map((group) => {
          const cells = Array.from({ length: CELLS }, () => h('span', { class: 'tape-cell' }));
          const row = {
            cells,
            head: h('span', { class: 'tape-head' }),
            badge: h('span', { class: 'state-badge' }, stateLabel(0)),
            count: h('span', { class: 'board-count' }, '0'),
            state: 0,
          };
          el.append(h('div', { class: 'board-row' },
            clickerLabel(groups, group, teams),
            h('div', { class: 'tape' }, h('div', { class: 'tape-window' }, h('div', { class: 'tape-track' }, cells)), row.head),
            row.badge, row.count));
          return row;
        });
      }
      // La cinta del que va primero llega casi al final; las demás, en proporción.
      const best = Math.max(1, ...game.totals);
      const top = game.totals.indexOf(best);
      rows.forEach((row, index) => {
        const total = game.totals[index] ?? 0;
        const written = Math.min(CELLS - 1, Math.round(((CELLS - 1) * total) / (best * 1.08)));
        row.cells.forEach((cell, i) => {
          cell.textContent = i < written ? tapeSymbol(index * 31 + i) : '';
          cell.classList.toggle('written', i < written);
        });
        row.head.style.setProperty('--at', written);
        row.count.textContent = total;
        row.badge.classList.toggle('top', total > 0 && index === top);
        if (stateOf(total) !== row.state) {
          row.state = stateOf(total);
          replace(row.badge, stateLabel(row.state));
          if (!still) bounce(row.badge);
        }
      });
    },
  };
}

// Host: una barra por grupo, actualizada a 4 Hz (RF-MJ3-05).
export function clickerBars({ groups, game }, teams) {
  const best = Math.max(1, ...game.totals);
  return h('div', { class: 'bars' }, groups.map((group, index) => h('div', { class: 'bar-row' },
    clickerLabel(groups, group, teams),
    h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: `${(100 * game.totals[index]) / best}%` } })),
    h('span', { class: 'mono bar-count' }, game.totals[index]))));
}

// ------------------------------------------------------------------ Memoria (RF-MJ1)

// Símbolos de las cartas dibujados con trazos de tinta: las fuentes del juego solo traen letras
// latinas, así que δ, Σ o λ saldrían con la fuente del sistema. Cada símbolo tiene además su color.
// Una cara que no esté aquí (otra configuración) se muestra como texto.
const FACES = {
  'δ': { name: 'delta', color: '#ffc93c', d: '<circle cx="23" cy="31" r="8.5"/><path d="M28 24c-7-4.5-11-9.5-7-13 3-2.6 8-1.8 11 1"/>' },
  'Σ': { name: 'sigma', color: '#a9d0ff', d: '<path d="M34 11H15l11 13-11 13h19"/>' },
  'ε': { name: 'épsilon', color: '#a6f0b8', d: '<path d="M33 14c-4-4-17-4-17 4 0 4 4 6 9 6M25 24c-6 0-11 2-11 7 0 8 13 8 19 3"/>' },
  'q₀': { name: 'q cero', color: '#ffb3cc', d: '<circle cx="19.5" cy="20.5" r="8.5"/><path d="M28 12v27"/><ellipse cx="37" cy="35" rx="3.6" ry="5" stroke-width="3.2"/>' },
  '∅': { name: 'conjunto vacío', color: '#c9b3ff', d: '<circle cx="24" cy="24" r="11.5"/><path d="M14 38 34 10"/>' },
  'λ': { name: 'lambda', color: '#ff8a3d', d: '<path d="M13 10c5 0 8 1 10 6l11 23M23.5 22 13 39"/>' },
  '⊢': { name: 'deriva', color: '#fff3c4', d: '<path d="M15 10v28M15 24h20"/>' },
  'Γ': { name: 'gamma', color: '#4d9bff', d: '<path d="M34 11H18v27M13 38h10"/>' },
  '↻': { name: 'bucle', color: '#5fd4c4', d: '<path d="M36 24a12 12 0 1 1-6-10.4"/><path fill="#1c1640" stroke-width="2" d="M34.6 16.3 27.6 17.6 32.4 9.3Z"/>' },
  '★': { name: 'estrella', color: '#ff4f8b', d: '<path fill="#fff" d="m24 8.5 4.6 9.4 10.3 1.4-7.5 7.2 1.9 10.2L24 31.8l-9.3 4.9 1.9-10.2-7.5-7.2 10.3-1.4Z"/>' },
  '∪': { name: 'unión', color: '#3ccf6e', d: '<path d="M14 11v13c0 15 20 15 20 0V11"/>' },
  '∀': { name: 'para todo', color: '#8c88a8', d: '<path d="M12 10l12 28 12-28M17.5 22h13"/>' },
  '∞': { name: 'infinito', color: '#8c5cff', d: '<path d="M24 24c-5-7-15-8-15 0s10 7 15 0 15-8 15 0-10 7-15 0Z"/>' },
  '⇒': { name: 'implica', color: '#c97b3f', d: '<path d="M9 19h21M9 29h21M27 12l10 12-10 12"/>' },
  '#': { name: 'almohadilla', color: '#e9f6ff', d: '<path d="M20 10l-3 28M32 10l-3 28M11 19h27M10 29h27"/>' },
};
const FLIP_MS = 480; // lo que dura el volteo en party.css
const FLY_MS = 620;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const faceName = (face) => FACES[face]?.name ?? face;

// Disco blanco con el símbolo. El SVG sale de la tabla de arriba, nunca del servidor.
function faceDisk(face) {
  const disk = h('span', { class: 'memo-disk' });
  if (FACES[face]) {
    disk.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="#1c1640" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">${FACES[face].d}</g></svg>`;
  } else {
    disk.append(h('span', { class: 'memo-glyph' }, face));
  }
  return disk;
}

// Columnas fijas según el número de cartas, igual en celular y proyector: 30 cartas → 5×6,
// 12 → 4×3. Con 5 columnas como máximo, las cartas salen grandes en un celular vertical.
export function memoriaGrid(count) {
  const cols = count <= 16 ? 4 : 5;
  return { cols, rows: Math.ceil(count / cols) };
}

// Tablero de la Memoria para el celular, el proyector y el host. Se monta una vez por fase y se
// actualiza en sitio, así cada carta conserva su volteo animado entre una vista y la siguiente:
// - volteo 3D al cambiar de boca abajo a arriba (y al revés);
// - acierto: pulso y anillo verde, y la pareja vuela al contador de su grupo;
// - error: sacudida y anillo rojo hasta que el servidor las vuelve a ocultar.
// Arriba, un marcador de una línea: un círculo por equipo con su color, las parejas de cada grupo y
// el anillo de tiempo del turno. Con fill, el tablero ocupa todo el alto que queda (celular y proyector).
export function createMemoriaPad({ socket = null, clock, teamId = null, fill = true }) {
  let view = null;
  let prev = null;        // la vista anterior del juego: para saber qué cambió y animarlo
  let sending = false;
  let cardsKey = '';
  let groupsKey = '';
  let flying = 0;         // vuelos de parejas en curso
  const held = new Map(); // grupo → parejas que aún vuelan hacia el marcador (se suman al llegar)
  const shown = [];       // parejas que muestra el marcador por grupo

  const groupsEl = h('div', { class: 'memo-groups' });
  const ring = h('div', { class: 'memo-ring', role: 'img', 'aria-label': 'Tiempo para voltear' });
  const score = h('section', { class: 'memo-score', 'aria-label': 'Marcador' }, groupsEl, ring);
  const announce = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const board = h('div', { class: 'memo-board', role: 'group', 'aria-label': 'Tablero' });
  const stage = h('div', { class: 'memo-stage' }, board);
  const el = h('section', { class: `memo-play${fill ? '' : ' fixed'}` }, score, announce, stage);

  board.addEventListener('click', async (event) => {
    const card = event.target.closest('.memo-card');
    if (!card || !socket || sending || !view?.phase.data.game.canFlip) return;
    sending = true;
    const res = await send(socket, 'mg:input', { type: 'flip', card: Number(card.dataset.i) });
    sending = false;
    if (!res.ok) toast(errorMessage(res.error));
  });
  board.addEventListener('animationend', (event) => {
    if (event.animationName === 'memo-lift') event.target.classList.remove('lift');
  });

  const game = () => view.phase.data.game;
  const myGroup = () => (teamId ? view.phase.data.groups.findIndex((group) => group.includes(teamId)) : -1);

  // Anillo del turno: se vacía con el reloj del servidor.
  animate(el, () => {
    if (!view || !clock) return true;
    const { turn } = game();
    if (turn.step !== 'reveal' && turn.deadline) {
      const left = Math.max(0, turn.deadline - clock.now());
      ring.style.setProperty('--left', Math.min(1, left / (turn.cardMs || 10000)).toFixed(4));
      ring.classList.toggle('low', left < 3000 && !view.room?.paused);
    }
    return true;
  });

  function buildBoard(count) {
    const { cols, rows } = memoriaGrid(count);
    board.style.setProperty('--cols', cols);
    board.style.setProperty('--rows', rows);
    board.style.setProperty('--ratio', ((cols * 3) / (rows * 4)).toFixed(4));
    board.style.setProperty('--ratio-tall', ((cols * 2) / (rows * 3)).toFixed(4));
    replace(board, Array.from({ length: count }, (_, i) => h('button', {
      type: 'button', class: 'memo-card', dataset: { i, state: 'down' },
    }, h('span', { class: 'memo-inner' },
      h('span', { class: 'memo-side memo-back' }, h('span', { class: 'memo-mark' }, '?')),
      h('span', { class: 'memo-side memo-front' })))));
  }

  // El orden del marcador: el grupo del jugador primero; en el proyector, el de la partida.
  function buildScore(groups, teams) {
    const mine = myGroup();
    const order = groups.map((_, g) => g).sort((a, b) => (b === mine) - (a === mine));
    groupsEl.style.setProperty('--n', groups.length);
    score.classList.toggle('many', groups.length >= 4);
    replace(groupsEl, order.map((g) => {
      const members = groups[g].map((id) => teams.find((t) => t.id === id)).filter(Boolean);
      return h('div', {
        class: `memo-group${g === mine ? ' mine' : ''}`,
        dataset: { g },
        'aria-label': `${g === mine ? 'Tu grupo' : `Grupo ${g + 1}`}: ${members.map((t) => t.name).join(' y ')}`,
      },
      h('span', { class: 'memo-swatches' }, members.map((t) => h('span', {
        class: `memo-swatch${t.id === teamId ? ' me' : ''}`, dataset: { t: t.id }, title: t.name, style: { '--team': t.color },
      }))),
      h('b', { class: 'memo-count' }, '0'));
    }));
  }

  function setCount(g, bump) {
    const count = groupsEl.querySelector(`[data-g="${g}"] .memo-count`);
    if (!count) return;
    count.textContent = shown[g] > 0 ? `+${shown[g]}` : '0';
    count.classList.toggle('zero', !shown[g]);
    if (!bump || reducedMotion()) return;
    count.classList.remove('bump');
    void count.offsetWidth; // reinicia la animación
    count.classList.add('bump');
    count.parentElement.append(h('span', { class: 'memo-plus', 'aria-hidden': 'true' }, '+1'));
    setTimeout(() => count.parentElement?.querySelector('.memo-plus')?.remove(), 950);
  }

  function showFace(cardEl, face, up, animated) {
    const front = cardEl.querySelector('.memo-front');
    if (up) {
      front.style.setProperty('--face', FACES[face]?.color ?? '#ffffff');
      replace(front, faceDisk(face));
    } else if (animated) {
      // Se borra cuando ya está de espaldas: el contenido no queda en la página (RF-MJ1-08).
      setTimeout(() => { if (cardEl.dataset.state === 'down') replace(front); }, FLIP_MS);
    } else {
      replace(front);
    }
    if (animated && !reducedMotion()) {
      cardEl.classList.remove('lift');
      void cardEl.offsetWidth;
      cardEl.classList.add('lift');
    }
  }

  // La pareja vuela desde el tablero hasta el contador de su grupo, que sube al llegar.
  function flyToScore(indexes, face, g) {
    const land = () => {
      held.set(g, Math.max(0, (held.get(g) ?? 0) - 1));
      shown[g] = Math.max(shown[g] ?? 0, game().pairs[g] - (held.get(g) ?? 0));
      setCount(g, true);
    };
    const count = groupsEl.querySelector(`[data-g="${g}"] .memo-count`);
    if (reducedMotion() || !count || !el.isConnected) return land();
    const to = count.getBoundingClientRect();
    let pending = indexes.length;
    flying += 1;
    for (const [n, i] of indexes.entries()) {
      const from = board.children[i].querySelector('.memo-inner').getBoundingClientRect();
      const ghost = h('div', {
        class: 'memo-ghost',
        style: { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, '--face': FACES[face]?.color ?? '#ffffff' },
      }, faceDisk(face));
      document.body.append(ghost);
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const s = Math.min(1, (to.height * 0.9) / from.height);
      const anim = ghost.animate([
        { transform: 'translate(0, 0) scale(1) rotate(0)', opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 30}px) scale(${(1 + s) / 1.7}) rotate(${n ? 10 : -10}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(0)`, opacity: 0.2 },
      ], { duration: FLY_MS, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'forwards' });
      anim.onfinish = () => {
        ghost.remove();
        if (--pending > 0) return;
        flying -= 1;
        land();
      };
    }
  }

  function draw() {
    const { groups } = view.phase.data;
    const g = game();
    const { turn } = g;
    const first = prev === null; // primera vista (o reconexión): sin animaciones
    const revealing = turn.step === 'reveal';

    if (cardsKey !== String(g.cards.length)) {
      cardsKey = String(g.cards.length);
      buildBoard(g.cards.length);
    }
    const key = JSON.stringify([groups, view.teams.map((t) => [t.id, t.color])]);
    if (groupsKey !== key) {
      groupsKey = key;
      buildScore(groups, view.teams);
    }

    // Cartas: volteo, acierto, error y huecos de las parejas encontradas.
    const wasMatch = prev?.turn.step === 'reveal' && prev.turn.match;
    const gone = [];
    g.cards.forEach((card, i) => {
      const cardEl = board.children[i];
      const before = cardEl.dataset.state;
      if (before !== card.state) {
        if (card.state === 'up') showFace(cardEl, card.face, true, !first);
        else if (card.state === 'down') showFace(cardEl, null, false, !first && before === 'up');
        else if (before === 'up' && wasMatch && !first) gone.push(i);
        cardEl.dataset.state = card.state;
      }
      if (!revealing) {
        cardEl.classList.remove('match', 'miss');
        delete cardEl.dataset.badge;
      }
      cardEl.disabled = !(socket && g.canFlip && card.state === 'down');
      cardEl.setAttribute('aria-label', card.state === 'up' ? `Carta ${i + 1}: ${faceName(card.face)}`
        : card.state === 'gone' ? `Carta ${i + 1}: pareja encontrada` : `Carta ${i + 1}, boca abajo`);
    });
    board.classList.toggle('my-turn', Boolean(socket && g.canFlip));

    // Al empezar la muestra: anillo verde o rojo sobre las dos cartas, cuando terminen de girar.
    const newReveal = revealing && !(prev?.turn.step === 'reveal' && prev.turn.group === turn.group);
    if (newReveal) {
      if (turn.match && !first) held.set(turn.group, (held.get(turn.group) ?? 0) + 1);
      const ups = g.cards.map((card, i) => (card.state === 'up' ? i : -1)).filter((i) => i >= 0);
      setTimeout(() => {
        if (game().turn.step !== 'reveal') return;
        for (const i of ups) {
          board.children[i].classList.add(turn.match ? 'match' : 'miss');
          board.children[i].dataset.badge = turn.match ? '✓' : '✕';
        }
      }, first ? 0 : FLIP_MS);
    }
    if (gone.length === 2) flyToScore(gone, prev.cards[gone[0]].face, prev.turn.group);
    else if (!revealing && !flying) held.clear();

    // Marcador: el grupo en turno en amarillo; salta el círculo del equipo que voltea.
    groups.forEach((_, gi) => {
      const target = g.pairs[gi] - (held.get(gi) ?? 0);
      if (shown[gi] !== target && !(held.get(gi) > 0)) {
        shown[gi] = target;
        setCount(gi, false);
      }
    });
    for (const groupEl of groupsEl.children) {
      const gi = Number(groupEl.dataset.g);
      groupEl.classList.toggle('active', gi === turn.group);
      for (const swatch of groupEl.querySelectorAll('.memo-swatch')) {
        swatch.classList.toggle('flipping', gi === turn.group && !revealing && swatch.dataset.t === String(turn.flipper?.teamId));
      }
    }
    ring.classList.toggle('ok', revealing && turn.match === true);
    ring.classList.toggle('bad', revealing && turn.match === false);

    // Un turno que pasa sin muestra es un turno perdido por tiempo (RF-MJ1-06).
    if (!first && prev.turn.step !== 'reveal' && (prev.turn.group !== turn.group || turn.step === 'first' && prev.turn.step === 'second')
      && !g.cards.every((card) => card.state === 'gone')) {
      const late = view.teams.find((t) => t.id === prev.turn.flipper?.teamId);
      if (late) toast(late.id === teamId ? 'Se acabó tu tiempo: el turno pasa' : `Se acabó el tiempo de ${late.name}`);
    }

    // Para lectores de pantalla: de quién es el turno (en pantalla lo dice el marcador).
    const flipper = view.teams.find((t) => t.id === turn.flipper?.teamId);
    const nth = turn.step === 'first' ? 'primera' : 'segunda';
    const text = revealing ? (turn.match ? '¡Pareja!' : 'No son pareja')
      : g.canFlip ? `Te toca: voltea la ${nth} carta`
      : flipper ? `${flipper.name} voltea la ${nth} carta` : '';
    if (announce.textContent !== text) announce.textContent = text;

    prev = { ...g, turn: { ...turn }, cards: g.cards.map((card, i) => ({ ...card, face: card.face ?? prev?.cards[i]?.face })) };
  }

  return {
    el,
    fill,
    update(next) {
      view = next;
      draw();
    },
    destroy() {
      document.querySelectorAll('.memo-ghost').forEach((ghost) => ghost.remove());
    },
  };
}

// Host: un tablero nuevo en cada vista, sin animaciones y con alto fijo.
export function memoriaBoard({ phase, room, teams, clock }) {
  const pad = createMemoriaPad({ clock, fill: false });
  pad.update({ phase, room, teams });
  return pad.el;
}
