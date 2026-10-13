# Presentación: autómatas de pila (3.1 y 3.2)

Diapositivas web para la exposición de **3.1 Definición del PDA** y **3.2 Lenguajes de un PDA**, con
diagramas que se animan paso a paso y un control remoto desde el celular. Viven en el mismo servidor
del quiz, pero aparte: otra carpeta (`presentacion/`), otro token y otro canal de Socket.IO.

- **Proyector:** `/slides/` · **Celular (control):** `/remote/`. Las dos piden sesión.
- Duración objetivo: **~22,5 min** de exposición (4 integrantes, entre 5 y 6,5 min cada uno), más diapositivas
  de respaldo para las preguntas. Después vienen el taller y el quiz.
- Lo que **no** nos toca (es del grupo siguiente, 3.3 y 3.4): PDA deterministas y la equivalencia
  entre PDA y gramáticas libres de contexto. Solo se mencionan al cierre como «lo que viene».

## Cómo se usa

### Preparación (una vez)

1. **Nombres:** en `presentacion/deck/deck.js`, la lista `PRESENTERS` (salen en la portada y en el
   celular). Quién expone cada diapositiva es su campo `presenter` (1 a 4).
2. **Token:** generar uno con `openssl rand -hex 32` y ponerlo como `SLIDES_TOKEN=` en el `.env` de la
   VM (y en el `.env` del portátil, para el plan B); luego reiniciar el servidor
   (`sudo systemctl restart automatas-party`). Si falta, el servidor genera uno temporal en cada
   arranque y lo escribe en el log (`journalctl -u automatas-party | grep SLIDES_TOKEN`).
3. **Enlace para cada integrante:** `https://tu-dominio.example/remote/#t=<token>`. Al abrirlo, el
   celular queda con sesión 12 h. Mándenlo por privado, no al grupo del curso: con el token,
   cualquiera puede mover la presentación.

### El día de la exposición

1. Antes de la clase: si el servidor se actualiza solo con cada push, pausar esos despliegues.
2. Portátil del proyector: abrir `https://tu-dominio.example/slides/`, escribir el token y pulsar **F**
   (pantalla completa). Probar un «Siguiente» desde un celular.
3. Celulares: abrir el enlace con el token. Con el menú (☰) se llega al índice, la pantalla negra, el
   cronómetro y las diapositivas de respaldo. El cronómetro arranca solo con el primer «Siguiente»
   desde la portada.
4. Para el quiz: abrir `/screen/` en otra pestaña del portátil. El último paso del cierre muestra el
   QR del quiz (úsenlo solo si el quiz va enseguida). Después del cierre, «Siguiente» sigue con las 7
   diapositivas que explican el quiz (sección «El quiz»): se cuentan justo antes de empezarlo; si el
   taller va en medio, se vuelve a ellas con el índice del celular.

Teclas del proyector:

| Tecla | Qué hace |
| ----- | -------- |
| → ↓ Espacio AvPág Intro | Siguiente |
| ← ↑ RePág Retroceso | Anterior |
| B o «.» | Pantalla negra (los clickers suelen tener un botón que manda «.») |
| F | Pantalla completa |

`/slides/?debug` muestra arriba la diapositiva, el paso, el `seq` y la conexión.

### Ensayo cronometrado

1. En el celular: menú → «Reiniciar» el cronómetro y volver a la portada.
2. Exponer completo; el cronómetro arranca con el primer «Siguiente». Al terminar, «Pausar».
3. `npm run slides:tiempos` (en la VM, desde la carpeta del repositorio; o copiar
   `data/slides-log.jsonl` y usar `--log <archivo>`): cuánto duró cada diapositiva y cada integrante
   contra el tiempo asignado. Los ensayos anteriores siguen en el log (`--ensayo N`).
4. Ajustar los tiempos asignados (`budget` en `deck.js`) o lo que se dice.

### PDF (plan B y material para compartir)

