# Taller y registro de equipos

La exposición tiene tres partes: las diapositivas ([PRESENTACION.md](PRESENTACION.md)), un taller y
el quiz. Este documento es el del taller, que además resuelve cómo entran los equipos a la sala.

El 10 de octubre de 2026 se propuso el taller en un artifact
(«Taller de la exposición», privado): dos
ejercicios en el celular, «Sé la pila» y «Repara el autómata». El equipo aprobó los dos ejercicios y
cambió cómo se hacen. Lo que sigue es lo que quedó decidido; el artifact no se actualizó.

## Decisiones

1. **Sin competencia.** El taller no da puntos, no tiene cronómetro y el proyector no compara
   equipos: ni carrera de avance, ni «terminaron N de M», ni cuántos fallaron un paso.
2. **A su ritmo.** Cada equipo hace los ejercicios con calma. Equivocarse no cuesta nada: el celular
   explica por qué y deja intentar otra vez. No hay fases con tiempo antes del quiz.
3. **Registro de equipos.** El taller es el momento de registrarse: entra una persona de cada grupo y
   escribe cómo quieren llamarse y los nombres de los integrantes. Los equipos ya no los crea el host.
4. **Repaso y espera.** Al terminar el taller, el equipo queda en un espacio para repasar mientras
   empieza el quiz.
5. **Dos celulares por equipo.** En ese espacio se asegura que entre el segundo celular: el quiz no
   empieza (sin forzar) hasta que todos los equipos tengan los dos.
6. **Los dos ejercicios** son los de la propuesta, con los autómatas de las diapositivas:
   - *Sé la pila:* el autómata lee y el equipo toca lo que hace la pila en cada paso (apilar, sacar,
     queda igual o se detiene) y al final dice si la cadena se acepta. Tres cadenas: `aaabbb` y `abb`
     en aⁿbⁿ por estado final, y `()()` en paréntesis por pila vacía.
   - *Repara el autómata:* al PDA de aⁿbⁿ le falta una transición; el equipo la arma con tres fichas
     (lee, tope, deja) y cinco cadenas de prueba se ponen verdes o rojas. Reto 1: `b, A / ε` en q₁
     (estado final). Reto 2: `ε, Z₀ / ε` en q₂ (pila vacía).

## Cómo queda el ingreso

1. El host crea una **sala con registro** (en `/host`, «Tipo de sala: Partida con registro de
   equipos»). El número de equipos es el máximo; la sala empieza vacía.
2. Una persona de cada grupo abre `/play` (el QR del proyector), toca «Crear mi equipo» y escribe el
   nombre del equipo y sus integrantes. Su celular queda como el primero del equipo.
3. El equipo hace el taller en ese celular (fase 2).
4. El segundo celular entra tocando el nombre del equipo en la lista o escaneando el código que
   muestra el primero (lleva a `/play/#equipo=t3`).
5. Con todos los equipos completos, el host inicia la partida.

La sala de **equipos fijos** sigue existiendo (equipos creados por el host, cada celular elige el
suyo): la usan las salas de práctica, las pruebas y la prueba de carga.

## Fases

Una fase por commit, en la rama `worktree-taller` (worktree `.claude/worktrees/taller`).

### Fase 1 — Registro de equipos (hecha)

- **Servidor.** `createRoom({ workshop: true })` crea la sala sin equipos (`room.workshop =
  { maxTeams, teamSeq }`). `GameEngine.registerTeam` crea el equipo con el primer puesto libre
  (`t1`…`t8`, con su color) y deja al celular en el puesto A; si el celular ya tiene equipo, corrige
  el nombre y los integrantes. `leave` deshace el equipo si sale su último celular. El host puede
  renombrar (`renameTeam`, en cualquier sala) y quitar (`removeTeam`) un equipo. Los textos se
  limpian y validan en `server/domain/registration.js`: nombre de 1 a 24 caracteres y único sin
  importar mayúsculas ni tildes; integrantes entre `workshop.members.min` y `.max` de `game.json`
  (2 a 6), de hasta 40 caracteres.
