# Traza a ciegas: el minijuego del autómata de pila

El 9 de octubre de 2026 el equipo decidió cambiar el **Laberinto oculto** (ronda 2) por un minijuego
sobre el tema de la exposición: un autómata de pila (PDA) en el que el equipo traza, estado por
estado, el camino con el que el autómata acepta una cadena. La propuesta se armó en un artifact
(«Traza a ciegas», privado) y el equipo aprobó
las 6 propuestas tal como estaban. Se trabajó en la rama `traza`, en dos fases y dos commits: primero
que funcione (A) y, ya probado, lo visual (B). Las dos están hechas.

## Decisiones aprobadas

1. **Reglas.** Cada equipo juega solo, con su copia del mismo autómata y la **misma cadena** para
   todos (al azar entre 24; la semilla queda en el log). El celular A empieza con el diagrama y el B
   con la cadena. El diagrama muestra el estado actual y la pila, no la cadena; la cadena se ve
   completa, sin cabezal ni marca de avance, y el celular de la cadena no recibe ninguna señal cuando
   su compañero acierta: todo va en voz alta. Cada toque es un paso del autómata, también los ε. Un
   toque es correcto si existe la transición y, desde ahí, la cadena todavía se puede aceptar (así,
   equivocarse de rama en el no determinismo falla en ese mismo momento). Máximo 120 s; termina
   antes si todos aceptaron o se quedaron sin intentos. Nombre: «Traza a ciegas».
2. **El autómata** (`server/domain/pda.js`): los dos PDA de la exposición uno detrás del otro, con
   seis estados. q0 y q1 son el aⁿbⁿ; q2 apila w y una ε adivina la mitad; q3 compara; al final, con
   Z₀ en el tope, «ε, Z₀ / Z₀» lleva a q4 (final) y «ε, Z₀ / ε» lleva a q5 (vacía la pila). Cada
   partida acepta **por estado final o por pila vacía** (al azar), y eso se ve en el celular de la
   cadena: lo tienen que decir. L(P) = N(P) = { aⁿbⁿ w wᴿ | n ≥ 1, w ∈ {0,1}* }. Rótulos con X
   («0, X / 0X»: X es cualquier símbolo de la pila) para que quepa en el celular. Cadenas de 8 o 10
   símbolos (n de 1 a 3, w de 2 o 3), incluidas las de w repetido (aabb0000): piden 11 o 13 toques,
   3 de ellos ε.
3. **Error.** Los dos celulares muestran durante 3 s (`swapMs`) qué tocaron, por qué no era y el
   paso correcto; luego **cambian de papel** (el diagrama pasa al otro celular) y vuelven a
   (q0, cadena, Z₀). El tiempo no se detiene. Con el segundo error quedan **sin intentos** (sin el
   paso correcto: los demás siguen con la misma cadena). Un toque a menos de 0,3 s del anterior se
   ignora. Con el compañero desconectado, el celular ve el diagrama y la cadena y toca él.
4. **Puntos** (de la ronda 1; el juego los escala con la ronda y la compensación, como siempre): el
   primero en aceptar gana 1000 y el fragmento; los demás que aceptan, 200 + 600 × (tiempo que
   sobraba ÷ 120 s), a la decena (de 800 a 200). Sin aceptar, 0. Empate en el primer puesto: Duelo.
5. **Proyector:** un cronómetro por equipo (los del Laberinto) con dos fichas de intento; la gastada
   se pone roja con ✗. Al aceptar, centro verde y puesto; sin intentos, gris. Nunca muestra el
   diagrama ni la cadena. Resultado: «Primero en aceptar» con el tiempo y el intento. **Host:** la
   cadena, la forma de aceptar y, por equipo, el intento, los pasos y la descripción instantánea.
6. **Plan:** fase A (MVP) y fase B (visual), en la rama `traza` desde `main` ya con el rediseño. El
   **Laberinto se borró** (código, pruebas, demo y estilos; queda en el historial de git). El SRS
   describe el Laberinto (RF-MJ2): este minijuego lo reemplaza; si el SRS se entrega, hay que
   actualizarlo.

## Fase A: que funcione (hecha)

- `server/domain/pda.js`: el autómata, las 24 cadenas y lo justo de un simulador (movimientos,
  aceptación en los dos modos, «¿todavía puede aceptar?», el paso correcto y la traza que acepta).
  Viene del simulador de la exposición (`presentacion/deck/pda/pda.js`).