Abrir `/slides/?print` (una página por paso, unas 140), `/slides/?print=final` (una por diapositiva)
y agregar `&respaldo` para incluir las de respaldo. Arriba aparece la revisión de pasos. Ctrl+P →
«Guardar como PDF», márgenes «Ninguno», «Gráficos de fondo» activado. Hecho en Chrome o Edge.

### Cambiar el contenido

- **Notas y guion:** en `deck.js`, una nota por paso (la primera es la del paso 0). Si una
  diapositiva cambia su número de pasos, hay que cambiar sus notas: `?print` y `npm test` lo avisan.
- **Una diapositiva:** `presentacion/deck/slides/<id>.js` (sus estilos, en `slides/slides.css`). Cada
  `steps.step((tl, at) => …)` agrega un paso; todo se crea al montar y solo se anima con GSAP, sin
  callbacks (ver `engine/steps.js`).
- **Los PDA de ejemplo:** `presentacion/deck/pda/examples.js`; sus diagramas, en `views/layouts.js`.
  Las notas de las ejecuciones se generan solas (`pda/narrate.js`).

## Cómo funciona

### Rutas y acceso

| Ruta | Qué es | Acceso |
| ---- | ------ | ------ |
| `/slides/` | Proyector: lienzo de 1920×1080 que se escala a la pantalla | Sesión |
| `/remote/` | Control para el celular: siguiente/anterior, notas, cronómetro, índice | Sesión |
| `/deck/…` | Motor, diapositivas, simulador y manifiesto (módulos JS y CSS) | Sesión |
| `/vendor/gsap/…` | GSAP, servido desde `node_modules` (no depende de un CDN) | Público |
| `POST /api/slides/login` | Recibe el token y entrega la cookie de sesión | Público, con límite de intentos |
| `POST /api/slides/logout` | Borra la cookie | — |
| Socket.IO `/slides` | Posición actual y órdenes de navegación | Sesión |

- Token propio, **`SLIDES_TOKEN`** en `.env`, distinto de `HOST_TOKEN`: se le puede dar a los cuatro
  integrantes sin darles el control del quiz. Si falta, el servidor genera uno temporal y lo escribe
  en la consola, igual que con `HOST_TOKEN`.
- Sesión: cookie `ap_slides` firmada con HMAC (derivada del token), `HttpOnly`, `SameSite=Lax`,
  `Secure` detrás de HTTPS, válida 12 h. Al ser firmada, un reinicio del servidor no cierra la sesión;
  cambiar el token invalida todas.
- Sin sesión, `/slides/` y `/remote/` responden 401 con la página de ingreso, y `/deck/…` responde
  401: el contenido no se puede descargar sin el token. El canal `/slides` también exige la cookie y
  rechaza conexiones de otro origen.
- Ingreso desde el celular: se escribe el token una vez, o se abre `…/remote/#t=<token>`. Lo que va
  después de `#` no viaja al servidor ni queda en los logs de Caddy; la página lo borra de la barra
  de direcciones al entrar.
- Límite: 10 intentos de ingreso por IP cada 10 minutos.

### Sincronización

- El servidor guarda la posición: diapositiva, paso, pantalla negra, cronómetro y un número de
  secuencia (`seq`). La escribe en `data/slides-state.json`, así un reinicio no pierde el lugar.
- El celular y el teclado del proyector mandan `next`/`prev` con el `seq` que ven. Si dos personas
  tocan «Siguiente» a la vez, el segundo toque llega con un `seq` viejo y se descarta: nunca se salta
  un paso. `goto` (desde el índice) va a una posición exacta.
- «Siguiente» en el último paso pasa a la diapositiva siguiente; «Anterior» en el paso 0 vuelve al
  último paso de la anterior. Después del cierre siguen las diapositivas del quiz. Las de respaldo
  quedan al final: desde la última del quiz «Siguiente» no entra en ellas; se llega con el índice.
