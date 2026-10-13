// Mediciones de la prueba de carga (scripts/load.js), como funciones que se pueden probar solas.
//
// Cada cliente (bot) convierte la hora de llegada de cada vista a la hora del servidor con su desfase
// de TimeSync: llegada = recepción local + offset. Con eso:
//   - latencia de entrega (RNF-02) = llegada − serverTime de la vista, en total y por tipo de fase;
//   - latencia de los fotogramas de la Arena = llegada − t del fotograma;
//   - inicio de fase (RNF-03): cada pantalla muestra la fase en max(startsAt, llegada), porque espera
//     a startsAt si la vista llegó antes (client/shared/view.js). La diferencia entre pantallas es el
//     máximo menos el mínimo de esos instantes. El error del propio desfase no entra aquí: se informa
//     aparte (en local es el desfase mismo, porque servidor y bots comparten reloj).

// Percentil por rango más cercano (p entre 0 y 100). Sin valores: null.
export function percentile(values, p) {
  return values.length === 0 ? null : rankIn([...values].sort((a, b) => a - b), p);
}

export function summarize(values) {
  if (values.length === 0) return { count: 0, p50: null, p95: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: rankIn(sorted, 50),
    p95: rankIn(sorted, 95),
    p99: rankIn(sorted, 99),
    max: sorted.at(-1),
  };
}

function rankIn(sorted, p) {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

// Junta lo que ven los clientes. watch(client) se suscribe a sus vistas; los clientes deben tener
// `rtt` (null hasta sincronizar el reloj), `offset` y `socket` (cambia al reconectar).
const phaseKey = (phase) => (!phase ? 'lobby' : phase.kind === 'minigame' ? `minijuego ${phase.minigame}` : phase.kind);

export function createProbe() {
  const latencies = [];
  const byPhase = new Map(); // tipo de fase → latencias
  const frameLatencies = [];
  const starts = new Map(); // seq → { id, startsAt, arrivals: [hora del servidor] }
  const clients = new Map(); // cliente → { socket, connectedLocal, lastSeq, phaseIds }

  function onView(client, view, receivedAt) {
    let state = clients.get(client);
    if (!state) {
      state = { socket: null, connectedLocal: null, lastSeq: null, phaseIds: [] };
      clients.set(client, state);
    }
    const synced = client.rtt !== null && client.rtt !== undefined;
    const arrival = receivedAt + (client.offset ?? 0);
    // Primera vista de cada conexión (hora local: el desfase puede no estar medido todavía).
    if (state.socket !== client.socket) {
      state.socket = client.socket;
      state.connectedLocal = receivedAt;
    }
    if (synced && Number.isFinite(view.serverTime)) {
      const ms = arrival - view.serverTime;
      latencies.push(ms);
      const key = phaseKey(view.phase);
      if (!byPhase.has(key)) byPhase.set(key, []);
      byPhase.get(key).push(ms);
    }

    const { phase } = view;
    if (!phase || phase.seq === state.lastSeq) return;
    state.lastSeq = phase.seq;
    state.phaseIds.push(phase.id);
    // Solo cuenta si el cliente ya estaba conectado cuando se anunció la fase (no tras reconectar).
    if (!synced || state.connectedLocal + client.offset > phase.startsAt) return;
    if (!starts.has(phase.seq)) starts.set(phase.seq, { id: phase.id, startsAt: phase.startsAt, arrivals: [] });
    starts.get(phase.seq).arrivals.push(arrival);
  }

  function onFrame(client, frame, receivedAt) {
    const synced = client.rtt !== null && client.rtt !== undefined;
    if (synced && Number.isFinite(frame.t)) frameLatencies.push(receivedAt + (client.offset ?? 0) - frame.t);
  }

  return {
    watch(client) {
      client.on('view', (view, receivedAt) => onView(client, view, receivedAt));
      client.on('frame', (frame, receivedAt) => onFrame(client, frame, receivedAt));
    },
    onView,
    onFrame,
    phaseIdsOf: (client) => clients.get(client)?.phaseIds ?? [],
    latency: () => summarize(latencies),
    // Por tipo de fase, de la más lenta (p95) a la más rápida: dónde se acumula la latencia.
    latencyByPhase: () => [...byPhase].map(([key, values]) => ({ key, ...summarize(values) })).sort((a, b) => b.p95 - a.p95),
    frameLatency: () => summarize(frameLatencies),
    phaseStarts: () => phaseStartSummary([...starts.values()]),
  };
}

// starts: [{ id, startsAt, arrivals }] → diferencia entre pantallas y vistas que llegaron tarde.
export function phaseStartSummary(starts) {
  const spreads = [];
  let lateViews = 0;
  let views = 0;
  let maxLateMs = 0;
  let minMarginMs = null; // cuánto antes de startsAt llegó la vista más justa
  for (const { startsAt, arrivals } of starts) {
    if (arrivals.length === 0) continue;
    const shown = arrivals.map((arrival) => Math.max(startsAt, arrival));
    spreads.push(Math.max(...shown) - Math.min(...shown));
    for (const arrival of arrivals) {
      views += 1;
      if (arrival > startsAt) {
        lateViews += 1;
        maxLateMs = Math.max(maxLateMs, arrival - startsAt);
      }
      minMarginMs = minMarginMs === null ? startsAt - arrival : Math.min(minMarginMs, startsAt - arrival);
    }
  }
  const spread = summarize(spreads);
  return { phases: spreads.length, views, spreadP95: spread.p95, spreadMax: spread.max, lateViews, maxLateMs, minMarginMs };
}
