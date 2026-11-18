"use strict";

/**
 * Pruebas de la configuración declarada del circuito.
 *    node --test tests/frontend
 *
 * `summarize()` es una función pura: no toca el DOM. Se comprueban las
 * fórmulas serie/paralelo, la separación de resistencias de carga y descarga,
 * las medidas opcionales y los estados «dato pendiente».
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Config = require("../../frontend/js/circuit-config.js");

const approx = (actual, expected, tolerance = 1e-12) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${expected} ± ${tolerance}, recibido ${actual}`
  );
};

function stateWith(overrides) {
  return Object.assign(Config.defaultState(), overrides || {});
}

test("la configuración base es 4 × 1000 µF en paralelo y 4700 Ω ilustrativa", () => {
  const state = Config.defaultState();
  assert.equal(state.capacitorTopology, "paralelo");
  assert.equal(state.resistorTopology, "serie");
  assert.equal(state.capacitors.length, 4);
  state.capacitors.forEach((item) => {
    assert.equal(item.uf, 1000);
    assert.equal(item.origin, "nominal");
  });
  assert.equal(state.resistors.length, 1);
  assert.equal(state.resistors[0].ohm, 4700);
  assert.equal(state.resistors[0].role, "ambas");
  assert.equal(state.resistors[0].origin, "ilustrativo");
});

test("el resumen por defecto calcula Ceq, Req, τ y Qmax", () => {
  const summary = Config.summarize(Config.defaultState());
  approx(summary.ceq, 0.004, 1e-15);
  approx(summary.reqCarga, 4700);
  approx(summary.reqDescarga, 4700);
  approx(summary.tauCarga, 18.8, 1e-12);
  approx(summary.tauDescarga, 18.8, 1e-12);
  approx(summary.qMaxC, 0.02, 1e-15);
  assert.equal(summary.ve, 5);
  assert.equal(summary.hasPending, false);
  assert.equal(summary.ceqSource, "calculado");
  assert.equal(summary.reqCargaSource, "calculado");
  assert.deepEqual(summary.capacitancePartsF, [0.001, 0.001, 0.001, 0.001]);
  assert.match(summary.ceqFormula, /Ceq = C1 \+ C2 \+ C3 \+ C4/);
  assert.match(summary.reqCargaFormula, /Req = R1/);
});

test("capacitores en paralelo suman y en serie usan inversos", () => {
  const parallel = Config.summarize(stateWith({
    capacitors: [
      { id: "a", uf: 1000, origin: "nominal" },
      { id: "b", uf: 2200, origin: "nominal" },
    ],
    capacitorTopology: "paralelo",
  }));
  approx(parallel.ceq, 0.0032, 1e-15);

  const series = Config.summarize(stateWith({
    capacitors: [
      { id: "a", uf: 1000, origin: "nominal" },
      { id: "b", uf: 1000, origin: "nominal" },
    ],
    capacitorTopology: "serie",
  }));
  approx(series.ceq, 0.0005, 1e-15);
});

test("resistencias en serie y paralelo cambian Req", () => {
  const serie = Config.summarize(stateWith({
    resistors: [
      { id: "a", ohm: 1000, role: "ambas", origin: "declarado" },
      { id: "b", ohm: 2200, role: "ambas", origin: "declarado" },
    ],
    resistorTopology: "serie",
  }));
  approx(serie.reqCarga, 3200);
  approx(serie.reqDescarga, 3200);
  approx(serie.tauCarga, 3200 * 0.004, 1e-12);

  const paralelo = Config.summarize(stateWith({
    resistors: [
      { id: "a", ohm: 1000, role: "ambas", origin: "declarado" },
      { id: "b", ohm: 2200, role: "ambas", origin: "declarado" },
    ],
    resistorTopology: "paralelo",
  }));
  approx(paralelo.reqCarga, 1 / (1 / 1000 + 1 / 2200), 1e-9);
  approx(paralelo.reqDescarga, 1 / (1 / 1000 + 1 / 2200), 1e-9);
});

test("carga y descarga usan resistencias distintas según su rol", () => {
  const summary = Config.summarize(stateWith({
    resistors: [
      { id: "rc", ohm: 4700, role: "carga", origin: "declarado" },
      { id: "rd", ohm: 1000, role: "descarga", origin: "declarado" },
    ],
    resistorTopology: "serie",
  }));
  approx(summary.reqCarga, 4700);
  approx(summary.reqDescarga, 1000);
  approx(summary.tauCarga, 18.8, 1e-12);
  approx(summary.tauDescarga, 4, 1e-12);
  assert.match(summary.reqCargaFormula, /Req = R1 = 4 700/);
  assert.match(summary.reqDescargaFormula, /Req = R1 = 1 000/);
});

test("un proceso sin resistencia propia queda pendiente", () => {
  const summary = Config.summarize(stateWith({
    resistors: [{ id: "rc", ohm: 4700, role: "carga", origin: "declarado" }],
  }));
  assert.equal(summary.reqCarga, 4700);
  assert.equal(summary.reqDescarga, null);
  assert.equal(summary.pending.reqDescarga, true);
  assert.equal(summary.hasPending, true);
  assert.equal(summary.tauDescarga, null);
  assert.match(summary.reqDescargaFormula, /dato pendiente de configurar/);
});

test("las medidas opcionales reemplazan el cálculo y se marcan como medidas", () => {
  const summary = Config.summarize(stateWith({
    measuredCeqUf: 3800,
    measuredReqChargeOhm: 5000,
    measuredReqDischargeOhm: 3900,
  }));
  approx(summary.ceq, 0.0038, 1e-15);
  approx(summary.reqCarga, 5000);
  approx(summary.reqDescarga, 3900);
  assert.equal(summary.ceqSource, "medido");
  assert.equal(summary.reqCargaSource, "medido");
  assert.equal(summary.reqDescargaSource, "medido");
  assert.match(summary.ceqFormula, /Ceq \(medida\) = 0,0038 F/);
  assert.match(summary.reqCargaFormula, /Req \(medida\) = 5 000 Ω/);
  approx(summary.tauCarga, 5000 * 0.0038, 1e-12);
});

test("sin condensadores ni resistencias el resumen no inventa valores", () => {
  const summary = Config.summarize({
    version: 1,
    capacitorTopology: "paralelo",
    resistorTopology: "serie",
    supplyVoltage: 5,
    resistors: [{ id: "r", ohm: null, role: "ambas", origin: "declarado" }],
    capacitors: [{ id: "c", uf: null, origin: "declarado" }],
  });
  assert.equal(summary.ceq, null);
  assert.equal(summary.reqCarga, null);
  assert.equal(summary.reqDescarga, null);
  assert.equal(summary.tauCarga, null);
  assert.equal(summary.qMaxC, 0);
  assert.deepEqual(summary.pending, {
    ceq: true,
    reqCarga: true,
    reqDescarga: true,
    ve: false,
  });
  assert.equal(summary.hasPending, true);
  assert.match(summary.ceqFormula, /dato pendiente de configurar/);
});

test("sin voltaje de alimentación Qmax queda pendiente", () => {
  const summary = Config.summarize(stateWith({ supplyVoltage: null }));
  assert.equal(summary.ve, null);
  assert.equal(summary.qMaxC, 0);
  assert.equal(summary.pending.ve, true);
  assert.equal(summary.hasPending, true);
});

test("normalizeState tolera datos corruptos y conserva al menos un componente", () => {
  const state = Config.normalizeState({
    resistorTopology: "zzz",
    capacitorTopology: "serie",
    resistors: [],
    capacitors: [],
  });
  assert.equal(state.resistorTopology, "serie");
  assert.equal(state.capacitorTopology, "serie");
  assert.equal(state.resistors.length, 1);
  assert.equal(state.capacitors.length, 1);
  assert.equal(state.resistors[0].ohm, null);
  assert.equal(state.capacitors[0].uf, null);

  const fallback = Config.normalizeState(null);
  assert.deepEqual(fallback, Config.defaultState());
});

test("componentes en más de cuatro no fuerzan reparto 3D y siguen sumando", () => {
  const summary = Config.summarize(stateWith({
    capacitors: [
      { id: "a", uf: 1000 },
      { id: "b", uf: 1000 },
      { id: "c", uf: 1000 },
      { id: "d", uf: 1000 },
      { id: "e", uf: 1000 },
    ],
  }));
  approx(summary.ceq, 0.005, 1e-15);
  assert.equal(summary.capacitancePartsF, null);
});

test("los textos de componentes describen roles y topología", () => {
  const summary = Config.summarize(stateWith({
    resistors: [
      { id: "rc", ohm: 4700, role: "carga", origin: "declarado" },
      { id: "rd", ohm: 1000, role: "descarga", origin: "declarado" },
    ],
    capacitors: [
      { id: "a", uf: 1000 },
      { id: "b", uf: 1000 },
    ],
  }));
  assert.match(summary.componentsText, /4 700 Ω \(carga\)/);
  assert.match(summary.componentsText, /1 000 Ω \(descarga\)/);
  assert.match(summary.componentsText, /1 000 \+ 1 000 µF en paralelo/);
});