- El manifiesto (`presentacion/deck/deck.js`) dice, para cada diapositiva: título, sección, quién
  expone, tiempo asignado y una nota por paso. Lo usan el servidor (para saber cuántos pasos hay),
  el proyector y el celular.
- Cada cambio de posición queda en `data/slides-log.jsonl`; `npm run slides:tiempos` lo convierte
  en una tabla de cuánto duró cada diapositiva y cada integrante en el ensayo.

### Motor del proyector

- Cada diapositiva es un módulo (`presentacion/deck/slides/<id>.js`) que monta su contenido y arma
  una línea de tiempo de GSAP con una etiqueta por paso (`s0`, `s1`, …).
- **Lo que se ve depende solo de (diapositiva, paso).** Avanzar o retroceder un paso anima ese tramo
  (hacia atrás, en reversa); saltar o recargar coloca la línea de tiempo directo en la etiqueta. Si el
  proyector se recarga a mitad de la exposición, vuelve exactamente al mismo punto.
- Si llega una orden mientras algo se anima, la animación en curso termina de golpe y empieza la
  nueva: tocar rápido nunca deja la pantalla a medias.
- Teclado: → / ↓ / Espacio / AvPág para avanzar; ← / ↑ / RePág para retroceder; B o «.» para la
  pantalla negra; F para pantalla completa. Los presentadores USB mandan AvPág/RePág y «.», así que
  un clicker barato también sirve. Sin conexión con el servidor, el teclado navega en local y, al
  volver la conexión, el proyector le pasa su posición.
- `?print` muestra todas las diapositivas paso por paso, una por página de 1920×1080, para guardar un
  PDF con Ctrl+P (`?print=final`: solo el último paso de cada una; `&respaldo` agrega las de
  respaldo). Arriba muestra una revisión: que cada diapositiva tenga los pasos que dice el manifiesto.
- Con «reducir movimiento» del sistema, los pasos cambian sin animación.

### El simulador de PDA

Es la pieza que hace baratos y correctos los diagramas dinámicos:

- `presentacion/deck/pda/pda.js` (puro, sin DOM, con pruebas): descripción instantánea, un paso de
  ⊢, el camino de una cadena (el que acepta si existe; si no, el que consume más entrada), el árbol
  de computación no determinista, la aceptación por estado final y por pila vacía, y las dos
  construcciones del tema: de pila vacía a estado final y de estado final a pila vacía.
- `presentacion/deck/pda/examples.js`: los PDA de la exposición y sus construcciones.
- Las pruebas (`tests/pda.test.js`) comprueban el lenguaje de cada ejemplo con todas las cadenas
  hasta cierta longitud, y que las construcciones aceptan exactamente lo mismo que el original. Ninguna
  traza que se proyecte puede estar mal.
- Vistas animadas (`presentacion/deck/views/`): diagrama de estados en SVG, cinta con cabezal, pila,
  lista de descripciones instantáneas y árbol de computación. `scene.js` las junta: con un PDA y una
  cadena arma los pasos de la ejecución y las notas automáticas de cada paso.

### Control en el celular

- Botón grande «Siguiente», «Anterior» más pequeño; deslizar a la izquierda o a la derecha también
  sirve. Vibra al tocar (en Android).
- Muestra la sección, la diapositiva, quién expone, el paso (puntos), **la nota del paso actual**, el
  guion de la diapositiva y qué viene después (avisa cuando cambia el integrante).
- Cronómetro general (objetivo 22:30) y de la diapositiva contra su tiempo asignado; se pone amarillo
  al 80 % y rojo al pasarse. Arranca solo con el primer «Siguiente» desde la portada.
- Menú: índice para saltar, pantalla negra, cronómetro (iniciar, pausar, reiniciar), cerrar sesión.
- En la diapositiva «Simulador en vivo» aparece un teclado con los símbolos del PDA elegido para
  escribir una cadena; el proyector la ejecuta.
