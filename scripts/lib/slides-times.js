// Tiempos de un ensayo de la presentación, a partir del log que escribe server/slides/store.js
// (data/slides-log.jsonl): cuánto estuvo cada diapositiva en pantalla con el cronómetro corriendo.
//
// Un ensayo empieza cuando el cronómetro arranca desde 0:00 (solo, con el primer «Siguiente» desde
// la portada, o con «Iniciar» en el celular) y termina con «Reiniciar». El tiempo en pausa no cuenta.

// Separa el log en ensayos y mide cada uno. slides: el manifiesto (SLIDES).
export function measureRehearsals(events, slides) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const rehearsals = [];
  let current = null; // ensayo en curso
  let slideId = slides[0]?.id ?? null; // diapositiva en pantalla (el log la sigue aunque no haya ensayo)
  let running = false;
  let last = null;

  const add = (until) => {
    if (current && running && last !== null && slideId) {
      const row = rowOf(current, slideId);
      row.realMs += until - last;
    }
    last = until;
  };

  for (const event of sorted) {
    add(event.t);
    if (event.type === 'pos') {
      if (event.id !== slideId && current) rowOf(current, event.id).visits += 1;
      slideId = event.id;
    } else if (event.type === 'timer') {
      if (event.action === 'start' && !running) {
        if (!current) {
          current = { startedAt: event.t, endedAt: event.t, pausedMs: 0, pausedAt: null, rows: new Map() };
          rehearsals.push(current);
          rowOf(current, slideId).visits += 1;
        }
        if (current.pausedAt !== null) current.pausedMs += event.t - current.pausedAt;
        current.pausedAt = null;
        running = true;
      } else if (event.action === 'pause' && running) {
        running = false;
        current.pausedAt = event.t;
      } else if (event.action === 'reset') {
        running = false;
        if (current) current.pausedAt = null;
        current = null;
      }
    }
    if (current) current.endedAt = event.t;
  }

  const byId = new Map(slides.map((slide, index) => [slide.id, { ...slide, index }]));
  return rehearsals.map((rehearsal) => {
    const rows = [...rehearsal.rows.entries()]
      .map(([id, row]) => {
        const slide = byId.get(id);
        return {
          id,
          index: slide?.index ?? Infinity,
          title: slide?.title ?? id,
          presenter: slide?.presenter ?? 0,
          budgetMs: (slide?.budget ?? 0) * 1000,
          realMs: row.realMs,
          visits: row.visits,
        };
      })
      .sort((a, b) => a.index - b.index);
    const presenters = [...new Set(slides.map((slide) => slide.presenter).filter(Boolean))].sort();
    const byPresenter = presenters.map((presenter) => {
      const own = slides.filter((slide) => slide.presenter === presenter);
      return {
        presenter,
        budgetMs: own.reduce((sum, slide) => sum + slide.budget * 1000, 0),
        realMs: rows.filter((row) => row.presenter === presenter).reduce((sum, row) => sum + row.realMs, 0),
      };
    });
    return {
      startedAt: rehearsal.startedAt,
      endedAt: rehearsal.endedAt,
      pausedMs: rehearsal.pausedMs,
      totalMs: rows.reduce((sum, row) => sum + row.realMs, 0),
      budgetMs: slides.filter((slide) => !slide.backup).reduce((sum, slide) => sum + slide.budget * 1000, 0),
      rows,
      byPresenter,
    };
  });
}

function rowOf(rehearsal, id) {
  if (!rehearsal.rows.has(id)) rehearsal.rows.set(id, { realMs: 0, visits: 0 });
  return rehearsal.rows.get(id);
}
