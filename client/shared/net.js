// El servidor sirve su propio cliente de Socket.IO: no dependemos de ningún CDN.
import { io } from '/socket.io/socket.io.esm.min.js';

export function connect(auth) {
  return io({ auth });
}

// 'polling' al principio; debe pasar a 'websocket' si Caddy y la red lo permiten.
export function transportName(socket) {
  return socket.io.engine?.transport?.name ?? '—';
}

// Llama a onChange al conectar y cada vez que el transporte se actualiza a websocket.
export function watchTransport(socket, onChange) {
  socket.on('connect', () => {
    onChange(transportName(socket));
    socket.io.engine.once('upgrade', () => onChange(transportName(socket)));
  });
}