- Mantiene la pantalla encendida (Wake Lock).
- Varios celulares a la vez: los cuatro integrantes pueden tener el control abierto.

## Estructura de la exposición

Tres PDA de ejemplo se reutilizan en toda la exposición:

- **aⁿbⁿ** (determinista, por estado final): para aprender la mecánica.
- **wwᴿ**, palíndromos de longitud par (no determinista, el ejemplo 6.2 de Hopcroft): para el no
  determinismo.
- **Paréntesis balanceados** (un estado, por pila vacía): para 3.2.

| # | Diapositiva | Qué se ve | Expone | Tiempo |
| - | ----------- | --------- | ------ | ------ |
| 1 | Portada | Título, integrantes; una pila de fichas cae y se apila | 1 | 0:30 |
| 2 | Lo que ya conocemos | Un AFD y un AFN para «termina en ab» leen aab: un camino frente a varios a la vez | 1 | 1:00 |
| 3 | ¿Qué le falta a un autómata finito? | Un AF intenta contar las a de aⁿbⁿ y se queda sin estados; dónde aparecen las pilas | 1 | 1:00 |
| 4 | La idea: un AFN-ε con una pila | Solo la pila (con la ficha del fondo, sin símbolo) y la cadena, sin estados: con aabb entra y sale una A por símbolo; con aaabb sobra una A | 1 | 1:15 |
| 5 | Anatomía de una transición | `a, X / α`: sacar, reemplazar y apilar, animados sobre una pila | 1 | 1:15 |
| 6 | Definición formal | P = (Q, Σ, Γ, δ, q₀, Z₀, F): cada componente se ilumina en el diagrama | 1 | 1:30 |
| 7 | Notación gráfica | El PDA de aⁿbⁿ se arma arco por arco | 2 | 1:00 |
| 8 | Descripciones instantáneas | La «foto» con un ejemplo y en palabras, luego (q, w, γ); un movimiento y varios, leídos antes de escribirlos con ⊢ y ⊢*; la regla general | 2 | 1:15 |
| 9 | Simulación: aabb | Diagrama, cinta, pila y descripciones avanzan juntos, un paso por toque | 2 | 1:30 |
| 10 | Cuando no se acepta | aab termina en un estado no final; abb llega a q₂ con entrada sin leer | 2 | 1:00 |
| 11 | wwᴿ: apilar una mitad y compararla | La estrategia, sin estados: con 0110 se apila 01 y se saca comparando con 10 | 3 | 0:45 |
| 12 | Un PDA no determinista: wwᴿ | El diagrama del libro; las transiciones ε «adivinan» la mitad | 3 | 0:45 |
| 13 | Árbol de computación: 0110 | El árbol crece nivel por nivel; las ramas muertas se apagan; basta una que acepte | 3 | 1:30 |
| 14 | Dos formas de aceptar | Empieza con el PDA de aⁿbⁿ y cómo acepta (estado final); luego la pila vacía, cómo se ve en ese autómata (queda Z₀) y la transición que le falta; al final, L(P) y N(P) con símbolos | 3 | 1:45 |
| 15 | Pila vacía en acción | Paréntesis con un solo estado: (()) vacía la pila | 3 | 1:15 |
| 16 | De pila vacía a estado final | El teorema en palabras; se agregan p₀, X₀ y p_f al PDA de paréntesis y se ejecuta () | 4 | 1:45 |
| 17 | De estado final a pila vacía | El teorema en palabras; se agregan p₀, X₀ y el estado que vacía la pila al PDA de aⁿbⁿ y se ejecuta ab | 4 | 1:45 |
| 18 | Mismo poder | Las dos clases de lenguajes son la misma; tabla AF frente a PDA; lo que viene (3.3 y 3.4) | 4 | 1:00 |
| 19 | Cierre | Tres ideas, preguntas y paso al taller; último paso opcional con el QR del quiz | 4 | 0:45 |
| | | | | **22:30** |

