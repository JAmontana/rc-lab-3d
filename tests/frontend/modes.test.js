"use strict";

/**
 * Comprobaciones estáticas de separación entre modos.
 *
 * No sustituyen una prueba en navegador: fijan las invariantes que no deben
 * romperse al editar el frontend.
 *   - El Modo prueba (origen SIMULACION) nunca se trata como medición física.
 *   - La simulación/práctica no depende de serial ni de WebSocket.
 *   - Cambiar el circuito propaga los valores a gráfica, escena 3D y cálculo.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("app.js detecta el origen SIMULACION y lo pasa al panel de cálculo", () => {
  const app = read("frontend/js/app.js");
  assert.match(app, /String\(current\.origen \|\| ""\)\.toUpperCase\(\) === "SIMULACION"/);
  assert.match(app, /const physical = !model\.nominal && samples\.length > 0 && !synthetic;/);
  assert.match(app, /source: synthetic\s*\?\s*"MODO PRUEBA · SIMULACIÓN"/);
  assert.match(app, /let measured = null;\s*if \(physical\)/);
  assert.match(app, /synthetic,/);
});

test("charts.js marca la curva del Modo prueba como sintética", () => {
  const charts = read("frontend/js/charts.js");
  assert.match(charts, /const synthetic = String\(last\.origen \|\| ""\)\.toUpperCase\(\) === "SIMULACION";/);
  assert.match(charts, /synthetic,\s*tauPending,/);
  assert.match(charts, /MODO PRUEBA · DATOS SINTÉTICOS/);
  assert.match(charts, /fuente.*SIMULACIÓN|source: synthetic \? "SIMULACIÓN" : "MEDICIÓN"/s);
});

test("la simulación no depende del Arduino, del serial ni del WebSocket", () => {
  const simulator = read("frontend/js/simulator.js");
  assert.doesNotMatch(simulator, /navigator\.serial/);
  assert.doesNotMatch(simulator, /WebSocket/);
  assert.doesNotMatch(simulator, /connectSerial/);
  assert.doesNotMatch(simulator, /API\.(startSerial|connectSerial|openSerial)/);
  // Se alimenta del endpoint teórico /api/simulate.
  assert.match(simulator, /API\.simulate\(/);
  assert.match(simulator, /source: "SIMULACIÓN — DATOS SINTÉTICOS"/);
});

test("el panel de configuración propaga los cambios a gráfica, escena y cálculo", () => {
  const app = read("frontend/js/app.js");
  assert.match(app, /applyCircuitSummary\(summary\)/);
  assert.match(app, /this\.charts\.setLiveParams\(/);
  assert.match(app, /this\.scene\.setCapacitance\(this\.liveRef\.c, this\.capacitanceParts\(this\.liveRef\.c\)\)/);
  assert.match(app, /this\.simulator\.setCapacitanceParts\(summary\.capacitancePartsF\)/);
  assert.match(app, /if \(this\._latestSample\) this\.renderLiveCharge\(this\._latestSample\)/);
  const config = read("frontend/js/circuit-config.js");
  assert.match(config, /if \(this\.onChange\) this\.onChange\(this\.summary\(\)\)/);
});

test("«Comprueba el cálculo» conserva los ocho pasos y el resultado en C y mC", () => {
  const html = read("frontend/index.html");
  const calc = read("frontend/js/calc.js");
  assert.match(html, /Comprueba el cálculo/);
  assert.match(html, /Datos del circuito y sus unidades/);
  assert.match(html, /Cálculo de C<sub>eq<\/sub>/);
  assert.match(html, /Cálculo de R<sub>eq<\/sub>/);
  assert.match(html, /τ = R<sub>eq<\/sub> × C<sub>eq<\/sub>/);
  assert.match(html, /Q<sub>max<\/sub> = C<sub>eq<\/sub> × V<sub>e<\/sub>/);
  assert.match(html, /Sustitución numérica completa/);
  assert.match(html, /Resultado final en culombios y milicoulombios/);
  assert.match(html, /calc-live-result-mc/);
  assert.match(html, /calc-sim-result-mc/);
  assert.match(calc, /Dato pendiente de configurar/);
});

test("la vista de configuración y el flujo del estudiante están enlazados", () => {
  const html = read("frontend/index.html");
  assert.match(html, /id="view-config"/);
  assert.match(html, /Configurar circuito/);
  assert.match(html, /js-config/);
  assert.match(html, /1 · CONFIGURAR CIRCUITO/);
  assert.match(html, /2 · ENTRAR AL LABORATORIO/);
  assert.match(html, /Observar carga y descarga/);
  assert.match(html, /Comprobar cálculo/);
  assert.match(html, /<script src="js\/circuit-config\.js" defer><\/script>/);
});
