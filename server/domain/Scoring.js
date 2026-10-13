// Reglas de puntaje de las secciones 5.1, 5.2 y 3.6 como funciones puras.
// El redondeo al entero se hace una sola vez, al final (RF-PUN-01, RF-PUN-04).

// P(t) = B · (T − t) / T, acotado a [0, B]. t y T en milisegundos.
export function timePoints({ basePoints, timeLimitMs, t }) {
  const elapsed = Math.min(Math.max(t, 0), timeLimitMs);
  return (basePoints * (timeLimitMs - elapsed)) / timeLimitMs;
}

// M(r) = 1 + ln(r) / divisor si r ≥ mínimo; si no, 1 (RF-PUN-03, AMB-01).
export function streakMultiplier(streak, { streakDivisor = 10, streakMinimum = 3 } = {}) {
  return streak >= streakMinimum ? 1 + Math.log(streak) / streakDivisor : 1;
}

// Puntos de una respuesta correcta: P(t) × M(r) × modificadores → redondeo.
// `streak` es la racha que ya incluye esta respuesta (AMB-02).
export function questionPoints({ basePoints, timeLimitMs, t, streak, modifier = 1, scoring }) {
  const multiplier = streakMultiplier(streak, scoring);
  return {
    points: Math.round(timePoints({ basePoints, timeLimitMs, t }) * multiplier * modifier),
    multiplier,
  };
}

// Premios de los minijuegos por ronda: los de game.json son los de la ronda 1 (1.er puesto =
// firstPrize) y cada ronda siguiente el 1.er puesto vale roundStep más (1000, 1500, 2000…). El
// factor multiplica todos los premios del minijuego, así cada uno conserva sus proporciones.
export function roundFactor({ firstPrize, roundStep }, round) {
  return (firstPrize + roundStep * Math.max(0, round - 1)) / firstPrize;
}

// Multiplicador de compensación: desde la ronda fromRound, un equipo gana más en el minijuego
// según los puntos que le saca el 1.º (la distancia, no el puesto): +bonusPerStep por cada gapStep
// puntos de diferencia, hasta +maxBonus. El líder (o quien empata con él) queda en ×1.
export function catchUpFactor({ fromRound, gapStep, bonusPerStep, maxBonus }, round, gap) {
  if (round < fromRound || gap <= 0) return 1;
  return 1 + Math.min(maxBonus, (bonusPerStep * gap) / gapStep);
}

// Tiempo de respuesta (sección 3.6, paso 4). Se acepta el t medido por el cliente si es
// coherente con lo que vio el servidor:  tServidor − RTT − slack ≤ tCliente ≤ tServidor + ahead.
// Si no (reloj manipulado o error), se usa tServidor − RTT/2. Nunca es negativo.
export function resolveAnswerTime({ tClient, tServer, rtt, slackMs, aheadMs, defaultRttMs }) {
  const roundTrip = Number.isFinite(rtt) ? rtt : defaultRttMs;
  if (Number.isFinite(tClient) && tClient >= tServer - roundTrip - slackMs && tClient <= tServer + aheadMs) {
    return { t: Math.max(0, Math.round(tClient)), source: 'client' };
  }
  return { t: Math.max(0, Math.round(tServer - roundTrip / 2)), source: 'server' };
}