- **Vistas.** `room.workshop` y `teams[].members` ([PROTOCOL.md](PROTOCOL.md)).
- **Celular** (`client/shared/taller.js`, montado una vez por `play.js`): «Crear mi equipo» con su
  formulario, la lista de equipos para unirse, y la ficha del equipo con sus celulares, el código QR
  para el segundo, «Corregir nombre o integrantes» y «Salir del equipo». Una vista nueva (otro
  equipo que se registra) no borra lo que alguien está escribiendo.
- **Proyector:** el QR de siempre y, al lado, los pasos y los equipos a medida que se registran, con
  sus integrantes y sus dos celulares. **Host:** tipo de sala, equipos registrados y completos,
  integrantes en la tabla, «Renombrar» y «Quitar».
- **Pruebas:** `tests/registro.test.js` (15). Revisado con Edge sin ventana: celulares de 390×844 y
  360×740, proyector a 1920×1080 y host.

### Fase 2 — El taller a su ritmo (hecha)

Al registrarse, el equipo pasa directo al taller: instrucciones del ejercicio 1 → «Sé la pila» →
instrucciones del ejercicio 2 → «Repara el autómata» → ficha del equipo, esperando el quiz.

- **El estado es del equipo y vive en el servidor** (`team.workshop`). Los dos celulares ven lo mismo
  y cualquiera de los dos puede tocar; recargar la página o entrar con el segundo celular retoma
  donde iban. No hay fases ni plazos: el motor solo aplica acciones (`GameEngine.workshopAction`)
  mientras no empiece la partida.
- **Todo lo que decide el taller** está en `server/domain/workshop.js`, como funciones puras: las tres
  cadenas (`RUNS`) y las de práctica (`EXTRA_RUNS`), los dos retos (`LEVELS`) y sus fichas (`CHIPS`),
  qué toca en cada paso (`expectedStep`), los textos que explican un error con la transición exacta, y
  las vistas. Los dos autómatas y el simulador están en `server/domain/pda.js` (`WORKSHOP_PDAS`,
  `runTrace`: lo que hace el autómata con una cadena, se acepte o no).
- **Ejercicio 1.** En cada paso el equipo toca Apilar, Sacar, Queda igual o Se detiene. Si no era,
  el botón se sacude y el aviso dice por qué («Aplica «a, Z₀ / AZ₀»: lee «a», sale Z₀ y entra AZ₀…»);
  no avanza hasta acertar y ese paso ya no cuenta como «a la primera». Cuando el autómata se detiene,
  el equipo dice si la cadena se acepta. 9 + 5 + 7 toques.
- **Ejercicio 2.** Tres renglones de fichas (lee, tope, deja) arman la transición del arco punteado.
  Las cinco pruebas se evalúan en el servidor con cada cambio; tocar una la muestra paso a paso en el
  diagrama y dice dónde se detiene. Entre las 30 combinaciones de cada reto solo una deja las cinco en
  verde (lo comprueban las pruebas), así que no hace falta comparar lenguajes en vivo.
- **Toques dobles y dos celulares a la vez:** cada acción lleva el número de estado que el celular
  tenía en pantalla (`seq`); si ya cambió, se descarta.
- **Celular:** las instrucciones, los dos ejercicios y «Mi equipo» (para ver el código del segundo
  celular o corregir datos sin salir del taller). Usa el diagrama, la pila y la ficha que viaja por el
  arco de la Traza a ciegas (`client/shared/traza.js`, ahora con un `layout` por autómata). Durante un
  ejercicio el tablero ocupa el alto libre y la tira de rondas se esconde.
