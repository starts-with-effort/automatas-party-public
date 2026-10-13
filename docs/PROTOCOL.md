# Protocolo cliente–servidor

Contrato entre el servidor y las tres interfaces (`/play`, `/screen`, `/host`). Concreta la sección
3.10 de la especificación. Cambiarlo afecta a todos: acuérdenlo en equipo antes de tocarlo.

## Principios

- **Servidor autoritativo.** El cliente solo envía intenciones; el servidor valida, decide y responde.
- **Una vista completa por cliente.** El servidor envía `state:sync` con todo lo que ese dispositivo
  debe ver, y solo cuando cambió para él. No hay eventos incrementales que ordenar: reconectar es
  igual que conectar por primera vez.
- **Tiempos absolutos.** Todos los instantes (`startsAt`, `endsAt`, …) están en milisegundos del reloj
  del servidor (epoch). Cada cliente calcula `horaServidor = Date.now() + offset` con TimeSync.

> Diferencia con la sección 3.10: `lobby:update` y `phase:change` se reemplazan por `state:sync`.
> Los minijuegos usan `mg:input` para sus entradas; la Arena, el único en tiempo real continuo, además
> difunde `mg:frame` (20 por segundo) fuera de la vista completa.

## Conexión

Socket.IO 4 en el mismo origen. Cada conexión se identifica en el *handshake* (`auth`):

| Rol | `auth` | Notas |
| --- | ------ | ----- |
| Jugador | `{ role: 'play', token? }` | `token` = token de sesión guardado en `localStorage`. Sin token, o con uno desconocido, se crea un dispositivo nuevo. |
| Proyector | `{ role: 'screen' }` | Solo lectura. |
| Host | `{ role: 'host', token }` | `token` = `HOST_TOKEN` del servidor. |

Si la conexión se rechaza, el cliente recibe `connect_error` con `invalid_role` o `unauthorized`
(no se reintenta solo).

El WebSocket va comprimido (permessage-deflate, con el contexto compartido entre mensajes): los
mensajes de 256 bytes o más ocupan de 6 a 17 veces menos. Los navegadores lo negocian solos.

## Servidor → cliente

| Evento | Para | Datos | Uso |
| ------ | ---- | ----- | --- |
| `session:welcome` | play | `{ deviceId, token }` | `token` solo viene (no nulo) si se creó un dispositivo: guardarlo. |
| `session:ended` | play | `{ reason: 'kicked' \| 'replaced' }` | Luego el servidor cierra la conexión. `kicked`: borrar el token. `replaced`: la misma sesión se abrió en otra pestaña. |
| `state:sync` | todos | vista (abajo) | Al conectar y cada vez que la vista de ese cliente cambia. Trae `serverTime`: la hora del servidor en que se envió. |
| `host:flash` | todos | `{ n, startsAt }` | Prueba de sincronización: destellar en `startsAt`. |
| `host:announce` | todos | `{ text }` | Aviso del host. |
| `mg:frame` | todos | fotograma de la Arena (abajo) | Cada `frameMs` (50 ms) mientras se juega la Arena, el mismo para todos. Volátil: si la conexión está ocupada se descarta; el siguiente lo reemplaza. No pasa por `state:sync` ni se guarda en el snapshot. |

## Cliente → servidor

Todos los mensajes usan *acknowledgement*: la respuesta es `{ ok: true, ... }` o
`{ ok: false, error }`. El servidor valida el esquema (zod) y limita la frecuencia por conexión.

| Evento | Rol | Datos | Máx./s | Respuesta |
| ------ | --- | ----- | ------ | --------- |
| `time:ping` | todos | `{ t0 }` | 20 | `{ t0, tServer }` |
| `time:report` | todos | `{ rtt, offset }` | 2 | — (el host ve la latencia de cada dispositivo) |
| `lobby:join` | play | `{ teamId }` | 4 | `{ ok, slot }` |
| `lobby:leave` | play | `{}` | 4 | `{ ok }` — en la sala con registro, si era el último celular del equipo, el equipo se deshace |
| `lobby:register` | play | `{ name, members: [nombre] }` | 2 | `{ ok, teamId, slot }` — sala con registro ([TALLER.md](TALLER.md)): crea el equipo y deja al celular en el puesto A. Si el celular ya está en un equipo, corrige el nombre y los integrantes de ese equipo |
| `taller:act` | play | `{ type, seq, … }` (abajo) | 8 | `{ ok }`, con `correct` en `stack` y `verdict` y con `solved: true` cuando una ficha repara el autómata — una acción del taller del equipo, mientras no empiece la partida |
| `question:answer` | play | `{ questionId, option, tClient? }` | 4 | `{ ok }`, o `{ ok, secondChance: true }` con Segunda Vida |
| `item:pick` | play | `{ offerId, codes }` | 4 | `{ ok }` — draft: 1 código (2 con Ticket Dorado) |
| `item:declare` | play | `{ itemId, targetTeamId? }` | 6 | `{ ok }` — fase de uso; `targetTeamId` si el objeto es contra un equipo |
| `item:undeclare` | play | `{ itemId }` | 6 | `{ ok }` — retirar antes de confirmar |
| `item:confirm` | play | `{}` | 4 | `{ ok }` — el equipo terminó de declarar |
| `duel:pick` | play | `{ option }` | 4 | `{ ok }` — Duelo: `piedra`, `papel` o `tijera` en la mano en curso; solo el celular del turno de su lado (`myTurn`); los demás reciben `not_your_turn` |
| `mg:input` | play | `{ type: 'clicks', count }`, `{ type: 'flip', card }`, `{ type: 'tap', state }`, `{ type: 'fly', tick, flaps }` o `{ type: 'drive', life, from, pos, f, shots }` | 20 | `{ ok }` — entrada de minijuego; el Clicker la envía sin esperar respuesta. `tap` (`state`: el estado al que pasa el autómata) responde `{ ok, correct, accepted?, swap?, out? }`; `fly` responde `{ ok, tick, status, x }`; `drive` responde `{ ok, tick, life, status, fix? }` |
| `host:command` | host | `{ action, data }` | 10 | según la acción |

