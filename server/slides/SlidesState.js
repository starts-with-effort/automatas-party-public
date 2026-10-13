// Posición de la presentación, con el servidor como autoridad: diapositiva, paso, pantalla negra,
// cronómetro y la cadena del simulador en vivo. El proyector y los celulares solo piden cambios.
//
// next/prev llevan el `seq` que ve quien los manda: si no coincide con el actual (otro toque ya
// movió la presentación), se descartan. Así dos toques simultáneos nunca saltan un paso.
import { EventEmitter } from 'node:events';
import { nextPosition, prevPosition } from '../../presentacion/deck/position.js';

export class SlidesState extends EventEmitter {
  // deck: { slides, stepCount(slide, live), normalizeLive(raw) } (presentacion/deck/deck.js).
  constructor({ deck, store = null, now = Date.now }) {
    super();
    this.deck = deck;
    this.store = store;
    this.now = now;
    this.state = this.restore(store?.load() ?? null);
  }

  restore(saved) {
    const fresh = {
      id: this.deck.slides[0].id,
      step: 0,
      seq: 0,
      blackout: false,
      slideSince: this.now(),
      timer: { running: false, startedAt: null, elapsedMs: 0 },
      live: null,
    };
    if (!saved || !this.deck.slides.some((slide) => slide.id === saved.id)) return fresh;
    const state = {
      ...fresh,
      id: saved.id,
      seq: Number.isInteger(saved.seq) ? saved.seq : 0,
      blackout: saved.blackout === true,
      slideSince: Number(saved.slideSince) || fresh.slideSince,
      timer: { ...fresh.timer, ...saved.timer },
      live: saved.live ? this.deck.normalizeLive(saved.live) : null,
    };
    state.step = clamp(saved.step, 0, this.deck.stepCount(this.slideById(state.id), state.live) - 1);
    return state;
  }

  slideById(id) {
    return this.deck.slides.find((slide) => slide.id === id);
  }

  get index() {
    return this.deck.slides.findIndex((slide) => slide.id === this.state.id);
  }

  get slide() {
    return this.deck.slides[this.index];
  }

  get steps() {
    return this.deck.stepCount(this.slide, this.state.live);
  }

  view() {
    const { id, step, seq, blackout, slideSince, timer, live } = this.state;
    return { index: this.index, id, step, steps: this.steps, seq, blackout, slideSince, timer: { ...timer }, live, now: this.now() };
  }

  // { action: 'next' | 'prev', seq } o { action: 'goto', slide: id | índice, step }.
  nav({ action, seq, slide, step } = {}) {
    if (action === 'goto') return this.goto(slide, step);
    if (action !== 'next' && action !== 'prev') return { ok: false, error: 'invalid_action' };
    if (seq !== this.state.seq) return { ok: false, error: 'stale', seq: this.state.seq };
    const move = action === 'next' ? nextPosition : prevPosition;
    const target = move(this.deck, this.state, this.state.live);
    if (!target) return { ok: false, error: action === 'next' ? 'end' : 'start' };
    if (action === 'next' && this.index === 0 && target.id !== this.state.id) this.autoStartTimer();
    return this.moveTo(target.id, target.step);
  }

  goto(target, step = 0) {
    const slide = typeof target === 'number' ? this.deck.slides[target] : this.slideById(target);
    if (!slide) return { ok: false, error: 'unknown_slide' };
    const last = this.deck.stepCount(slide, this.state.live) - 1;
    return this.moveTo(slide.id, clamp(step, 0, last));
  }

  moveTo(id, step) {
    if (id !== this.state.id) this.state.slideSince = this.now();
    this.state.id = id;
    this.state.step = step;
    this.record({ type: 'pos', id, step });
    return this.changed();
  }

  setBlackout(on) {
    this.state.blackout = Boolean(on);
    this.record({ type: 'blackout', on: this.state.blackout });
    return this.changed();
  }

  // Cronómetro general: 'start', 'pause' o 'reset'.
  timer(action) {
    const timer = this.state.timer;
    const now = this.now();
    if (action === 'start') {
      if (timer.running) return { ok: true };
      Object.assign(timer, { running: true, startedAt: now });
    } else if (action === 'pause') {
      if (!timer.running) return { ok: true };
      Object.assign(timer, { running: false, startedAt: null, elapsedMs: timer.elapsedMs + (now - timer.startedAt) });
    } else if (action === 'reset') {
      Object.assign(timer, { running: false, startedAt: null, elapsedMs: 0 });
    } else {
      return { ok: false, error: 'invalid_action' };
    }
    this.record({ type: 'timer', action });
    return this.changed();
  }

  // El cronómetro arranca solo con el primer «Siguiente» desde la portada.
  autoStartTimer() {
    const timer = this.state.timer;
    if (timer.running || timer.elapsedMs > 0) return;
    Object.assign(timer, { running: true, startedAt: this.now() });
    this.record({ type: 'timer', action: 'start' });
  }

  // Cadena del simulador en vivo. Si la presentación está en esa diapositiva, vuelve al paso 0.
  setLive(raw) {
    const live = this.deck.normalizeLive(raw);
    if (!live) return { ok: false, error: 'invalid_live' };
    this.state.live = live;
    if (this.slide.live) this.state.step = 0;
    this.record({ type: 'live', ...live });
    return this.changed();
  }

  changed() {
    this.state.seq += 1;
    this.store?.save(this.state);
    this.emit('change');
    return { ok: true, seq: this.state.seq };
  }

  record(event) {
    this.store?.append({ t: this.now(), ...event });
  }
}

function clamp(value, min, max) {
  const n = Number.isInteger(value) ? value : 0;
  return Math.max(min, Math.min(max, n));
}
