"use strict";

/**
 * Pruebas del núcleo matemático del frontend con el runner nativo de Node.
 *   node --test tests/frontend
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../../frontend/js/core.js");

const approx = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected} ± ${tolerance}, recibido ${actual}`
  );
};

test("constantes características de la exponencial RC", () => {
  approx(Core.TAU_CHARGE_FACTOR, 1 - Math.exp(-1), 1e-12);
  approx(Core.TAU_CHARGE_FACTOR * 100, 63.21205588285577, 1e-9);
  approx(Core.TAU_DISCHARGE_FACTOR, Math.exp(-1), 1e-12);
  approx(Core.TAU_DISCHARGE_FACTOR * 100, 36.787944117144235, 1e-9);
});

test("carga y descarga respetan V0 y la asíntota", () => {
  approx(Core.chargeAt(0, 0, 4, 2), 0);
  approx(Core.chargeAt(2, 0, 4, 2), 4 * (1 - Math.exp(-1)), 1e-12);
  approx(Core.chargeAt(1000, 0, 4, 2), 4, 1e-9);
  approx(Core.dischargeAt(0, 4, 0, 2), 4);
  approx(Core.dischargeAt(2, 4, 0, 2), 4 * Math.exp(-1), 1e-12);
  approx(Core.dischargeAt(1000, 4, 0, 2), 0, 1e-9);
});

test("tau inválido mantiene el voltaje inicial", () => {
  approx(Core.chargeAt(5, 1.2, 4, 0), 1.2);
  approx(Core.dischargeAt(5, 1.2, 0, -3), 1.2);
});

test("punto característico de carga y descarga", () => {
  const charge = Core.characteristicPoint("CARGA", 0, 4);
  approx(charge.voltage_v, 4 * Core.TAU_CHARGE_FACTOR, 1e-12);
  approx(charge.percent, 63.21205588285577, 1e-9);
  const discharge = Core.characteristicPoint("DESCARGA", 4, 0);
  approx(discharge.voltage_v, 4 * Core.TAU_DISCHARGE_FACTOR, 1e-12);
  approx(discharge.percent, 36.787944117144235, 1e-9);
});

test("energía y carga usan las ecuaciones correctas", () => {
  approx(Core.energyJ(0.004, 10), 0.2, 1e-12); // ½ · 0.004 · 100
  approx(Core.chargeC(0.004, 10), 0.04, 1e-12);
});

test("unwrapMillis convierte a segundos relativos", () => {
  const result = Core.unwrapMillis([1000, 1100, 1200]);
  assert.deepEqual(result.times.map((t) => Math.round(t * 1000)), [0, 100, 200]);
  assert.equal(result.resetAt, -1);
});

test("unwrapMillis maneja el desbordamiento uint32", () => {
  const result = Core.unwrapMillis([4294967295, 5, 105]);
  approx(result.times[0], 0);
  approx(result.times[1], 0.006, 1e-9);
  approx(result.times[2], 0.106, 1e-9);
  assert.equal(result.resetAt, -1);
});

test("unwrapMillis marca un reinicio del dispositivo", () => {
  const result = Core.unwrapMillis([1000, 1500, 100, 200]);
  assert.equal(result.resetAt, 2);
  approx(result.times[2], result.times[1]);
});

test("interpolateCrossing interpola una subida", () => {
  const times = Array.from({ length: 10 }, (_, i) => i);
  const values = Array.from({ length: 10 }, (_, i) => i);
  const crossing = Core.interpolateCrossing(times, values, 4.5, 2);
  assert.ok(crossing);
  approx(crossing.time_s, 4.5, 1e-9);
  approx(crossing.fraction, 0.5, 1e-9);
  assert.equal(crossing.direction, "subida");
});

test("interpolateCrossing interpola una bajada", () => {
  const times = Array.from({ length: 10 }, (_, i) => i);
  const values = Array.from({ length: 10 }, (_, i) => 5 - i * (10 / 9));
  const crossing = Core.interpolateCrossing(times, values, 2.5, 2);
  assert.ok(crossing);
  assert.ok(crossing.time_s > 2 && crossing.time_s < 3);
  assert.equal(crossing.direction, "bajada");
});

test("interpolateCrossing no inventa un cruce inexistente", () => {
  const times = Array.from({ length: 10 }, (_, i) => i);
  const values = times.map(() => 1.0);
  assert.equal(Core.interpolateCrossing(times, values, 4.0, 2), null);
});

test("interpolateCrossing exige datos suficientes", () => {
  assert.equal(Core.interpolateCrossing([0, 1], [0, 1], 0.5, 2), null);
  assert.equal(Core.interpolateCrossing([], [], 0.5, 2), null);
});

test("estimateAsymptote recupera una exponencial sintética", () => {
  const values = Array.from({ length: 40 }, (_, i) => 4 * (1 - Math.exp(-i / 10)));
  const estimate = Core.estimateAsymptote(values, "CARGA", 0);
  approx(estimate, 4, 0.02);
});

test("TauTracker detecta tau de carga y lo confirma con la cola", () => {
  const tracker = new Core.TauTracker({ capacitanceF: 0.004 });
  let event = null;
  for (let i = 0; i <= 40; i += 1) {
    const t = i * 0.1;
    const sample = {
      voltaje_tanque: 4 * (1 - Math.exp(-t / 2)),
      voltaje_techo: 4,
      estado: "C",
      device_time_ms: Math.round(t * 1000),
    };
    const emitted = tracker.push(sample);
    if (emitted && !event) event = emitted;
  }
  assert.ok(event, "debe emitir un evento tau durante la carga");
  assert.equal(event.mode, "CARGA");
  assert.ok(event.time_s > 1.9 && event.time_s < 2.2, `tau=${event.time_s}`);
  approx(event.percent, 63.21205588285577, 1e-6);
  assert.equal(event.provisional, true);

  // La cola estable confirma el nivel final medido.
  for (let i = 41; i <= 46; i += 1) {
    tracker.push({
      voltaje_tanque: 4,
      voltaje_techo: 4,
      estado: "S",
      device_time_ms: i * 100,
    });
  }
  approx(event.vf_v, 4, 1e-6);
  assert.equal(event.confirmed, true);
  assert.equal(event.provisional, false);
  assert.equal(tracker.segments.length, 1);
});

test("TauTracker detecta tau de descarga", () => {
  const tracker = new Core.TauTracker();
  const events = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = i * 0.1;
    const emitted = tracker.push({
      voltaje_tanque: 4 * Math.exp(-t / 2),
      voltaje_techo: 4,
      estado: "D",
      device_time_ms: Math.round(t * 1000),
    });
    if (emitted) events.push(emitted);
  }
  assert.ok(events.length >= 1);
  const event = events[0];
  assert.equal(event.mode, "DESCARGA");
  assert.ok(event.time_s > 1.9 && event.time_s < 2.2, `tau=${event.time_s}`);
  approx(event.percent, 36.787944117144235, 1e-6);
});

test("TauTracker no dispara con una señal estable", () => {
  const tracker = new Core.TauTracker();
  for (let i = 0; i <= 40; i += 1) {
    assert.equal(
      tracker.push({
        voltaje_tanque: 2.0,
        voltaje_techo: 4,
        estado: "S",
        device_time_ms: i * 100,
      }),
      null
    );
  }
  assert.equal(tracker.events.length, 0);
});

test("TauTracker tolera saltos de millis sin inventar tiempos", () => {
  const tracker = new Core.TauTracker();
  tracker.push({ voltaje_tanque: 0.1, voltaje_techo: 4, estado: "C", device_time_ms: 10000 });
  const second = tracker.push({
    voltaje_tanque: 0.2,
    voltaje_techo: 4,
    estado: "C",
    device_time_ms: 10100,
  });
  assert.equal(second, null);
  const reset = tracker.push({
    voltaje_tanque: 0.3,
    voltaje_techo: 4,
    estado: "C",
    device_time_ms: 50,
  });
  assert.equal(reset, null);
  assert.equal(tracker.segment.length, 1);
});
