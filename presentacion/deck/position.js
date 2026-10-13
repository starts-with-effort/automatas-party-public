// Siguiente y anterior posición (diapositiva, paso). La usan el servidor y el proyector sin conexión.
// deck: { slides, stepCount(slide, live) }. Devuelven null en los bordes.
//
// Las diapositivas de respaldo van al final y forman su propio bloque: desde la última principal
// «Siguiente» no entra en ellas, y desde la primera de respaldo «Anterior» no vuelve atrás.

export function nextPosition(deck, { id, step }, live = null) {
  const i = deck.slides.findIndex((slide) => slide.id === id);
  const current = deck.slides[i];
  if (!current) return null;
  if (step < deck.stepCount(current, live) - 1) return { id, step: step + 1 };
  const following = deck.slides[i + 1];
  if (!following || Boolean(following.backup) !== Boolean(current.backup)) return null;
  return { id: following.id, step: 0 };
}

export function prevPosition(deck, { id, step }, live = null) {
  const i = deck.slides.findIndex((slide) => slide.id === id);
  const current = deck.slides[i];
  if (!current) return null;
  if (step > 0) return { id, step: step - 1 };
  const previous = deck.slides[i - 1];
  if (!previous || Boolean(previous.backup) !== Boolean(current.backup)) return null;
  return { id: previous.id, step: deck.stepCount(previous, live) - 1 };
}
