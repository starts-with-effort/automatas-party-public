# Autómatas Party

🇬🇧 English · 🇪🇸 [Leer en español](README.es.md)

**A classroom game about pushdown automata.** Animated slides you control from your phone, a hands-on
workshop, and a real-time team quiz with power-ups, minigames and duels, all running in the browser.
Nobody installs anything: students just scan a QR code.

![The final ranking on the projector and a team's two phones during a question](docs/img/portada.png)

> **Note on language:** the game itself (quiz questions, interface text, slides) is written in
> **Spanish**, since it was made for a university class in Spanish. The code, config files and this
> README are easy to adapt: questions, items and slide notes live in plain JSON/JS files (see
> [How to edit it](#how-to-edit-it)).

## Features

- **Interactive slides** with automaton diagrams that run step by step on a built-in pushdown
  automaton (PDA) simulator. Presenters advance the deck from their phones.
- **A workshop** where each group registers a team and solves two exercises at its own pace, with no
  points and no timer.
- **A team quiz**: 11 questions in 6 rounds, power-ups (attacks, defenses, boosts), five minigames,
  stars and rock-paper-scissors duels.
- **Zero install for players**: a QR code opens the game on any phone. Every team plays on two
  phones, one showing the question and the other the options, so they have to talk.
- **Real-time and synchronized**: an authoritative Node.js server, per-role views (nobody gets the
  correct answer early) and synchronized clocks so every screen changes at the same moment.
- **Resilient**: game state is persisted, so a phone that disconnects or reloads rejoins its team
  and the game resumes even if the server restarts.
- **No database, no build step**: configuration is JSON validated at startup, and the client is plain
  ES modules.
- **Grading and stats**: download an Excel workbook with every table, including each student's grade.

It was built for a university presentation (the definition of the pushdown automaton and the
languages it accepts). A session has three parts, and each one is a page served by the same server:

| Part | What it is | Where |
| ---- | ---------- | ----- |
| **Slides** | The presentation, with diagrams that run step by step on a PDA simulator. Advanced from a phone. | `/slides/` (projector) and `/remote/` (controller) |
| **Workshop** | Each group registers its team and solves two exercises at its own pace, with no points and no timer. | `/play/` |
| **Quiz** | 11 questions in 6 rounds, with items, five minigames, stars and duels. | `/play/` (phones), `/screen/` (projector) and `/host/` (whoever runs the game) |

## Quick start

Requires [Node.js](https://nodejs.org) 22 or later.

```bash
git clone https://github.com/starts-with-effort/automatas-party-public.git
cd automatas-party-public
npm install
npm run dev          # http://localhost:3000, restarts on file changes
```

To see it work without gathering any phones:

```bash
npm run demo         # plays a full game with 14 bots and prints the result (~1.5 min)
```

## What it looks like

**On the projector** (`/screen/`): the lobby with the QR code, each question's result, the minigames
and the ranking.

| | |
| :-: | :-: |
| ![Waiting room with the QR code and the teams](docs/img/proyector-sala.png) | ![A question's result](docs/img/proyector-pregunta.png) |
| The lobby: QR code and teams | A question's result |
| ![Blind Trace minigame](docs/img/proyector-traza.png) | ![Arena minigame](docs/img/proyector-arena.png) |
| "Blind Trace" minigame | "Arena" minigame: everyone against the boss |

**On the phone** (`/play/`): each team plays with two phones, and during questions one shows the
statement and the other the options.

| | | | | |
| :-: | :-: | :-: | :-: | :-: |
| <img src="docs/img/celular-pregunta.png" width="170" alt="Phone showing the question statement"> | <img src="docs/img/celular-opciones.png" width="170" alt="Phone showing the options"> | <img src="docs/img/celular-objetos.png" width="170" alt="Choosing an item"> | <img src="docs/img/celular-traza.png" width="170" alt="Blind Trace minigame on a phone"> | <img src="docs/img/celular-final.png" width="170" alt="Final ranking on a phone"> |
| One phone has the question… | …and the other, the options | Choosing an item | "Blind Trace" | The finale |

**The slides** (`/slides/`) and their controller (`/remote/`): every tap on "Next" runs one step of
the automaton, and the phone shows that step's speaker note and the timer.

| | | |
| :-: | :-: | :-: |
| <img src="docs/img/diapositiva-simulacion.png" width="400" alt="Slide with a pushdown automaton simulation"> | <img src="docs/img/diapositiva-quiz.png" width="400" alt="Slide explaining the quiz items"> | <img src="docs/img/control.png" width="150" alt="Presentation controller on a phone"> |
| A step-by-step run | The quiz rules | The controller |

**The host panel** (`/host/`): create the room, advance, pause, adjust points and download the stats.

<img src="docs/img/host.png" width="700" alt="Host panel with the ranking and the buttons to advance the game">

## How it works

### The session

1. **Presentation.** The projector opens `/slides/` and the presenters drive it from `/remote/` on
   their phones (or with the keyboard or a clicker). The position is stored on the server, so you can
   reload the projector in the middle of an animation and it comes back to the same point.
2. **Workshop.** The host creates a room "with team registration". One person from each group joins
   through the QR code, enters the team name and its members, and the group solves two exercises:
   "Be the Stack" (what happens to the stack at each step) and "Fix the Automaton" (build the missing
   transition).
3. **Quiz.** Once every team has its two phones connected, the host starts the game.

### The quiz

- **6 rounds, 11 questions.** The first five rounds go: question, choose an item, question, minigame,
  use the item. The sixth is a single question. Progress is drawn as an automaton (q₁ … q₅ and q_F).
- **Two-phone questions.** One phone shows the statement and the other the options, and they swap
  turns: the team has to talk. There is one answer per team; answering fast and getting answers right
  in a row (a streak) earns more points.
- **Items.** Each round the team picks one of three: attacks (take away points, time or streak, flood
  screens with ink), defenses and self-boosts. Teams that are behind get better ones.
- **Minigames.** One per round: Memory (matching pairs) and Feed the Automaton (in groups of two
  teams), Blind Trace and Flappy (each team on its own), and Arena (everyone against the team in
  first place).
- **Stars and duels.** Winning a minigame gives a star fragment; five make a star, which is worth a
  lot. The "Challenge" item dares another team to rock-paper-scissors: if the challenger wins, they
  take the other team's stars.
- **The grade** comes only from correct answers (5 × correct ÷ questions). Rank, items and minigames
  are the game, not the grade.

### Under the hood

- **Authoritative server.** Node.js with Express and Socket.IO. Clients are uncompiled web pages (ES
  modules, no framework): they only send actions and draw what the server sends them.
- **One state machine.** A game is a fixed list of phases (`server/core/RoundPlan.js`); the engine
  (`GameEngine.js`) enters each one, receives actions, expires deadlines and moves on to the next.
- **Every screen gets only its own data.** The server builds a different view for each phone, the
  projector and the host: the phone with the statement never receives the options, and nobody
  receives the correct answer ahead of time.
- **Synchronized clocks.** Each client estimates its offset from the server and phases start at an
  agreed time, so every screen switches at once.
- **Nothing gets lost.** State is saved in `data/` (a snapshot plus an event log). A phone that
  disconnects or reloads goes back to its team with its points and items; if the server restarts, the
  game resumes.
- **No database.** Questions, items, timings and prizes are JSON files that the server validates at
  startup.

The client–server contract is in [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Running a real game locally

1. Open <http://localhost:3000/host/>. It asks for a token: with no `.env` file, the server generates
   a temporary one and prints it to the console on startup (message `HOST_TOKEN no está definido…`).
2. Create a room and open <http://localhost:3000/screen/> in another tab (the projector).
3. Open <http://localhost:3000/play/> in one or more tabs and join a team. To fill the remaining
   teams with simulated players: `npm run bots -- --bots 14`.
4. Click "Iniciar partida" (start game) in the host panel.

With phones on the same WiFi: copy `.env.example` to `.env`, set `HOST=0.0.0.0` and open the
projector using the local network address shown in the console (the `lan` field), so the QR code
points to it. `npm run start:fast` shortens the timings for rehearsals.

The slides are at <http://localhost:3000/slides/> and ask for a different token (`SLIDES_TOKEN`,
also generated and printed to the console if missing). More in
[docs/PRESENTACION.md](docs/PRESENTACION.md) (in Spanish).

## How to edit it

Almost all the content can be changed in configuration files, without touching the code. The server
validates them at startup and tells you what is wrong.

| I want to change… | Where |
| ----------------- | ----- |
| The questions | [server/config/questions.json](server/config/questions.json) |
| Timings, scoring, number of teams, prizes | [server/config/game.json](server/config/game.json) |
| The items: texts, values, enabling or disabling | [server/config/items.json](server/config/items.json) |
| Which items each rank gets | [server/config/pools.json](server/config/pools.json) |
| The order and rules of the minigames | `minigames` and `minigameRules` in `game.json` |
| The slides and their notes | [presentacion/deck/deck.js](presentacion/deck/deck.js) and `presentacion/deck/slides/` |
| The workshop exercises | `server/domain/workshop.js` |

**Questions.** There are 11 (two per round plus the final one). Each has an `id`, a `difficulty`
(`basica`, `intermedia` or `dificil`), a `statement`, `options` (four), `correct` (an index from 0 to
3) and an optional `image` (a path inside `client/assets/`, for example `questions/q3.png`). The time
to answer comes from the difficulty (30, 45 and 60 s) and can be set per question with
`timeLimitMs`.

**Items.** `items.json` holds each item's name, the text the player sees, the illustration and the
numeric values (`params`). With `"enabled": false` an item stops appearing. The rules of each item
are in `server/domain/items/` (one file per item). A new item needs its drawing in
`client/assets/items/`: [docs/ICONOS.md](docs/ICONOS.md) explains how to make one.

**Minigames.** Each is a module in `server/minigames/` with the same interface (documented in
`index.js`) and its screen in `client/shared/`. The `minigames` list in `game.json` says which one
goes in each round; a disabled one is replaced by "Feed the Automaton".

**Slides.** `deck.js` is the manifest: order, title, presenter, allotted time and a note per step.
Each slide is a file in `presentacion/deck/slides/` that builds its steps with GSAP. The example
automata are in `presentacion/deck/pda/examples.js` and their runs come from the simulator, so no
projected trace can be wrong.

**Look and feel.** Colors, fonts and game pieces: `client/shared/party.css` and `base.css`. For the
presentation: `presentacion/deck/theme.css` and `deck.css`.

## Tests and tools

```bash
npm test                    # unit and integration tests (full games played by bots)
npm run demo                # full game with 14 bots in a single process
npm run demo -- --real      # the same with real timings
npm run bots -- --bots 14   # simulated players against an already running server
npm run load                # load test: 30 clients play a game while CPU, memory and latency are measured
npm run duration            # how long a game lasts with the current configuration
npm run slides:tiempos      # how long each slide took in the last rehearsal
```

- **Bots.** With `--create-room --drive --host-token <token>` they create the room and play the whole
  game on their own; `--url` points to another server; `--practice <minigame>` sets up a room to
  practice a single minigame in a loop; `--taller` creates a room with registration. All options are
  listed at the top of [scripts/bots.js](scripts/bots.js).
- **Load.** `npm run load` starts its own server and exits with an error if the limits aren't met:
  CPU under 50 %, memory under 500 MB, 95 % of messages delivered in under 250 ms and screens
  synchronized to within 100 ms. `--outages` adds two 10 s network cuts; `--real` uses real timings;
  `--url … --host-token … --confirm` runs it against a deployed server (it creates a new room);
  `--json <file>` saves the report.
- **Duration.** `npm run duration` shows the fixed and maximum duration of a game; with
  `--log data/events-<room>.jsonl`, how long an already played game actually took.
- **Stats.** From `/host` you can download an Excel workbook with every table (the first sheet is the
  student list with their grade), the standalone CSVs and the full log as JSON.

## Deployment

It is a single Node process with no database, so it runs on any machine with Node 22 (`npm ci` and
`npm start`). To use it with phones over the internet you need HTTPS; we ran it on a Linux virtual
machine with [Caddy](https://caddyserver.com) in front (it handles the certificate and forwards
traffic, WebSockets included, to the Node port) and the server as a systemd service. `GET /health`
reports which version is running. The repository includes a GitHub Actions workflow that runs the
tests on every push (`.github/workflows/`).

Secrets go in a `.env` file that is not committed ([.env.example](.env.example) lists them):
`HOST_TOKEN` for the host panel, `SLIDES_TOKEN` for the slides and `PUBLIC_URL`, the address that goes
into the QR code.

## Repository layout

```
server/
  index.js              startup: .env, configuration, saved state, Express + Socket.IO
  app.js                HTTP routes (/health, QR, export, metrics) and static files
  config/               game.json, questions.json, items.json, pools.json and fast.json (rehearsal)
  core/                 GameEngine (state machine), RoundPlan, per-role views, persistence
  phases/               one file per phase type: question, dealing, item use, minigame, duel
  minigames/            one module per minigame: Memory, Blind Trace, Clicker, Flappy, Arena
  domain/               pure rules: scoring, items (items/), luck, stars, workshop, stats
  transport/            Socket.IO: message schemas, host token, rate limiting
  slides/               the presentation: session, protected routes and current position
client/
  play/ screen/ host/   the game's three pages: phone, projector and panel
  shared/               connection, clock, UI pieces, styles and the drawing of each minigame
  assets/               fonts and illustrations (one SVG per item)
presentacion/
  display/ remote/      the projector and the phone controller
  deck/                 manifest, step engine, PDA simulator and one slide per file
scripts/                bots, demo game, load test, duration and rehearsal timings
tests/                  tests with node:test
docs/                   the documentation below and the images in this file
.github/workflows/      tests on every push (GitHub Actions)
```

## Documentation

The documents below are written in Spanish.

| Document | What it covers |
| -------- | -------------- |
| [docs/PRESENTACION.md](docs/PRESENTACION.md) | The slides: how to use them, how they work and the structure of the presentation |
| [docs/TALLER.md](docs/TALLER.md) | The workshop and team registration |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Client–server messages and the view format |
| [docs/ARENA.md](docs/ARENA.md) and [docs/TRAZA.md](docs/TRAZA.md) | Design of the Arena and Blind Trace minigames |
| [docs/ICONOS.md](docs/ICONOS.md) | How to draw an item's illustration |

These documents were written while the project was being built: they explain why things are the way
they are, and parts of them describe stages that are already behind us.

## Tech stack

Node.js 22, [Express](https://expressjs.com) 5, [Socket.IO](https://socket.io) 4,
[Zod](https://zod.dev) to validate configuration and messages, [GSAP](https://gsap.com) for the slide
animations and `qrcode` for the entry code. The client is HTML, CSS and JavaScript with no build
step.

## License

[MIT](LICENSE): you can use, copy, modify and distribute it for anything, commercial use included;
you only have to keep the license notice. It is provided as is, without warranty.

The bundled fonts (Lilita One and Nunito) belong to their authors and are distributed under the
[SIL Open Font License](https://openfontlicense.org).