`question:answer`: `option` es el índice 0–3 y `tClient` los milisegundos desde que el celular
habilitó las opciones (`performance.now()`). El servidor acepta `tClient` si
`tServidor − RTT − 150 ≤ tClient ≤ tServidor + 20` (`tServidor` = llegada − `answersAt`); si no, usa
`tServidor − RTT/2` (sección 3.6, paso 4). Solo responde el dispositivo de opciones. La confirmación
nunca dice si la respuesta es correcta (RF-PRE-08), salvo el aviso de Segunda Vida, que es el propio
efecto del objeto.

En el draft y en la fase de uso puede actuar cualquiera de los dos dispositivos del equipo; los dos
ven el mismo estado (RF-OBJ-06, AMB-18).

`taller:act` ([TALLER.md](TALLER.md)): el taller de cada equipo es un estado en el servidor que
avanza con las acciones de cualquiera de sus dos celulares, sin fases ni plazos. `seq` es el número
de estado que el celular tenía en pantalla (`workshop.seq` de su vista): si ya cambió, porque el
otro celular se adelantó o fue un toque doble, la acción se descarta con `stale_action` en vez de
aplicarse al paso siguiente.

| `type` | Datos | Cuándo |
| ------ | ----- | ------ |
| `begin` | — | En las instrucciones de un ejercicio (`intro1`, `intro2`): empezarlo. |
| `stack` | `act`: `push` \| `pop` \| `same` \| `halt` | Ejercicio 1: qué le pasa a la pila en este paso (`halt`: el autómata se detiene). |
| `verdict` | `accept`: booleano | Ejercicio 1, cuando el autómata se detuvo: si la cadena se acepta. |
| `chip` | `slot`: 0 lee, 1 tope, 2 deja; `value`: índice de la ficha o `null` | Ejercicio 2: poner o quitar una ficha de la transición. |
| `next` | — | Tras resolver una cadena o un reto: lo que sigue. |
| `again` | `exercise`: 1 \| 2 | En el repaso: practicar otra vez (el ejercicio 1, con tres cadenas nuevas). |
| `back` | — | En una práctica: volver al repaso sin terminarla. |

Acciones de `host:command`:

| `action` | `data` | Efecto |
| -------- | ------ | ------ |
| `createRoom` | `{ teamCount, names?, confirm?, practice?, workshop? }` | Sala nueva con el ingreso abierto. Con una partida en curso exige `confirm: true`. Con `practice: '<id de minijuego>'` es una sala de práctica: solo ese minijuego, en bucle (instrucciones → juego → resultado → instrucciones…). Con `workshop: true` es una sala con registro: empieza sin equipos, los crean los celulares y `teamCount` es el máximo (no se combina con `practice`). |
| `renameTeam` | `{ teamId, name }` | Cambia el nombre de un equipo, en cualquier sala y en cualquier momento. |
| `removeTeam` | `{ teamId }` | Sala con registro, antes de empezar: quita el equipo; sus celulares quedan sin equipo. |
| `setBosses` | `{ teamIds }` | Solo en la práctica de la Arena: quién es jefe desde el próximo intento. `[]` vuelve a la regla del puntaje. Siempre queda al menos un retador. |
| `setLobby` | `{ open }` | Abre o cierra el ingreso. |
| `start` | `{ force? }` | Inicia. Sin `force` exige todos los equipos con 2 dispositivos; los equipos vacíos no juegan. |
| `next` | — | Avanza una pantalla que espera al host. |
| `skip` | — | Cierra la fase actual como si se acabara el tiempo. |
| `pause` / `resume` | — | Congela y reanuda los plazos. Tras un reinicio del servidor, `resume` reinicia la fase en curso. |
| `move` | `{ deviceId, teamId \| null }` | Mueve un dispositivo de equipo (en cualquier momento). |
| `kick` | `{ deviceId }` | Expulsa el dispositivo; su token deja de valer. |
| `adjust` | `{ teamId, points, reason? }` | Ajuste manual de puntos (RF-HOST-03): `points` ≠ 0, positivo suma y negativo resta, sin bajar de 0. Responde `{ ok, applied, score }` y queda en el log como `score_adjusted`. |
| `flash` | — | Destello sincronizado en todas las pantallas. |
| `announce` | `{ text }` | Aviso de hasta 140 caracteres. |

