// Sincronización de reloj (sección 3.6, paso 1): se envían varios pings seguidos y se
// usa la muestra de menor RTT. Se repite cada 30 s y en cada (re)conexión.
//   rtt    = t_recepción − t_envío
//   offset = t_servidor − (t_envío + rtt / 2)
export function createTimeSync(socket, { samples = 7, intervalMs = 30_000, onUpdate } = {}) {
  const state = { rtt: null, offset: 0, synced: false };
  let running = false;

  function ping() {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const p0 = performance.now();
      socket.timeout(3000).emit('time:ping', { t0 }, (err, res) => {
        if (err || !Number.isFinite(res?.tServer)) return resolve(null);
        const rtt = performance.now() - p0;
        resolve({ rtt, offset: res.tServer - (t0 + rtt / 2) });
      });
    });
  }

  async function sync() {
    if (running || !socket.connected) return;
    running = true;
    let best = null;
    for (let i = 0; i < samples; i += 1) {
      const sample = await ping();
      if (sample && (!best || sample.rtt < best.rtt)) best = sample;
    }
    running = false;
    if (!best) return;
    state.rtt = Math.round(best.rtt);
    state.offset = Math.round(best.offset);
    state.synced = true;
    socket.emit('time:report', { rtt: state.rtt, offset: state.offset });
    onUpdate?.(state);
  }

  socket.on('connect', sync);
  const timer = setInterval(sync, intervalMs);
  if (socket.connected) sync();

  return {
    state,
    now: () => Date.now() + state.offset, // hora del servidor estimada
    sync,
    stop: () => clearInterval(timer),
  };
}
