/**
 * Gestor de gráficas científicas interactivas con Plotly.js para RC LAB 3D.
 * Implementa Gráficas A, B, C, D con buffers eficientes y sin fugas de memoria.
 */

class ScienceCharts {
  constructor() {
    this.maxPoints = 400; // Ventana rodante para rendimiento óptimo
    this.timeBuffer = [];
    this.vRealBuffer = [];
    this.vTargetBuffer = [];
    this.vPotBuffer = [];
    this.errorBuffer = [];
    this.currentBuffer = [];

    this.t0 = null;
    this.isPaused = false;
    this.initialized = false;
  }

  init() {
    if (typeof Plotly === "undefined") {
      console.error("Plotly.js no está disponible.");
      return;
    }

    const darkLayoutBase = {
      paper_bgcolor: "transparent",
      plot_bgcolor: "rgba(10, 16, 28, 0.6)",
      font: { color: "#8b9bb4", family: "Consolas, monospace", size: 11 },
      margin: { l: 45, r: 20, t: 30, b: 35 },
      xaxis: {
        gridcolor: "rgba(70, 100, 150, 0.15)",
        zerolinecolor: "rgba(70, 100, 150, 0.3)",
        title: { text: "Tiempo t (s)" }
      },
      yaxis: {
        gridcolor: "rgba(70, 100, 150, 0.15)",
        zerolinecolor: "rgba(70, 100, 150, 0.3)"
      },
      legend: { orientation: "h", y: 1.15, x: 0 }
    };

    // 1. Gráfica Principal / Gráfica A: V_real vs V_objetivo
    const layoutA = JSON.parse(JSON.stringify(darkLayoutBase));
    layoutA.yaxis.title = "Voltaje (V)";
    layoutA.yaxis.range = [-0.2, 5.2];
    
    const tracesA = [
      {
        x: [], y: [],
        mode: "lines",
        name: "Voltaje Real A1",
        line: { color: "#00f0ff", width: 2 }
      },
      {
        x: [], y: [],
        mode: "lines",
        name: "Curva Objetivo (Ref)",
        line: { color: "#ffb703", width: 2, dash: "dot" }
      }
    ];

    if (document.getElementById("chart-live-voltage")) {
      Plotly.newPlot("chart-live-voltage", tracesA, layoutA, { responsive: true, displayModeBar: false });
    }
    if (document.getElementById("chart-sub-a")) {
      Plotly.newPlot("chart-sub-a", tracesA, layoutA, { responsive: true, displayModeBar: false });
    }

    // 2. Gráfica B: Potenciómetro A0 & Curva Objetivo
    const layoutB = JSON.parse(JSON.stringify(darkLayoutBase));
    layoutB.yaxis.title = "Consigna (V)";
    layoutB.yaxis.range = [-0.2, 5.2];
    const tracesB = [
      {
        x: [], y: [],
        mode: "lines",
        name: "Límite Pot A0",
        line: { color: "#9d4edd", width: 2 }
      },
      {
        x: [], y: [],
        mode: "lines",
        name: "Curva Objetivo",
        line: { color: "#ffb703", width: 1.5, dash: "dot" }
      }
    ];
    if (document.getElementById("chart-sub-b")) {
      Plotly.newPlot("chart-sub-b", tracesB, layoutB, { responsive: true, displayModeBar: false });
    }

    // 3. Gráfica C: Error de Seguimiento e(t)
    const layoutC = JSON.parse(JSON.stringify(darkLayoutBase));
    layoutC.yaxis.title = "Error e(t) (V)";
    const tracesC = [
      {
        x: [], y: [],
        mode: "lines",
        name: "e(t) = V_real - V_obj",
        line: { color: "#ef476f", width: 1.5 }
      }
    ];
    if (document.getElementById("chart-sub-c")) {
      Plotly.newPlot("chart-sub-c", tracesC, layoutC, { responsive: true, displayModeBar: false });
    }

    // 4. Gráfica D: Estimación Corriente RC
    const layoutD = JSON.parse(JSON.stringify(darkLayoutBase));
    layoutD.yaxis.title = "Corriente Estimada (mA)";
    const tracesD = [
      {
        x: [], y: [],
        mode: "lines",
        name: "I_estimada (mA) [R=1kΩ hip.]",
        line: { color: "#06d6a0", width: 1.5 }
      }
    ];
    if (document.getElementById("chart-sub-d")) {
      Plotly.newPlot("chart-sub-d", tracesD, layoutD, { responsive: true, displayModeBar: false });
    }

    this.initialized = true;
  }

  addSample(sample) {
    if (!this.initialized || this.isPaused) return;

    if (this.t0 === null) {
      this.t0 = sample.monotonic_time;
    }

    const tRel = sample.monotonic_time - this.t0;
    const vReal = sample.voltaje_real;
    const vTarget = sample.voltaje_objetivo;
    const vPot = sample.limite_pot;
    const eT = sample.error_seguimiento;
    // Estimación teórica simple asumiendo R=1000 ohm, expresada en mA
    const iEst_mA = ((5.0 - vReal) / 1000.0) * 1000.0;

    this.timeBuffer.push(tRel);
    this.vRealBuffer.push(vReal);
    this.vTargetBuffer.push(vTarget);
    this.vPotBuffer.push(vPot);
    this.errorBuffer.push(eT);
    this.currentBuffer.push(iEst_mA);

    // Limitar ventana visible
    if (this.timeBuffer.length > this.maxPoints) {
      this.timeBuffer.shift();
      this.vRealBuffer.shift();
      this.vTargetBuffer.shift();
      this.vPotBuffer.shift();
      this.errorBuffer.shift();
      this.currentBuffer.shift();
    }

    this.renderThrottled();
  }

  renderThrottled() {
    if (this._renderPending) return;
    this._renderPending = true;

    requestAnimationFrame(() => {
      this._renderPending = false;
      this.updateAllPlots();
    });
  }

  updateAllPlots() {
    // Gráfica Principal en Vivo
    if (document.getElementById("chart-live-voltage")) {
      Plotly.update("chart-live-voltage", {
        x: [this.timeBuffer, this.timeBuffer],
        y: [this.vRealBuffer, this.vTargetBuffer]
      });
    }

    // Gráfica A secundaria si está visible
    if (document.getElementById("chart-sub-a") && document.getElementById("tab-charts").classList.contains("active")) {
      Plotly.update("chart-sub-a", {
        x: [this.timeBuffer, this.timeBuffer],
        y: [this.vRealBuffer, this.vTargetBuffer]
      });
      Plotly.update("chart-sub-b", {
        x: [this.timeBuffer, this.timeBuffer],
        y: [this.vPotBuffer, this.vTargetBuffer]
      });
      Plotly.update("chart-sub-c", {
        x: [this.timeBuffer],
        y: [this.errorBuffer]
      });
      Plotly.update("chart-sub-d", {
        x: [this.timeBuffer],
        y: [this.currentBuffer]
      });
    }
  }

  clear() {
    this.t0 = null;
    this.timeBuffer = [];
    this.vRealBuffer = [];
    this.vTargetBuffer = [];
    this.vPotBuffer = [];
    this.errorBuffer = [];
    this.currentBuffer = [];
    this.updateAllPlots();
  }
}

const scienceCharts = new ScienceCharts();
document.addEventListener("DOMContentLoaded", () => {
  scienceCharts.init();
});