- **Proyector:** tres pasos (registrarse, hacer el taller, sumar el segundo celular) y el sello
  «¡Listos!» en los equipos que terminaron y tienen sus dos celulares. No muestra por dónde va cada
  uno. **Host:** por dónde va cada equipo y sus pasos a la primera; avisa antes de iniciar si alguno
  no ha terminado.
- **Bots** (`scripts/lib/bots.js`): en una sala con registro cada pareja registra su equipo y hace el
  taller, con tropiezos. `npm run demo` usa la sala con registro (`--sin-taller` para la de equipos
  fijos) y `node scripts/bots.js --create-room --taller` la crea para probar con celulares.
- **Pruebas:** `tests/taller.test.js` (19): una sola respuesta por paso, una sola solución por reto,
  el autómata reparado acepta exactamente aⁿbⁿ (todas las cadenas hasta 8 símbolos), los textos de
  cada error, el recorrido completo, las vistas por rol y una partida con bots. Revisado con Edge sin
  ventana en 390×844 y 360×640: los dos ejercicios caben sin desplazar en 844 de alto; en 640, el
  ejercicio 2 pide desplazar unos 60 px.

### Fase 3 — Repaso, espera y evidencias (hecha)

Al terminar el segundo ejercicio el equipo queda en el **repaso**, hasta que el host inicie el quiz.

- **Primero, el segundo celular.** Si el equipo tiene un solo celular, lo primero que ve es «Falta el
  segundo celular» con su código QR. Cuando entra, el título pasa a «¡Listos para el quiz!». En el
  proyector ese equipo recibe el sello «¡Listos!» y el host no puede iniciar (sin forzar) mientras
  falte algún celular.
- **Mientras esperan** (todo opcional y sin registro de resultados nuevos):
  - *Repasar paso a paso:* las tres ejecuciones del ejercicio 1, con «Anterior» y «Siguiente», la
    transición de cada paso y el veredicto al final.
  - *Sé la pila con otras cadenas:* tres cadenas al azar de `EXTRA_RUNS` (al menos una de paréntesis).
  - *Reparar el autómata otra vez:* los dos retos de nuevo.
  Una práctica se puede dejar a medias («Volver al repaso») y no cambia el resumen de la primera vez.
- **Cómo les fue:** cuántos pasos de «Sé la pila» salieron a la primera y, para cada tropiezo, la
  cadena, la descripción instantánea y la explicación. Es para el equipo: no se compara con nadie.
- **Para repasar:** seis ideas del tema (la transición, la descripción instantánea, cuándo se
  detiene, las dos formas de aceptar y el no determinismo).
- **Evidencias.** El log guarda `team_registered`, cada respuesta (`workshop_step`), cada reto
  (`workshop_level`), cada ejercicio (`workshop_exercise`) y `workshop_done`. En `/host` →
  Estadísticas hay un CSV nuevo, **Taller**: una fila por equipo con sus integrantes, si terminó,
  los minutos que tardó, los pasos a la primera, dónde tropezó y las fichas movidas en cada reto.
  «Resumen por equipo» ahora trae también los integrantes.
- **Pruebas:** 21 en `tests/taller.test.js` (se agregaron la exportación y la tabla). Revisado con
  Edge sin ventana: el repaso con uno y con dos celulares, el paso a paso, las dos prácticas, el
  proyector con equipos en distintas etapas y el host.

### Fase 4 — Lo visual (hecha)

Los ejercicios ya nacieron con el tema de cartón (reutilizan el diagrama, la pila y la ficha de la
Traza a ciegas). Esta fase agregó lo que faltaba y la revisión de punta a punta. Versión 0.13.0.

- **Demos en las instrucciones** (`client/shared/demos.js`, `taller1` y `taller2`): en «Sé la pila»,
  el autómata lee «ab» y se enciende la respuesta de cada paso; en «Repara el autómata», las tres
  fichas arman «b, A / ε» y la prueba pasa de rojo a verde.
