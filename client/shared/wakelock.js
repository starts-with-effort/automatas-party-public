// Pantalla encendida durante la partida (RNF-12) con la Wake Lock API. El bloqueo se pierde al
// cambiar de pestaña o apagar la pantalla, así que se vuelve a pedir al volver y tras cada toque
// (algunos navegadores solo lo dan después de una interacción). onChange recibe 'on', 'off',
// 'unsupported' o 'denied'.
export function keepScreenOn({ onChange = () => {} } = {}) {
  if (!('wakeLock' in navigator)) {
    onChange('unsupported');
    return;
  }
  let lock = null;
  let pending = false;
  const request = async () => {
    if (lock || pending || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
        onChange('off');
      });
      onChange('on');
    } catch {
      onChange('denied');
    } finally {
      pending = false;
    }
  };
  document.addEventListener('visibilitychange', request);
  document.addEventListener('pointerdown', request);
  request();
}