### Códigos de error

`no_room`, `game_in_progress`, `invalid_team_count`, `game_started`, `lobby_closed`, `unknown_team`,
`unknown_device`, `team_full`, `no_players`, `teams_incomplete`, `not_started`, `game_finished`,
`paused`, `not_paused`, `not_waiting_host`, `no_action_expected`, `not_in_team`, `phase_not_started`,
`invalid_action`, `wrong_question`, `answers_not_open`, `question_closed`, `already_answered`,
`not_options_device`, `option_eliminated`, `wrong_offer`, `invalid_pick`, `already_picked`,
`unknown_item`, `already_declared`, `target_required`, `self_target`, `no_next_draft`,
`duplicate_effect`, `not_declared`, `already_confirmed`, `game_not_started`, `not_your_turn`,
`card_unavailable`, `outside_window`, `already_arrived`, `not_pilot`, `too_fast`,
`implausible_progress`, `not_in_arena`, `invalid_input`, `unknown_minigame`, `not_practice`,
`invalid_minigame`, `no_challengers`, `duel_not_open`, `not_in_duel`,
`no_registration`, `invalid_name`, `invalid_members`, `name_taken`, `teams_full`, `invalid_room_type`,
`stale_action`,
`rate_limited`, `invalid_payload`,
`forbidden`, `unknown_action`, `server_error`.
Los textos en español están en `client/shared/errors.js`.

## Vista (`state:sync`)

```js
{
  role: 'play' | 'screen' | 'host',
  room: null | {
    id, lobbyOpen, started, finished,
    recovered,              // true tras reiniciar el servidor, hasta que el host reanude
    paused: null | { at },
    planLength,             // número total de fases (73 con los 10 Duelos; 4 en una sala de práctica)
    practice: null | { minigame, attempt, bosses },   // sala de práctica: minijuego, intento, jefes fijados
    workshop: null | { maxTeams, members: { min, max } }, // sala con registro: equipos que caben e integrantes por equipo
    fragmentsPerStar,       // fragmentos que hacen una estrella (5): las puntas del dibujo
  },
  // members: integrantes que escribió el equipo al registrarse ([] en la sala de equipos fijos).
  teams: [{ id, name, color, members, score, streak, fragments, stars, slots: { A: Slot | null, B: Slot | null } }],
  phase: null | {
    seq,                    // aumenta en cada fase que empieza (también al reanudar)
    index, id, kind, round, // round 6 = ronda final
    question?, minigame?, minigameName,
    practice?, attempt?,    // solo en una sala de práctica: true y el número de intento
    startsAt,               // mostrar la fase en este instante (RF-FLU-05)
    answersAt?,             // preguntas: se habilitan las opciones (startsAt + lectura)
    playStartsAt?,          // minijuegos: termina la cuenta 3-2-1 y empieza el juego
    endsAt,                 // null: espera al host
    closeAt?,               // preguntas: el servidor cierra (endsAt + margen para respuestas en camino)
    resumeAt,               // tras una pausa: los plazos corren desde aquí
    waitingHost, terminal,
    data,                   // según el tipo de fase (tabla abajo)
  },

  me: { deviceId, teamId, slot, inventory: [{ id, code }] },   // solo play: el inventario de su equipo
  workshop: null | Taller,  // solo play, en la sala con registro y antes de empezar: el taller de su equipo (abajo)
  unassigned: [Slot], consoles: [{ role, rtt, platform }],
  upcoming: [fase], teamLimits: { minCount, maxCount, defaultCount }, // solo host
  minigames: [{ id, name }],                                            // solo host: para crear una práctica
  serverTime,             // hora del servidor (ms) en que se envió; la usa la prueba de carga para
                          // medir la latencia de entrega. No cuenta para decidir si la vista cambió.
}

// Slot para play y screen: { connected }
// Slot para host:          { deviceId, connected, rtt, offset, platform }
// El host además recibe teams[].inventory: [códigos].
// Sala con registro: el proyector y el host reciben teams[].workshopDone (el equipo terminó el
// taller) y el host, teams[].workshop: { stage, where, finished, first, total, slips, changes,
// practices, ms } (por dónde va, pasos a la primera del ejercicio 1, fichas movidas en cada reto y
// lo que tardó). Un celular no recibe nada del taller de otro equipo.
```

Taller del equipo (`workshop`, igual en sus dos celulares). Todas las etapas traen `stage`, `seq` y
`finished` (ya terminó los dos ejercicios alguna vez):

