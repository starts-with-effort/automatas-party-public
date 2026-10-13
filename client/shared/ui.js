import { h } from './dom.js';
import { errorMessage } from './errors.js';

export const $ = (selector, root = document) => root.querySelector(selector);

const STATUS_LABELS = {
  wait: 'Conectando…',
  ok: 'Conectado',
  off: 'Desconectado',
  bad: 'Rechazado',
};

export function setStatus(el, state) {
  el.textContent = STATUS_LABELS[state];
  el.className = `chip chip-${state}`;
}

export function formatMs(value) {
  return value === null || value === undefined ? '—' : `${value} ms`;
}

// +250, −250 o 0.
export function signed(value) {
  if (value > 0) return `+${value}`;
  if (value < 0) return `−${-value}`;
  return '0';
}

// Envía un mensaje y espera la confirmación del servidor: { ok, error?, ... }.
export function send(socket, event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) return resolve({ ok: false, error: 'disconnected' });
    socket.timeout(5000).emit(event, payload, (err, res) => {
      resolve(err ? { ok: false, error: 'timeout' } : res);
    });
  });
}

// Como send, pero muestra el error en pantalla si lo hay.
export async function sendOrToast(socket, event, payload) {
  const res = await send(socket, event, payload);
  if (!res.ok) toast(errorMessage(res.error));
  return res;
}

export function toast(text) {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

// Ejecuta fn cuando el reloj sincronizado llegue a serverTime (inicios programados, 3.6 paso 2).
export function runAt(serverTime, clock, fn) {
  setTimeout(fn, Math.max(0, serverTime - clock.now()));
}

// Actualiza en cada cuadro todas las cuentas regresivas creadas con countdown() (phases.js).
// Antes de startsAt (o de resumeAt, tras una pausa) muestra el tiempo completo; en pausa, el congelado.
// --left es la fracción de tiempo que queda (de 1 a 0): el anillo de la cuenta regresiva la dibuja.
export function startCountdowns(clock) {
  const tick = () => {
    const now = clock.now();
    for (const el of document.querySelectorAll('[data-ends-at]')) {
      const { endsAt, startsAt, resumeAt, pausedAt } = el.dataset;
      const from = pausedAt
        ? Math.max(Number(pausedAt), Number(startsAt))
        : Math.max(now, Number(startsAt), Number(resumeAt));
      const left = Number(endsAt) - from;
      el.textContent = formatSeconds(left);
      const total = Number(endsAt) - Number(startsAt);
      if (Number(startsAt) > 0 && total > 0) el.style.setProperty('--left', Math.min(1, Math.max(0, left / total)).toFixed(3));
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function formatSeconds(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return String(total);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Reloj del servidor con décimas de segundo: dos pantallas juntas deben marcar lo mismo.
export function startClock(el, clock) {
  const tick = () => {
    const now = new Date(clock.now());
    const time = now.toLocaleTimeString('es-CO', { hour12: false });
    el.textContent = `${time}.${Math.floor(now.getMilliseconds() / 100)}`;
    requestAnimationFrame(tick);
  };
  tick();
}

export function flash(label) {
  const overlay = h('div', { class: 'flash' }, label);
  document.body.append(overlay);
  overlay.addEventListener('animationend', () => overlay.remove());
}

export function showAnnouncement(el, text) {
  el.textContent = text;
  el.hidden = false;
}

// Destello y avisos del host: comunes a las tres interfaces.
export function listenHostBroadcasts(socket, clock, announceEl) {
  socket.on('host:flash', ({ n, startsAt }) => runAt(startsAt, clock, () => flash(n)));
  socket.on('host:announce', ({ text }) => showAnnouncement(announceEl, text));
}
