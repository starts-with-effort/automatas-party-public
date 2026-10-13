// ?print: todas las diapositivas paso por paso, una por página de 1920×1080, para guardar un PDF con
// Ctrl+P (plan B y material para compartir). ?print=final deja solo el último paso de cada una;
// &respaldo agrega las de respaldo. Arriba, una revisión: que cada diapositiva arme los pasos que dice
// el manifiesto y que ninguna falle al montarse.
import { DEFAULT_LIVE, SECTIONS, SLIDES, normalizeLive, stepCount } from '/deck/deck.js';
import { footerHtml, loadModules, mountSlide } from '/deck/engine/engine.js';
import { escapeHtml } from '/deck/ui.js';

export async function runPrint(params) {
  document.body.className = 'print-mode';
  document.body.innerHTML = '<section class="print-report" id="report">Preparando…</section><div class="print-pages" id="pages"></div>';
  const pages = document.getElementById('pages');
  const finalOnly = params.get('print') === 'final';
  const slides = SLIDES.filter((slide) => params.has('respaldo') || !slide.backup);
  const modules = await loadModules(SLIDES);
  const problems = [];
  let count = 0;

  for (const slide of slides) {
    const index = SLIDES.indexOf(slide);
    // &live=pda:cadena prueba el simulador en vivo con otra cadena (p. ej. live=wwr:0110).
    const [pda, input = ''] = (params.get('live') ?? '').split(':');
    const live = normalizeLive({ pda, input }) ?? DEFAULT_LIVE;
    const expected = stepCount(slide, live);
    const steps = finalOnly ? [expected - 1] : [...Array(expected).keys()];
    let checked = false;
    for (const step of steps) {
      const page = document.createElement('div');
      page.className = 'page';
      page.innerHTML = `<div class="stage"><div class="slides"></div><footer class="deck-foot${index === 0 ? ' is-hidden' : ''}">${footerHtml(SLIDES, SECTIONS, index)}</footer></div>`;
      pages.append(page);
      const mounted = mountSlide(page.querySelector('.slides'), slide, { mount: modules.get(slide.id), live, expected });
      mounted.tl.seek(`s${step}`);
      mounted.intro?.progress(1);
      count += 1;
      if (!checked) {
        checked = true;
        if (!modules.get(slide.id)) problems.push(`${slide.id}: no tiene módulo (se muestran sus notas)`);
        if (mounted.error) problems.push(`${slide.id}: error al montar (${mounted.error.message})`);
        else if (mounted.count !== expected) problems.push(`${slide.id}: arma ${mounted.count} pasos y el manifiesto dice ${expected}`);
      }
    }
  }

  document.getElementById('report').innerHTML = `
    <h1>Presentación para imprimir</h1>
    <p>${slides.length} diapositivas, ${count} páginas${finalOnly ? ' (último paso de cada una)' : ' (una por paso)'}.
      Ctrl+P → «Guardar como PDF», márgenes «Ninguno» y gráficos de fondo activados.</p>
    ${problems.length
      ? `<p class="bad-text">Revisión: ${problems.length} problema(s)</p><ul>${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
      : '<p class="ok-text">Revisión: todas las diapositivas arman los pasos del manifiesto.</p>'}`;
  document.body.dataset.ready = 'true';
}
