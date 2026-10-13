// Carga y valida al arrancar game.json, el banco de preguntas, el catálogo de objetos y las
// pools (RNF-14): si algo está mal, el servidor no arranca y el error dice qué campo corregir.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ITEM_CODES } from '../domain/items/index.js';
import { QUESTION_COUNT } from './RoundPlan.js';

const DEFAULT_PATH = new URL('../config/game.json', import.meta.url);

const ms = z.number().int().min(0);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color en formato #rrggbb');
// Ruta dentro de client/assets/, p. ej. "questions/q1.png" (sin "..").
const assetPath = z.string().regex(/^(?!.*\.\.)[\w\-./]+$/, 'ruta dentro de client/assets/').max(200);
const itemCode = z.enum(ITEM_CODES);
// Un vehículo de la Arena (unidades del mundo: la arena mide `size` de lado; velocidades por segundo).
const vehicleRules = z.object({
  radius: z.number().min(5).max(200),
  speed: z.number().min(50).max(3000),
  fireMs: ms.min(50), // cadencia de disparo
  bullets: z.number().int().min(1).max(7), // balas por disparo (en abanico si son varias)
  spreadDeg: z.number().min(0).max(60), // grados entre las balas del abanico
  bulletSpeed: z.number().min(100).max(5000),
  bulletRange: z.number().min(100).max(10_000),
  bulletRadius: z.number().min(2).max(60),
});
// Poderes de la Arena (los nombres, en client/shared/arena-physics.js → POWERS). `ms`: cuánto dura
// como máximo desde que se recoge.
const powerId = z.enum(['freeze', 'blast', 'double', 'fan', 'shield', 'turbo']);
const powerRules = z.object({ ms: ms.min(500).max(90_000) });
const arenaPowers = z.object({
  waves: z.array(ms).max(10), // cuándo aparecen las oleadas, desde que empieza el juego
  comebackAbove: z.number().min(0).max(1), // última oleada: poderes fuertes si los jefes conservan más que esto
  padRadius: z.number().min(10).max(300),
  pools: z.object({ axis: z.array(powerId).min(1), corner: z.array(powerId).min(1) }), // qué sale en cada punto
  freeze: powerRules.extend({
    charges: z.number().int().min(1).max(20),
    freezeMs: ms.min(100).max(5000),
    immuneMs: ms.max(20_000), // después de congelarse, el jefe no se vuelve a congelar en este tiempo
  }),
  blast: powerRules.extend({ radius: z.number().min(50).max(2000), damage: z.number().int().min(1).max(100) }),
  double: powerRules,
  fan: powerRules.extend({ bullets: z.number().int().min(1).max(7), spreadDeg: z.number().min(0).max(60) }),
  shield: powerRules.extend({ charges: z.number().int().min(1).max(20) }),
  turbo: powerRules.extend({ speed: z.number().min(1).max(3) }), // multiplica la velocidad
});
// Estado del jefe: bajo `below` de su vida (fracción) cambia lo que se indique de sus reglas.
const bossState = z.object({
  below: z.number().min(0).max(1),
  bullets: z.number().int().min(1).max(7).optional(),
  spreadDeg: z.number().min(0).max(60).optional(),
  fireMs: ms.min(50).optional(),
  speed: z.number().min(50).max(3000).optional(),
});

const QuestionSchema = z.object({
  id: z.string().min(1).max(32),
  difficulty: z.string(),
  // Opcional: si falta, se usa el tiempo de su dificultad (questions.difficulties.*.timeLimitMs).
  timeLimitMs: z.number().int().min(1000).max(120_000).optional(),
  statement: z.string().min(1).max(500),
  image: assetPath.nullable().optional(),
  options: z.array(z.string().min(1).max(120)).length(4, 'cada pregunta tiene 4 opciones'),
  correct: z.number().int().min(0).max(3),
});

const ItemSchema = z.object({
  code: itemCode,
  name: z.string().min(1).max(40),
  text: z.string().min(1).max(160), // texto corto y no técnico para el jugador (RF-OBJ-09)
  icon: z.string().min(1).max(8),
  image: assetPath.nullable().optional(),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()).optional(),
  maxPerGame: z.number().int().min(0).optional(), // veces que puede aparecer en toda la partida
  onlyLeader: z.boolean().optional(), // solo se ofrece al 1.º del ranking
  // No sale de las pools: el draft lo ofrece a entre min y max equipos por reparto (el Desafío).
  perDraft: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) })
    .refine(({ min, max }) => min <= max, 'min no puede ser mayor que max')
    .optional(),
});

