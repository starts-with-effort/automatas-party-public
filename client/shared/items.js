// Objetos en la interfaz: catálogo, tarjetas y frases de la resolución (secciones 4.5 y 4.6).
import { h } from './dom.js';
import { signed } from './ui.js';

let catalog = new Map();

// El catálogo es público y no cambia durante la partida: se pide una vez al cargar la página.
export async function loadCatalog() {
  try {
    const { items } = await fetch('/api/items').then((res) => res.json());
    setCatalog(items);
    // Precarga de las imágenes de los objetos (RNF-11): las páginas cargan el catálogo al abrir,
    // durante el lobby, y así no aparecen en blanco en el draft.
    for (const item of items) if (item.image) new Image().src = `/assets/${item.image}`;
  } catch {
    catalog = new Map(); // sin catálogo se muestran los códigos
  }
}

export function setCatalog(items) {
  catalog = new Map(items.map((item) => [item.code, item]));
}

export function itemInfo(code) {
  return catalog.get(code) ?? { code, name: code, text: '', icon: '❔', image: null, target: 'SELF' };
}

export function itemIcon(code) {
  const item = itemInfo(code);
  return item.image
    ? h('img', { class: 'item-icon', src: `/assets/${item.image}`, alt: '' })
    : h('span', { class: 'item-icon', 'aria-hidden': 'true' }, item.icon);
}

// Tarjeta de objeto con imagen, nombre y texto corto (RF-OBJ-09).
export function itemCard(code, { selected = false, onClick = null, disabled = false, footer = null } = {}) {
  const item = itemInfo(code);
  return h(onClick ? 'button' : 'div', {
    class: `item-card${selected ? ' selected' : ''}`,
    type: onClick ? 'button' : null,
    disabled: Boolean(onClick) && disabled,
    'aria-pressed': onClick ? String(selected) : null,
    onClick,
  },
  itemIcon(code),
  h('span', { class: 'item-body' }, h('strong', {}, item.name), h('span', { class: 'muted' }, item.text)),
  footer);
}

// Fila compacta de íconos (inventario, efectos activos).
export function itemStrip(codes, emptyText = 'Sin objetos') {
  if (codes.length === 0) return h('span', { class: 'muted' }, emptyText);
  return h('span', { class: 'item-strip' }, codes.map((code) => h('span', { title: itemInfo(code).name }, itemIcon(code))));
}

// ------------------------------------------------------------------ resolución

const SHIELDS = { EF: 'Escudo Físico', EA: 'Escudo Anti-hechizos', E: 'Espejo' };

// Frase de un evento de la resolución (RF-USO-08). nameOf(teamId) → nombre del equipo.
export function eventSentence(event, nameOf) {
  const item = itemInfo(event.code);
  const source = nameOf(event.source);
  const target = nameOf(event.target);
  const changes = changesText(event.changes ?? [], nameOf);
  switch (event.kind) {
    case 'defense':
      return `${source} activó ${item.name}.`;
    case 'reflected':
      return `El Espejo de ${target} devolvió ${item.name} a ${source}.`;
    case 'blocked':
      return `El ${SHIELDS[event.by]} de ${target} bloqueó ${item.name} de ${source}.`;
    case 'hit':
      if (event.self) return `${source} usó ${item.name} y también le tocó: ${changes}.`;
      return `${source} usó ${item.name} contra ${target}${event.reflected ? ' (devuelto)' : ''}: ${changes || 'sin efecto'}.`;
    case 'powerup':
      return `${source} usó ${item.name}: ${changes}.`;
    case 'armed':
      if (event.source === event.target) {
        return `${source} activó ${item.name} para ${event.code === 'TD' ? 'el próximo reparto' : 'la próxima pregunta'}.`;
      }
      if (event.code === 'DS') {
        return `${source} desafía a ${target}: se decide en un duelo de piedra, papel o tijera.`;
      }
      return `${source} usó ${item.name} contra ${target}${event.reflected ? ' (devuelto)' : ''}: actuará en la próxima pregunta.`;
    default:
      return `${source}: ${item.name}.`;
  }
}

function changesText(changes, nameOf) {
  return changes
    .flatMap(({ teamId, points, streak }) => [
      points ? `${nameOf(teamId)} ${signed(points)} pts` : null,
      streak ? `${nameOf(teamId)} racha ${signed(streak)}` : null,
    ])
    .filter(Boolean)
    .join(', ');
}

