// Pregunta y resultado de la pregunta (sección 4.3, reglas 5.1, 5.2 y 5.5).
//
// Línea de tiempo:  startsAt ──lectura──▶ answersAt ──T──▶ endsAt ─margen─▶ closeAt
//   - el enunciado aparece en startsAt; las opciones se habilitan en answersAt (RF-PRE-06);
//   - t se mide desde answersAt; el servidor cierra en closeAt (endsAt + answerGraceMs) para no
//     perder respuestas enviadas en el último instante.
//
// Efectos de objetos que llegan a la pregunta (room.activeEffects, sección 5.5):
//   RR plazo 2T/3 para el objetivo · CR elimina una incorrecta en T/4, T/2 y 3T/4 · SV segundo
//   intento · DN puntos × 2 o pierde 0,5·B · CS se aplica al cerrar · C tinta en las pantallas.
import { itemParams } from '../domain/items/index.js';
import { questionPoints, resolveAnswerTime } from '../domain/Scoring.js';
import { addPoints, setStreak } from '../domain/teams.js';

// Tolerancia para respuestas que llegan un poco antes de answersAt por el error de sincronización.
const EARLY_TOLERANCE_MS = 250;
const COUNTDOWN_STEPS = 3; // Contrarreloj: T/4, T/2 y 3T/4

const fail = (error) => ({ ok: false, error });

export function questionFor(config, step) {
  return config.questionBank[step.question - 1];
}

const hasEffect = (phase, teamId, code) =>
  phase.data.effects.some((effect) => effect.targetTeamId === teamId && effect.code === code);

// Plazo de un equipo: endsAt, o answersAt + 2T/3 con Reloj Roto (no acumulable, AMB-13).
function deadlineOf({ phase, config }, teamId) {
  if (!hasEffect(phase, teamId, 'RR')) return phase.endsAt;
  const { timeLimitMs } = questionFor(config, phase);
  return phase.answersAt + Math.round(timeLimitMs * itemParams(config, 'RR').timeFactor);
}

// Calamar: salpica al aparecer el enunciado y otra vez al habilitarse las opciones; se va en endsAt
// (answersAt + durationMs) y los últimos fadeMs son el desvanecido.
function inkOf(phase, config) {
  const { durationMs, fadeMs } = itemParams(config, 'C');
  return { startsAt: phase.startsAt, answersAt: phase.answersAt, endsAt: phase.answersAt + durationMs, fadeMs };
}

function countdownStepAt({ phase, config }, step) {
  return phase.answersAt + Math.round((questionFor(config, phase).timeLimitMs * step) / (COUNTDOWN_STEPS + 1));
}