```js
// stage 'intro1' | 'intro2': las instrucciones del ejercicio; nada más.

// stage 'e1' — Sé la pila
{
  again,                          // true en una práctica desde el repaso
  run: { index, count, word, mode: 'final' | 'empty', pdaName, pushSymbol, pda: Diagrama },
  id: { state, input, stack },    // descripción instantánea: lo que falta leer y la pila, del tope al fondo
  last: null | { from, to, label, read },   // la transición del último paso
  steps,                          // pasos dados en esta cadena
  phase: 'step' | 'verdict' | 'solved',
  feedback: null
    | { kind: 'wrong', tapped, text }       // la última respuesta no era: por qué
    | { kind: 'verdict', accepted, text },  // la cadena quedó resuelta: el veredicto y su porqué
  score: { first, total },        // respuestas buenas y cuántas salieron a la primera
}

// stage 'e2' — Repara el autómata
{
  again,
  level: { index, count, mode, goal, solvedText },
  pda: Diagrama,                  // sin la transición que falta, más el arco por armar ({ hole: true, set })
  options: { read: [texto], top: [texto], leave: [texto] },   // las fichas de cada renglón
  sel: [índice | null, índice | null, índice | null],          // las fichas puestas
  tests: [{ word, want, got, end, steps: [{ from, to, label, read, custom, id }] }],
                                  // cada cadena de prueba: si debe aceptarse, si se acepta, cómo
                                  // termina y sus pasos (custom: usó la transición armada)
  solved,
}

// stage 'done' — repaso y espera
{
  summary: { e1: { first, total, slips: [{ word, at, tapped, expected, text }] }, e2: { levels: [{ level, changes }] } },
  practices,                      // veces que practicó de nuevo
  review: [{ word, mode, pdaName, pda, accepted, verdict, steps: [{ from, to, label, read, act, id }] }],
                                  // las tres ejecuciones del ejercicio 1, completas
}

// Diagrama: { id, states, start, final, edges: [{ from, to, labels: [texto], hole?, set? }] }
```

Código de ingreso: `GET /api/join-qr.svg` es el QR de `/play/`. Con `?team=t3` codifica
`/play/#equipo=t3`: lo muestra el primer celular de un equipo y el segundo, al abrirlo, se une a ese
equipo sin pasar por la lista.

Catálogo de objetos: `GET /api/items` → `{ items: [{ code, name, text, icon, image, enabled, type,
target, timing }] }`. Es público y no cambia durante la partida: las páginas lo piden una vez al
cargar y la vista solo envía códigos.

Cuenta regresiva: `endsAt − max(ahora, inicio, resumeAt)`, con `inicio = answersAt ?? startsAt`; en
pausa queda fija en `endsAt − max(paused.at, inicio)`. La pausa desplaza todos los instantes de la
fase, así que el t de las respuestas no incluye el tiempo en pausa.

### Tipos de fase

| `kind` | Termina | `data` |
| ------ | ------- | ------ |
| `question` | `closeAt`, o cuando todos los equipos con dispositivos respondieron (o ya no pueden) | ver abajo |
| `questionResult` | Host (o `autoAdvanceMs`) | ver abajo |
| `draft` | Plazo, o cuando todos eligieron | ver abajo |
| `itemUse` | Plazo, o cuando todos confirmaron | ver abajo |
| `resolution` | Host (o `autoAdvanceMs`) | ver abajo |
| `roulette` | Plazo | `{ reel: [nombres], targetIndex, spinMs }` |
| `minigameIntro` | Plazo | `{ name, minigame, instructions, groups: [[teamId]], firstPrize, fragmentRule }` — `firstPrize`: lo que vale el 1.er puesto en esta ronda; `fragmentRule`: quién gana el fragmento |
| `minigame` | Plazo, o cuando el juego termina (Memoria sin cartas, Traza a ciegas con todos aceptados o sin intentos, Flappy sin nadie volando, Arena sin jefes en pie) | `{ groups, game }` — ver abajo |
| `duel` | Cuando se decide el último duelo de la cola (el plazo es un tope); se salta si no hay duelos | ver abajo |
| `minigameResult` | Host (o `autoAdvanceMs`) | `{ minigame, metric, headline?, everyoneScores?, groups: [{ teamIds, score, winner, rank?, label? }], awards: [{ teamId, points, base, catchUp, streak }], fragments: [{ teamId, fragments, stars, starsCompleted, starPoints }], roundFactor, duel: null \| { sides, winner } }` — `rank` y `label` cuando el minijuego ordena por puesto o lo explica en texto (Traza a ciegas: `score` = ms en que aceptó o `null`); `everyoneScores` (Arena): también suma quien no ganó. `replay` (Traza a ciegas): `{ word, mode, pda, steps: [{ from, to, label, read, id }] }`, la traza que acepta, para repasarla en el proyector. `points` = `base` (premio de la ronda 1) × `roundFactor` × `catchUp`; `duel`: el empate que se desempató antes |
| `ranking`, `finalRanking` | Host; `finalRanking` es la última | `{ ranking: [{ teamId, position, score, streak, delta }] }`; `finalRanking` además `highlights` con `bestStreak: { value, teamIds }`, `fastestAnswer: { teamId, question, t }` y `topItem: { code, count }` (cada uno puede ser `null`; RF-RNK-03) |

`delta` es el cambio de puesto respecto al ranking anterior (positivo = subió; `null` en el primero).
Los empatados comparten puesto.

#### `question`