Reparto propuesto (se cambia en `deck.js`, campo `presenter`):

| Integrante | Diapositivas | Tema | Tiempo |
| ---------- | ------------ | ---- | ------ |
| 1 | 1–6 | Apertura, repaso de autómatas finitos, la idea y la definición formal | 6:30 |
| 2 | 7–10 | Notación, descripciones instantáneas y ejecución | 4:45 |
| 3 | 11–15 | No determinismo y las dos formas de aceptar | 6:00 |
| 4 | 16–19 | Los dos teoremas, equivalencia y cierre | 5:15 |

Los tiempos son estimados: con los cambios del 12 de octubre la exposición pasó de 19:30 a 22:30 y el
integrante 1 quedó con 6:30. Si hay que recortar o repartir de otra forma, se decide en el ensayo
cronometrado (`budget` y `presenter` en `deck.js`; `tests/deck.test.js` fija el total).

Después del cierre, **el quiz** (sección «El quiz»): 7 diapositivas con las reglas del juego, para
contarlas justo antes de empezarlo. No son parte de la exposición: no tienen integrante ni tiempo
asignado (`presenter` y `budget` en 0 en `deck.js`), así que no cambian el total de 22:30 ni el
reparto. En el celular aparecen como «El quiz». Se numeran aparte (Q1 a Q7) y no cuentan en la barra
de avance del pie: la exposición va de «1 / 19» a «19 / 19» y en las del quiz la barra queda llena.

| # | Diapositiva | Qué se ve |
| - | ----------- | --------- |
| Q1 | El quiz: 6 rondas | La tira de estados del quiz (q₁…q₅ y q_F); las cinco partes de una ronda (pregunta, elegir un objeto, pregunta, minijuego, usar el objeto) y la ronda final: 11 preguntas en total |
| Q2 | Las preguntas: dos celulares | Dos celulares: uno muestra la pregunta y el otro las opciones; una sola respuesta por equipo, cambio de papel, rapidez y racha |
| Q3 | Los objetos | Arriba, los 16 dibujos en tres grupos y el Desafío aparte; un grupo por paso con lo que hace cada objeto (contra otro equipo, con su tipo físico o hechizo; defensas; para tu equipo) y al final el Desafío, «se explica con el duelo» |
| Q4 | Los minijuegos: tres formatos | Individual, en grupos de dos equipos y un tercero que no se revela (el del jefe); ganar da puntos y un fragmento de estrella |
| Q5 | Las estrellas | Una estrella que se llena punta por punta: 1 fragmento = 1000 puntos, 5 fragmentos = 1 estrella = 6000; hay pocos y se pueden robar |
| Q6 | El Desafío y el duelo | El que reta contra el retado; piedra, papel o tijera con un celular por equipo en cada mano; qué pasa si gana (se lleva todas las estrellas y fragmentos) o pierde (nada); también hay duelo en los empates de un minijuego |
| Q7 | Antes de empezar: es un juego | El aviso: el marcador da muchas vueltas a propósito y para la nota solo cuenta responder bien las preguntas |

Los textos de los objetos resumen los de `server/config/items.json`, y los valores de las estrellas
son los de `game.json` (`stars`): si cambian allá, hay que cambiarlos en `slides/quiz-objetos.js` y
`slides/quiz-estrellas.js`. Los dibujos de los objetos se leen de `client/assets/items/`.

Respaldo, al final (no cuentan en el tiempo):

- **R1 · Simulador en vivo:** se escribe una cadena en el celular y el proyector la ejecuta con
  cualquiera de los tres PDA (para «¿y qué pasa con…?»).
- **R2 · ¿Qué falla sin X₀?** Un P_F que vacía su pila sin aceptar: sin el marcador, la construcción
  aceptaría «b», que no está en el lenguaje.
