# Íconos de los objetos

Cada objeto tiene una ilustración SVG en `client/assets/items/<código en minúsculas>.svg` (por
ejemplo `cv.svg`), enlazada desde el campo `image` de
[server/config/items.json](../server/config/items.json). La interfaz la muestra como `<img>` y la
precarga durante el lobby (`client/shared/items.js`). El emoji de `icon` queda solo como respaldo
por si la imagen no carga.

**Al añadir un objeto nuevo hay que dibujar también su SVG con estas reglas.** `npm test` falla si
algún objeto de `items.json` no tiene su archivo o si el archivo no sigue el formato de abajo.

## El tema: piezas de cartón

Los íconos siguen el diseño «Tablero con autómata» de `client/shared/party.css`: contorno grueso de
tinta, colores planos y una sombra dura hacia abajo, igual que las tarjetas y los botones.

- **Cuadrícula de 64.** `viewBox="0 0 64 64"`, sin `width` ni `height`. El dibujo va entre 4 y 58
  para dejar sitio a la sombra.
- **Tinta de 3 px.** Contorno `#1c1640` con uniones y puntas redondeadas. Los detalles finos pueden
  bajar a 2–2,6. Nada de degradados ni desenfoques.
- **Sombra dura.** Un `feDropShadow` con `dy="2.5"` y `stdDeviation="0"` sobre todo el grupo, como
  `--lift` en el CSS.
- **Brillos en blanco.** Un trazo blanco curvo (`stroke="#fff"`, sin contorno de tinta) en la parte
  superior izquierda da volumen.
- **Un objeto, una silueta.** Tiene que reconocerse a 18 px (el chip de efectos activos). Si a ese
  tamaño no se entiende, sobran detalles.
- **Sin texto.** Las fuentes no cargan dentro de un `<img>`: los números o símbolos se dibujan con
  formas (puntos de un dado, un «+» con dos trazos).

### Plantilla

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="2.5" stdDeviation="0" flood-color="#1c1640" flood-opacity="1"/></filter></defs><g filter="url(#lift)" fill="none" stroke="#1c1640" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
  <!-- formas con fill de la paleta; el contorno de tinta lo hereda del grupo -->
</g></svg>
```

### Paleta

| Uso | Color |
| --- | --- |
| Tinta (contornos, pupilas, puntos) | `#1c1640` |
| Amarillo sol | `#ffc93c` · más oscuro `#e9a91c` · pálido `#fff3c4` |
| Rosa | `#ff4f8b` · claro `#ffb3cc` |
| Rojo | `#e8384f` · vino `#8a1838` |
| Naranja | `#ff8a3d` · madera `#c97b3f` |
| Verde | `#3ccf6e` · claro `#a6f0b8` |
| Azul | `#4d9bff` · claro `#a9d0ff` |
| Morado | `#8c5cff` · claro `#c9b3ff` |
| Neutros | blanco `#ffffff` · vidrio `#e9f6ff` · acero `#8c88a8` · noche `#3a3366` · guante `#4a4470` |

### El color según el tipo

El tipo del objeto (`type` en `server/domain/items/<código>.js`) decide qué escudo lo bloquea. El
dibujo lo refuerza con su color principal cuando el objeto lo permite:

| Tipo | Lo bloquea | Color de referencia | Ejemplos |
| --- | --- | --- | --- |
| `FISICO` | Escudo Físico | rojo `#e8384f` | Caparazón Verde, Bomba Nuclear |
| `EFECTO` (hechizo) | Escudo Anti-hechizos | morado `#8c5cff` | Calamar, Guante de Ladrón |
| `DEFENSA` | — | azul `#4d9bff` | Escudo Físico, Espejo |
| `POWERUP` | no se bloquea | verde `#3ccf6e` | +Racha, Poción |
| `IMPARABLE` | nada (tampoco lo devuelve el Espejo) | amarillo sol `#ffc93c` | Desafío |

## Pasos para un objeto nuevo

1. Escribir su archivo en `server/domain/items/` y registrarlo en `index.js`.
2. Dibujar `client/assets/items/<código>.svg` con la plantilla y la paleta de arriba. Conviene
   abrirlo junto a dos o tres íconos existentes para comparar grosor y tamaño.
3. Añadirlo en `items.json` con `"image": "items/<código>.svg"` y un emoji en `icon` como respaldo.
4. Correr `npm test`.
