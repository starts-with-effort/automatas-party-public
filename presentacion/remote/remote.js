// Control de la presentación en el celular: siguiente/anterior (botones o deslizar), la nota del paso
// actual, el guion, qué viene después, cronómetros, índice, pantalla negra y el simulador en vivo.
import { DEFAULT_LIVE, LIVE_OPTIONS, PRESENTERS, SECTIONS, SLIDES, TOTAL_BUDGET, stepNotes } from '/deck/deck.js';
import { createNavigator } from '/deck/navigator.js';
import { connectSlides } from '/deck/net.js';
import { escapeHtml, formatClock, noteHtml, slideLabel } from '/deck/ui.js';
import { keepScreenOn } from '/shared/wakelock.js';

// Si se entró con un enlace …/remote/#t=<token> y ya había sesión, el token no se queda a la vista.
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

const $ = (id) => document.getElementById(id);
const socket = connectSlides('remote');
let state = null;
let offset = 0; // hora del servidor − hora local
let draft = null; // cadena que se está escribiendo para el simulador
const navigator = createNavigator(socket, () => state, {
  onBusy: (busy) => $('next').classList.toggle('busy', busy),
});

keepScreenOn();

socket.on('slides:state', (next) => {
  const changedSlide = state?.id !== next.id;
  state = next;
  offset = next.now - Date.now();
  if (changedSlide) draft = null;
  render();
  tick();
});
socket.on('connect', () => setConnected(true));
socket.on('disconnect', () => setConnected(false));
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') location.reload();
  setConnected(false);
});

function setConnected(on) {
  $('dot').classList.toggle('on', on);
  renderBanner();
}

function press(direction) {
  if (!state || !socket.connected) return;
  globalThis.navigator.vibrate?.(12);
  navigator.press(direction);
}

$('next').addEventListener('click', () => press(1));
$('prev').addEventListener('click', () => press(-1));

// Deslizar sobre las notas: a la izquierda avanza, a la derecha retrocede.
let swipe = null;
$('body').addEventListener('pointerdown', (event) => {
  if (event.target.closest('button, summary, .live')) return;
  swipe = { x: event.clientX, y: event.clientY };
});
$('body').addEventListener('pointerup', (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dy) < 50) press(dx < 0 ? 1 : -1);
});
$('body').addEventListener('pointercancel', () => { swipe = null; });

// ------------------------------------------------------------ dibujo
function render() {
  const slide = SLIDES[state.index];
  const notes = stepNotes(slide, state.live ?? DEFAULT_LIVE);
  $('section').textContent = SECTIONS[slide.section] ?? '';
  $('num').textContent = slideLabel(SLIDES, state.index);
  $('who').textContent = slide.presenter ? `Expone: ${PRESENTERS[slide.presenter - 1]}` : SECTIONS[slide.section] ?? '';
  $('title').textContent = slide.title;
  $('dots').innerHTML = state.steps <= 16
    ? Array.from({ length: state.steps }, (_, i) => `<i class="${i < state.step ? 'done' : i === state.step ? 'now' : ''}"></i>`).join('')
      + `<span>${state.step + 1}/${state.steps}</span>`
    : `<span>Paso ${state.step + 1} de ${state.steps}</span>`;
  $('note').innerHTML = noteHtml(notes[state.step] ?? '');
  $('script').innerHTML = noteHtml(slide.script);
  $('script-box').hidden = !slide.script;
  $('upnext').innerHTML = upNext(slide, notes);
  $('prev').disabled = !hasPrev();
  renderLive(slide);
  renderBanner();
  renderMenu();
}

function upNext(slide, notes) {
  if (state.step < state.steps - 1) {
    const text = (notes[state.step + 1] ?? '').replace(/\*\*/g, '').split(/\n/)[0];
    return `<strong>Al tocar:</strong> ${escapeHtml(text.length > 110 ? `${text.slice(0, 108)}…` : text)}`;
  }
  const following = SLIDES[state.index + 1];
  if (!following || Boolean(following.backup) !== Boolean(slide.backup)) {
    return slide.backup ? 'Última de respaldo.' : 'Es la última. Las de respaldo están en el menú (☰).';
  }
  const handover = following.presenter && following.presenter !== slide.presenter
    ? ` · <strong class="change">pasa a ${escapeHtml(PRESENTERS[following.presenter - 1])}</strong>`
    : '';
  return `<strong>Siguiente diapositiva:</strong> ${escapeHtml(following.title)}${handover}`;
}

function hasPrev() {
  if (state.step > 0) return true;
  const previous = SLIDES[state.index - 1];
  return Boolean(previous) && Boolean(previous.backup) === Boolean(SLIDES[state.index].backup);
}