```js
// Todos:
{ questionId, number, difficulty, difficultyLabel, basePoints, timeLimitMs,
  answeredTeamIds, expectedTeamIds,
  effects: [{ code, sourceTeamId, targetTeamId }] }  // objetos que actúan en esta pregunta (públicos)
// Además, host:    statement: { text, image }, options: [4 textos]
// Además, jugador: role: 'statement' | 'options' | 'both',
//                  statement (si role ≠ 'options'), options (si role ≠ 'statement'),
//                  myAnswer: null | { option },     // la opción que eligió su equipo
//                  deadline,                        // su plazo: endsAt, o answersAt + 2T/3 con Reloj Roto
//                  eliminated: [índices],           // Contrarreloj y Segunda Vida
//                  secondChanceUsed,                // ya falló una vez con Segunda Vida
//                  ink: null | { startsAt, answersAt, endsAt, fadeMs }   // Calamar: salpica en startsAt y
//                                                   // en answersAt; se desvanece en los últimos fadeMs
```

Roles (RF-PRE-03/04): en las preguntas impares A tiene el enunciado y B las opciones; en las pares, al
revés. Si el compañero no está conectado, el dispositivo tiene ambos (`both`). Se recalcula en cada
vista. `image` es una ruta dentro de `client/assets/` (se sirve en `/assets/<image>`).

#### `questionResult`

```js
{ questionId, number, difficulty, difficultyLabel, basePoints, timeLimitMs,
  statement, options, correct,
  results: [{ teamId, answered, option, correct, t, points, streak, multiplier,
              modifiers: ['DN']?, secondChance,
              adjustments: [{ code: 'DN' | 'CS', points, teamId? }] }] }   // después de cerrar (5.5)
```

#### `draft`

```js
// Todos:   { pickedTeamIds, expectedTeamIds }
// Jugador: offer: { offerId, codes, picks, luck, extra }, chosen: null | [códigos]
// Host:    offers: { teamId: oferta }, chosen: { teamId: [códigos] }
```

`luck` = puesto + Ticket Dorado; `picks` = 1, o 2 con Ticket Dorado; `extra` = objeto adicional por
no haber respondido una pregunta (se entrega al cerrar el draft, junto con lo elegido).

#### `itemUse`

```js
// Todos:   { confirmedTeamIds, expectedTeamIds, nextDraft }   // nextDraft: false en la ronda 5
// Jugador: declared: [{ itemId, code, targetTeamId }]          // solo las de su equipo
```

#### `resolution`

```js
{ events: [{ kind, code, source, target, by?, reflected?, self?, changes: [{ teamId, points, streak }] }],
  teams: [{ teamId, scoreBefore, scoreAfter, streakBefore, streakAfter }] }
```

`kind`: `defense` (escudo o espejo activado), `reflected` (el Espejo de `target` lo devuelve a
`source`), `blocked` (por el escudo `by`), `hit` (se aplicó ya), `powerup`, `armed` (actuará en la
próxima pregunta o draft; el Desafío, `DS`, en el Duelo que sigue a la resolución). Los eventos van
en el orden de la sección 5.4.

#### `duel`

Piedra, papel o tijera entre dos o más lados (un lado = un equipo o un grupo). Desempata el primer
puesto o el fragmento de un minijuego (`kind: 'minigame'`) o resuelve un Desafío (`kind: 'desafio'`,
`sides = [[atacante], [desafiado]]`). Si hay varios en la cola se juegan uno tras otro.

```js
{ index, count,                 // duelo en curso y cuántos hay en esta fase
  lineup: null | [{ kind, sides, round, minigame, minigameName }],  // con más de un duelo: la lista
  duel: { kind, sides: [[teamId]], round, minigame, minigameName },
  step: 'lineup' | 'intro' | 'pick' | 'reveal' | 'result' | 'void',
  since, until, pickMs,          // inicio y fin del paso en curso
  hand, alive: [lado],           // número de mano y lados que siguen
  picked: [lado],                // durante 'pick': quién ya eligió (no qué)
  turnHand, turns: { lado: { teamId, slot } },  // quién elige en la mano turnHand (la en curso, o la que viene)
  myPick, mySide, mySlot, myTurn, // solo play: la elección de su lado, su lado (−1 si no juega), su slot y si le toca elegir
  stake: null | { fragments, stars, points },   // Desafío: lo del desafiado al empezar
  hands: [{ picks: { lado: opción }, auto: [lado], alive: [lado], turns: { lado: { teamId, slot } } }],  // manos jugadas
  winner, drawn, outcome,        // lado ganador, si salió de un sorteo y lo que se aplicó
  done: [{ id, kind, sides, winner, drawn, outcome }] }
```

Un celular por lado elige en cada mano: los del lado van en rotación (A de cada equipo y luego B),
desde uno al azar, y avanza uno por mano; si el del turno no está conectado, elige el siguiente
conectado. Con más de un duelo, la fase empieza con la cartelera (`lineup`). Un Desafío contra un
equipo sin fragmentos ni estrellas no se juega: paso `void` y `outcome: { stolen: false, empty: true }`.