// Lista animada: cada frase aparece después de la anterior.
export function resolutionList(events, nameOf, { onlyTeam = null } = {}) {
  const shown = onlyTeam ? events.filter((e) => e.source === onlyTeam || e.target === onlyTeam) : events;
  if (shown.length === 0) return h('p', { class: 'muted' }, onlyTeam ? 'Nadie usó objetos contra tu equipo.' : 'Nadie usó objetos en esta ronda.');
  return h('ol', { class: 'resolution' }, shown.map((event, index) => h('li', {
    class: `resolution-${event.kind}`,
    style: { animationDelay: `${index * 0.6}s` },
  }, itemIcon(event.code), h('span', {}, eventSentence(event, nameOf)))));
}

// ------------------------------------------------------------------ resolución como diagrama

// Resolución en el celular y el proyector (rediseño, fase 4): cada uso es un diagrama con el círculo
// del equipo, el objeto sobre la flecha y el equipo al que apuntó; debajo, el efecto en pocas
// palabras. Tres reglas para agrupar:
// - contra todos (Calamar, Bomba): un solo diagrama, «Equipo 3 usó Calamar», con los bloqueos y los
//   Espejos en el efecto;
// - para uno mismo (Poción, +Racha, escudos…): los equipos que usaron el mismo objeto van juntos;
// - contra un equipo: un diagrama por uso (lo que devuelve un Espejo, como otro diagrama).
// teams: los equipos de la vista (nombre y color). onlyTeam: solo lo que toca a ese equipo.
const ARMED_TEXT = {
  RR: 'menos tiempo en la próxima pregunta',
  CS: 'apuesta por él en la próxima pregunta',
  C: 'tinta en su pantalla en la próxima pregunta',
  DS: 'se decide en un duelo de piedra, papel o tijera',
  SV: 'puede fallar una vez en la próxima pregunta',
  DN: 'doble o nada en la próxima pregunta',
  CR: 'irán desapareciendo respuestas incorrectas en la próxima pregunta',
  TD: 'elige 2 objetos de 4 en el próximo reparto',
};
const DEFENSE_TEXT = { EF: 'protegido de los ataques físicos este turno', EA: 'protegido de los hechizos este turno', E: 'devuelve los ataques este turno' };

export function resolutionDiagrams(events, teams, { onlyTeam = null } = {}) {
  const teamOf = (id) => teams.find((t) => t.id === id) ?? { id, name: id, color: '#888888' };
  const groups = groupEvents(events);
  const shown = onlyTeam ? groups.filter((g) => g.teams.has(onlyTeam)) : groups;
  if (shown.length === 0) {
    return h('p', { class: 'muted' }, onlyTeam ? 'Nadie usó objetos contra tu equipo.' : 'Nadie usó objetos en esta ronda.');
  }
  const ball = (id) => h('i', { class: 'dg-ball', style: { '--team': teamOf(id).color } });
  const who = (id) => h('span', { class: 'dg-who' }, ball(id), h('span', {}, teamOf(id).name));
  const chip = (id) => h('span', { class: 'dg-chip' }, ball(id), teamOf(id).name);
  const nameOf = (id) => teamOf(id).name;
  return h('div', { class: 'diagrams' }, shown.map((group, index) => {
    const item = itemInfo(group.code);
    let line;
    if (group.type === 'one') {
      line = [who(group.source), h('span', { class: 'dg-arrow' }, itemIcon(group.code)), who(group.target)];
    } else {
      const verb = group.type === 'self' && group.sources.length > 1 ? 'usaron' : 'usó';
      line = [group.sources.map(chip), h('span', { class: 'dg-item' }, itemIcon(group.code)), h('span', { class: 'dg-verb' }, `${verb} ${item.name}`)];
    }
    return h('div', { class: `dg dg-${group.tone}`, style: { animationDelay: `${index * 0.6}s` } },
      h('div', { class: 'dg-line' }, line),
      h('p', { class: 'dg-fx' }, group.fx(nameOf)));
  }));
}

