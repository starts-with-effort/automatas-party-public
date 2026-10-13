// Dibujos del quiz que usan varias diapositivas de la sección «El quiz»: los objetos y la estrella
// de fragmentos.

// Ilustración de un objeto (client/assets/items/<código>.svg, la misma que se ve en el celular).
export const itemIcon = (code) => `<img src="/assets/items/${code}.svg" alt="">`;

const point = (radius, angle) => {
  const a = (angle * Math.PI) / 180;
  return `${(50 + radius * Math.cos(a)).toFixed(2)},${(54 + radius * Math.sin(a)).toFixed(2)}`;
};

// Estrella de cinco puntas como la del quiz (client/shared/widgets.js): una punta amarilla por
// fragmento. Cada punta es un <polygon class="arm">, en orden desde la de arriba.
export function starSvg(fragments = 0, tips = 5) {
  const R = 46;
  const r = R * 0.382;
  const outer = Array.from({ length: tips }, (_, k) => point(R, -90 + (k * 360) / tips));
  const inner = Array.from({ length: tips }, (_, k) => point(r, -90 + 180 / tips + (k * 360) / tips));
  const outline = outer.flatMap((o, k) => [o, inner[k]]).join(' ');
  const arms = outer.map((o, k) => `<polygon class="arm${k < fragments ? ' on' : ''}" points="50,54 ${inner[(k - 1 + tips) % tips]} ${o} ${inner[k]}"/>`);
  return `<svg class="qz-star" viewBox="-2 -2 104 110" aria-hidden="true"><polygon class="shade" points="${outline}" transform="translate(0 4.5)"/>${arms.join('')}<polygon class="outline" points="${outline}"/></svg>`;
}
