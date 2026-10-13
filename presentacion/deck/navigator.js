// Envía «Siguiente»/«Anterior» al servidor con el seq que ve este dispositivo. Los toques rápidos se
// encolan (hasta 3) y se mandan de a uno, cada uno con el seq que dejó el anterior: quien toca dos
// veces avanza dos pasos. Si otro dispositivo movió la presentación entre medio (respuesta «stale»),
// la cola se descarta: así dos personas tocando a la vez no saltan un paso.
const MAX_QUEUE = 3;

export function createNavigator(socket, getState, { onBusy = () => {} } = {}) {
  let queued = 0;
  let inflight = false;

  async function pump() {
    const state = getState();
    if (inflight || queued === 0 || !state) {
      onBusy(inflight || queued !== 0);
      return;
    }
    const action = queued > 0 ? 'next' : 'prev';
    queued -= Math.sign(queued);
    inflight = true;
    onBusy(true);
    let res;
    try {
      res = await socket.timeout(4000).emitWithAck('nav', { action, seq: state.seq });
    } catch {
      res = { ok: false, error: 'timeout' };
    }
    inflight = false;
    if (!res.ok) queued = 0;
    pump();
  }

  return {
    press(direction) {
      queued = Math.max(-MAX_QUEUE, Math.min(MAX_QUEUE, queued + direction));
      pump();
    },
    clear() {
      queued = 0;
    },
  };
}