- **R3 · Lo que no se ve no importa:** las propiedades de las descripciones instantáneas (agregar
  entrada al final o pila por debajo no cambia la computación; teoremas 6.5 y 6.6 de Hopcroft).
- **R4 · ¿Qué no puede hacer un PDA?** aⁿbⁿcⁿ: una sola pila no alcanza para contar dos veces.

## Reglas de animación

- Cada toque produce un solo cambio. Algo se mueve solo si cambia algo en el autómata (estado, cinta
  o pila) o si aparece una idea nueva; nada decorativo en bucle.
- Cada animación dura 0,6 s o menos y se mueven a lo sumo 2 o 3 cosas a la vez. Todas las
  diapositivas entran y salen con la misma transición corta (~0,4 s).
- Texto de 28 px como mínimo en el lienzo de 1920×1080; títulos de ~72 px. Poco texto en pantalla:
  el resto va en las notas del celular.
- Colores con significado fijo: amarillo = estado actual, rosado = transición que se usa, verde =
  acepta, rojo = rechaza. Contorno grueso y sombra dura, como el quiz.

## Plan B

1. **Normal:** la VM (`https://tu-dominio.example/slides/`) y el control en el celular.
2. **Falla el celular:** teclado del portátil o un clicker USB (comparten la posición del servidor).
3. **Falla internet:** `npm start` en el portátil y abrir `http://localhost:3000/slides/` (con
   `SLIDES_TOKEN` en el `.env` local). Para el control desde el celular por la red local:
   `HOST=0.0.0.0`.
4. **Falla todo:** el PDF exportado con `?print`, que también sirve como material para compartir.

Antes de la clase, si el servidor se actualiza solo con cada push, pausar esos despliegues,
para que un push no reinicie el servidor en plena exposición.

## Fases

Una fase por commit, en la rama `presentacion`.

### P0 — Acceso protegido y control

Incluye:

- `SLIDES_TOKEN`, ingreso, cookie firmada, middleware para `/slides/`, `/remote/` y `/deck/`, y la
  página de ingreso (con `#t=`).
- Canal `/slides` de Socket.IO con la misma cookie y comprobación de origen.
- Posición en el servidor (`server/slides/`): siguiente, anterior, ir a, pantalla negra, cronómetro,
  descarte por `seq`, límites entre diapositivas principales y de respaldo, persistencia y log.
- Manifiesto inicial con las 17 diapositivas y las de respaldo; proyector y celular mínimos.

Cómo se verifica: pruebas de acceso (sin cookie, token malo, límite de intentos, socket rechazado,
origen ajeno), de la navegación (bordes, `seq` viejo, respaldo, persistencia) y que las pruebas del
juego sigan pasando.

### P1 — Motor de diapositivas y control completo

Incluye:

- Lienzo de 1920×1080 escalado, módulos con pasos (`steps.js`), avance y retroceso animados, saltos,
  transición entre diapositivas, pantalla negra, pantalla completa, teclado y modo sin conexión.
- Pie con la sección y el número; aviso de conexión solo si se cae.
- Modo `?print` con la revisión de pasos.
- Control completo: notas por paso, guion, siguiente, cronómetros, índice, menú, deslizar, vibración y
  Wake Lock.
- GSAP 3 como dependencia, servido desde `node_modules`.

Cómo se verifica: recargar el proyector a mitad de una animación; tocar muy rápido; 1920×1080 y
1280×720; celulares de 360 a 430 px de ancho.

### P2 — Simulador y componentes

Incluye `pda.js`, `examples.js`, las pruebas de los lenguajes y de las construcciones, y las vistas:
diagrama (estados, flecha inicial, estados finales, arcos rectos, curvos y bucles, etiquetas por
transición, caja alrededor de un PDA dentro de una construcción), cinta, pila, descripciones
instantáneas, árbol y escena.

Cómo se verifica: `npm test`; en `?print`, las escenas de prueba con cada componente.