- **Movimiento:** al cambiar de pantalla las piezas llegan una tras otra; la ficha recorre el arco de
  cada paso (en los ejercicios, en las pruebas del ejercicio 2 y en el repaso paso a paso); la pila
  apila y saca; un toque equivocado sacude su botón y hace vibrar el celular; «¡Autómata reparado!»
  salta; en el proyector, la tarjeta de un equipo aterriza al registrarse. Con «reducir movimiento»
  no hay ninguna de estas animaciones y la demo queda en un cuadro fijo.
- **Revisado con Edge sin ventana**, sin errores en las páginas: el flujo completo con dos celulares
  del mismo equipo (390×844 y 360×740; el segundo entra con el código, los dos ven lo mismo y uno se
  recarga a mitad del ejercicio), 360×640, «reducir movimiento», el proyector a 1920×1080, el host
  con sus avisos al iniciar y el paso del repaso a la primera pregunta del quiz.
- `npm test`: 366 pruebas (36 nuevas: 15 del registro y 21 del taller). `npm run demo` termina sin
  errores con 14 bots que se registran, hacen el taller y juegan la partida.

### Notas por estudiante y Excel (10 de octubre, rama `notas-xlsx`)

Pedido después de fusionar el taller (PR #16), para entregarle los resultados al profesor.

- **Nota de 0 a 5** según los aciertos en las preguntas del quiz: 5 con todas correctas, 0 con
  ninguna (`5 × aciertos ÷ preguntas`, a un decimal; `grading` en `game.json`). Una pregunta sin
  responder cuenta como incorrecta. El taller no entra en la nota. Como el quiz se responde por
  equipo, todos los integrantes de un equipo tienen la misma.
- **Sin identificación:** el estudiante es el nombre que su equipo escribió al registrarse.
- **Tabla «Estudiantes»** (`studentsTable` en `server/domain/stats.js`): una fila por integrante, en
  orden alfabético, con su equipo, preguntas, aciertos, % de aciertos, nota y si su equipo terminó
  el taller. «Resumen por equipo» también trae la nota.
- **Excel:** en `/host` → Estadísticas, «Todo en Excel (.xlsx)» descarga un libro con todas las
  tablas; la primera hoja es la de estudiantes. Lo escribe `server/domain/xlsx.js` sin dependencias
  (un ZIP con los XML del formato). Probado con dos lectores independientes y con LibreOffice; falta
  abrirlo en Excel.
- **Formulario del equipo:** «− Quitar el último» borra la última fila de integrantes (hasta el
  mínimo de 2).
- `npm test`: 373 pruebas (`tests/xlsx.test.js` y dos más en `tests/stats.test.js`). Versión 0.13.1.

## Cómo seguir

1. **Probarlo con celulares de verdad.** `npm run start:fast` (o `npm start`), en `/host` crear la
   sala «con registro de equipos» y entrar desde dos celulares. Para llenar la sala:
   `node scripts/bots.js --bots 6 --create-room --taller --room-teams 4 --host-token <token>` deja
   tres equipos de bots y un lugar para el de los celulares. Qué mirar: que el teclado del celular no
   tape el formulario, que el segundo celular lea el QR del primero, que los botones se toquen bien
   y que el diagrama se lea en un celular pequeño.
2. **Medir cuánto tarda un grupo real.** No hay tope: el CSV «Taller» trae los minutos de cada
   equipo. Si resulta largo, se puede quitar una cadena de `RUNS` (y ajustar sus pruebas).
3. **Decidir si el quiz espera a todos.** Hoy el host ve quién terminó y decide; al iniciar con
   equipos que siguen en el taller, el panel le pide confirmación.
4. **Llevarlo a `main`** cuando el equipo lo apruebe (un push a `main` despliega). La rama
   `worktree-taller` sale de `main` (`1b2002d`) y no se ha subido.

Lo que queda igual: el quiz no cambia, y la sala de equipos fijos, las de práctica, la prueba de
carga y `npm run duration` siguen como estaban (el taller no tiene tiempos que sumar).