export const questionPhase = {
  durationMs: (config, step) => config.questions.readingMs + questionFor(config, step).timeLimitMs,
  acceptsActions: true,

  // Los efectos se leen al entrar y se consumen al salir: tras un reinicio no se pierden.
  enter({ room, phase, config }) {
    phase.answersAt = phase.startsAt + config.questions.readingMs;
    phase.closeAt = phase.endsAt + config.questions.answerGraceMs;
    phase.data = {
      questionId: questionFor(config, phase).id,
      answers: {},
      effects: (room.activeEffects ?? []).filter((effect) => effect.appliesTo === 'question'),
      eliminated: {}, // teamId → opciones eliminadas (Contrarreloj y Segunda Vida)
      countdownSteps: {}, // teamId → pasos de Contrarreloj ya aplicados
      secondChanceUsed: {},
    };
  },

  // Una sola respuesta por equipo y es definitiva (RF-PRE-07), salvo con Segunda Vida.
  onAction(ctx, { teamId, deviceId, action }) {
    const { phase, config, now } = ctx;
    if (action.type !== 'answer') return fail('invalid_action');
    if (action.questionId !== phase.data.questionId) return fail('wrong_question');
    if (now < phase.answersAt - EARLY_TOLERANCE_MS) return fail('answers_not_open');
    if (now > deadlineOf(ctx, teamId) + config.questions.answerGraceMs) return fail('question_closed');
    if (phase.data.answers[teamId]) return fail('already_answered');
    if (deviceRole(ctx, deviceId) === 'statement') return fail('not_options_device');
    if ((phase.data.eliminated[teamId] ?? []).includes(action.option)) return fail('option_eliminated');

    const question = questionFor(config, phase);
    const tServer = now - phase.answersAt;
    const { t, source } = resolveAnswerTime({
      tClient: action.tClient,
      tServer,
      rtt: ctx.presence.get(deviceId)?.rtt,
      ...config.scoring.timeValidation,
    });
    const correct = action.option === question.correct;
    const event = { questionId: question.id, option: action.option, t, tClient: action.tClient ?? null, tServer, tSource: source };

    // Segunda Vida: el primer error elimina esa opción y se puede responder otra vez sin perder la racha.
    if (!correct && hasEffect(phase, teamId, 'SV') && !phase.data.secondChanceUsed[teamId]) {
      phase.data.secondChanceUsed[teamId] = true;
      (phase.data.eliminated[teamId] ??= []).push(action.option);
      return { ok: true, secondChance: true, event: { type: 'answer_second_chance', ...event } };
    }

    phase.data.answers[teamId] = { option: action.option, t, tSource: source, correct, deviceId, at: now };
    // La confirmación no dice si la respuesta es correcta (RF-PRE-08).
    return { ok: true, event: { type: 'answer_received', ...event } };
  },

  // Cierra cuando todos respondieron o ya no pueden responder (su plazo con Reloj Roto pasó).
  isComplete(ctx) {
    const { phase, config, activeTeamIds, now } = ctx;
    return activeTeamIds.length > 0 && activeTeamIds.every((id) =>
      phase.data.answers[id] || now > deadlineOf(ctx, id) + config.questions.answerGraceMs);
  },

  // Instantes en que el servidor debe actuar dentro de la pregunta: pasos de Contrarreloj y el
  // vencimiento de los plazos acortados por Reloj Roto.
  nextWakeup(ctx) {
    const { room, phase, config, now } = ctx;
    const times = [];
    for (const { id } of room.teams) {
      if (phase.data.answers[id]) continue;
      const done = phase.data.countdownSteps[id] ?? 0;
      if (hasEffect(phase, id, 'CR') && done < COUNTDOWN_STEPS) times.push(countdownStepAt(ctx, done + 1));
      const deadline = deadlineOf(ctx, id) + config.questions.answerGraceMs + 1;
      if (hasEffect(phase, id, 'RR') && deadline > now) times.push(deadline);
    }
    return times.length > 0 ? Math.min(...times) : null;
  },

  // Contrarreloj: elimina una opción incorrecta al azar en cada paso vencido.
  onWakeup(ctx) {
    const { room, phase, config, now, random } = ctx;
    const { correct } = questionFor(config, phase);
    for (const { id } of room.teams) {
      if (phase.data.answers[id] || !hasEffect(phase, id, 'CR')) continue;
      while ((phase.data.countdownSteps[id] ?? 0) < COUNTDOWN_STEPS
        && countdownStepAt(ctx, (phase.data.countdownSteps[id] ?? 0) + 1) <= now) {
        phase.data.countdownSteps[id] = (phase.data.countdownSteps[id] ?? 0) + 1;
        const eliminated = (phase.data.eliminated[id] ??= []);
        const candidates = [0, 1, 2, 3].filter((option) => option !== correct && !eliminated.includes(option));
        if (candidates.length > 0) eliminated.push(candidates[Math.floor(random() * candidates.length)]);
      }
    }
  },

  // Al cerrar: puntos y rachas (RF-PUN-*, RF-PRE-11); luego la penalización de Doble o nada y los
  // Chupa-Sangre, en ese orden (5.5).
  exit(ctx) {
    const { room, phase, config } = ctx;
    const question = questionFor(config, phase);
    const { basePoints } = config.questions.difficulties[question.difficulty];
    const doubleOrNothing = itemParams(config, 'DN');
    const rows = new Map();

    for (const team of room.teams) {
      const answer = phase.data.answers[team.id] ?? null;
      const doubled = hasEffect(phase, team.id, 'DN');
      const row = {
        teamId: team.id,
        answered: Boolean(answer),
        option: answer?.option ?? null,
        correct: Boolean(answer?.correct),
        t: answer?.t ?? null,
        points: 0,
        streak: 0,
        multiplier: 1,
        modifiers: doubled ? ['DN'] : [],
        secondChance: Boolean(phase.data.secondChanceUsed[team.id]),
        adjustments: [],
      };
      if (row.correct) {
        setStreak(team, team.streak + 1);
        const { points, multiplier } = questionPoints({
          basePoints,
          timeLimitMs: question.timeLimitMs, // con Reloj Roto, P(t) se calcula con la T original
          t: answer.t,
          streak: team.streak,
          modifier: doubled ? doubleOrNothing.multiplier : 1,
          scoring: config.scoring,
        });
        addPoints(team, points);
        Object.assign(row, { points, streak: team.streak, multiplier });
      } else {
        setStreak(team, 0);
        // Sin respuesta: además, un objeto adicional en el próximo draft (RF-OBJ-08).
        if (!answer) team.pendingExtraItem = true;
      }
      rows.set(team.id, row);
    }

    for (const team of room.teams) {
      const row = rows.get(team.id);
      if (row.correct || !hasEffect(phase, team.id, 'DN')) continue;
      const applied = addPoints(team, -Math.round(doubleOrNothing.penaltyShare * basePoints));
      row.adjustments.push({ code: 'DN', points: applied });
    }

    // Chupa-Sangre (AMB-11): el objetivo no pierde nada. Si acierta, el usuario gana el 50 % de lo
    // que obtuvo; si falla o no responde, el usuario pierde el 10 % de su total en ese momento.
    const bloodsucker = itemParams(config, 'CS');
    for (const effect of phase.data.effects.filter((e) => e.code === 'CS')) {
      const user = room.teams.find((t) => t.id === effect.sourceTeamId);
      const target = rows.get(effect.targetTeamId);
      if (!user || !target) continue;
      const delta = target.correct
        ? Math.round(bloodsucker.gainShare * target.points)
        : -Math.round(bloodsucker.lossShare * user.score);
      const applied = addPoints(user, delta);
      rows.get(user.id).adjustments.push({ code: 'CS', points: applied, teamId: effect.targetTeamId });
    }

    const results = [...rows.values()];
    room.activeEffects = (room.activeEffects ?? []).filter((effect) => effect.appliesTo !== 'question');
    room.questionResults ??= {};
    room.questionResults[phase.question] = { questionId: question.id, correct: question.correct, results };
    ctx.record('question_closed', {
      questionId: question.id,
      number: phase.question,
      difficulty: question.difficulty,
      correct: question.correct,
      basePoints,
      timeLimitMs: question.timeLimitMs,
      effects: phase.data.effects,
      results,
    });
  },

  // Qué ve cada rol mientras la pregunta está abierta. La opción correcta no sale del
  // servidor (RF-PRE-08) y el proyector no ve el enunciado (RF-PRE-10, AMB-29). Los efectos
  // activos son públicos: ya se mostraron en la resolución.
  view(ctx, viewer) {
    const { phase, config, activeTeamIds } = ctx;
    const question = questionFor(config, phase);
    const base = {
      ...summary(config, question, phase),
      answeredTeamIds: Object.keys(phase.data.answers),
      expectedTeamIds: activeTeamIds,
      effects: phase.data.effects.map(({ code, sourceTeamId, targetTeamId }) => ({ code, sourceTeamId, targetTeamId })),
    };
    if (viewer.role === 'screen') return base;
    if (viewer.role === 'host') return { ...base, statement: statementOf(question), options: question.options };

    const mine = ctx.teamOf(viewer.deviceId);
    if (!mine) return base;
    const teamId = mine.team.id;
    const role = deviceRole(ctx, viewer.deviceId);
    const answer = phase.data.answers[teamId];
    return {
      ...base,
      role,
      statement: role === 'options' ? null : statementOf(question),
      options: role === 'statement' ? null : question.options,
      myAnswer: answer ? { option: answer.option } : null,
      deadline: deadlineOf(ctx, teamId),
      eliminated: phase.data.eliminated[teamId] ?? [],
      secondChanceUsed: Boolean(phase.data.secondChanceUsed[teamId]),
      ink: hasEffect(phase, teamId, 'C') ? inkOf(phase, config) : null,
    };
  },
};