const ConfigSchema = z
  .object({
    teams: z.object({
      defaultCount: z.number().int(),
      minCount: z.number().int().min(1),
      maxCount: z.number().int().max(8),
      names: z.array(z.string().min(1).max(30)),
      colors: z.array(hexColor),
    }),
    // Sala con registro y taller (docs/TALLER.md): cuántos integrantes puede escribir un equipo.
    workshop: z.object({
      members: z.object({ min: z.number().int().min(1).max(10), max: z.number().int().min(1).max(10) })
        .refine(({ min, max }) => min <= max, 'min no puede ser mayor que max'),
    }),
    // Nota de cada estudiante en la exportación: max × aciertos ÷ preguntas, con estos decimales.
    grading: z.object({ max: z.number().min(1).max(100), decimals: z.number().int().min(0).max(2) }),
    timings: z.object({
      leadMs: ms.max(5000), // startsAt común: cuánto antes se anuncia cada fase (3.6)
      autoAdvanceMs: ms.nullable(), // null: las pantallas de resultados esperan al host (RF-FLU-04)
      draft: ms,
      roulette: ms,
      minigameGroups: ms, // «Formando grupos» antes de las instrucciones (Memoria y Clicker)
      minigameIntro: ms,
      itemUse: ms,
    }),
    questions: z.object({
      file: z.string().min(1),
      readingMs: ms.max(30_000), // tiempo de lectura antes de habilitar las opciones (RF-PRE-06)
      answerGraceMs: ms.max(2000), // margen para respuestas enviadas justo antes del final
      difficulties: z.record(z.string(), z.object({
        label: z.string().min(1),
        basePoints: z.number().int().min(1), // B (RF-PRE-02)
        timeLimitMs: z.number().int().min(1000).max(120_000), // tiempo para responder (T) de esta dificultad
      })),
    }),
    items: z.object({ file: z.string().min(1), poolsFile: z.string().min(1) }),
    scoring: z.object({
      streakDivisor: z.number().positive(), // M(r) = 1 + ln(r) / divisor (AMB-01)
      streakMinimum: z.number().int().min(1), // M(r) se aplica desde esta racha
      timeValidation: z.object({ slackMs: ms, aheadMs: ms, defaultRttMs: ms }), // sección 3.6, paso 4
    }),
    // Premios de los minijuegos: los de minigameRules son los de la ronda 1 (1.er puesto =
    // firstPrize) y cada ronda el 1.er puesto vale roundStep más. Compensación para los rezagados
    // desde la ronda fromRound: +bonusPerStep por cada gapStep puntos detrás del 1.º, hasta +maxBonus.
    minigameScoring: z.object({
      firstPrize: z.number().int().min(1),
      roundStep: z.number().int().min(0),
      catchUp: z.object({
        fromRound: z.number().int().min(1),
        gapStep: z.number().int().min(1),
        bonusPerStep: z.number().min(0),
        maxBonus: z.number().min(0).max(5),
      }),
    }),
    // Estrellas: fragmentsPerStar fragmentos hacen una estrella, que vale basePoints + bonusPoints.
    stars: z.object({
      fragmentsPerStar: z.number().int().min(1).max(20),
      basePoints: z.number().int().min(0),
      bonusPoints: z.number().int().min(0),
    }),
    // Duelo (piedra, papel o tijera): cartelera (con varios duelos), presentación, tiempo para
    // elegir, cuánto se muestran las opciones, cuánto se muestra el ganador, aviso de un Desafío sin
    // nada que robar y manos antes de sortear al ganador.
    duel: z.object({
      lineupMs: ms.max(10_000),
      introMs: ms.max(10_000),
      pickMs: ms.min(1000).max(30_000),
      revealMs: ms.max(10_000),
      resultMs: ms.max(15_000),
      voidMs: ms.max(10_000),
      maxRounds: z.number().int().min(1).max(50),
    }),
    minigames: z
      .array(z.object({
        id: z.enum(['memoria', 'traza', 'clicker', 'flappy', 'arena']),
        name: z.string().min(1),
        enabled: z.boolean(),
      }))
      .length(5, 'una entrada por ronda (5)'),
    minigameRules: z.object({
      countdownMs: ms.max(10_000), // cuenta 3-2-1 antes de cada minijuego (RF-MJ-01)
      roulette: z.object({ spinMs: ms, decoys: z.array(z.string().min(1).max(40)) }),
      memoria: z.object({
        instructions: z.string().min(1),
        pairs: z.number().int().min(2).max(15),
        cardTimeMs: ms,
        revealMs: ms,
        maxDurationMs: ms,
        prize: z.number().int().min(0),
        faces: z.array(z.string().min(1).max(8)).min(2),
      }),
      traza: z.object({
        instructions: z.string().min(1),
        maxDurationMs: ms.min(2000),
        attempts: z.number().int().min(1).max(5), // con cada error cambian de papel y vuelven a empezar
        swapMs: ms.max(10_000), // pantalla del error y del cambio de papel (el tiempo sigue corriendo)
        doubleTapMs: ms.max(2000), // un segundo toque antes de esto se ignora
        modes: z.array(z.enum(['final', 'empty'])).min(1), // formas de aceptar; una al azar por partida
        firstPrize: z.number().int().min(0), // el primero en aceptar (y el fragmento)
        prizeBase: z.number().int().min(0), // los demás: base + porTiempo × lo que sobraba
        prizeByTime: z.number().int().min(0),
      }),
      flappy: z.object({
        instructions: z.string().min(1),
        levelMs: ms.min(2000).max(300_000), // lo que tarda en recorrerse el nivel (~60 s)
        extraMs: ms, // margen tras ese tiempo antes de cerrar el minijuego
        lives: z.number().int().min(1).max(5), // AMB-22
        gapStart: z.number().min(20).max(60), // alto del hueco de los tubos, del primero al último
        gapEnd: z.number().min(20).max(60),
        gapCurve: z.number().min(0.2).max(5), // 1 = recta; más de 1 = se angosta rápido al principio
        gapMin: z.number().min(20).max(60), // ningún hueco es más bajo que esto
        narrowFrom: z.number().min(0).max(1), // desde qué fracción del recorrido hay tubos estrechos
        narrowBy: z.number().min(0).max(20), // cuánto más estrechos son (0 = ninguno)
        pipeSpacing: z.number().min(30).max(200),
        maxShift: z.number().min(0).max(40), // cuánto cambia el hueco de un tubo al siguiente
        progressMs: ms.min(50).max(2000), // cada cuánto informa el celular (RF-MJ4-05)
        toleranceMs: ms.max(5000), // adelanto máximo aceptado respecto al reloj del servidor (RF-MJ4-06)
        prizePerPlayer: z.number().int().min(0), // RF-MJ4-08
      }),
      arena: z.object({
        instructions: z.string().min(1),
        threshold: z.number().int().min(0), // U: diferencia para que el 2.º también sea jefe
        durationMs: ms.min(5000),
        size: z.number().int().min(1000).max(10_000), // lado de la arena
        view: z.number().min(300).max(5000), // lo que ve el celular en su lado corto
        frameMs: ms.min(20).max(500), // cada cuánto se difunde un fotograma
        reportMs: ms.min(60).max(500), // cada cuánto informa el celular (el tope es 20 mensajes/s)
        maxLagMs: ms.max(2000), // cuánto se espera a un celular atrasado antes de decidir los impactos
        respawnMs: ms, // un retador destruido vuelve tras esto
        shieldMs: ms, // escudo al reaparecer
        aimConeDeg: z.number().min(0).max(45), // ayuda de puntería
        challenger: vehicleRules.extend({ hp: z.number().int().min(1).max(20) }),
        // Vida de cada vehículo jefe: hpPerChallenger × N × p ÷ B, con p = 1 ÷ (1 + pressure × B ÷ N),
        // y al menos minHp (N: retadores conectados al empezar; B: vehículos jefe).
        boss: vehicleRules.extend({
          hpPerChallenger: z.number().int().min(1).max(1000),
          pressure: z.number().min(0).max(10),
          minHp: z.number().int().min(1).max(1000),
          states: z.array(bossState).max(4)
            .refine((list) => list.every((s, i) => i === 0 || s.below < list[i - 1].below), 'los umbrales van de mayor a menor'),
          ring: z.object({ bullets: z.number().int().min(0).max(36), shieldMs: ms.max(5000) }), // al cambiar de estado
        }),
        powers: arenaPowers,
        pointsPerHit: z.number().int().min(0),
        defeatBonus: z.number().int().min(0), // si derriban al jefe, a cada equipo que le hizo daño
        bossSurvivePrize: z.number().int().min(0),
        bossSurviveStreak: z.number().int().min(0),
        bossPointsPerKill: z.number().int().min(0),
      }),
      clicker: z.object({
        instructions: z.string().min(1),
        durationMs: ms,
        maxClicksPerSecond: z.number().int().min(1),
        soloFactor: z.number().min(1), // por cuánto cuentan los clics del equipo que queda sin pareja
        batchMs: ms.min(50),
        graceMs: ms,
        prize: z.number().int().min(0),
      }),
    }),
    questionBank: z.array(QuestionSchema).length(QUESTION_COUNT, `exactamente ${QUESTION_COUNT} preguntas`),
    itemCatalog: z.array(ItemSchema),
    // Suerte 1…5 y "6" para 6 o más (sección 5.3).
    pools: z.object(Object.fromEntries(['1', '2', '3', '4', '5', '6'].map((luck) => [luck, z.array(itemCode).min(1)]))),
  })
  .superRefine((config, ctx) => {
    const { defaultCount, minCount, maxCount, names, colors } = config.teams;
    if (!(minCount <= defaultCount && defaultCount <= maxCount)) {
      ctx.addIssue({ code: 'custom', path: ['teams', 'defaultCount'], message: 'debe estar entre minCount y maxCount' });
    }
    if (names.length < maxCount || colors.length < maxCount) {
      ctx.addIssue({ code: 'custom', path: ['teams'], message: 'names y colors necesitan al menos maxCount elementos' });
    }
    const ids = new Set();
    config.questionBank.forEach((question, i) => {
      if (!config.questions.difficulties[question.difficulty]) {
        ctx.addIssue({ code: 'custom', path: ['questionBank', i, 'difficulty'], message: `dificultad desconocida: ${question.difficulty}` });
      }
      if (ids.has(question.id)) {
        ctx.addIssue({ code: 'custom', path: ['questionBank', i, 'id'], message: `id repetido: ${question.id}` });
      }
      ids.add(question.id);
    });
    const { memoria } = config.minigameRules;
    if (new Set(memoria.faces).size < memoria.pairs) {
      ctx.addIssue({ code: 'custom', path: ['minigameRules', 'memoria', 'faces'], message: 'hacen falta al menos tantas caras distintas como parejas' });
    }
    const listed = config.itemCatalog.map((item) => item.code);
    for (const code of ITEM_CODES) {
      const count = listed.filter((c) => c === code).length;
      if (count !== 1) {
        ctx.addIssue({ code: 'custom', path: ['itemCatalog'], message: `el objeto ${code} debe aparecer una vez (aparece ${count})` });
      }
    }
  });

