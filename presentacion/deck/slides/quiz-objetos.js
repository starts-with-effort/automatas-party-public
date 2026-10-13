// Q3 · Los objetos: arriba, los 16 en tres grupos y el Desafío aparte; abajo, un grupo por paso con
// lo que hace cada uno. Los dibujos son los del quiz (client/assets/items); los textos resumen los
// de server/config/items.json.
import { $, $$, box, hidden, show } from './common.js';
import { COLORS } from '../views/format.js';
import { itemIcon } from './quiz-common.js';

// [código, nombre, efecto, tipo]: el tipo dice qué escudo lo detiene.
const GROUPS = [
  {
    id: 'atk', label: 'Contra otro equipo', items: [
      ['cv', 'Caparazón Verde', 'Le quitas puntos a otro equipo: más si va primero.', 'físico'],
      ['bn', 'Bomba Nuclear', 'Todos pierden muchos puntos. Tú también.', 'físico'],
      ['rr', 'Reloj Roto', 'Otro equipo tiene menos tiempo en la próxima pregunta.', 'hechizo'],
      ['gl', 'Guante de Ladrón', 'Le robas la racha a otro equipo.', 'hechizo'],
      ['cp', 'Cáscara de plátano', 'Le bajas la racha a otro equipo.', 'hechizo'],
      ['c', 'Calamar', 'Llenas de tinta las pantallas de los demás.', 'hechizo'],
      ['cs', 'Chupa-Sangre', 'Apuestas por otro equipo: ganas si acierta, pierdes si falla.', 'hechizo'],
    ],
  },
  {
    id: 'def', label: 'Defensas', items: [
      ['ef', 'Escudo Físico', 'Te protege de los ataques físicos de este turno.'],
      ['ea', 'Escudo Anti-hechizos', 'Te protege de los hechizos de este turno.'],
      ['e', 'Espejo', 'Devuelve los ataques a quien te los envió.'],
    ],
  },
  {
    id: 'own', label: 'Para tu equipo', items: [
      ['sv', 'Segunda Vida', 'En la próxima pregunta puedes fallar una vez.'],
      ['dn', 'Doble o nada', 'Próxima pregunta: el doble si aciertas; pierdes puntos si fallas.'],
      ['r', '+Racha', 'Sube tu racha.'],
      ['b', 'Bala', 'Tu racha sube muchísimo.'],
      ['p', 'Poción', 'Ganas puntos al instante.'],
      ['td', 'Ticket Dorado', 'En el próximo reparto eliges 2 objetos de 4.'],
    ],
  },
];

const itemCard = ([code, name, text, kind]) => `
  <div class="card qz-item">
    ${itemIcon(code)}
    <div class="qz-item-head">
      <div class="display-font">${name}</div>
      ${kind ? `<span class="chip qz-kind ${kind === 'físico' ? 'fis' : 'hex'}">${kind}</span>` : ''}
    </div>
    <p>${text}</p>
  </div>`;

export default function mount({ body, steps }) {
  const tray = box(body, 'qz-trays', { x: 0, y: 0, w: 1728 }, `
    ${GROUPS.map((group) => `<div class="qz-tray" data-group="${group.id}"><b>${group.label}</b><div>${group.items.map(([code]) => itemIcon(code)).join('')}</div></div>`).join('')}
    <div class="qz-tray special" data-group="ds"><b>Especial</b><div>${itemIcon('ds')}</div></div>`);
  const intro = box(body, 'card qz-items-intro', { x: 214, y: 270, w: 1300 }, `
    <p>En cada ronda, cada equipo <strong>elige 1 objeto entre 3</strong><br>y lo puede usar después del minijuego.</p>
    <p class="muted">Son 16, en tres grupos… y uno especial.</p>`);
  const pages = GROUPS.map((group) => box(body, `qz-page ${group.id}`, { x: 0, y: 164, w: 1728 }, `
    ${group.items.map(itemCard).join('')}
    ${group.id === 'def' ? '<div class="card sun qz-once">Las defensas son <strong>raras de encontrar</strong>.</div>' : ''}`));
  const special = box(body, 'card qz-special', { x: 314, y: 250, w: 1100 }, `
    ${itemIcon('ds')}
    <div>
      <div class="display-font">Desafío</div>
      <p>Es especial: ningún escudo lo detiene.</p>
      <p class="muted">Lo explicamos en un momento, con el duelo.</p>
    </div>`);
  const trayOf = (id) => $(tray, `[data-group="${id}"]`);
  pages.forEach((page) => hidden($$(page, '.card')));
  hidden(special, { y: 0, scale: 0.85 });

  // Cada paso apaga el grupo anterior (lo que haya en pantalla) y enciende el suyo.
  const order = [...GROUPS.map((group, i) => ({ id: group.id, cards: $$(pages[i], '.card') })), { id: 'ds', cards: [special] }];
  order.forEach(({ id, cards }, i) => {
    const before = order[i - 1];
    steps.step((tl, at) => {
      tl.to(before ? before.cards : intro, { autoAlpha: 0, duration: 0.25 }, at);
      if (before) tl.to(trayOf(before.id), { backgroundColor: COLORS.surface, duration: 0.25 }, at);
      tl.to(trayOf(id), { backgroundColor: id === 'ds' ? COLORS.pink : COLORS.sun, duration: 0.25 }, at);
      if (id === 'ds') tl.to($(trayOf(id), 'b'), { color: '#ffffff', duration: 0.25 }, at);
      show(tl, at + 0.2, cards, id === 'ds' ? { ease: 'back.out(1.6)' } : { duration: 0.3, stagger: 0.05 });
    });
  });
}
