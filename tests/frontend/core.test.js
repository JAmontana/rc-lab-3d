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

test("Qmax = C · Ve y tabla de referencia del profesor", () => {
  // C = 0,004 F · Ve = 5 V → Qmax = 0,020 C = 20 mC
  approx(Core.qMaxC(0.004, 5), 0.02, 1e-15);

  // Con τ = 1 s, la tabla de comprobación (en mC) debe coincidir.
  const table = [
    [0, 0],
    [0.5, 7.87],
    [1, 12.64],
    [2, 17.29],
    [3, 19.0],
    [5, 19.87],
  ];
  table.forEach(([t, expectedMc]) => {
    const qMc = Core.chargeAtTimeC(t, 0.02, 1) * 1000;
    assert.ok(Math.abs(qMc - expectedMc) <= 0.005, `t=${t} s: ${qMc} mC ≠ ${expectedMc} mC`);
  });

  // En 1τ se alcanza 1 − e^−1 = 63,2 % de Qmax.
  approx(Core.chargeAtTimeC(1, 0.02, 1) / 0.02, Core.TAU_CHARGE_FACTOR, 1e-12);
  // τ = R · C en los valores nominales del montaje.
  approx(Core.tauOf(4700, 0.004), 18.8, 1e-12);
});

test("despejes de t y tau desde puntos de carga respetan el dominio", () => {
  const qMax = 0.02;
  // Con τ = 1 s, t = 1 s → q = 12,64 mC y el despeje debe devolver 1 s.
  const q1 = Core.chargeAtTimeC(1, qMax, 1);
  approx(Core.timeForChargeC(1, q1, qMax), 1, 1e-9);
  approx(Core.tauFromPointChargeC(1, q1, qMax), 1, 1e-9);

  // Punto intermedio: t = 0,5 s → q = 7,87 mC → tau ≈ 1 s.
  const q05 = Core.chargeAtTimeC(0.5, qMax, 1);
  approx(Core.tauFromPointChargeC(0.5, q05, qMax), 1, 1e-9);
  approx(Core.timeForChargeC(1, q05, qMax), 0.5, 1e-9);

  // Dominio inválido: t = 0, q = 0, q = Qmax o datos no finitos.
  assert.equal(Core.tauFromPointChargeC(0, q05, qMax), null);
  assert.equal(Core.tauFromPointChargeC(1, 0, qMax), null);
  assert.equal(Core.tauFromPointChargeC(1, qMax, qMax), null);
  assert.equal(Core.tauFromPointChargeC(1, -0.001, qMax), null);
  assert.equal(Core.timeForChargeC(1, 0, qMax), null);
  assert.equal(Core.timeForChargeC(1, qMax, qMax), null);
  assert.equal(Core.timeForChargeC(0, q05, qMax), null);
  assert.equal(Core.tauFromPointChargeC(1, NaN, qMax), null);

  // Con carga inicial distinta de cero se usa la variación Δq.
  const q0 = 0.01;
  const qMid = Core.chargeAtTimeGeneralC(1, q0, qMax, 1);
  approx(Core.tauFromPointChargeC(1, qMid, qMax, q0), 1, 1e-9);
  approx(Core.timeForChargeC(1, qMid, qMax, q0), 1, 1e-9);
  assert.equal(Core.tauFromPointChargeC(1, q0, qMax, q0), null);
});

test("despejes de descarga usan la variación y rechazan el dominio inválido", () => {
  const q0 = 0.02;
  const q1 = Core.chargeAtTimeGeneralC(2, q0, 0, 2);
  approx(Core.tauFromPointDecayC(2, q1, q0, 0), 2, 1e-9);
  approx(Core.timeForDecayC(2, q1, q0, 0), 2, 1e-9);
  assert.equal(Core.tauFromPointDecayC(0, q1, q0, 0), null);
  assert.equal(Core.tauFromPointDecayC(2, q0, q0, 0), null);
  assert.equal(Core.tauFromPointDecayC(2, 0, q0, 0), null);
  assert.equal(Core.timeForDecayC(2, 0, q0, 0), null);
});

test("descarga exponencial conserva el 36,8 % después de un τ", () => {
  const q0 = 0.02;
  approx(Core.chargeAtTimeGeneralC(0, q0, 0, 2), q0, 1e-15);
  approx(Core.chargeAtTimeGeneralC(2, q0, 0, 2), q0 * Core.TAU_DISCHARGE_FACTOR, 1e-15);
  approx(Core.chargeAtTimeGeneralC(1000, q0, 0, 2), 0, 1e-9);
  // Nivel final distinto de cero: equilibrio q∞.
  approx(Core.chargeAtTimeGeneralC(1000, q0, 0.005, 2), 0.005, 1e-9);
});

