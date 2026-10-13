// Inicios programados (RF-FLU-05): el servidor anuncia cada fase con un startsAt en el
// futuro. La vista nueva llega antes, pero la pantalla sigue mostrando la fase anterior
// hasta que el reloj sincronizado llega a startsAt; así todas cambian a la vez.
// onAhead(view, delay) avisa una vez, al llegar una fase nueva, cuánto falta para mostrarla
// (lo usa el cambio de ronda para animarse durante ese margen).
export function createViewScheduler(clock, render, { onAhead = null } = {}) {
  let shownSeq; // undefined hasta el primer render
  let latest = null;
  let timer = null;

  function show(view) {
    clearTimeout(timer);
    timer = null;
    shownSeq = view.phase?.seq ?? null;
    render(view);
  }

  return function onView(view) {
    latest = view;
    const seq = view.phase?.seq ?? null;
    // Primera vista, misma fase o sin fase: se muestra de inmediato.
    if (shownSeq === undefined || seq === shownSeq || seq === null) return show(view);
    const delay = view.phase.startsAt - clock.now();
    if (delay <= 0) return show(view);
    if (!timer) {
      onAhead?.(view, delay);
      timer = setTimeout(() => {
        timer = null;
        onView(latest);
      }, delay);
    }
  };
}
