/**
 * RC LAB 3D — Gráficas científicas con Plotly.
 *
 * La gráfica en vivo es una ventana de observación. El análisis científico
 * usa todos los datos del intervalo elegido y permite zoom, desplazamiento y
 * restablecimiento de la vista.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore;
  const FMT = global.FMT;

  const COLORS = {
    measured: "#258bc7",
    theoretical: "#36a878",
    threshold: "#e6b83f",
    tau: "#d64b43",
    ceiling: "#7b61a8",
    residual: "#7b61a8",
    grid: "#e8edef",
    axis: "#c3ced5",
    text: "#4a5d6e",
    muted: "#8a979f",
  };

  const CONFIG = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"],
  };

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function baseLayout(overrides = {}) {
    const layout = {
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#ffffff",
      font: { color: COLORS.text, family: "'Segoe UI', Arial, sans-serif", size: 11 },
      margin: { l: 58, r: 18, t: 24, b: 48 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: "#263849", font: { color: "#ffffff" } },
      xaxis: {
        gridcolor: COLORS.grid,
        zerolinecolor: COLORS.axis,
        linecolor: COLORS.axis,
        title: { text: "Tiempo (s)", font: { size: 11 } },
        tickfont: { size: 10 },
      },
      yaxis: {
        gridcolor: COLORS.grid,
        zerolinecolor: COLORS.axis,
        linecolor: COLORS.axis,
        tickfont: { size: 10 },
      },
      legend: { orientation: "h", x: 0, y: 1.13, font: { size: 10 }, bgcolor: "rgba(0,0,0,0)" },
      showlegend: true,
    };
    return Object.assign(layout, overrides);
  }

  class RCCharts {
    constructor(store, options = {}) {
      this.store = store;
      this.livePaused = false;
      this.liveInitialized = false;
      this.liveTauEvents = [];
      this.lastAnalysis = null;
      this.simResult = null;
      this.onInsight = options.onInsight || null;
      this._livePending = false;
      this._maxLive = 900;
      this._plots = new Set();
    }

    isPlotlyReady() {
      if (typeof Plotly === "undefined") {
        console.warn("Plotly no está disponible.");
        return false;
      }
      return true;
    }

    /* ------------------------------------------------------------------ */
    /* Gráfica en vivo                                                     */
    /* ------------------------------------------------------------------ */
    initLive() {
      const element = document.getElementById("chart-live");
      if (!element || !this.isPlotlyReady() || this.liveInitialized) return;
      const traces = [
        {
          x: [], y: [], mode: "lines", name: "Medición experimental",
          line: { color: COLORS.measured, width: 2.2 }, hovertemplate: "%{y:.3f} V<extra></extra>",
        },
        {
          x: [], y: [], mode: "lines", name: "Voltaje techo",
          line: { color: COLORS.ceiling, width: 1.5, dash: "dot" }, hovertemplate: "%{y:.3f} V<extra></extra>",
        },
        {
          x: [], y: [], mode: "markers", name: "Punto 1τ",
          marker: { color: COLORS.tau, size: 12, symbol: "star", line: { color: "#ffffff", width: 1 } },
          hovertemplate: "1τ · %{x:.2f} s · %{y:.3f} V<extra></extra>",
        },
        {
          x: [], y: [], mode: "lines", name: "Umbral 1τ",
          line: { color: COLORS.threshold, width: 1.2, dash: "dash" }, hoverinfo: "skip",
        },
      ];
      const layout = baseLayout({
        legend: { orientation: "h", x: 0, y: 1.14, font: { size: 10 } },
        margin: { l: 54, r: 14, t: 22, b: 40 },
        yaxis: {
          gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
          title: { text: "Voltaje (V)", font: { size: 11 } }, tickfont: { size: 10 },
        },
      });
      Plotly.newPlot(element, traces, layout, CONFIG);
      this._plots.add(element);
      this.liveInitialized = true;
    }

    scheduleLive() {
      if (this.livePaused || this._livePending) return;
      this._livePending = true;
      requestAnimationFrame(() => {
        this._livePending = false;
        this.updateLive();
      });
    }

    updateLive() {
      if (!this.liveInitialized || this.livePaused) return;
      const element = document.getElementById("chart-live");
      if (!element) return;
      const samples = this.store.samples.slice(-this._maxLive);
      if (samples.length === 0) return;
      const x = samples.map((sample) => sample.t_rel);
      const y = samples.map((sample) => sample.voltaje_tanque);
      const ceiling = samples.map((sample) => sample.voltaje_techo);
      const lastX = x[x.length - 1];
      const lastEvent = this.liveTauEvents.length ? this.liveTauEvents[this.liveTauEvents.length - 1] : null;
      const tauX = lastEvent ? [lastEvent.absolute_time_s] : [];
      const tauY = lastEvent ? [lastEvent.voltage_v] : [];
      const thresholdX = lastEvent ? [x[0], lastX + 0.5] : [];
      const thresholdY = lastEvent ? [lastEvent.threshold_v, lastEvent.threshold_v] : [];

      Plotly.update(element, {
        0: { x, y },
        1: { x, y: ceiling },
        2: { x: tauX, y: tauY },
        3: { x: thresholdX, y: thresholdY },
      }, {
        "xaxis.range": [Math.max(0, x[0]), lastX + 0.4],
      });
    }

    setLivePaused(paused) {
      this.livePaused = Boolean(paused);
      if (!this.livePaused) this.updateLive();
    }

    clearLive() {
      this.liveTauEvents = [];
      if (this.liveInitialized && this.isPlotlyReady()) {
        Plotly.update("chart-live", { 0: { x: [], y: [] }, 1: { x: [], y: [] }, 2: { x: [], y: [] }, 3: { x: [], y: [] } });
      }
      if (this.onInsight) this.onInsight(null);
    }

    addTauEvent(event) {
      this.liveTauEvents.push(event);
      this.updateLive();
      if (this.onInsight) this.onInsight(event);
    }

    /* ------------------------------------------------------------------ */
    /* Análisis                                                            */
    /* ------------------------------------------------------------------ */
    plotAnalysis(result, capacitance) {
      this.lastAnalysis = result;
      if (!result || !result.valido) {
        this._emptyAnalysis(result);
        return;
      }
      const segments = result.segmentos || [];
      const charge = this._pickSegment(segments, "CARGA");
      const discharge = this._pickSegment(segments, "DESCARGA");
      this._plotSegment("chart-charge", charge, capacitance, "CARGA");
      this._plotSegment("chart-discharge", discharge, capacitance, "DESCARGA");
      this._plotDerived("chart-charge-q", charge, discharge, capacitance, "charge", "Carga Q (C)");
      this._plotDerived("chart-energy", charge, discharge, capacitance, "energy", "Energía E (J)");
      this._plotResiduals(charge || discharge);
    }

    _emptyAnalysis(result) {
      ["chart-charge", "chart-discharge", "chart-charge-q", "chart-energy", "chart-residuals"].forEach((id) => {
        const element = document.getElementById(id);
        if (!element || !this.isPlotlyReady()) return;
        const message = (result && result.motivo) || "Sin datos suficientes para este análisis.";
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false },
          yaxis: { visible: false },
          annotations: [{
            text: message, xref: "paper", yref: "paper", x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: COLORS.muted },
          }],
          showlegend: false,
        }), CONFIG);
        this._plots.add(element);
      });
    }

    _pickSegment(segments, mode) {
      const candidates = segments.filter(
        (segment) => segment.modo === mode && Array.isArray(segment.voltaje_v) && Array.isArray(segment.tiempo_s)
      );
      if (candidates.length === 0) return null;
      return candidates.sort((a, b) => (b.num_muestras || 0) - (a.num_muestras || 0))[0];
    }

    _plotSegment(divId, segment, capacitance, mode) {
      const element = document.getElementById(divId);
      if (!element || !this.isPlotlyReady()) return;
      const tag = document.getElementById(mode === "CARGA" ? "tag-charge" : "tag-discharge");
      if (!segment) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{
            text: `Aún no hay un segmento de ${mode.toLowerCase()} con datos suficientes.`,
            xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
            font: { size: 12, color: COLORS.muted },
          }],
        }), CONFIG);
        this._plots.add(element);
        if (tag) tag.textContent = mode === "CARGA" ? "63,2 %" : "36,8 %";
        return;
      }

      const times = segment.tiempo_s.slice();
      const voltages = segment.voltaje_v.slice();
      const tauExp = toNumber(segment.tau_experimental_s);
      const tauTeo = toNumber(segment.tau_teorica_s);
      const tauCurve = tauTeo !== null && tauTeo > 0 ? tauTeo : tauExp;
      const duration = Math.max(...times, 0.001);
      const modelTimes = [];
      const modelVolts = [];
      if (Number.isFinite(tauCurve) && tauCurve > 0) {
        const steps = 160;
        const span = Math.max(duration * 1.05, tauCurve * 4.5);
        for (let i = 0; i <= steps; i += 1) {
          const t = (span * i) / steps;
          modelTimes.push(t);
          modelVolts.push(Core.modelAt(mode, t, segment.v0_v, segment.vf_v, tauCurve));
        }
      }

      const traces = [
        { x: times, y: voltages, mode: "lines", name: "Medición", line: { color: COLORS.measured, width: 2.2 }, hovertemplate: "%{y:.3f} V<extra></extra>" },
        { x: modelTimes, y: modelVolts, mode: "lines", name: "Modelo RC", line: { color: COLORS.theoretical, width: 2, dash: "dash" }, hovertemplate: "%{y:.3f} V<extra></extra>" },
        { x: [times[0], times[times.length - 1]], y: [segment.v0_v, segment.v0_v], mode: "lines", name: "V inicial", line: { color: COLORS.muted, width: 1, dash: "dot" }, hoverinfo: "skip" },
        { x: [times[0], times[times.length - 1]], y: [segment.vf_v, segment.vf_v], mode: "lines", name: "V final de referencia", line: { color: COLORS.ceiling, width: 1, dash: "dot" }, hoverinfo: "skip" },
      ];

      const shapes = [{
        type: "line", x0: times[0], x1: times[times.length - 1],
        y0: segment.umbral_tau_v, y1: segment.umbral_tau_v,
        line: { color: COLORS.threshold, width: 1.4, dash: "dash" },
      }];
      const annotations = [{
        x: times[times.length - 1], y: segment.umbral_tau_v,
        xref: "x", yref: "y", text: `Umbral ${mode === "CARGA" ? "63,2 %" : "36,8 %"}`,
        showarrow: false, xanchor: "right", yanchor: "bottom",
        font: { size: 9, color: "#8a6508" }, bgcolor: "rgba(253,245,223,0.9)",
      }];

      if (segment.punto_tau && tauExp !== null && Number.isFinite(tauExp)) {
        const tauT = tauExp;
        traces.push({
          x: [tauT], y: [segment.punto_tau.voltaje_v], mode: "markers+text",
          name: "1τ experimental", text: ["1τ"], textposition: "top center",
          textfont: { size: 10, color: COLORS.tau },
          marker: { color: COLORS.tau, size: 13, symbol: "star", line: { color: "#fff", width: 1 } },
          hovertemplate: `1τ = %{x:.3f} s · %{y:.3f} V<extra></extra>`,
        });
        shapes.push({
          type: "line", x0: tauT, x1: tauT, y0: Math.min(segment.v0_v, segment.vf_v),
          y1: Math.max(segment.v0_v, segment.vf_v),
          line: { color: COLORS.tau, width: 1.2, dash: "dot" },
        });
        annotations.push({
          x: tauT, y: segment.punto_tau.voltaje_v, xref: "x", yref: "y",
          text: `τexp = ${FMT.seconds(tauT, 2)}`, showarrow: true, arrowhead: 2,
          ax: -35, ay: -34, font: { size: 10, color: COLORS.tau },
          bgcolor: "rgba(255,255,255,0.92)", bordercolor: COLORS.tau, borderwidth: 1, borderpad: 3,
        });
      }

      const layout = baseLayout({
        margin: { l: 58, r: 16, t: 22, b: 48 },
        yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, title: { text: "Voltaje (V)", font: { size: 11 } }, tickfont: { size: 10 } },
        shapes,
        annotations,
      });
      Plotly.react(element, traces, layout, CONFIG);
      this._plots.add(element);
      if (tag) {
        tag.textContent = segment.punto_tau
          ? `τexp = ${FMT.seconds(segment.tau_experimental_s, 2)}`
          : (mode === "CARGA" ? "63,2 %" : "36,8 %");
      }
    }

    _plotDerived(divId, chargeSegment, dischargeSegment, capacitance, kind, yTitle) {
      const element = document.getElementById(divId);
      if (!element || !this.isPlotlyReady()) return;
      const traces = [];
      [chargeSegment, dischargeSegment].forEach((segment) => {
        if (!segment) return;
        const times = segment.tiempo_s;
        const values = segment.voltaje_v.map((v) => (kind === "energy" ? Core.energyJ(capacitance, v) : Core.chargeC(capacitance, v)));
        traces.push({
          x: times, y: values, mode: "lines",
          name: `${segment.modo === "CARGA" ? "Carga" : "Descarga"} experimental`,
          line: { color: segment.modo === "CARGA" ? COLORS.measured : COLORS.ceiling, width: 2.2 },
          hovertemplate: `%{y:.6f}<extra></extra>`,
        });
        const tau = toNumber(segment.tau_teorica_s) || toNumber(segment.tau_experimental_s);
        if (tau !== null && Number.isFinite(tau) && tau > 0) {
          const maxT = Math.max(...times) * 1.02;
          const modelX = [];
          const modelY = [];
          for (let i = 0; i <= 140; i += 1) {
            const t = (maxT * i) / 140;
            const v = Core.modelAt(segment.modo, t, segment.v0_v, segment.vf_v, tau);
            modelX.push(t);
            modelY.push(kind === "energy" ? Core.energyJ(capacitance, v) : Core.chargeC(capacitance, v));
          }
          traces.push({
            x: modelX, y: modelY, mode: "lines",
            name: `${segment.modo === "CARGA" ? "Carga" : "Descarga"} teórica`,
            line: { color: COLORS.theoretical, width: 1.6, dash: "dash" }, hoverinfo: "skip",
          });
        }
      });

      if (traces.length === 0) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{
            text: "Sin segmentos de carga o descarga para esta magnitud.",
            xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
            font: { size: 12, color: COLORS.muted },
          }],
        }), CONFIG);
        this._plots.add(element);
        return;
      }

      Plotly.react(element, traces, baseLayout({
        margin: { l: 64, r: 16, t: 22, b: 48 },
        yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, title: { text: yTitle, font: { size: 11 } }, tickfont: { size: 10 } },
      }), CONFIG);
      this._plots.add(element);
    }

    _plotResiduals(segment) {
      const element = document.getElementById("chart-residuals");
      if (!element || !this.isPlotlyReady()) return;
      const fit = segment && segment.ajuste;
      if (!fit || !fit.valido || !Array.isArray(fit.residuos)) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{
            text: (fit && fit.motivo) || "No hay un ajuste válido para calcular residuos.",
            xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
            font: { size: 12, color: COLORS.muted },
          }],
        }), CONFIG);
        this._plots.add(element);
        return;
      }
      const x = fit.t_relativo || [];
      const residuals = fit.residuos || [];
      const traces = [
        {
          x, y: residuals, mode: "lines+markers", name: "Residuo",
          line: { color: COLORS.residual, width: 1.3 }, marker: { size: 3.5, color: COLORS.residual },
          hovertemplate: "%{y:.4f} V<extra></extra>",
        },
        {
          x: [x[0], x[x.length - 1]], y: [0, 0], mode: "lines", name: "Cero",
          line: { color: COLORS.axis, width: 1, dash: "dash" }, hoverinfo: "skip",
        },
      ];
      Plotly.react(element, traces, baseLayout({
        margin: { l: 64, r: 16, t: 22, b: 48 },
        yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, title: { text: "Residuo (V)", font: { size: 11 } }, tickfont: { size: 10 } },
      }), CONFIG);
      this._plots.add(element);
    }

    /* ------------------------------------------------------------------ */
    /* Simulación                                                          */
    /* ------------------------------------------------------------------ */
    plotSimulation(result) {
      this.simResult = result;
      const element = document.getElementById("chart-sim");
      if (!element || !this.isPlotlyReady()) return;
      if (!result || !result.valido) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{ text: (result && result.error) || "Simulación no disponible.", xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false, font: { size: 12, color: COLORS.muted } }],
        }), CONFIG);
        this._plots.add(element);
        return;
      }

      const tau = result.tau_segundos;
      const point = result.punto_tau;
      const traces = [
        {
          x: result.tiempo, y: result.voltaje, mode: "lines", name: "Modelo RC ideal",
          line: { color: COLORS.measured, width: 2.4 }, hovertemplate: "%{y:.3f} V<extra></extra>",
        },
        {
          x: [tau, tau], y: [Math.min(result.v_inicial, result.v_final), Math.max(result.v_inicial, result.v_final)],
          mode: "markers+text", name: "1τ", text: ["1τ"], textposition: "top center",
          marker: { color: COLORS.tau, size: 13, symbol: "star" }, textfont: { size: 10, color: COLORS.tau },
          hovertemplate: "1τ = %{x:.3f} s<extra></extra>",
        },
        {
          x: [], y: [], mode: "markers", name: "Punto actual",
          marker: { color: COLORS.measured, size: 9, line: { color: "#ffffff", width: 1 } },
          hovertemplate: "Actual · %{x:.2f} s · %{y:.3f} V<extra></extra>",
        },
      ];
      const layout = baseLayout({
        margin: { l: 58, r: 16, t: 22, b: 48 },
        yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, title: { text: "Voltaje (V)", font: { size: 11 } }, tickfont: { size: 10 } },
        shapes: [{
          type: "line", x0: tau, x1: tau,
          y0: Math.min(result.v_inicial, result.v_final), y1: Math.max(result.v_inicial, result.v_final),
          line: { color: COLORS.tau, width: 1.2, dash: "dot" },
        }],
        annotations: [{
          x: tau, y: point.voltage_v, xref: "x", yref: "y",
          text: `1τ · ${FMT.number(point.voltage_v, 3)} V`,
          showarrow: true, arrowhead: 2, ax: 34, ay: -36,
          font: { size: 10, color: COLORS.tau },
          bgcolor: "rgba(255,255,255,0.92)", bordercolor: COLORS.tau, borderwidth: 1, borderpad: 3,
        }],
      });
      Plotly.react(element, traces, layout, CONFIG);
      this._plots.add(element);
    }

    resizeAll() {
      if (!this.isPlotlyReady()) return;
      this._plots.forEach((element) => {
        if (element && element.offsetParent !== null) {
          try { Plotly.Plots.resize(element); } catch (error) { /* contenedor oculto */ }
        }
      });
    }
  }

  global.RCCharts = RCCharts;
})(typeof globalThis !== "undefined" ? globalThis : this);