### P3 — Contenido

Las 17 diapositivas, las 4 de respaldo, el guion y la nota de cada paso.

Cómo se verifica: el equipo lee las notas y las diapositivas contra el libro del curso; `?print`
sin errores de pasos.

### P4 — Ensayo y plan B

`npm run slides:tiempos` (duración real por diapositiva e integrante a partir del log), la sección
de uso de este documento, el README y `.env.example`.

Cómo se verifica (lo hace el equipo): ensayo completo cronometrado, PDF con `?print`, prueba con los
celulares de los cuatro integrantes y en el proyector del salón.

## Estado

- 8 de octubre de 2026: plan escrito; empieza la P0.
- **P0 hecha.** `server/slides/` (sesión, posición, disco y rutas), página de ingreso, proyector y
  control mínimos, manifiesto con las 17 diapositivas y las 4 de respaldo. 21 pruebas nuevas en
  `tests/slides.test.js`; el juego sigue pasando las suyas.
- **P1 hecha.** Motor (`presentacion/deck/engine/`): lienzo escalado, pasos con GSAP, transiciones,
  pantalla negra, teclado, modo sin conexión y `?print` con revisión. Control completo en el celular
  (notas, guion, cronómetros, índice, menú, deslizar, simulador en vivo, Wake Lock). GSAP 3.15 como
  dependencia, servido en `/vendor/gsap`. Revisado con Edge sin ventana: proyector a 1920×1080 y
  celulares de 390×844 y 360×640, sincronizados.
- **P2 hecha.** Simulador (`presentacion/deck/pda/`: `pda.js`, `examples.js`, `narrate.js`) con 19
  pruebas en `tests/pda.test.js` (lenguajes de los ejemplos, las dos construcciones, el contraejemplo
  sin X₀, trazas, árbol de 0110 y simulador en vivo). Vistas en `presentacion/deck/views/`: diagrama,
  cinta, pila, descripciones instantáneas, árbol y escenas. La diapositiva R1 (simulador en vivo)
  las usa todas; se probó de punta a punta: el celular elige wwᴿ y 0110, el proyector anima el árbol
  y al recargarlo vuelve al mismo paso. La presentación usa su propio `theme.css` (las clases de
  `party.css` del quiz chocaban con las de la cinta).
- **P3 hecha.** Las 17 diapositivas y las 4 de respaldo (`presentacion/deck/slides/`), con guion y
  una nota por paso en `deck.js` (las de las ejecuciones salen del simulador, así siempre coinciden
  con lo que se anima). 91 pasos en total. `tests/deck.test.js` revisa el manifiesto (módulos,
  tiempos, reparto, notas). Revisado con Edge sin ventana: `?print` sin problemas de pasos y sin
  errores; todas las diapositivas en su último paso y las de los teoremas paso por paso; recorrido
  completo desde el celular (95 toques, algunos muy rápidos) y 30 toques rápidos hacia atrás, sin
  errores y sin perder toques.
- **P4 hecha.** `npm run slides:tiempos` (`scripts/slides-times.js`, con pruebas en
  `tests/slides-times.test.js`), la sección «Cómo se usa» de este documento, el README, el enlace en
  la página de inicio y `SLIDES_TOKEN` en `.env.example`. `npm test`: 272 pruebas (225 del juego y
  47 de la presentación).
- **12 de octubre de 2026: ajustes de contenido** (primero la intuición y las palabras, después los
  símbolos). Dos diapositivas nuevas: «Lo que ya conocemos» (`finitos`: un AFD y un AFN leyendo aab)
  y «wwᴿ: apilar una mitad y compararla» (`mitades`: la estrategia antes del diagrama y del árbol).
  Rehechas: «La idea» (solo la pila, que empieza vacía, y la cadena: aabb símbolo por símbolo y
  aaabb de corrido; Z₀ aparece después, con las transiciones), «Descripciones instantáneas» (la
  foto con un ejemplo, y ⊢ y ⊢* leídos antes de escribirlos) y «Dos formas de aceptar» (cada criterio
  en palabras y luego su fórmula, con colores que unen las dos). La simulación quedó igual. Ahora
  son 19 diapositivas, 108 pasos y 22:30 estimados. Revisado con Edge sin ventana: `?print` sin
  problemas, y cada paso se ve igual al llegar hacia adelante, hacia atrás o de un salto.