Sin empates: la misma opción en todos los lados o las tres opciones repiten la mano; con dos
opciones siguen los que eligieron la que gana. Quien no elige en `pickMs` recibe una opción al azar
(`auto`). Tras `maxRounds` manos empatadas, o si el host salta la fase, el ganador se sortea
(`drawn`). `outcome` en un desempate: `{ fragments: [teamId] }`; en un Desafío:
`{ stolen: false }` o `{ stolen: true, fragments, stars, completed, points }` (lo robado y las
estrellas que el atacante completó con eso).

#### `roulette`

Todas las pantallas animan la misma tira desde `startsAt`: la posición es
`(1 − (1 − t)³) · targetIndex` con `t = (ahora − startsAt) / spinMs`, así que se ven igual a la vez.

#### `minigame`

Los grupos se forman al entrar a las instrucciones (`groups`, parejas al azar; con un número impar,
un equipo queda solo; en la Arena, `[jefes, retadores]` según el puntaje) y se mantienen en el
minijuego. `game` depende del minijuego:

```js
// Clicker: la vista se difunde como mucho 4 veces por segundo
{ totals: [clics por grupo],           // los del equipo que juega solo, ya con sus clics adicionales
  teamClicks: { teamId: clics },       // los toques aceptados de cada equipo, sin adicionales
  batchMs }
// Memoria
{ cards: [{ state: 'down' | 'up' | 'gone', face? }],   // face solo mientras está volteada (RF-MJ1-08)
  turn: { group, step: 'first' | 'second' | 'reveal', deadline, cardMs, match, flipper: { teamId, slot } },
  pairs: [parejas por grupo],
  canFlip }                                              // solo jugador: si este dispositivo puede voltear ahora
// Traza a ciegas (un grupo por equipo; todos con la misma cadena)
{ attempts,                                              // intentos por equipo (2)
  progress: [{ teamId, attempt, lost, acceptedMs, outMs, place }],   // lo único que ve el proyector
  // Solo host:
  word, mode: 'final' | 'empty', teams: { teamId: { id: { state, input, stack }, steps } },
  // Solo jugador:
  role: 'diagram' | 'string' | 'both',                   // both: el compañero no está conectado
  attempt, acceptedMs, place, out,
  swapUntil,                   // mientras dura la pantalla del error y el cambio de papel
  error: null | { attempt, tapped, deadBranch, at: { state, top, next }, correct, ms },  // correct: null si quedaron sin intentos
  pda, current: { state, stack }, last: { from, to, label, read }, steps,   // solo diagram y both
  word, mode }                                                              // solo string y both
// Flappy (un grupo por equipo; cada dispositivo juega con su pájaro)
{ length,
  players: [{ teamId, slot, x, status: 'playing' | 'arrived' | 'crashed' }],   // posiciones verificadas
  // Solo jugador:
  level: { ticks, length, lives, pipes: [{ x, gapY, gap }], physics },  // todo lo que usa la simulación
  progressMs,
  me: null | { tick, x, y, vy, lives, safeUntil, pipe, status } }       // su pájaro según el servidor
// Arena (groups = [jefes, retadores]): lo que no cambia durante el juego; lo que se mueve va en mg:frame
{ size, obstacles: [{ x, y, w, h } | { x, y, r }], endTick, view, reportMs, aimConeDeg, respawnMs,
  pads: [{ x, y, ring: 'axis' | 'corner' }],   // puntos de caja de poder; su contenido va en mg:frame (p)
  waves: [tick],                      // cuándo sale cada oleada de poderes
  rules: { boss, challenger },        // radius, speed, fireMs, bullets, spreadDeg, bulletSpeed, bulletRange, bulletRadius
                                      // (boss además: states [{ below, …lo que cambia }] y ring { bullets, shieldMs })
  powers: { padRadius, comebackAbove, freeze, blast, double, fan, shield, turbo },   // game.json → powers
  vehicles: [{ idx, teamId, slot, boss, maxHp }],   // uno por dispositivo; idx = posición en el fotograma
  // Solo jugador:
  me: null | idx, role: 'boss' | 'challenger' }
```

Clicker: cada dispositivo envía `{ type: 'clicks', count }` cada `batchMs` con los toques acumulados.
El servidor acepta como mucho 20 por segundo de juego por dispositivo y descarta lo que llega fuera
de `[playStartsAt, endsAt + 300 ms]` (RF-MJ3-04). Con un número impar de equipos, el que queda sin
pareja tiene la mitad de dispositivos que los demás grupos: sus clics cuentan con clics adicionales
(`minigameRules.clicker.soloFactor` en `game.json`). Las pantallas solo avisan que los tiene por
jugar solo, sin decir cuántos.

Traza a ciegas: el del diagrama envía `{ type: 'tap', state }`, el estado al que pasa el autómata.
Es correcto si hay una transición a ese estado desde la descripción instantánea del equipo y, desde
ahí, la cadena todavía se puede aceptar (`server/domain/pda.js`); la respuesta trae `correct` y, si
aceptó, `accepted`. Un toque equivocado cambia el papel (el diagrama pasa al otro celular), vuelve a
`(q0, cadena, Z0)` y durante `swapMs` rechaza toques con `swapping`; si era el último intento, el
equipo queda sin intentos (`out`). Un toque a menos de `doubleTapMs` del anterior se rechaza con
`too_fast`; el de la cadena no puede tocar (`not_diagram`). Cada toque va al log (`traza_step`,
`traza_error`, `traza_out`, `traza_accepted`).

