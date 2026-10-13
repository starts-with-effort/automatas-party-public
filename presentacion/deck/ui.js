// Utilidades de interfaz compartidas por el proyector y el celular.

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 83 000 ms → «1:23». Negativo → «-0:05».
export function formatClock(ms) {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Texto de una nota: párrafos separados por una línea en blanco; **así** queda en negrita y P_N con
// subíndice.
export function noteHtml(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim())
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\b([A-Za-z])_([A-Za-z0-9]+)/g, '$1<sub>$2</sub>')
      .replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// Bloque de una diapositiva: la exposición ('talk'), las que explican el quiz ('quiz', después del
// cierre) o las de respaldo ('backup'). Solo las de la exposición cuentan en el avance.
export function slideGroup(slide) {
  if (slide.backup) return 'backup';
  return slide.section === 'quiz' ? 'quiz' : 'talk';
}

// Número que se muestra: «8 / 19» en las de la exposición, «Q2» en las del quiz y «R2» en las de
// respaldo.
export function slideLabel(slides, index) {
  const slide = slides[index];
  const kind = slideGroup(slide);
  const group = slides.filter((s) => slideGroup(s) === kind);
  const n = group.indexOf(slide) + 1;
  return kind === 'talk' ? `${n} / ${group.length}` : `${kind === 'quiz' ? 'Q' : 'R'}${n}`;
}
