"use strict";

/**
 * Pruebas del panel «Comprueba el cálculo» sin navegador.
 *
 * Se simula un DOM mínimo con `getElementById` y se llama a `RCCalc.update`
 * para comprobar los ocho pasos, los estados pendientes y la comparación
 * teoría/experimento. No se conecta hardware ni se inventan mediciones.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

function makeElement(id) {
  const classes = new Set();
  return {
    id,
    textContent: "",
    innerHTML: "",
    className: "",
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains(name) { return classes.has(name); },
    },
    _classes: classes,
  };
}

function installDom() {
  const nodes = new Map();
  global.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeElement(id));
      return nodes.get(id);
    },
  };
  return nodes;
}

function text(nodes, id) {
  const node = nodes.get(id);
  return node ? node.textContent : null;
}

require("../../frontend/js/calc.js");
const Calc = globalThis.RCCalc;
const Config = require("../../frontend/js/circuit-config.js");

const BASE_TAU = 18.8;
const BASE_QMAX = 0.02;
const qAtTau = BASE_QMAX * (1 - Math.exp(-1));

function chargeData(overrides) {
  return Object.assign({
    r: 4700,
    rCharge: 4700,
    rDischarge: 4700,
    c: 0.004,
    ve: 5,
    v0: 0,
    t: BASE_TAU,
    qC: qAtTau,
    qMaxC: BASE_QMAX,
    q0C: 0,
    qInfC: BASE_QMAX,
    mode: "CARGA",
    tau: BASE_TAU,
    nominal: false,
    synthetic: false,
    measured: null,
    summary: null,
  }, overrides || {});
}

test("los ocho pasos de una carga física completa", () => {
  const nodes = installDom();
  Calc.update("calc-x", chargeData());

  assert.equal(text(nodes, "calc-x-ve"), "5 V");
  assert.equal(text(nodes, "calc-x-t"), "18,8 s");
  assert.equal(text(nodes, "calc-x-r"), "4 700 Ω");
  assert.equal(text(nodes, "calc-x-rd"), "4 700 Ω");
  assert.equal(text(nodes, "calc-x-c"), "0,004 F");
  assert.match(text(nodes, "calc-x-ceq"), /Ceq = 0,004 F/);
  assert.match(text(nodes, "calc-x-req"), /Req = 4 700 Ω/);
  assert.equal(text(nodes, "calc-x-tau"), "τ = Req × Ceq = 4 700 Ω × 0,004 F = 18,8 s");
  assert.match(text(nodes, "calc-x-qmax"), /Qmax = Ceq × Ve = 0,004 F × 5 V = 0,02 C = 20,00 mC/);
  assert.match(nodes.get("calc-x-formula").innerHTML, /1 − e<sup>−t\/τ<\/sup>/);
  assert.match(text(nodes, "calc-x-subst"), /q\(18,8 s\) = 0,02 C × \(1 − e\^\(−18,8 s \/ 18,8 s\)\)/);
  assert.equal(text(nodes, "calc-x-result"), "0,01264 C");
  assert.equal(text(nodes, "calc-x-result-mc"), "12,64 mC");
  assert.match(text(nodes, "calc-x-result-step"), /q\(18,8 s\) = 0,01264 C = 12,64 mC/);
  assert.match(text(nodes, "calc-x-pct"), /63,2 % de Qmax/);
  assert.equal(nodes.get("calc-x-warning")._classes.has("hidden"), true);
  assert.equal(nodes.get("calc-x-compare")._classes.has("is-physical"), false);
});

test("sin resistencia de descarga todo queda pendiente y no se inventa τ", () => {
  const nodes = installDom();
  Calc.update("calc-p", chargeData({
    mode: "DESCARGA",
    r: null,
    rDischarge: null,
    tau: null,
    q0C: BASE_QMAX,
    qInfC: 0,
    qC: 0.01,
    v0: 5,
  }));

  assert.equal(nodes.get("calc-p-warning")._classes.has("hidden"), false);
  assert.match(text(nodes, "calc-p-warning"), /Dato pendiente de configurar: Req de descarga/);
  assert.match(text(nodes, "calc-p-rd-note"), /Dato pendiente/);
  assert.match(text(nodes, "calc-p-tau"), /Dato pendiente de configurar/);
  assert.match(text(nodes, "calc-p-subst"), /Dato pendiente de configurar/);
  assert.equal(text(nodes, "calc-p-result"), "—");
  assert.equal(text(nodes, "calc-p-result-mc"), "—");
  assert.equal(text(nodes, "calc-p-result-step"), "Dato pendiente de configurar.");
});

test("la descarga parte de Q₀ y usa la ecuación exponencial decreciente", () => {
  const nodes = installDom();
  const q = BASE_QMAX * Math.exp(-1);
  Calc.update("calc-d", chargeData({
    mode: "DESCARGA",
    v0: 5,
    q0C: BASE_QMAX,
    qInfC: 0,
    qC: q,
  }));

  assert.match(nodes.get("calc-d-formula").innerHTML, /q\(t\) = Q₀ · e<sup>−t\/τ<\/sup>/);
  assert.match(text(nodes, "calc-d-qmax"), /Q₀ = Ceq × V₀ = 0,004 F × 5 V = 0,02 C = 20,00 mC/);
  assert.match(text(nodes, "calc-d-subst"), /0,02 C × e\^\(−18,8 s \/ 18,8 s\)/);
  assert.equal(text(nodes, "calc-d-result-mc"), "7,36 mC");
  assert.match(text(nodes, "calc-d-pct"), /36,8 % de la carga inicial/);
});

test("al cambiar el instante cambian la sustitución y el resultado", () => {
  const nodes = installDom();
  Calc.update("calc-t", chargeData({ t: 0, qC: 0 }));
  const firstSubst = text(nodes, "calc-t-subst");
  const firstMc = text(nodes, "calc-t-result-mc");

  Calc.update("calc-t", chargeData({ t: BASE_TAU, qC: qAtTau }));
  assert.notEqual(text(nodes, "calc-t-subst"), firstSubst);
  assert.notEqual(text(nodes, "calc-t-result-mc"), firstMc);
  assert.equal(firstMc, "0,00 mC");
  assert.equal(text(nodes, "calc-t-result-mc"), "12,64 mC");
});

test("una carga con voltaje inicial distinto de cero usa la ecuación general", () => {
  const nodes = installDom();
  const q0 = 0.004; // 1 V
  const tau = BASE_TAU;
  const qInf = BASE_QMAX;
  const q = qInf + (q0 - qInf) * Math.exp(-1);
  Calc.update("calc-g", chargeData({
    v0: 1,
    q0C: q0,
    qInfC: qInf,
    qC: q,
  }));

  assert.match(nodes.get("calc-g-formula").innerHTML, /Q∞ \+ \(Q₀ − Q∞\) · e<sup>−t\/τ<\/sup>/);
  assert.match(text(nodes, "calc-g-subst"), /0,02 C \+ \(0,004 C − 0,02 C\)/);
  assert.match(text(nodes, "calc-g-pct"), /condición inicial distinta de cero/);
});

test("la comparación física muestra teoría, experimento y diferencia", () => {
  const nodes = installDom();
  Calc.update("calc-c", chargeData({
    measured: { voltage: 3.2, qC: 0.0128, time: 18.8 },
  }));

  assert.equal(text(nodes, "calc-c-theory"), "12,64 mC");
  assert.equal(text(nodes, "calc-c-exp"), "12,80 mC");
  assert.match(text(nodes, "calc-c-diff"), /^\+0,16 mC$/);
  assert.match(text(nodes, "calc-c-compare"), /Medición del Arduino: q_exp = Ceq × Vc = 0,004 F × 3,2 V = 12,80 mC/);
  assert.match(text(nodes, "calc-c-compare"), /tolerancias/);
  assert.equal(nodes.get("calc-c-compare")._classes.has("is-physical"), true);
});

test("los datos sintéticos se marcan y no se presentan como medición", () => {
  const nodes = installDom();
  Calc.update("calc-s", chargeData({
    synthetic: true,
    measured: { voltage: 3, qC: 0.012, time: 10 },
  }));

  assert.match(text(nodes, "calc-s-compare"), /Datos sintéticos de simulación/);
  assert.match(text(nodes, "calc-s-compare"), /no son mediciones del Arduino/);
  assert.equal(nodes.get("calc-s-compare")._classes.has("is-physical"), false);

  Calc.update("calc-s", chargeData({ synthetic: true, measured: null }));
  assert.equal(text(nodes, "calc-s-exp"), "— (sintético)");
  assert.match(text(nodes, "calc-s-compare"), /SIMULACIÓN — DATOS SINTÉTICOS/);
});

test("con el resumen declarado se muestran las fórmulas serie/paralelo", () => {
  const nodes = installDom();
  const summary = Config.summarize(Config.defaultState());
  Calc.update("calc-r", chargeData({ summary }));

  assert.match(text(nodes, "calc-r-ceq"), /Ceq = C1 \+ C2 \+ C3 \+ C4 = 1 000 \+ 1 000 \+ 1 000 \+ 1 000 µF/);
  assert.match(text(nodes, "calc-r-req"), /Req = R1 = 4 700/);
  assert.match(text(nodes, "calc-r-components"), /4 700 Ω \(carga y descarga\)/);
  assert.match(text(nodes, "calc-r-c-note"), /calculada desde los componentes/);
});

test("sin condensadores el paso 2 avisa del dato pendiente", () => {
  const nodes = installDom();
  Calc.update("calc-n", chargeData({
    c: null,
    tau: null,
    qC: 0,
    qMaxC: null,
    q0C: null,
    qInfC: null,
  }));
  assert.match(text(nodes, "calc-n-warning"), /Ceq/);
  assert.match(text(nodes, "calc-n-ceq"), /Dato pendiente de configurar/);
  assert.equal(text(nodes, "calc-n-result"), "—");
});