export const questionResultPhase = {
  durationMs: () => null,
  waitsHost: true,
  view({ room, phase, config }) {
    const question = questionFor(config, phase);
    const stored = room.questionResults?.[phase.question];
    return {
      ...summary(config, question, phase),
      statement: statementOf(question),
      options: question.options,
      correct: question.correct,
      results: stored?.results ?? [],
    };
  },
};

// Roles del equipo en una pregunta (RF-PRE-03/04): A ve el enunciado en las preguntas impares
// y B en las pares; el otro ve las opciones. Si el compañero no está conectado, el dispositivo
// cumple ambos roles. Se calcula en cada vista, así que se adapta a desconexiones.
export function deviceRole({ phase, teamOf, isConnected }, deviceId) {
  const mine = teamOf(deviceId);
  if (!mine) return null;
  const partner = mine.team.slots[mine.slot === 'A' ? 'B' : 'A'];
  if (!partner || !isConnected(partner)) return 'both';
  const statementSlot = phase.question % 2 === 1 ? 'A' : 'B';
  return mine.slot === statementSlot ? 'statement' : 'options';
}

function summary(config, question, phase) {
  const difficulty = config.questions.difficulties[question.difficulty];
  return {
    questionId: question.id,
    number: phase.question,
    difficulty: question.difficulty,
    difficultyLabel: difficulty.label,
    basePoints: difficulty.basePoints,
    timeLimitMs: question.timeLimitMs,
  };
}

function statementOf(question) {
  return { text: question.statement, image: question.image ?? null };
}