test("carga individual qi = Ci · Vc y suma igual a la carga total", () => {
  const caps = [0.001, 0.001, 0.001, 0.002]; // banco NO necesariamente igual
  const v = 3.2;
  const parts = Core.capacitorChargesC(caps, v);
  approx(parts.reduce((sum, q) => sum + q, 0), 0.005 * v, 1e-15);
  approx(parts[0], 0.001 * v, 1e-15);
  approx(parts[3], 0.002 * v, 1e-15);
  approx(Core.chargeFraction(0.01, 0.02), 0.5, 1e-15);
  approx(Core.chargeFraction(0.03, 0.02), 1, 1e-15);
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

test("resistencias equivalentes en serie suman y en paralelo usan inversos", () => {
  approx(Core.seriesResistance([1000, 2200, 4700]), 7900);
  approx(Core.parallelResistance([1000, 2200, 4700]), 1 / (1 / 1000 + 1 / 2200 + 1 / 4700), 1e-9);
  // Dos resistencias iguales en paralelo dan la mitad.
  approx(Core.parallelResistance([4700, 4700]), 2350);
  approx(Core.equivalentResistance([100, 100], "serie"), 200);
  approx(Core.equivalentResistance([100, 100], "paralelo"), 50);
  // Un único componente devuelve su propio valor en ambas topologías.
  approx(Core.equivalentResistance([4700], "serie"), 4700);
  approx(Core.equivalentResistance([4700], "paralelo"), 4700);
});

test("capacitancias equivalentes: paralelo suma y serie usa inversos", () => {
  const uf = (value) => value * 1e-6;
  const fourInParallel = [uf(1000), uf(1000), uf(1000), uf(1000)];
  approx(Core.parallelCapacitance(fourInParallel), 0.004, 1e-15);
  approx(Core.equivalentCapacitance(fourInParallel, "paralelo"), 0.004, 1e-15);
  // Dos condensadores iguales en serie dan la mitad.
  approx(Core.seriesCapacitance([uf(1000), uf(1000)]), uf(500), 1e-15);
  approx(Core.equivalentCapacitance([uf(1000), uf(1000)], "serie"), uf(500), 1e-15);
  approx(Core.seriesCapacitance([uf(100), uf(220)]), 1 / (1 / uf(100) + 1 / uf(220)), 1e-15);
});

test("las equivalencias rechazan listas vacías, ceros y valores no numéricos", () => {
  for (const bad of [[], [0], [-100], [100, null], ["x"], undefined, null]) {
    assert.equal(Core.seriesResistance(bad), null);
    assert.equal(Core.parallelResistance(bad), null);
    assert.equal(Core.seriesCapacitance(bad), null);
    assert.equal(Core.parallelCapacitance(bad), null);
    assert.equal(Core.equivalentResistance(bad, "serie"), null);
    assert.equal(Core.equivalentCapacitance(bad, "paralelo"), null);
  }
});

test("τ y Qmax de la configuración base: 4700 Ω × 0,004 F = 18,8 s", () => {
  const ceq = Core.parallelCapacitance([1e-3, 1e-3, 1e-3, 1e-3]);
  const tau = Core.tauOf(4700, ceq);
  approx(ceq, 0.004, 1e-15);
  approx(tau, 18.8, 1e-12);
  // En un τ la carga es el 63,2 % de Qmax.
  approx(Core.chargeAtTimeC(tau, Core.qMaxC(ceq, 5), tau), Core.qMaxC(ceq, 5) * Core.TAU_CHARGE_FACTOR, 1e-15);
  approx(Core.qMaxC(ceq, 5), 0.02, 1e-15);
});

test("isPhysicalSample separa el Arduino del emulador", () => {
  assert.equal(Core.isPhysicalSample({ origen: "SERIAL" }), true);
  assert.equal(Core.isPhysicalSample({ origen: "" }), true);
  assert.equal(Core.isPhysicalSample({}), true);
  assert.equal(Core.isPhysicalSample({ origen: "SIMULACION" }), false);
  assert.equal(Core.isPhysicalSample({ origen: "simulacion" }), false);
  assert.equal(Core.isPhysicalSample(null), false);
});
