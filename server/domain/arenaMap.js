// Mapa de la Arena (3000 × 3000): obstáculos, puntos de aparición y puntos de caja de poder. Se
// describe un cuarto y se gira tres veces alrededor del centro, así ningún lado tiene más cobertura que otro. El centro queda
// despejado para el jefe. Los pasillos miden al menos ~150, más que el ancho del jefe.
export const MAP_SIZE = 3000;

const QUARTER = {
  obstacles: [
    { x: 420, y: 420, w: 340, h: 110 }, // L de la esquina, abierta hacia el centro
    { x: 420, y: 530, w: 110, h: 230 },
    { x: 1000, y: 330, r: 95 }, // pilar
    { x: 1430, y: 600, w: 140, h: 180 }, // bloque sobre el eje, entre el borde y el centro
    { x: 1040, y: 1040, w: 150, h: 150 }, // cobertura cerca del jefe
  ],
  // Donde aparecen (y reaparecen) los retadores: junto a los bordes, lejos del centro.
  spawns: [
    { x: 150, y: 150 },
    { x: 800, y: 150 },
    { x: 1500, y: 150 },
    { x: 2200, y: 150 },
  ],
  // Cajas de poder: en el eje, entre el bloque y el jefe (arriesgada, poderes fuertes), y en la
  // esquina, detrás de la L y junto a la reaparición (protegida, poderes de apoyo).
  pads: [
    { x: 1500, y: 960, ring: 'axis' },
    { x: 290, y: 290, ring: 'corner' },
  ],
};

// Giro de 90° alrededor del centro: (x, y) → (size − y, x).
function rotate(shape, size) {
  if (shape.w === undefined) return { ...shape, x: size - shape.y, y: shape.x };
  return { x: size - (shape.y + shape.h), y: shape.x, w: shape.h, h: shape.w };
}

function fourWays(shapes, size) {
  const all = [];
  let current = shapes;
  for (let turn = 0; turn < 4; turn += 1) {
    all.push(...current);
    current = current.map((shape) => rotate(shape, size));
  }
  return all;
}

// Escala el mapa a `size` (la configuración puede cambiar el tamaño de la arena).
export function buildMap(size = MAP_SIZE) {
  const k = size / MAP_SIZE;
  const scale = (shape) => Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * k) : value]));
  return {
    size,
    obstacles: fourWays(QUARTER.obstacles, MAP_SIZE).map(scale),
    spawns: fourWays(QUARTER.spawns, MAP_SIZE).map(scale),
    pads: fourWays(QUARTER.pads, MAP_SIZE).map(scale),
  };
}

// Posiciones iniciales de los jefes: el centro, o a su alrededor si son varios.
export function bossStarts(count, size) {
  const c = size / 2;
  if (count <= 1) return [{ x: c, y: c }];
  const ring = size * 0.06;
  return Array.from({ length: count }, (_, i) => {
    const a = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: Math.round(c + Math.cos(a) * ring), y: Math.round(c + Math.sin(a) * ring) };
  });
}
