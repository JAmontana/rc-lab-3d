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
    measured: "#26DCE0",
    theoretical: "#B4DC55",
    threshold: "#FF963D",
    tau: "#FF963D",
    ceiling: "#7899A4",
    residual: "#FF963D",
    grid: "rgba(232, 245, 246, 0.14)",
    axis: "#4A7A86",
    text: "#EAF6F7",
    muted: "#B9CFD5",
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
      plot_bgcolor: "#122B34",
      font: { color: COLORS.text, family: "'Segoe UI', Arial, sans-serif", size: 11 },
      margin: { l: 58, r: 18, t: 24, b: 48 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: "#1F4A55", font: { color: "#E8E7D9" } },
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
      this.liveParams = null;
      this.liveSelected = null;
      this.liveCleared = false;
    }

    isPlotlyReady() {
      if (typeof Plotly === "undefined") {
        console.warn("Plotly no está disponible.");
        return false;
      }
      return true;
    }

    /* ------------------------------------------------------------------ */
    /* Gráfica en vivo — carga eléctrica q(t)                              */
    /* ------------------------------------------------------------------ */
    initLive() {
      const element = document.getElementById("chart-live");
      if (!element || !this.isPlotlyReady() || this.liveInitialized) return;
      const traces = [
        {
          x: [], y: [], mode: "lines", name: "q(t) modelo · Qmax(1−e^(−t/τ))",
          line: { color: COLORS.theoretical, width: 2.6 },
          fill: "tozeroy", fillcolor: "rgba(180, 220, 85, 0.07)",
          hovertemplate: "%{y:.2f} mC<extra></extra>",
        },
        {
          x: [], y: [], mode: "lines+markers", name: "q estimada · q = C · Vc",
          line: { color: COLORS.measured, width: 2.4 },
          marker: { size: 4, color: COLORS.measured },
          hovertemplate: "%{y:.2f} mC<extra></extra>",
        },
        {
          x: [], y: [], mode: "markers", name: "Instante seleccionado",
          marker: { color: "#FFFFFF", size: 13, line: { color: COLORS.tau, width: 3 } },
          hovertemplate: "t = %{x:.2f} s · %{y:.2f} mC<extra></extra>",
        },
        {
          x: [], y: [], mode: "markers+text", name: "1τ",
          marker: { color: COLORS.tau, size: 15, symbol: "star", line: { color: "#FFFFFF", width: 1 } },
          text: [], textposition: "top center", textfont: { size: 10, color: COLORS.tau },
          hovertemplate: "1τ · %{x:.2f} s · %{y:.2f} mC<extra></extra>",
        },
        {
          x: [], y: [], mode: "markers+text", name: "2τ",
          marker: { color: COLORS.muted, size: 7, symbol: "diamond" },
          text: [], textposition: "top center", textfont: { size: 8, color: COLORS.muted },
          hoverinfo: "skip",
        },
        {
          x: [], y: [], mode: "markers+text", name: "3τ",
          marker: { color: COLORS.muted, size: 7, symbol: "diamond" },
          text: [], textposition: "top center", textfont: { size: 8, color: COLORS.muted },
          hoverinfo: "skip",
        },
        {
          x: [], y: [], mode: "markers+text", name: "5τ",
          marker: { color: COLORS.green || "#B4DC55", size: 7, symbol: "diamond" },
          text: [], textposition: "top center", textfont: { size: 8, color: "#B4DC55" },
          hoverinfo: "skip",
        },
      ];
      const layout = baseLayout({
        margin: { l: 58, r: 18, t: 30, b: 46 },
        legend: { orientation: "h", x: 0, y: 1.16, font: { size: 9 } },
        xaxis: {
          gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
          title: { text: "Tiempo (s)", font: { size: 11 } }, tickfont: { size: 10 },
          range: [0, 10],
        },
        yaxis: {
          gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
          title: { text: "Carga eléctrica (mC)", font: { size: 11 } }, tickfont: { size: 10 },
          range: [0, 25], autorange: false,
        },
        annotations: [{
          text: "Selecciona un instante para calcular q(t) y verlo en los condensadores 3D.",
          xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
          font: { size: 12, color: COLORS.muted },
        }],
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

    setLiveParams(params) {
      this.liveParams = Object.assign({}, this.liveParams || {}, params || {});
      this.updateLive();
    }

    setLiveSelected(selection) {
      this.liveSelected = selection || null;
      if (this.livePaused) return;
      // Mover el cursor solo repinta el marcador y las anotaciones: la curva
      // completa ya está dibujada y así la respuesta es inmediata.
      if (selection && this.liveInitialized) {
        const model = this.buildLiveChargeModel();
        if (model) {
          this.updateChargeMarker("chart-live", model);
          return;
        }
      }
      this.updateLive();
    }

    bindChargeClick(divId, handler) {
      const element = document.getElementById(divId);
      if (!element) return;
      element._chargeClickHandler = handler;
      this._attachChargeClick(element);
    }

    /** Adjunta una sola vez el clic sobre la gráfica para elegir un instante. */
    _attachChargeClick(element) {
      if (!element || typeof element.on !== "function" || element._chargeClickAttached) return;
      element._chargeClickAttached = true;
      element.on("plotly_click", (event) => {
        const handler = element._chargeClickHandler;
        if (typeof handler !== "function" || !event || !Array.isArray(event.points)) return;
        const point = event.points[0];
        const x = Number(point && point.x);
        if (Number.isFinite(x)) handler(x);
      });
    }

    /**
     * Modelo nominal de referencia cuando todavía no hay muestras físicas.
     * Se identifica como SIMULACIÓN y nunca se mezcla con datos medidos: en
     * cuanto llega la primera muestra, buildLiveChargeModel usa el hardware.
     */
    buildNominalChargeModel() {
      const params = this.liveParams || {};
      const c = Number(params.c) > 0 ? Number(params.c) : (this.store ? this.store.capacitanceF : 0.004);
      const ceiling = Number(params.ceiling) > 0 ? Number(params.ceiling) : 5;
      const tau = Number(params.tau) > 0
        ? Number(params.tau)
        : (Number(params.rCharge) > 0 ? Number(params.rCharge) * c : null);
      if (!(tau > 0) || !(c > 0) || !(ceiling > 0)) return null;
      const qMaxC = Core.qMaxC(c, ceiling);
      const xEnd = 5 * tau;
      const steps = 220;
      const times = [];
      const chargesC = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = (xEnd * i) / steps;
        times.push(t);
        chargesC.push(Core.chargeAtTimeC(t, qMaxC, tau));
      }
      const selected = this.liveSelected && Number.isFinite(Number(this.liveSelected.time))
        ? {
          time: Number(this.liveSelected.time),
          chargeC: Number.isFinite(Number(this.liveSelected.chargeC))
            ? Number(this.liveSelected.chargeC)
            : Core.chargeAtTimeC(Number(this.liveSelected.time), qMaxC, tau),
        }
        : (this.liveCleared
          ? { time: 0, chargeC: 0 }
          : { time: tau, chargeC: Core.chargeAtTimeC(tau, qMaxC, tau) });
      return {
        times,
        chargesC,
        qMaxC,
        q0C: 0,
        qInfC: qMaxC,
        tau,
        c,
        ceiling,
        xStart: 0,
        xEnd,
        mode: "CARGA",
        selected,
        experimental: { times: [], chargesC: [] },
        tauPoint: null,
        nominal: true,
        tauPending: false,
        source: "SIMULACIÓN",
      };
    }

    /**
     * Modelo de carga para el montaje físico. Si no hay muestras, devuelve la
     * curva nominal marcada como SIMULACIÓN; con muestras usa exclusivamente
     * los datos reales del evento actual.
     */
    buildLiveChargeModel() {
      if (!this.store || !Array.isArray(this.store.samples) || this.store.samples.length === 0) {
        return this.buildNominalChargeModel();
      }
      const samples = this.store.samples;
      const params = this.liveParams || {};
      // Con la primera muestra física se abandona la curva nominal y el
      // cursor vuelve a seguir el dato real.
      this.liveCleared = false;
      const c = Number(params.c) > 0 ? Number(params.c) : this.store.capacitanceF;
      const last = samples[samples.length - 1];
      // El Modo prueba inyecta tramas con origen SIMULACION en el mismo
      // almacén. La curva se dibuja, pero nunca se etiqueta como medición.
      const synthetic = String(last.origen || "").toUpperCase() === "SIMULACION";
      // En el montaje físico manda el techo medido por A1; el valor nominal de
      // referencia solo se usa si la trama no trae un techo válido.
      const measuredCeiling = Number(last.voltaje_techo);
      const ceiling = measuredCeiling > 0.05 ? measuredCeiling : Number(params.ceiling);
      const qMaxC = Core.qMaxC(c, Number.isFinite(ceiling) ? ceiling : 0);
      const state = String(last.estado || "S").toUpperCase();
      const mode = state === "D" ? "DESCARGA" : "CARGA";
      const rMode = mode === "DESCARGA" ? Number(params.rDischarge) : Number(params.rCharge);
      const tau = rMode > 0 ? rMode * c : (mode === "CARGA" ? Number(params.tau) : null);
      const tauPending = !(tau > 0);


      // Inicio del evento actual: la última muestra donde cambió el estado.
      let startIndex = samples.length - 1;
      while (startIndex > 0 && String(samples[startIndex - 1].estado || "S") === state) {
        startIndex -= 1;
      }
      const xStart = Number(samples[startIndex].t_rel) || 0;
      const q0C = c * Number(samples[startIndex].voltaje_tanque);
      const qInfC = mode === "DESCARGA" ? 0 : qMaxC;
      const lastTime = Number(samples[samples.length - 1].t_rel);
      // Se muestran al menos 0..5τ y, si la sesión física dura más, también
      // todo el tramo medido: nunca se recortan las muestras originales.
      const xEnd = tau > 0
        ? Math.max(xStart + 5 * tau, Number.isFinite(lastTime) ? lastTime : xStart)
        : (Number.isFinite(lastTime) ? lastTime : xStart + 1);
      const steps = 220;
      const times = [];
      const chargesC = [];
      if (tau > 0) {
        for (let i = 0; i <= steps; i += 1) {
          const t = xStart + ((xEnd - xStart) * i) / steps;
          times.push(t);
          chargesC.push(Core.chargeAtTimeGeneralC(t - xStart, q0C, qInfC, tau));
        }
      }

      const experimental = {
        times: samples.map((sample) => Number(sample.t_rel)).filter((t) => Number.isFinite(t)),
        chargesC: samples
          .map((sample) => c * Number(sample.voltaje_tanque))
          .filter((q) => Number.isFinite(q)),
      };

      let tauPoint = null;
      const events = (this.liveTauEvents || []).filter((event) => event.mode === mode);
      if (events.length) {
        const event = events[events.length - 1];
        const eventCharge = c * Number(event.voltage_v);
        if (Number.isFinite(event.absolute_time_s) && Number.isFinite(eventCharge)) {
          tauPoint = {
            time: event.absolute_time_s,
            chargeC: eventCharge,
            percent: event.percent,
            label: `1τ exp. · ${event.mode === "CARGA" ? "63,2 %" : "36,8 %"}`,
          };
        }
      }

      const selectedSample = this.liveSelected && Number.isFinite(this.liveSelected.time)
        ? null
        : last;
      const selected = this.liveSelected && Number.isFinite(this.liveSelected.time)
        ? {
          time: this.liveSelected.time,
          chargeC: Number.isFinite(this.liveSelected.chargeC)
            ? this.liveSelected.chargeC
            : Core.chargeAtTimeGeneralC(this.liveSelected.time - xStart, q0C, qInfC, tau),
        }
        : {
          time: selectedSample.t_rel,
          chargeC: c * Number(selectedSample.voltaje_tanque),
        };

      return {
        times,
        chargesC,
        qMaxC,
        q0C,
        qInfC,
        tau,
        c,
        ceiling,
        xStart,
        xEnd,
        mode,
        selected,
        experimental,
        tauPoint,
        nominal: false,
        synthetic,
        tauPending,
        source: synthetic ? "SIMULACIÓN" : "MEDICIÓN",
      };
    }

    updateLive(force = false) {
      if (!this.liveInitialized || (this.livePaused && !force)) return;
      const element = document.getElementById("chart-live");
      if (!element) return;
      const model = this.buildLiveChargeModel();
      if (!model) return;
      const sub = document.getElementById("live-chart-sub");
      if (sub) {
        sub.innerHTML = model.tauPending
          ? "Dato pendiente de configurar: falta la resistencia de descarga para calcular τ y q(t)."
          : (model.synthetic
            ? "Modo prueba · SIMULACIÓN — DATOS SINTÉTICOS · la curva no es una medición del Arduino"
            : (model.nominal
              ? "Curva nominal · SIMULACIÓN sin datos físicos · q(t) = Qmax · (1 − e<sup>−t/τ</sup>)"
              : (model.mode === "DESCARGA"
                ? "q(t) = Q₀ · e<sup>−t/τ</sup> · Q₀ = C<sub>eq</sub> · V₀ (carga estimada q = C · Vc)"
                : "q(t) = Qmax · (1 − e<sup>−t/τ</sup>) · Qmax = C<sub>eq</sub> · V<sub>techo</sub>")));
      }
      const badge = document.getElementById("live-data-badge");
      if (badge) {
        const show = model.nominal || model.synthetic;
        badge.classList.toggle("hidden", !show);
        if (show) {
          badge.textContent = model.synthetic
            ? "MODO PRUEBA · DATOS SINTÉTICOS"
            : "SIN DATOS FÍSICOS · CURVA NOMINAL";
        }
      }
      this.plotCharge("chart-live", model);
    }

    setLivePaused(paused) {
      this.livePaused = Boolean(paused);
      if (!this.livePaused) this.updateLive();
    }

    clearLive() {
      this.liveTauEvents = [];
      this.liveSelected = null;
      const element = document.getElementById("chart-live");
      if (element && this.liveInitialized && this.isPlotlyReady()) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{
            text: "Sin datos todavía. Inicia una sesión o el Modo prueba para ver q(t).",
            xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
            font: { size: 12, color: COLORS.muted },
          }],
        }), CONFIG);
      }
      if (this.onInsight) this.onInsight(null);
    }


    addTauEvent(event) {
      this.liveTauEvents.push(event);
      this.updateLive();
      if (this.onInsight) this.onInsight(event);
    }

    /* ------------------------------------------------------------------ */
    /* Gráfica protagonista: carga eléctrica q(t)                          */
    /* ------------------------------------------------------------------ */
    _chargeGeometry(model) {
      const mode = String(model.mode || "CARGA").toUpperCase();
      const tau = Number(model.tau);
      const xStart = Number.isFinite(model.xStart) ? Number(model.xStart) : 0;
      const qMaxC = Number(model.qMaxC) || 0;
      const q0C = Number.isFinite(model.q0C) ? Number(model.q0C) : 0;
      const qInfC = Number.isFinite(model.qInfC) ? Number(model.qInfC) : qMaxC;
      const at = (t) => Core.chargeAtTimeGeneralC(t - xStart, q0C, qInfC, tau) * 1000;
      const xEnd = Number.isFinite(Number(model.xEnd)) && Number(model.xEnd) > xStart
        ? Number(model.xEnd)
        : xStart + 5 * tau;
      const qMaxMc = qMaxC * 1000;
      const q0Mc = q0C * 1000;
      const selectedTime = Number(model.selected && model.selected.time);
      const selectedQ = Number(model.selected && model.selected.chargeC);
      const selT = Number.isFinite(selectedTime) ? selectedTime : xStart;
      const selMc = Number.isFinite(selectedQ) ? selectedQ * 1000 : at(selT);
      const base = mode === "DESCARGA" ? q0Mc : qMaxMc;
      const selPct = base > 0 ? (selMc / base) * 100 : 0;
      const values = Array.isArray(model.chargesC) ? model.chargesC : [];
      const yTop = Math.max(1, qMaxMc, q0Mc, ...values.map((q) => Number(q) * 1000)) * 1.12;
      const tauPoint = model.tauPoint && Number.isFinite(Number(model.tauPoint.time))
        ? {
          time: Number(model.tauPoint.time),
          chargeMc: Number(model.tauPoint.chargeC) * 1000,
          percent: Number(model.tauPoint.percent),
          label: model.tauPoint.label,
        }
        : {
          time: xStart + tau,
          chargeMc: at(xStart + tau),
          percent: mode === "DESCARGA" ? Core.TAU_DISCHARGE_FACTOR * 100 : Core.TAU_CHARGE_FACTOR * 100,
          // Con q0 ≠ 0 la fracción es de la variación, no de Qmax: la etiqueta
          // no debe afirmar un 63,2 % de Qmax que la curva no cumple.
          label: mode === "DESCARGA"
            ? (qInfC > q0C * 0.01 ? "1τ · 36,8 % de la variación" : "1τ · 36,8 % restante")
            : (Math.abs(q0C) > qMaxC * 0.005 ? "1τ · 63,2 % de la variación" : "1τ · 63,2 % de Qmax"),
        };
      return { mode, tau, xStart, xEnd, qMaxC, q0C, qInfC, qMaxMc, q0Mc, at, selT, selMc, selPct, yTop, tauPoint };
    }

    _chargeLayoutParts(geom) {
      const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits).replace(".", ",") : "—");
      const shapes = [];
      const annotations = [];
      if (geom.mode === "DESCARGA") {
        // En descarga la referencia superior es la carga inicial Q₀.
        shapes.push({
          type: "line", x0: geom.xStart, x1: geom.xEnd, y0: geom.q0Mc, y1: geom.q0Mc,
          line: { color: "#FF963D", width: 1.6, dash: "dashdot" },
        });
        annotations.push({
          x: geom.xEnd, y: geom.q0Mc, xref: "x", yref: "y",
          text: `Q₀ = ${fmt(geom.q0Mc)} mC · carga inicial`,
          showarrow: false, xanchor: "right", yanchor: "bottom",
          font: { size: 10, color: "#FF963D" }, bgcolor: "rgba(16,24,32,0.82)", borderpad: 2,
        });
        const qInfMc = geom.qInfC * 1000;
        if (qInfMc > 1e-6) {
          shapes.push({
            type: "line", x0: geom.xStart, x1: geom.xEnd, y0: qInfMc, y1: qInfMc,
            line: { color: "#B4DC55", width: 1.4, dash: "dot" },
          });
          annotations.push({
            x: geom.xEnd, y: qInfMc, xref: "x", yref: "y",
            text: `Q∞ = ${fmt(qInfMc)} mC · equilibrio`,
            showarrow: false, xanchor: "right", yanchor: "bottom",
            font: { size: 10, color: "#B4DC55" }, bgcolor: "rgba(16,24,32,0.82)", borderpad: 2,
          });
        }
      } else {
        shapes.push({
          type: "line", x0: geom.xStart, x1: geom.xEnd, y0: geom.qMaxMc, y1: geom.qMaxMc,
          line: { color: "#B4DC55", width: 1.6, dash: "dashdot" },
        });
        annotations.push({
          x: geom.xEnd, y: geom.qMaxMc, xref: "x", yref: "y",
          text: `Qmax = ${fmt(geom.qMaxMc)} mC · C·Ve`,
          showarrow: false, xanchor: "right", yanchor: "bottom",
          font: { size: 10, color: "#B4DC55" }, bgcolor: "rgba(16,24,32,0.82)", borderpad: 2,
        });
      }
      shapes.push({
        type: "line", x0: geom.selT, x1: geom.selT, y0: 0, y1: geom.yTop,
        line: { color: COLORS.tau, width: 1.4, dash: "dot" },
      });
      annotations.push({
        x: geom.tauPoint.time, y: geom.tauPoint.chargeMc, xref: "x", yref: "y",
        text: `${geom.tauPoint.label}<br>t = ${fmt(geom.tauPoint.time)} s · q = ${fmt(geom.tauPoint.chargeMc)} mC`,
        showarrow: true, arrowhead: 2, ax: 42, ay: -38,
        font: { size: 10, color: COLORS.tau }, bgcolor: "rgba(16,24,32,0.92)",
        bordercolor: COLORS.tau, borderwidth: 1, borderpad: 3,
      });
      annotations.push({
        x: geom.selT, y: geom.selMc, xref: "x", yref: "y",
        text: `t = ${fmt(geom.selT)} s<br>q = ${fmt(geom.selMc)} mC · ${fmt(geom.selPct, 1)} %`,
        showarrow: true, arrowhead: 0, ax: -56, ay: -46,
        font: { size: 10, color: "#FFFFFF" }, bgcolor: "rgba(255,150,61,0.92)",
        bordercolor: "#FF963D", borderwidth: 1, borderpad: 3,
      });
      return { shapes, annotations };
    }

    /**
     * Dibuja la curva q(t) completa de 0 a 5τ (o desde el inicio del evento
     * en el modo físico) con Qmax, 1τ, 2τ, 3τ, 5τ y el instante seleccionado.
     * No recorta los datos: dibuja todas las muestras recibidas.
     */
    plotCharge(divId, model) {
      const element = document.getElementById(divId);
      if (!element || !this.isPlotlyReady()) return;
      if (!model || !(Number(model.tau) > 0) || !Array.isArray(model.times) || !Array.isArray(model.chargesC)) {
        Plotly.react(element, [], baseLayout({
          xaxis: { visible: false }, yaxis: { visible: false }, showlegend: false,
          annotations: [{
            text: model && model.tauPending
              ? "Dato pendiente de configurar: falta la resistencia de este proceso."
              : "Completa R y C con valores positivos para dibujar q(t).",
            xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
            font: { size: 12, color: COLORS.muted },
          }],
        }), CONFIG);
        this._plots.add(element);
        return;
      }

      const geom = this._chargeGeometry(model);
      const c = Number(model.c) > 0
        ? Number(model.c)
        : (geom.qMaxC > 0 && Number(model.ceiling) > 0 ? geom.qMaxC / Number(model.ceiling) : 0);
      const baseC = geom.mode === "DESCARGA" ? geom.q0C : geom.qMaxC;
      const pctOf = (qC) => (baseC > 0 ? (qC / baseC) * 100 : 0);
      const voltOf = (qC) => (c > 0 ? qC / c : 0);
      const hover = "t = %{x:.2f} s<br>Vc = %{customdata[0]:.2f} V<br>q = %{y:.2f} mC<br>%{customdata[1]:.1f} %";

      const pairs = [];
      model.times.forEach((tRaw, index) => {
        const t = Number(tRaw);
        const qC = Number(model.chargesC[index]);
        if (Number.isFinite(t) && Number.isFinite(qC)) pairs.push({ t, qC });
      });
      const times = pairs.map((point) => point.t);
      const chargesMc = pairs.map((point) => point.qC * 1000);
      const modelCustom = pairs.map((point) => [voltOf(point.qC), pctOf(point.qC)]);

      const experimental = model.experimental || {};
      const expPairs = [];
      const expTimesRaw = Array.isArray(experimental.times) ? experimental.times : [];
      const expChargesRaw = Array.isArray(experimental.chargesC) ? experimental.chargesC : [];
      expTimesRaw.forEach((tRaw, index) => {
        const t = Number(tRaw);
        const qC = Number(expChargesRaw[index]);
        if (Number.isFinite(t) && Number.isFinite(qC)) expPairs.push({ t, qC });
      });
      const expTimes = expPairs.map((point) => point.t);
      const expCharges = expPairs.map((point) => point.qC * 1000);
      const expCustom = expPairs.map((point) => [voltOf(point.qC), pctOf(point.qC)]);

      const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits).replace(".", ",") : "—");
      const mark = (factor) => {
        const time = geom.xStart + factor * geom.tau;
        return { x: [time], y: [geom.at(time)], text: [`${factor}τ · ${fmt(geom.at(time))} mC`] };
      };
      const m2 = mark(2);
      const m3 = mark(3);
      const m5 = mark(5);
      const selVolt = voltOf(geom.selMc / 1000);
      const tauVolt = voltOf(geom.tauPoint.chargeMc / 1000);

      const modelName = model.nominal
        ? "q nominal · SIMULACIÓN (sin datos físicos)"
        : (geom.mode === "DESCARGA"
          ? (geom.qInfC > 1e-6 ? "q(t) modelo · descarga al equilibrio" : "q(t) modelo · Q₀·e^(−t/τ)")
          : "q(t) modelo · Qmax(1−e^(−t/τ))");

      const traces = [
        {
          x: times, y: chargesMc, mode: "lines",
          name: modelName,
          line: {
            color: COLORS.theoretical,
            width: 3,
            dash: model.nominal ? "dot" : "solid",
          },
          fill: "tozeroy", fillcolor: "rgba(180, 220, 85, 0.08)",
          customdata: modelCustom,
          hovertemplate: hover,
        },
        {
          x: expTimes, y: expCharges, mode: "lines+markers",
          name: "q estimada · q = C · Vc",
          line: { color: COLORS.measured, width: 2.2 },
          marker: { size: 4.5, color: COLORS.measured },
          customdata: expCustom,
          hovertemplate: hover,
        },
        {
          x: [geom.selT], y: [geom.selMc], mode: "markers", name: "Instante seleccionado",
          marker: { color: "#FFFFFF", size: 14, line: { color: COLORS.tau, width: 3 } },
          customdata: [[selVolt, geom.selPct]],
          hovertemplate: hover,
        },
        {
          x: [geom.tauPoint.time], y: [geom.tauPoint.chargeMc], mode: "markers+text",
          name: "1τ", text: [geom.tauPoint.label], textposition: "top center",
          marker: { color: COLORS.tau, size: 15, symbol: "star", line: { color: "#FFFFFF", width: 1 } },
          textfont: { size: 9, color: COLORS.tau },
          customdata: [[tauVolt, geom.tauPoint.percent]],
          hovertemplate: `1τ · ${hover}`,
        },
        {
          x: m2.x, y: m2.y, mode: "markers+text", name: "2τ", text: m2.text,
          textposition: "top center", marker: { color: COLORS.muted, size: 7, symbol: "diamond" },
          textfont: { size: 8, color: COLORS.muted }, hoverinfo: "skip",
        },
        {
          x: m3.x, y: m3.y, mode: "markers+text", name: "3τ", text: m3.text,
          textposition: "top center", marker: { color: COLORS.muted, size: 7, symbol: "diamond" },
          textfont: { size: 8, color: COLORS.muted }, hoverinfo: "skip",
        },
        {
          x: m5.x, y: m5.y, mode: "markers+text", name: "5τ · ≈99,3 %", text: m5.text,
          textposition: "top center", marker: { color: "#B4DC55", size: 7, symbol: "diamond" },
          textfont: { size: 8, color: "#B4DC55" }, hoverinfo: "skip",
        },
      ];

      const parts = this._chargeLayoutParts(geom);
      const layout = baseLayout({
        margin: { l: 62, r: 20, t: 34, b: 48 },
        legend: { orientation: "h", x: 0, y: 1.16, font: { size: 9 } },
        xaxis: {
          gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
          title: { text: "Tiempo (s)", font: { size: 11 } }, tickfont: { size: 10 },
          range: [geom.xStart, geom.xEnd], autorange: false,
        },
        yaxis: {
          gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis,
          title: { text: "Carga eléctrica (mC)", font: { size: 11 } }, tickfont: { size: 10 },
          range: [0, geom.yTop], autorange: false,
        },
        shapes: parts.shapes,
        annotations: parts.annotations,
      });
      Plotly.react(element, traces, layout, CONFIG);
      this._plots.add(element);
      this._attachChargeClick(element);
    }

    /** Actualiza solo el instante seleccionado sin recalcular toda la curva. */
    updateChargeMarker(divId, model) {
      const element = document.getElementById(divId);
      if (!element || !element.data || !(Number(model.tau) > 0)) return;
      try {
        const geom = this._chargeGeometry(model);
        Plotly.restyle(element, { x: [[geom.selT]], y: [[geom.selMc]] }, [2]);
        const parts = this._chargeLayoutParts(geom);
        Plotly.relayout(element, { shapes: parts.shapes, annotations: parts.annotations });
      } catch (error) {
        /* la gráfica todavía no está lista */
      }
    }

    renderAnalysisEmptyState(message) {
      if (!this.isPlotlyReady()) return;
      if (this.lastAnalysis) return;
      const text = message || "Inicia una simulación para visualizar las curvas.";
      ["chart-charge", "chart-discharge", "chart-charge-q", "chart-energy", "chart-residuals"].forEach((id) => {
        const element = document.getElementById(id);
        if (!element) return;
        try {
          Plotly.react(element, [], baseLayout({
            xaxis: { visible: false },
            yaxis: { visible: false },
            showlegend: false,
            annotations: [{
              text, xref: "paper", yref: "paper", x: 0.5, y: 0.5, showarrow: false,
              font: { size: 13, color: COLORS.muted },
            }],
          }), CONFIG);
          this._plots.add(element);
        } catch (error) {
          /* contenedor aún oculto o sin dimensiones */
        }
      });
    }

    reflowAnalysis() {
      if (!this.isPlotlyReady()) return;
      if (this.lastAnalysis) {
        this.plotAnalysis(this.lastAnalysis, this.lastCapacitance);
      } else {
        this.renderAnalysisEmptyState();
      }
      this.resizeAll();
    }

    /* ------------------------------------------------------------------ */
    /* Análisis                                                            */
    /* ------------------------------------------------------------------ */
    plotAnalysis(result, capacitance) {
      this.lastAnalysis = result;
      this.lastCapacitance = capacitance || this.lastCapacitance || this.store.capacitanceF;
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
        font: { size: 9, color: COLORS.threshold }, bgcolor: "rgba(16,24,32,0.9)",
      }];

      if (segment.punto_tau && tauExp !== null && Number.isFinite(tauExp)) {
        const tauT = tauExp;
        traces.push({
          x: [tauT], y: [segment.punto_tau.voltaje_v], mode: "markers+text",
          name: "1τ experimental",
          text: [`1τ · ${mode === "CARGA" ? "63,2 %" : "36,8 %"}`],
          textposition: "top center",
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
          bgcolor: "rgba(16,24,32,0.92)", bordercolor: COLORS.tau, borderwidth: 1, borderpad: 3,
        });
      }

      const layout = baseLayout({
        margin: { l: 58, r: 16, t: 22, b: 48 },
        yaxis: { gridcolor: COLORS.grid, zerolinecolor: COLORS.axis, linecolor: COLORS.axis, range: [0, 5.5], autorange: false, title: { text: "Voltaje (V)", font: { size: 11 } }, tickfont: { size: 10 } },
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
          line: { color: segment.modo === "CARGA" ? COLORS.measured : COLORS.tau, width: 2.2 },
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
      const c = Number(result.capacitance_f) || this.store.capacitanceF;
      const vHigh = Math.max(Number(result.v_inicial) || 0, Number(result.v_final) || 0);
      const qMaxC = Core.qMaxC(c, vHigh);
      const q0C = c * result.v_inicial;
      const qInfC = result.modo === "DESCARGA" ? c * result.v_final : qMaxC;
      const times = result.tiempo;
      const chargesC = times.map((t) => Core.chargeAtTimeGeneralC(t, q0C, qInfC, result.tau_segundos));
      this.plotCharge("chart-sim", {
        times,
        chargesC,
        qMaxC,
        q0C,
        qInfC,
        tau: result.tau_segundos,
        xStart: 0,
        mode: result.modo,
        selected: { time: 0, chargeC: q0C },
      });
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