- `server/minigames/traza.js`: el plugin. Papeles por celular (`trazaRole`), toques con el cambio de
  papel y los intentos, la pantalla del cambio con `nextWakeup`/`onWakeup` (al vencer se difunde la
  vista nueva), pausas (`shiftTimes`), premios por tiempo (`timePrize`) y una vista por papel.
- Configuración en `game.json` (`minigameRules.traza`: instrucciones, `maxDurationMs`, `attempts`,
  `swapMs`, `doubleTapMs`, `modes`, `firstPrize`, `prizeBase`, `prizeByTime`) y `fast.json`; la
  entrada `{ type: 'tap', state }` en `schemas.js`.
- `client/shared/traza.js`: celular (diagrama en SVG con estados tocables, pila, cadena, forma de
  aceptar y las pantallas de error, sin intentos y aceptada), proyector (cronómetros con fichas) y
  host (texto). Demo de las instrucciones en `demos.js`.
- Bots (`scripts/lib/bots.js`): el de la cadena la pasa por la «radio» y el del diagrama toca la
  traza que acepta; se equivocan el 4 % de las veces (`trazaMistakeRate`).
- Pruebas: `tests/traza.test.js` (20: lenguaje del PDA en los dos modos, un solo toque correcto por
  paso, ε, vistas sin filtraciones, error y cambio, rama muerta, la otra salida, segundo error,
  premios, pausas y tiempo agotado) y la de reconexión en `tests/reconnection.test.js`. `npm test`:
  304 en verde. `npm run demo` sin errores; duración máxima estimada sin cambios (42:09).
- Revisado con Edge sin ventana: sala de práctica con dos celulares de 390×844, bots en otros dos
  equipos y el proyector a 1280×720 (instrucciones, diagrama a mitad de camino, error y cambio de
  papel, segundo intento, cadena aceptada y resultado).

## Fase B: lo visual (hecha)

Con los colores de la exposición: amarillo = estado actual, rosado = el arco que se usó, verde =
acepta, rojo = error. Todo en `client/shared/traza.js` y `party.css`; con «reducir movimiento» no
hay animaciones.

- **Diagrama de cartón:** estados con contorno grueso y sombra dura, doble círculo en q₄, nombres en
  Lilita One; el arco y el rótulo del último paso en rosado.
- **Ficha del equipo:** un círculo del color del equipo junto al estado actual que, en cada toque
  correcto, recorre el arco que se usó (también los bucles) y se acomoda en el estado nuevo.
- **Pila animada:** lo que se apila cae desde arriba y lo que se saca sale volando (comparando con la
  pila anterior); el tope en amarillo y el fondo con sombra.
- **Cadena** como cinta de cartón, sin cabezal, con la forma de aceptar en una etiqueta.
- **Error:** el tablero se sacude en los dos celulares (y vibra en Android); en el que tocó, el estado
  equivocado se pone rojo medio segundo antes de la pantalla del error. Las tarjetas del error, de
  «sin intentos» y de la cadena aceptada entran con un rebote. Al terminar el cambio de papel, el
  tablero nuevo entra desde el costado: el diagrama «llega» del otro celular.
- **Resultado en el proyector:** al lado del ganador, el **repaso de la traza** que acepta la cadena
  de la partida, en bucle: la cinta (ahora con el cabezal y lo leído en gris), el diagrama con la
  ficha, la pila, la descripción instantánea y «Paso 3 de 11 · ε, Z₀ / Z₀ (no lee nada)». El servidor
  lo manda en el resultado (`replay`, ver PROTOCOL.md). Se reutiliza mientras dure la fase.
- Demo de las instrucciones (`demos.js`): la cinta, el globo con lo que se dicta («a», «ε: no
  avanzo») y los estados que se encienden toque a toque.
- Pruebas: 21 en `tests/traza.test.js` (se agregó la del repaso); `npm test` y `npm run demo` en
  verde. Revisado con capturas a 390×844 y 360×740 en el celular y a 1280×720 en el proyector:
  ficha y arco usados, parpadeo rojo, tarjeta del error, cambio de papel, cadena aceptada y repaso.
  Se corrigió el primer cuadro de las animaciones (puede llegar con un instante anterior al de
  arranque: la demo y el repaso fallaban a veces).

## Cómo seguir

1. Probar con celulares de verdad (sala de práctica de la Traza desde el host): que los estados se
   toquen bien con el dedo, que se lea el diagrama a 360 px y el repaso desde el fondo del salón.
2. Llevar la rama `traza` a `main` cuando el equipo lo decida (un push a `main` despliega).