- **12 de octubre de 2026, segunda ronda.** «La idea»: la pila muestra la ficha del fondo (la de Z₀)
  sin su símbolo. «Dos formas de aceptar» empieza con el diagrama de aⁿbⁿ y el texto de que acepta
  por estado final; después presenta la pila vacía, muestra que en ese autómata queda Z₀ y agrega
  la transición ε, Z₀ / ε en q₂; las fórmulas quedan para el último paso (5 pasos en vez de 6). Los
  enunciados y los rótulos de los dos teoremas, y los textos de «Pila vacía en acción» y «Mismo
  poder», pasaron de símbolos (L = N(P_N)…) a frases. Las ejecuciones no cambiaron. 107 pasos.

- **13 de octubre de 2026: diapositivas del quiz.** Después del cierre, una sección nueva, «El quiz»,
  con 7 diapositivas (`slides/quiz-*.js`; lo común, en `quiz-common.js`): las 6 rondas, las
  preguntas con dos celulares, los objetos, los tres formatos de minijuego, las estrellas, el
  Desafío y el duelo, y el aviso de que el marcador es volátil y la nota sale solo de las respuestas.
  Sin integrante ni tiempo asignado: el total sigue en 22:30. Ahora son 26 diapositivas principales
  y 137 pasos. Revisado con Edge sin ventana: `?print` sin problemas de pasos ni desbordes, y el
  recorrido en vivo hacia adelante y hacia atrás se ve igual.

- **13 de octubre de 2026, ajustes a las del quiz.** El pie cuenta solo la exposición (`slideGroup`
  en `ui.js`): «n / 19» y la barra llena en el cierre; las del quiz llevan Q1 a Q7, igual en el
  celular y en `slides:tiempos`. «Los objetos» ya no muestra el Contrarreloj (se desactivó en el
  quiz: quedan 16 y el Desafío) y de las defensas dice que son raras de encontrar, sin decir cuántas
  veces salen.

### Lo que falta (lo hace el equipo)

1. **Nombres** en `PRESENTERS` y, si quieren, otro reparto (`presenter` de cada diapositiva).
2. **`SLIDES_TOKEN` en el `.env` de la VM** y repartir el enlace del control a los cuatro.
3. **Revisar el contenido** contra lo que vio el curso: notación (P = (Q, Σ, Γ, δ, q₀, Z₀, F), la
   pila con el tope a la izquierda, ⊢ y ⊢*), los ejemplos y las notas de cada paso. Si el profesor usa
   otra notación, se cambia en las diapositivas y en `deck.js`.
4. **Ensayo cronometrado** con los cuatro (`npm run slides:tiempos`) y ajuste de los tiempos.
5. **Probar en el salón:** el proyector (resolución, contraste, que se lea desde el fondo), el
   portátil en pantalla completa y los celulares de los cuatro (Android y iPhone: sesión, Wake Lock,
   deslizar; la vibración solo existe en Android). Probar también un corte de red del celular
   (sigue el teclado) y recargar el proyector a mitad de una diapositiva.
6. **Exportar el PDF** de respaldo con `?print` y guardarlo en el portátil.
7. **El quiz:** las 11 preguntas siguen siendo de ejemplo; conviene sacarlas de estas diapositivas.
   Decidir quién cuenta las diapositivas del quiz y en qué momento (antes o después del taller).
8. **Llevar a `main`** cuando esté revisado (un push a `main` despliega en la VM).
