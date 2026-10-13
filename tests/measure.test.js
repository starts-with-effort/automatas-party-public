// Mediciones de la prueba de carga (scripts/lib/measure.js): percentiles, latencia de entrega e
// inicio de fase entre pantallas.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import { createProbe, percentile, phaseStartSummary, summarize } from '../scripts/lib/measure.js';

describe('percentiles', () => {
  test('rango más cercano', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    assert.equal(percentile(values, 50), 5);
    assert.equal(percentile(values, 95), 10);
    assert.equal(percentile(values, 10), 1);
    assert.equal(percentile([], 95), null);
  });

  test('resumen: cantidad, p50, p95, p99 y máximo, sin modificar la lista', () => {
    const values = Array.from({ length: 100 }, (_, i) => 100 - i); // 100 … 1
    assert.deepEqual(summarize(values), { count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    assert.equal(values[0], 100);
    assert.deepEqual(summarize([]), { count: 0, p50: null, p95: null, p99: null, max: null });
  });

  test('aguanta muchas muestras (no usa Math.max con argumentos)', () => {
    const values = Array.from({ length: 300_000 }, (_, i) => i);
    assert.equal(summarize(values).max, 299_999);
  });
});

describe('inicio de fase entre pantallas', () => {
  test('cada pantalla muestra la fase en max(startsAt, llegada)', () => {
    const summary = phaseStartSummary([
      { id: 'a', startsAt: 1000, arrivals: [900, 950, 990] }, // todas antes: diferencia 0
      { id: 'b', startsAt: 2000, arrivals: [1900, 2030, 2010] }, // dos tarde: 2030 − 2000 = 30
    ]);
    assert.equal(summary.phases, 2);
    assert.equal(summary.views, 6);
    assert.equal(summary.spreadMax, 30);
    assert.equal(summary.lateViews, 2);
    assert.equal(summary.maxLateMs, 30);
    assert.equal(summary.minMarginMs, -30);
  });
});

// Cliente falso: emite 'view' con la hora local de llegada, como los bots.
function fakeClient({ offset = 0 } = {}) {
  const client = new EventEmitter();
  Object.assign(client, { offset, rtt: 10, socket: {} });
  return client;
}

describe('sonda de la prueba de carga', () => {
  test('latencia = llegada en hora del servidor − serverTime, con el desfase de cada cliente', () => {
    const probe = createProbe();
    const ahead = fakeClient({ offset: 500 }); // su reloj va 500 ms atrás del servidor
    probe.watch(ahead);
    ahead.emit('view', { serverTime: 10_520, phase: null }, 10_040); // llega a las 10 540 del servidor
    ahead.emit('view', { serverTime: 11_000, phase: null }, 10_530); // 11 030
    assert.deepEqual(probe.latency(), { count: 2, p50: 20, p95: 30, p99: 30, max: 30 });
  });

  test('la latencia se separa por tipo de fase, de la más lenta a la más rápida', () => {
    const probe = createProbe();
    const client = fakeClient();
    probe.watch(client);
    client.emit('view', { serverTime: 1000, phase: { seq: 1, id: 'r1.q1', kind: 'question', startsAt: 0 } }, 1010);
    client.emit('view', { serverTime: 2000, phase: { seq: 2, id: 'r5.mg', kind: 'minigame', minigame: 'arena', startsAt: 0 } }, 2090);
    client.emit('view', { serverTime: 3000, phase: { seq: 2, id: 'r5.mg', kind: 'minigame', minigame: 'arena', startsAt: 0 } }, 3070);
    assert.deepEqual(probe.latencyByPhase().map((row) => [row.key, row.count, row.p95]), [['minijuego arena', 2, 90], ['question', 1, 10]]);
  });

  test('los fotogramas de la Arena se miden aparte, con su hora del servidor (t)', () => {
    const probe = createProbe();
    const client = fakeClient({ offset: 100 });
    probe.watch(client);
    client.emit('frame', { t: 5000 }, 4940); // llega a las 5040 del servidor
    client.emit('frame', { seq: 1 }, 5000); // sin t: no se mide
    assert.deepEqual(probe.frameLatency(), { count: 1, p50: 40, p95: 40, p99: 40, max: 40 });
    assert.equal(probe.latency().count, 0, 'no se mezclan con las vistas');
  });

  test('sin reloj sincronizado o sin serverTime no se mide', () => {
    const probe = createProbe();
    const client = fakeClient();
    client.rtt = null;
    probe.watch(client);
    client.emit('view', { serverTime: 1000, phase: null }, 1010);
    client.rtt = 5;
    client.emit('view', { phase: null }, 1020);
    assert.equal(probe.latency().count, 0);
  });

  test('las fases que empezaron antes de reconectar no cuentan para la diferencia entre pantallas', () => {
    const probe = createProbe();
    const [a, b] = [fakeClient(), fakeClient()];
    probe.watch(a);
    probe.watch(b);
    const phase = (seq, startsAt) => ({ seq, id: `f${seq}`, startsAt });
    a.emit('view', { phase: null }, 100);
    b.emit('view', { phase: null }, 100);
    a.emit('view', { phase: phase(1, 1000) }, 900);
    b.emit('view', { phase: phase(1, 1000) }, 920);
    // b se reconecta a mitad de la fase 2 y recibe la vista tarde: no es un inicio de fase.
    a.emit('view', { phase: phase(2, 2000) }, 1900);
    b.socket = {};
    b.emit('view', { phase: phase(2, 2000) }, 2500);
    assert.deepEqual(probe.phaseIdsOf(b), ['f1', 'f2']);
    const summary = probe.phaseStarts();
    assert.equal(summary.views, 3);
    assert.equal(summary.lateViews, 0);
    assert.equal(summary.spreadMax, 0);
  });
});