Flappy: el celular simula con `client/shared/flappy-physics.js` a 60 Hz fijos. Cada `progressMs`
envía `{ type: 'fly', tick, flaps }`: el tick al que llegó y los ticks en que aleteó desde el último
tick confirmado (puede repetir alguno ya aplicado; el servidor lo ignora). Al chocar o llegar lo envía
de inmediato. El servidor avanza su propia simulación con esos aleteos y responde
`{ ok, tick, status, x }`; si su resultado difiere del celular, manda el del servidor. Un `tick` más
de `toleranceMs` por delante de `playStartsAt` (sin contar pausas) se rechaza con
`implausible_progress`. Al recargar la página, el celular retoma desde `me`.

Arena: el tiempo se cuenta en ticks de 30 por segundo desde `playStartsAt` (la pausa lo congela). El
celular mueve su vehículo con `client/shared/arena-physics.js` y cada `reportMs` envía, sin esperar la
respuesta anterior (hasta 4 envíos en camino; si uno falla, reenvía desde lo último confirmado),
`{ type: 'drive', life, from, pos, f, shots }`: `pos` son las posiciones `[x, y, x, y…]` (enteros) en
los ticks `from`, `from + 1`…; `f`, hacia dónde mira (0–4095, una vuelta); `shots`, sus disparos
`[[tick, ángulo]…]`; `life`, el número de vida en que va (sube al reaparecer). El servidor ignora los
ticks que ya conoce, limita cada posición a la velocidad máxima y la saca de los obstáculos (entonces
responde `fix: { tick, x, y }` y el celular se corrige), acepta un disparo si respeta la cadencia y ya
conoce la posición de ese tick, y responde con el último tick conocido. Lo de una vida anterior no
cuenta: la respuesta trae `life` y `status` (`alive`, `dead` o `out`). Ticks más de 10 por delante
del reloj del servidor se rechazan con `implausible_progress`. Al recargar la página, el celular
sigue desde la posición del fotograma.

Los impactos los decide el servidor, tick a tick, con la posición de cada vehículo en ese tick: avanza
hasta donde ya informaron todos los celulares conectados, o hasta `maxLagMs` atrás si alguno se
atrasa (su vehículo se toma quieto). No hay fuego amigo ni choques entre vehículos. Fotograma
(`mg:frame`):

```js
{ seq,                      // fase a la que pertenece: se descarta el de otra fase
  t,                        // hora del servidor al enviarlo (para medir el atraso)
  n, r,                     // tick actual y hasta dónde se decidieron los impactos
  v: [[tick, x, y, f, vida, estado, nVida, extra, golpes, derribos, poder, poderHasta, cargas, congeladoHasta, estadoJefe]],
      // por vehículo, en el orden de la vista
      // estado: 0 fuera (reaparece en el tick extra), 1 en juego (escudo hasta el tick extra), 2 jefe derribado
      // poder: código de POWERS en arena-physics.js + 1 (0 = ninguno); estadoJefe: 0 = q₀, 1 = q₁…
  b: [[dueño, tick0, k, x0, y0, ángulo]],   // balas que el servidor conoce desde hace menos de 8 ticks
                                            // (k: bala del abanico; desde 10, el anillo del cambio de estado)
  h: [[dueño, tick0, k, objetivo, tick, daño]],   // impactos recientes (daño 0: lo absorbió un escudo o el Lazo; 2: Apilar doble)
  p: [poder],                               // contenido de cada caja (código, 0 = vacía), en el orden de pads
  w: [oleadas, remontada] }                 // oleadas que salieron y si la última fue la de poderes fuertes
```

Las cajas, los poderes y el congelado del jefe los decide el servidor (reglas en
[ARENA.md](ARENA.md)). Un jefe congelado que informa posiciones distintas recibe `fix` con la posición
donde quedó, y sus disparos de esos ticks no cuentan.

El resultado trae `headline` («El jefe resistió» / «¡Vaciaron la pila del jefe!») y `everyoneScores`.

### Qué ve cada rol (ViewProjector)

- Ningún cliente recibe tokens.
- Un jugador no recibe los `deviceId` de los demás dispositivos; el host sí.
- Mientras la pregunta está abierta, ningún cliente (ni el host) recibe la opción correcta, y el
  proyector no recibe ni el enunciado ni las opciones (RF-PRE-08, RF-PRE-10, AMB-29). Se publica quién
  respondió, nunca qué.
- El inventario y la oferta del draft de un equipo solo los ven sus dos dispositivos (y el host).
- Las declaraciones de la fase de uso solo las ve el equipo que las hizo; nadie más, ni el host,
  hasta la resolución (RF-USO-02). Se publica quién confirmó.