export function parseConfig(raw) {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuración inválida:\n${z.prettifyError(result.error)}`);
  }
  // Cada pregunta queda con su tiempo: el propio si lo trae, si no el de su dificultad.
  const config = result.data;
  for (const question of config.questionBank) {
    question.timeLimitMs ??= config.questions.difficulties[question.difficulty].timeLimitMs;
  }
  return config;
}

// Partida rápida para ensayar (scripts/demo.js, `npm run start:fast`): solo los valores que cambian.
export const FAST_OVERLAY = new URL('../config/fast.json', import.meta.url);

// Preguntas, objetos y pools se buscan junto a game.json (campos questions.file e items.*).
// `overlay`: otro JSON que se mezcla encima (los objetos se combinan; el resto se reemplaza).
export function loadConfig(path = DEFAULT_PATH, { overlay = null } = {}) {
  const game = overlay ? merge(readJson(path), readJson(overlay)) : readJson(path);
  const base = path instanceof URL ? path : pathToFileURL(path);
  const sibling = (file, fallback) => readJson(new URL(file ?? fallback, base));
  return parseConfig({
    ...game,
    questionBank: sibling(game.questions?.file, 'questions.json').questions,
    itemCatalog: sibling(game.items?.file, 'items.json').items,
    pools: sibling(game.items?.poolsFile, 'pools.json').pools,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function merge(base, extra) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(base) || !isObject(extra)) return extra;
  const result = { ...base };
  for (const [key, value] of Object.entries(extra)) result[key] = merge(base[key], value);
  return result;
}