export function groupEvents(events) {
  const groups = [];
  const byKey = new Map();
  const add = (key, make, event) => {
    let group = byKey.get(key);
    if (!group) {
      group = make();
      byKey.set(key, group);
      groups.push(group);
    }
    group.events.push(event);
    for (const id of [event.source, event.target, ...(event.changes ?? []).map((c) => c.teamId)]) if (id) group.teams.add(id);
    return group;
  };
  for (const event of events) {
    const scope = itemInfo(event.code).target;
    if (scope === 'OTHERS' || scope === 'ALL') {
      // Contra todos: lo que se devolvió con el Espejo sigue siendo parte del mismo uso.
      const origin = event.reflected ? event.target : event.source;
      const group = add(`all:${event.code}:${origin}`, () => ({
        type: 'all', code: event.code, sources: [origin], events: [], teams: new Set(), tone: 'hit', fx: (nameOf) => allText(group, nameOf),
      }), event);
    } else if (event.source === event.target) {
      const key = `self:${event.code}:${event.kind}:${singleText(event, (id) => id, true)}`;
      const group = add(key, () => ({
        type: 'self', code: event.code, sources: [], events: [], teams: new Set(), tone: 'self',
        fx: () => singleText(group.events[0], (id) => id, true) + (group.sources.length > 1 ? ' cada uno' : ''),
      }), event);
      if (!group.sources.includes(event.source)) group.sources.push(event.source);
    } else {
      groups.push({
        type: 'one', code: event.code, source: event.source, target: event.target, events: [event],
        teams: new Set([event.source, event.target, ...(event.changes ?? []).map((c) => c.teamId)]), tone: event.kind,
        fx: (nameOf) => singleText(event, nameOf, false),
      });
    }
  }
  return groups;
}

// Efecto de un uso en pocas palabras: «−111 pts», «racha +3», «bloqueado por Escudo Físico»…
function singleText(event, nameOf, self) {
  switch (event.kind) {
    case 'blocked': return `bloqueado por ${SHIELDS[event.by]}`;
    case 'reflected': return 'el Espejo lo devolvió';
    case 'defense': return DEFENSE_TEXT[event.code] ?? 'activado';
    case 'armed': return (ARMED_TEXT[event.code] ?? 'actuará en la próxima pregunta') + (event.reflected ? ' (devuelto)' : '');
    default: {
      const text = changesShort(event.changes ?? [], nameOf, self ? event.source : event.target);
      return (text || 'sin efecto') + (event.reflected ? ' (devuelto)' : '');
    }
  }
}

// Cambios de puntos y racha. Si solo cambia el equipo principal, sin su nombre.
function changesShort(changes, nameOf, main) {
  const parts = changes
    .map(({ teamId, points, streak }) => ({
      teamId,
      text: [points ? `${signed(points)} pts` : '', streak ? `racha ${signed(streak)}` : ''].filter(Boolean).join(', '),
    }))
    .filter((part) => part.text);
  if (parts.length === 1 && parts[0].teamId === main) return parts[0].text;
  return parts.map((part) => `${nameOf(part.teamId)}: ${part.text}`).join(' · ');
}

// Un objeto contra todos: el efecto general y, aparte, quién lo bloqueó o lo devolvió.
function allText(group, nameOf) {
  const hits = group.events.filter((e) => (e.kind === 'hit' || e.kind === 'armed') && !e.reflected && !e.self);
  const self = group.events.find((e) => e.self);
  const notes = [];
  if (group.code === 'C') {
    notes.push(hits.length > 0 ? 'tinta en las pantallas de los demás en la próxima pregunta' : 'nadie recibió la tinta');
  } else {
    const points = hits[0]?.changes?.[0]?.points ?? self?.changes?.[0]?.points;
    notes.push(points ? `${signed(points)} pts a todos${self ? ', también a quien la usó' : ''}` : 'sin efecto');
  }
  for (const e of group.events.filter((x) => x.kind === 'blocked' && !x.reflected)) notes.push(`${nameOf(e.target)} lo bloqueó con su ${SHIELDS[e.by]}`);
  for (const e of group.events.filter((x) => x.kind === 'reflected')) notes.push(`${nameOf(e.target)} lo devolvió con el Espejo`);
  return notes.join(' · ');
}

// Texto de los efectos activos de un equipo en la pregunta (7.1).
export function effectLabel(effect, teamId, nameOf) {
  const item = itemInfo(effect.code);
  if (effect.code === 'CS') {
    return effect.sourceTeamId === teamId
      ? `${item.name}: apuestas por ${nameOf(effect.targetTeamId)}`
      : `${item.name}: ${nameOf(effect.sourceTeamId)} apuesta por ustedes`;
  }
  const notes = { RR: 'menos tiempo', CR: 'irán desapareciendo respuestas incorrectas', SV: 'pueden fallar una vez', DN: 'doble o nada', C: 'tinta en la pantalla' };
  return `${item.name}: ${notes[effect.code] ?? ''}`;
}
