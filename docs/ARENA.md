# Arena con poderes

El 9 de octubre de 2026 el equipo pidió mejorar la Arena (ronda 5), que todavía era un prototipo:
que al jefe le cueste más caer, pero no sea imposible, según cuántos retadores y cuántos jefes haya;
poderes que aparezcan en lugares fijos, y algo que rompa la monotonía del minuto y medio. La
propuesta se armó en un artifact («Arena con poderes»,
privado) y el equipo aprobó todas las decisiones tal como estaban. Se trabajó en dos fases:
primero las reglas con un dibujo simple (A, rama `arena-poderes`, en `main` desde el PR #13) y
después el diseño temático (B, rama `arena-automata`). Las dos están hechas; la B, sin commit.

## Decisiones aprobadas

1. **Vida del jefe.** Cada vehículo jefe tiene `hpPerChallenger × N × p ÷ B`, con
   `p = 1 ÷ (1 + pressure × B ÷ N)` y al menos `minHp` (N: celulares retadores conectados al empezar;
   B: vehículos jefe; un equipo jefe con dos celulares son 2). Valores de partida: 42, 1,5 y 10 (desde
   la prueba del 9 de octubre, `hpPerChallenger` es 86: ver «Registro de ajustes»). `p`
   es la parte del tiempo que un retador puede dedicar a pegarle: baja cuando hay más jefes por
   retador. Con 1,5, la fórmula espera 0,2 golpes por segundo en un 2 contra 2; en la práctica del 7 de
   octubre se midieron 0,18. Si el modelo acierta, jugando normal el jefe cae hacia el segundo 73 con
   cualquier cantidad de jugadores. Antes (20 por retador, sin `p`) 2 contra 2 era casi imposible y 12
   contra 2 caía hacia el segundo 50. **Se recalibra con personas**: ver «Calibración pendiente».
2. **Puntos por golpe:** se quedan en 10, aunque con más vida haya más golpes.
3. **Poderes:** los seis.
4. **Cuándo aparecen:** en oleadas a los 10, 30, 50 y 70 s (con la Arena de 75 s, a los 8, 25, 42 y
   58 s: ver «Registro de ajustes»).
5. **El jefe aplasta las cajas** que pisa.
6. **Estados del jefe** q₀, q₁ y q₂, con el anillo de balas al cambiar.
7. **Diseño:** A, «El Autómata» (fase B).

## Reglas (fase A, hecha)

- **Cajas:** ocho puntos fijos, diseñados en un cuarto y girados como el mapa
  (`server/domain/arenaMap.js`, `pads`). Cuatro en los ejes, entre el bloque y el jefe, a 540 del
  centro: dan los poderes fuertes (Estado trampa, Desbordamiento, Apilar doble). Cuatro en las
  esquinas, detrás de la L y junto a la reaparición: dan los de apoyo (No determinismo, Lazo,
  Transición ε). Cada oleada llena los ocho con un poder al azar del grupo de cada punto (una caja que
  nadie tomó se reemplaza). En la última, si los jefes conservan más de la mitad de su vida
  (`comebackAbove`), todos los puntos traen poderes fuertes. El azar sale de una semilla guardada en
  el estado (queda en el log, `minigame_started`).
- **Recoger:** el vehículo vivo más cercano al centro de la caja entre los que la tocan
  (`padRadius` + su radio), decidido por el servidor tick a tick, como los impactos. El retador se
  lleva el poder (reemplaza al que tenía); el jefe la aplasta. El poder se activa solo y se pierde al
  caer.
- **Los seis poderes** (`powers` en `game.json`; `ms` es cuánto dura como máximo):
  - **Estado trampa** (bala congelante): las próximas 3 balas que le peguen al jefe lo congelan 0,5 s;
    después queda inmune 2 s. Congelado no se mueve ni dispara: el servidor lo deja donde estaba y le
    responde la corrección, y su celular se detiene solo al enterarse por el fotograma. Si el golpe
    llega cuando el jefe está inmune, no gasta carga.
  - **Desbordamiento** (explota al morir): si el retador cae mientras lo lleva, quita 6 a cada jefe a
    menos de 260 del borde de su vehículo (no a uno con escudo). Cuenta como golpes suyos.
  - **Apilar doble:** cada golpe al jefe cuenta 2, durante 8 s.
  - **No determinismo:** cada disparo sale en 3 balas en abanico de 12°, durante 8 s.
  - **Lazo:** absorbe los próximos 2 golpes del jefe (hasta 15 s).
  - **Transición ε:** 50 % más de velocidad durante 6 s. El servidor acepta esa velocidad hasta 10 ticks
    después de que vence, porque el celular se entera tarde.
- **Estados del jefe** (`boss.states`): q₀ como antes; bajo 66 % de su vida, q₁ (5 balas cada
  750 ms); bajo 33 %, q₂ (3 balas cada 450 ms y velocidad 330). Al cambiar, 1 s de escudo y un anillo
  de 12 balas (`boss.ring`); si cruza dos umbrales de una vez, el anillo sale una sola vez.
- **Fotograma:** cada vehículo lleva cinco datos más (poder, hasta cuándo, cargas, congelado hasta y
  estado del jefe), y van `p` (el poder de cada caja) y `w` (oleadas que salieron y si la última fue
  de remontada). Cada bala se repite en los fotogramas 8 ticks desde que el servidor la conoce, no
  desde que se disparó: el anillo nace al decidir los impactos (hasta 300 ms atrás) y, si no, no
  llegaba a las pantallas.
- **Log:** `arena_wave`, `arena_power`, `arena_crushed`, `arena_blast`, `arena_stage` y, al cerrar,
  `arena_summary` (retadores, vehículos jefe, vida que le quedó y la máxima, en qué momento cayó,
  oleadas y poderes recogidos). `npm run demo` imprime ese resumen en una línea.
- **Dibujo provisional** (`client/shared/arena.js`; la fase B lo reemplazó): cajas como cuadros con el
  emoji del poder (rosados en los ejes, amarillos en las esquinas) y en el minimapa; en el celular, el
  poder propio abajo al centro con un aro que se vacía y sus cargas, y la línea de arriba explica
  el poder recién tomado; cinta «¡Poderes en el mapa!» (o «¡Última oleada: poderes fuertes!») en el
  celular y el proyector; jefe congelado con una capa de hielo y «¡Te congelaron!» en su celular;
  aro del jefe que cambia de color con el estado y q₀/q₁/q₂ junto a su barra y en el lateral del
  proyector; explosión de Desbordamiento con su alcance real.
- **Bots:** al 60 % de los retadores les gustan las cajas: si no tienen poder, van por la más cercana
  a menos de 700. El jefe dispara con las reglas de su estado.
- **Pruebas:** 16 nuevas en `tests/arena.test.js` (vida según N y B; oleadas, recoger, reemplazar,
  aplastar, perder el poder y oleada de remontada; cada poder; estados y anillo; resumen). `npm test`:
  329 en verde. `npm run demo` sin errores (12 retadores contra 2 jefes, 404 de vida: los bots lo
  derriban a los 24 s de 30, con 4 oleadas y 18 poderes).
- **Revisado en Edge sin ventana** con una sala de práctica de 12 bots, un celular de 390×844 como
  retador y como jefe, y el proyector a 1280×720: sin errores en las páginas.

**Limitación conocida:** justo cuando el jefe cambia de estado o un retador toma No determinismo,
su celular dispara con las reglas anteriores durante lo que tarda en llegar el fotograma (~100 a
200 ms): en ese celular pueden verse un momento balas que el servidor no creó. Es solo visual.

## Calibración pendiente (con personas)

La fórmula de la vida se aplicó con los valores de la propuesta, pero **hay que ajustarla después de
jugar con personas**: los bots apuntan mucho mejor y no sirven para esto. La meta acordada: si los
retadores se coordinan, el jefe cae cerca del final; **si no trabajan en equipo, el jefe tiene una
posibilidad pequeña de ganar**.

Qué anotar en cada prueba real (práctica o partida):

- Del log (`data/events-*.jsonl`, una línea `arena_summary` por intento): retadores (N), vehículos
  jefe (B), si cayó y en qué momento (`downAtMs`) o cuánta vida le quedó (`bossHp` de `bossMaxHp`) y
  cuántos poderes se recogieron.
- Mirando la partida: si los retadores se coordinaron (atacaban juntos, iban por las cajas fuertes,
  aprovechaban el congelado) o cada uno jugaba solo; cuántas veces congelaron al jefe; si el anillo y
  q₂ cambiaron la pelea.

Qué cambiar según lo observado (en `minigameRules.arena` de `game.json`):

1. **`boss.hpPerChallenger` (hoy 86), lo principal.** El tiempo hasta derribarlo crece en proporción:
   para que caiga en el segundo T cuando hoy cae en el S, usar `valor actual × T ÷ S`. Si un grupo coordinado lo
   derriba antes del segundo 60, subirlo; si ni coordinados lo derriban, bajarlo.
2. **`boss.pressure` (1,5).** Corrige los grupos chicos frente a los grandes. Si con 2 a 4 retadores
   por jefe no lo derriban y con 10 a 14 sí, subirlo (menos vida cuando hay muchos jefes por
   retador); si pasa al revés, bajarlo. Con 0 es la regla anterior.
3. **La posibilidad de que gane el jefe** depende de la diferencia entre jugar coordinados y jugar
   solos. Si los retadores ganan siempre aunque jueguen cada uno por su lado: subir un poco
   `hpPerChallenger` y endurecer el final (q₂ con `fireMs` 400 o más velocidad) para que el último
   tercio exija atacar juntos. Si los poderes deciden demasiado: más `freeze.immuneMs`, menos
   `blast.damage` o quitar un poder fuerte de `pools.axis`. Si el jefe gana demasiado: lo contrario,
   o bajar `comebackAbove` para que la oleada de remontada salga más seguido.
4. **`pointsPerHit` (10).** Con más vida hay más golpes: si la Arena pesa demasiado en el ranking
   final, bajarlo (la propuesta sugería 6 para mantener el total anterior).

Cada cambio se anota aquí con la fecha, N, B y lo observado.

### Registro de ajustes

- **9 de octubre, prueba con personas en la VM** (commit `727a4d0`, sala `20261009T183715-c636`):
  2 retadores contra 2 vehículos jefe, 34 de vida en total (17 por vehículo con 42 por retador). El
  jefe cayó a los **31,9 s** (2 oleadas, 4 poderes recogidos, el jefe pasó a q₁ y q₂ en sus dos
  vehículos): los retadores le pegaron ~1,07 veces por segundo entre los dos, más del doble de lo
  que el modelo esperaba para 2 contra 2. El equipo pidió que el jefe dure **al menos 60 s y como
  mucho 70 s** jugando así, con un tiempo de **75 s** para que tenga una posibilidad pequeña de
  ganar. Cambios: `hpPerChallenger` de 42 a **86** (42 × 65 ÷ 31,9: con el mismo ritmo, 2 contra 2
  tiene 34 por vehículo y cae hacia el segundo 64), `durationMs` de 90 000 a **75 000** y las
  oleadas a los **8, 25, 42 y 58 s** (las de antes, en proporción: con la última a los 70 s, la de
  remontada llegaba con 5 s de juego). `pressure` queda en 1,5. **Ojo:** es un solo dato y con 2
  contra 2; con más retadores por jefe hay que volver a mirar el `arena_summary` (si con 10 a 14
  retadores no lo derriban nunca, bajar `pressure` antes que `hpPerChallenger`).

## Fase B: diseño «El Autómata» (hecha)

El diseño A del artifact, con los colores de la exposición (amarillo = estado actual, rosado = lo
que golpea, celeste = congelado). Solo cambia el dibujo y el titular: la red y las reglas son las de la
fase A. Rama `arena-automata`, desde `main` con la fase A; sin commit.

- **`client/shared/arena-draw.js` (nuevo):** todo el dibujo de la arena, usado por el celular, el
  proyector y el host.
  - **Piso** de papel cuadriculado: línea fina cada 100 (si no quedan demasiado juntas) y marcada
    cada 500, solo la parte que se ve.
  - **Obstáculos:** los rectángulos son trozos de cinta con un símbolo por celda (a, b, X, 0, 1, Z;
    fijos por obstáculo, uno de cada tres en rosado) y los círculos, estados de cartón q₃ a q₆. Los
    que no se ven no se dibujan.
  - **Jefe:** estado final (doble círculo del color del equipo) con su estado adentro; el centro es
    blanco en q₀, amarillo en q₁ y rosado en q₂. Bucle encima que gira despacio, flecha gruesa por
    cañón y, al costado, su pila (Z₀ y una celda por cada 10 % de vida, el tope en amarillo).
    Congelado: capa de hielo con cristales y el copo encima.
  - **Retadores:** estados del color del equipo con su letra y una flecha de transición por cañón.
    El poder que llevan va en una insignia con su ícono; el Lazo dibuja además el bucle y el aro
    celeste, y el Desbordamiento, un aro amarillo que late.
  - **Balas:** las del retador, puntos de su color; las del jefe, celdas de cinta rosadas.
  - **Cajas:** rótulos de transición (tarjeta con δ) con el ícono del poder; rosadas en los ejes y
    amarillas en las esquinas, con un halo que late.
  - **Íconos dibujados** de los seis poderes (en lugar de emojis): copo (Estado trampa), estallido
    (Desbordamiento), dos celdas apiladas (Apilar doble), tres ramas (No determinismo), bucle con
    flecha (Lazo) y doble flecha (Transición ε). El emoji queda solo en el aviso de texto de arriba.
  - **Estado con subíndice:** la fuente Lilita One de la app solo trae el alfabeto latino, así que
    «q₁» y «Z₀» se dibujan como una letra y un número más chico abajo (`stateLabel`).
  - **Efectos:** estallido al caer, chispa del impacto, explosión de Desbordamiento con su alcance
    real (borde punteado) y, al cambiar de estado el jefe, un aro del color nuevo con su estado que
    sube encima (sigue al jefe mientras dura).
- **Celular:** arriba a la izquierda, la **pila del jefe** en lugar de la barra verde: Z₀ y diez
  celdas, las que salen suben y se desvanecen; al lado, su estado en un círculo (blanco, amarillo o
  rosado). La vida propia y los golpes bajan un renglón. El poder propio usa el ícono dibujado. La
  cinta de la oleada va inclinada, como pegada.
- **Proyector y host:** el lateral muestra la **pila de cada vehículo jefe** como en la Traza (celdas
  con X sobre Z₀, el tope en amarillo; las que salen se van volando), celeste si está congelado y
  gris si cayó; al lado, el **diagrama q₀ → q₁ → q₂** con los umbrales (66 %, 33 %) y el estado más
  avanzado en amarillo. Los golpes de cada equipo van en una línea (equipo, barra y número) para que
  todo quepa a 1280×720. El lateral se arma una vez por fase y se actualiza en su lugar (antes se
  rehacía con cada cambio y cortaba las animaciones). Las cajas tienen un tamaño mínimo para verse.
- **Titular:** «¡Vaciaron la pila del jefe!» («¡Vaciaron las pilas de los jefes!» con dos equipos
  jefe); si resiste, sigue «El jefe resistió».
- **Demo de las instrucciones** (`demos.js`): papel cuadriculado, un trozo de cinta y un estado; el
  jefe como estado final con la pila arriba; un retador va a una caja δ, toma Estado trampa, su
  disparo congela al jefe (queda quieto y deja de disparar), la pila se vacía y el jefe pasa a q₁ y a
  q₂ con su aro.
- **«Reducir movimiento»:** sin latido de las cajas ni giro del bucle, la pila no anima las celdas
  que salen y los efectos quedan fijos.
- **Revisado** en Edge sin ventana (sala de práctica con 12 bots, celular de 390×844 como retador y
  como jefe, proyector a 1280×720, instrucciones) y con una galería de todas las piezas: sin errores
  en las páginas. La galería encontró un retador pintado de blanco cuando no se pasaba `flash`
  (`globalAlpha` con NaN); quedó con valor por defecto. `npm test`: 329 en verde.