- Traza a ciegas: el celular del diagrama no recibe la cadena ni la forma de aceptar; el de la cadena
  no recibe el estado, la pila, el último paso ni cuántos pasos llevan. El proyector solo recibe
  tiempos e intentos (si mostrara el diagrama, el de la cadena podría mirarlo). El host lo ve todo.
- Flappy: el avance de todos es público (RF-MJ4-09); el nivel y el estado del pájaro solo van al
  celular que juega.
- Arena: todo es público (posiciones, vidas, balas e impactos de todos).

## Exportación de estadísticas (HTTP)

`GET /api/export`, solo para el host, con la cabecera `Authorization: Bearer <HOST_TOKEN>` (sin el
token: 401). Sin sala: 404.

- `?format=json`: `{ exportedAt, room: { id, createdAt, seed, finished, teams }, summary: { teams,
  questions, highlights, workshop, students }, events }`, con el log completo de la sala.
- `?format=csv&table=<tabla>[&sep=,]`: `respuestas`, `objetos`, `minijuegos`, `ranking`, `equipos`
  (resumen por equipo, con sus integrantes), `preguntas` (resumen por pregunta) o `taller` (una fila
  por equipo registrado: integrantes, si terminó el taller, pasos a la primera, dónde tropezó y
  fichas movidas en cada reto) o `estudiantes` (una fila por integrante, con los aciertos y la nota
  de su equipo). UTF-8 con BOM y CRLF; separador `;` con coma decimal (por defecto) o `,` con punto
  decimal. Una tabla desconocida: 400.
- `?format=xlsx`: un libro de Excel con todas las tablas, una por hoja: Estudiantes (la primera),
  Equipos, Taller, Preguntas, Respuestas, Ranking, Minijuegos y Objetos. Lo escribe
  `server/domain/xlsx.js`, sin dependencias.

La nota de un equipo es `grading.max × aciertos ÷ preguntas` (`game.json`: máximo 5, un decimal): 5
con todas las preguntas correctas y 0 con ninguna. Una pregunta sin responder cuenta como incorrecta
y, si la partida no ha terminado, solo cuentan las preguntas jugadas. Todos los integrantes de un
equipo tienen la misma nota.

Las tablas se calculan desde el log (`server/domain/stats.js`), que el motor guarda también en memoria
y recupera de `data/events-<sala>.jsonl` tras un reinicio.

## Métricas del servidor (HTTP)

Para la prueba de carga (`npm run load`, RNF-01 y RNF-15). Solo para el host, con la misma cabecera
`Authorization: Bearer <HOST_TOKEN>` (sin el token: 401). Las calcula `server/core/metrics.js`, que
toma una muestra por segundo.

- `GET /api/metrics` → `{ ok, version, commit, at, sampleMs, cores, totalMemMb, loadavg, memory:
  { rssMb, heapUsedMb }, connections, last, window }`.
  - `last`: la última muestra (`null` en el primer segundo): `{ cpuPercent, rssMb, heapUsedMb,
    loopDelayP99Ms, loopDelayMaxMs, inPerSec, outPerSec, connections }`. `cpuPercent` es el uso del
    proceso en porcentaje de un núcleo; `loopDelay*` es el retraso del event loop más allá de los 10 ms
    con que se mide; `inPerSec` son mensajes recibidos y `outPerSec` vistas enviadas por segundo.
  - `window`: desde el último reinicio de las métricas (o desde que arrancó el servidor): `{ since,
    seconds, samples, cpuAvgPercent, peak: { …los mismos campos que last }, messagesIn, viewsOut,
    errors }`. `errors` cuenta los mensajes que terminaron en `server_error`.
- `POST /api/metrics/reset` → reinicia `window` (picos, promedios y contadores) y responde lo mismo.

## Cómo se agrega una fase real (Fases 2–7)

1. Implementar el tipo en `server/phases/` (como `question.js`) con `durationMs(config, step)`,
   `enter`, `onAction(ctx, { teamId, deviceId, action })`, `isComplete`, `exit` y `view(ctx, viewer)`;
   `view` decide qué recibe cada rol. `onAction` puede devolver `{ ok: true, event }`: el evento va al
   log y no al cliente. Los puntos y rachas se cambian con `server/domain/teams.js` (respeta los pisos).
   Si la fase necesita actuar sola en ciertos instantes (como Contrarreloj), implementa
   `nextWakeup(ctx)` y `onWakeup(ctx)`; el azar sale de `ctx.random` (con semilla, reproducible).
   Un minijuego nuevo no es una fase: es un plugin en `server/minigames/` con la interfaz descrita en
   `server/minigames/index.js` (`init`, `onInput`, `nextWakeup`/`onWakeup`, `shiftTimes`, `isFinished`,
   `scores`, `view`), registrado en `MINIGAMES`. Mientras no esté registrado, su ronda usa el Clicker. Si ordena por
   puesto en lugar de por puntaje (como la Traza a ciegas), implementa también `results`.
2. Declarar su mensaje y esquema en `server/transport/schemas.js` y enlazarlo en `gateway.js`.
3. Dibujar `phase.data` en `client/play`, `client/screen` y `client/host`.
4. Actualizar este documento.