function renderBanner() {
  const banner = $('banner');
  if (!socket.connected) {
    banner.textContent = 'Sin conexión con el servidor…';
    banner.className = 'banner';
    banner.hidden = false;
  } else if (state?.blackout) {
    banner.textContent = 'Pantalla negra activada';
    banner.className = 'banner dark';
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// Cronómetro general y de la diapositiva, contra la hora del servidor.
function tick() {
  if (!state) return;
  const now = Date.now() + offset;
  const { timer } = state;
  const total = timer.elapsedMs + (timer.running ? now - timer.startedAt : 0);
  const clock = $('clock');
  clock.textContent = `${formatClock(total)} / ${formatClock(TOTAL_BUDGET * 1000)}`;
  clock.classList.toggle('paused', !timer.running);
  clock.classList.toggle('warn', total > TOTAL_BUDGET * 800 && total <= TOTAL_BUDGET * 1000);
  clock.classList.toggle('bad', total > TOTAL_BUDGET * 1000);

  const slide = SLIDES[state.index];
  const spent = now - state.slideSince;
  const budget = slide.budget * 1000;
  const box = $('slide-time-box');
  $('slide-time').textContent = budget ? `${formatClock(spent)} / ${formatClock(budget)}` : formatClock(spent);
  $('slide-bar').style.width = budget ? `${Math.min(100, (spent / budget) * 100)}%` : '0';
  box.classList.toggle('warn', budget > 0 && spent >= budget * 0.8 && spent <= budget);
  box.classList.toggle('bad', budget > 0 && spent > budget);
}
setInterval(tick, 250);

// ------------------------------------------------------------ simulador en vivo
function renderLive(slide) {
  const box = $('live');
  box.hidden = !slide.live;
  if (!slide.live) return;
  const live = state.live ?? DEFAULT_LIVE;
  draft ??= { ...live };
  const option = LIVE_OPTIONS[draft.pda];
  $('live-pdas').innerHTML = Object.entries(LIVE_OPTIONS)
    .map(([id, o]) => `<button class="btn${id === draft.pda ? ' sun' : ''}" type="button" data-pda="${id}">${escapeHtml(o.label)}</button>`)
    .join('');
  $('live-input').innerHTML = draft.input
    ? escapeHtml(draft.input)
    : '<span class="empty">Cadena vacía (ε)</span>';
  $('live-keys').innerHTML = [
    ...option.alphabet.map((c) => `<button class="btn" type="button" data-key="${escapeHtml(c)}">${escapeHtml(c)}</button>`),
    '<button class="btn" type="button" data-key="back" aria-label="Borrar el último">⌫</button>',
    '<button class="btn" type="button" data-key="clear">ε</button>',
  ].join('');
  const same = draft.pda === live.pda && draft.input === live.input;
  $('live-hint').textContent = same
    ? `En el proyector: ${LIVE_OPTIONS[live.pda].label} con «${live.input || 'ε'}». Máximo ${option.max} símbolos.`
    : `Sin enviar. Máximo ${option.max} símbolos.`;
}

$('live').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || !draft) return;
  if (button.dataset.pda) {
    draft = { pda: button.dataset.pda, input: LIVE_OPTIONS[button.dataset.pda].input };
  } else if (button.dataset.key === 'back') {
    draft.input = [...draft.input].slice(0, -1).join('');
  } else if (button.dataset.key === 'clear') {
    draft.input = '';
  } else if (button.dataset.key) {
    if ([...draft.input].length < LIVE_OPTIONS[draft.pda].max) draft.input += button.dataset.key;
  } else if (button.id === 'live-run') {
    socket.emit('live', { ...draft });
    return;
  }
  renderLive(SLIDES[state.index]);
});

// ------------------------------------------------------------ menú
function renderMenu() {
  $('blackout').textContent = state.blackout ? 'Quitar pantalla negra' : 'Pantalla negra';
  $('blackout').classList.toggle('on', state.blackout);
  $('timer-toggle').textContent = state.timer.running ? 'Pausar cronómetro' : 'Iniciar cronómetro';
  let group = null;
  $('index').innerHTML = SLIDES.map((slide, i) => {
    const header = slide.section !== group ? `<li class="group">${escapeHtml(SECTIONS[slide.section])}</li>` : '';
    group = slide.section;
    return `${header}<li><button type="button" data-goto="${i}" class="${i === state.index ? 'now' : ''}">
      <span class="n">${escapeHtml(slideLabel(SLIDES, i).split(' ')[0])}</span>
      <span class="t">${escapeHtml(slide.title)}</span>
      <span class="w">${slide.presenter ? `I${slide.presenter}` : ''}</span></button></li>`;
  }).join('');
}

const sheet = $('sheet');
$('menu-open').addEventListener('click', () => {
  sheet.hidden = false;
  sheet.querySelector('.now')?.scrollIntoView({ block: 'center' });
});
$('menu-close').addEventListener('click', () => { sheet.hidden = true; });
sheet.addEventListener('click', (event) => {
  if (event.target === sheet) sheet.hidden = true;
});
$('index').addEventListener('click', (event) => {
  const button = event.target.closest('[data-goto]');
  if (!button) return;
  socket.emit('nav', { action: 'goto', slide: Number(button.dataset.goto), step: 0 });
  sheet.hidden = true;
});
$('blackout').addEventListener('click', () => state && socket.emit('blackout', { on: !state.blackout }));
$('timer-toggle').addEventListener('click', () => state && socket.emit('timer', { action: state.timer.running ? 'pause' : 'start' }));
$('timer-reset').addEventListener('click', () => {
  if (confirm('¿Reiniciar el cronómetro a 0:00?')) socket.emit('timer', { action: 'reset' });
});
$('logout').addEventListener('click', async () => {
  await fetch('/api/slides/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});
