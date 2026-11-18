/**
 * RC LAB 3D — Simulación teórica independiente.
 *
 * La experiencia gira alrededor de la carga eléctrica:
 *   q(t) = Qmax · (1 − e^(−t/τ)),  Qmax = Ceq · Ve,  τ = R · Ceq
 * El deslizador elige un instante, la gráfica muestra q(t) y los cuatro
 * condensadores 3D se llenan con q(t)/Qmax. Está etiquetada como SIMULACIÓN y
 * nunca crea sesiones ni se mezcla con el flujo serial real.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore;
  const API = global.API;
  const FMT = global.FMT;
  const UI = global.UI;
  const NOMINAL_R = 4700;

  class SimulatorPanel {
    constructor(options = {}) {
      this.onStart = options.onStart || null;
      this.onStop = options.onStop || null;
      this.onTau = options.onTau || null;
      this.charts = options.charts || null;
      this.scene = null;
      this.result = null;
      this.data = null;
      this.chargeModel = null;
      this.selectedTime = 0;
      this.currentCharge = null;
      this.selectedCapIndex = null;
      this._hasApplied = false;
      this.running = false;
      this._raf = null;
      this._startedAt = 0;
      this._tauFired = false;
      this._lastFrame = 0;
      this.speed = 2;
      this._applyTimer = null;
      this.bind();
      this.updateHint();
      this.applyResistanceSource(false);
      // Renderizar la curva q(t) desde el arranque, sin pulsar nada.
      this.applyParameters(true);
    }

    bind() {
      const run = document.getElementById("btn-sim-run");
      if (run) run.addEventListener("click", () => this.run());
      const stop = document.getElementById("btn-sim-stop");
      if (stop) stop.addEventListener("click", () => this.stop(true));
      const apply = document.getElementById("btn-sim-apply");
      if (apply) apply.addEventListener("click", () => this.applyParameters());
      const reset = document.getElementById("btn-sim-reset");
      if (reset) reset.addEventListener("click", () => this.reset());

      ["sim-mode", "sim-r", "sim-rdischarge", "sim-c", "sim-vf", "sim-v0"].forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
          element.addEventListener("input", () => {
            if (id === "sim-r") this.markManualResistance();
            this.updateHint(true);
            this.applyParametersLive();
          });
          element.addEventListener("change", () => {
            this.updateHint(true);
            this.applyParametersLive();
          });
        }
      });

      const source = document.getElementById("sim-r-source");
      if (source) {
        source.addEventListener("change", () => {
          this.applyResistanceSource(true);
          this.updateHint(false);
          this.applyParametersLive();
        });
      }

      const duration = document.getElementById("sim-duration");
      if (duration) duration.addEventListener("change", () => this.updateHint(false));

      const speed = document.getElementById("sim-speed");
      if (speed) {
        speed.addEventListener("change", () => {
          const value = Number(speed.value);
          if (Number.isFinite(value) && value > 0) this.speed = value;
        });
        const initial = Number(speed.value);
        if (Number.isFinite(initial) && initial > 0) this.speed = initial;
      }

      const slider = document.getElementById("sim-time");
      if (slider) {
        slider.addEventListener("input", () => {
          this.pausePlaybackForUser();
          this.setSelectedTime(Number(slider.value), { fromSlider: true });
        });
      }
      const timeInput = document.getElementById("sim-time-input");
      if (timeInput) {
        timeInput.addEventListener("change", () => {
          this.pausePlaybackForUser();
          this.setSelectedTime(Number(timeInput.value));
        });
      }
      if (this.charts && typeof this.charts.bindChargeClick === "function") {
        this.charts.bindChargeClick("chart-sim", (time) => {
          if (!this.chargeModel) return;
          this.pausePlaybackForUser();
          this.setSelectedTime(time);
        });
      }
      const zero = document.getElementById("btn-sim-time-zero");
      if (zero) zero.addEventListener("click", () => {
        this.pausePlaybackForUser();
        this.setSelectedTime(0);
      });
      const tauButton = document.getElementById("btn-sim-time-tau");
      if (tauButton) tauButton.addEventListener("click", () => {
        this.pausePlaybackForUser();
        if (this.chargeModel) this.setSelectedTime(this.chargeModel.tau);
      });

      const help = document.getElementById("btn-q-help");
      if (help) {
        help.addEventListener("click", () => {
          const box = document.getElementById("q-help");
          if (!box) return;
          const hidden = box.classList.toggle("hidden");
          help.setAttribute("aria-expanded", hidden ? "false" : "true");
        });
      }
    }

    markManualResistance() {
      const source = document.getElementById("sim-r-source");
      if (source && source.value !== "manual") source.value = "manual";
    }

    applyResistanceSource(updateValue) {
      const source = document.getElementById("sim-r-source");
      const input = document.getElementById("sim-r");
      if (!source || !input) return;
      const manual = source.value === "manual";
      input.readOnly = !manual;
      input.title = manual
        ? "Resistencia introducida manualmente. Se usa para τ = R · C."
        : "Resistencia nominal de referencia (4,7 kΩ).";
      input.style.opacity = manual ? "1" : "0.78";
      if (!manual && updateValue) input.value = String(NOMINAL_R);
    }

    ensureScene() {
      if (this.scene || !global.RCLab3D) return this.scene;
      this.scene = new global.RCLab3D("scene-sim", {
        simulation: true,
        onSelect: (component) => {
          if (global.RCShowComponent) global.RCShowComponent(component, "sim");
        },
        onCapacitorSelect: (index) => this.showCapacitor(index),
      });
      const data = this.read();
      this.scene.setCapacitance(data.c, this.capacitanceParts(data.c));
      if (this.currentCharge) this.pushSceneState(this.currentCharge);
      return this.scene;
    }

    applyCircuitConfig(summary) {
      if (!summary) return;
      const number = (id) => document.getElementById(id);
      const rCharge = Number(summary.reqCarga);
      const rDischarge = Number(summary.reqDescarga);
      const cFarads = Number(summary.ceq);
      const ve = Number(summary.ve);

      const rInput = number("sim-r");
      if (rInput && rCharge > 0) {
        rInput.value = String(rCharge);
        if (Math.abs(rCharge - NOMINAL_R) > 1e-9) {
          this.markManualResistance();
          this.applyResistanceSource(false);
        }
      }
      const rdInput = number("sim-rdischarge");
      if (rdInput && rDischarge > 0) rdInput.value = String(rDischarge);
      const cInput = number("sim-c");
      if (cInput && cFarads > 0) cInput.value = String(Number((cFarads * 1e6).toFixed(6)));
      const vfInput = number("sim-vf");
      if (vfInput && ve > 0) vfInput.value = String(ve);
      this.capacitancePartsF = Array.isArray(summary.capacitancePartsF)
        ? summary.capacitancePartsF.slice()
        : null;
      this.updateHint(true);
      this.applyParameters(true);
    }

    /** Reparto declarado para las etiquetas y la carga individual del 3D. */
    setCapacitanceParts(parts) {
      this.capacitancePartsF = Array.isArray(parts) && parts.length === 4 ? parts.slice() : null;
      if (this.scene && this.data) {
        this.scene.setCapacitance(this.data.c, this.capacitanceParts(this.data.c));
      }
      this.updateCapNote();
    }

    read() {
      const number = (id) => Number(document.getElementById(id).value);
      const source = document.getElementById("sim-r-source");
      return {
        mode: document.getElementById("sim-mode").value,
        r: number("sim-r"),
        rDischarge: number("sim-rdischarge"),
        c: number("sim-c") * 1e-6,
        vf: number("sim-vf"),
        v0: number("sim-v0"),
        duration: number("sim-duration"),
        rSource: source ? source.value : "nominal",
      };
    }

    effectiveResistance(data) {
      const value = data.mode === "CARGA" ? data.r : data.rDischarge;
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    formatNumber(value, digits = 2) {
      if (!Number.isFinite(value)) return "—";
      return value.toFixed(digits).replace(".", ",");
    }

    setText(id, text) {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    }

    /** Reparto nominal del banco. Es una hipótesis declarada, no una medida. */
    capacitanceParts(totalF) {
      if (!(totalF > 0)) return [0, 0, 0, 0];
      if (Array.isArray(this.capacitancePartsF) && this.capacitancePartsF.length === 4) {
        return this.capacitancePartsF.slice();
      }
      return [totalF / 4, totalF / 4, totalF / 4, totalF / 4];
    }

    updateHint(autoDuration = false) {
      const data = this.read();
      const c = data.c;
      const rCharge = Number(data.r);
      const rDischarge = Number(data.rDischarge);
      const tauCharge = Core.tauOf(rCharge, c);
      const tauDischarge = Core.tauOf(rDischarge, c);
      const tauSelected = this.effectiveResistance(data) !== null
        ? Core.tauOf(this.effectiveResistance(data), c)
        : null;
      const span = data.vf - data.v0;
      const chargePoint = data.v0 + 0.6321205588 * span;
      const dischargePoint = data.v0 + 0.3678794412 * span;
      const fiveTau = Number.isFinite(tauSelected) ? 5 * tauSelected : null;
      const loadMode = data.mode === "CARGA";
      const origin = data.rSource === "manual" ? "manual" : "nominal";
      const rSelected = this.effectiveResistance(data);
      const qMaxC = Core.qMaxC(c, Math.max(Number(data.v0) || 0, Number(data.vf) || 0));

      this.setText("sim-tau-big", Number.isFinite(tauSelected) ? this.formatNumber(tauSelected, 2) : "—");
      this.setText("sim-tau-r", Number.isFinite(rSelected) && rSelected > 0
        ? `${this.formatNumber(rSelected, 0)} Ω · ${loadMode ? origin : "descarga"}`
        : "—");
      this.setText("sim-tau-c", Number.isFinite(c) && c > 0 ? `${this.formatNumber(c, 4)} F` : "—");
      this.setText("sim-tau-5t", Number.isFinite(fiveTau) ? `${this.formatNumber(fiveTau, 1)} s` : "—");
      this.setText("sim-tau-v0", Number.isFinite(data.v0) ? `${this.formatNumber(data.v0, 1)} V` : "—");
      this.setText("sim-tau-vf", Number.isFinite(data.vf) ? `${this.formatNumber(data.vf, 1)} V` : "—");
      this.setText("sim-tau-charge-point", Number.isFinite(chargePoint) ? `${this.formatNumber(chargePoint, 2)} V` : "—");
      this.setText("sim-tau-discharge-point", Number.isFinite(dischargePoint) ? `${this.formatNumber(dischargePoint, 2)} V` : "—");

      this.setText("sim-tau-charge", Number.isFinite(tauCharge) ? `${this.formatNumber(tauCharge, 2)} s` : "—");
      this.setText("sim-tau-discharge", Number.isFinite(tauDischarge) ? `${this.formatNumber(tauDischarge, 2)} s` : "—");
      this.setText("sim-tau-5t-mini", Number.isFinite(fiveTau) ? `${this.formatNumber(fiveTau, 1)} s` : "—");
      this.setText("sim-tau-pct", loadMode ? "63,2 %" : "36,8 %");
      const ref = document.getElementById("sim-tau-ref");
      if (ref) {
        ref.textContent = Number.isFinite(tauSelected)
          ? `${this.formatNumber(tauSelected, 2)} s`
          : "—";
        if (Number.isFinite(tauSelected)) {
          const small = document.createElement("small");
          small.textContent = ` (${this.formatNumber(rSelected, 0)} Ω × ${this.formatNumber(c, 4)} F)`;
          ref.appendChild(small);
        }
      }
      this.setText("sq-qmax", qMaxC > 0 ? `${this.formatNumber(qMaxC * 1000, 2)} mC` : "—");
      this.setText("sq-tau", Number.isFinite(tauSelected) ? `${this.formatNumber(tauSelected, 2)} s` : "—");

      const formula = document.getElementById("sim-charge-formula");
      if (formula) {
        const diff = Math.abs((Number(data.vf) || 0) - (Number(data.v0) || 0));
        if (loadMode) {
          formula.innerHTML = "q(t) = Qmax · (1 − e<sup>−t/τ</sup>) · Qmax = C<sub>eq</sub> · V<sub>f</sub>";
        } else if (Number(data.vf) > 1e-6 && diff > 1e-9) {
          formula.innerHTML = "q(t) = Q∞ + (Q₀ − Q∞) · e<sup>−t/τ</sup> · descarga al equilibrio";
        } else {
          formula.innerHTML = "q(t) = Q₀ · e<sup>−t/τ</sup> · Q₀ = C<sub>eq</sub> · V₀";
        }
      }

      if (autoDuration) {
        const duration = document.getElementById("sim-duration");
        if (duration && Number.isFinite(tauSelected) && tauSelected > 0) {
          duration.value = Math.max(1, Math.min(100000, Math.round(5 * tauSelected)));
        }
      }
    }

    async run() {
      const data = this.read();
      const rEff = this.effectiveResistance(data);
      if (!(rEff > 0) || !(data.c > 0) || !(data.duration > 0)) {
        UI.toast("Revisa R (según el tipo de evento), C y la duración: deben ser mayores que cero.", "warning");
        return;
      }
      if (data.mode === "CARGA" && !(data.vf > data.v0)) {
        UI.toast("En carga, el voltaje techo debe ser mayor que el voltaje inicial.", "warning");
        return;
      }
      if (data.mode === "DESCARGA" && !(data.vf < data.v0)) {
        UI.toast("En descarga, el voltaje final debe ser menor que el voltaje inicial.", "warning");
        return;
      }

      const runButton = document.getElementById("btn-sim-run");
      if (runButton) { runButton.disabled = true; runButton.textContent = "Calculando…"; }
      try {
        const result = await API.simulate({
          modo: data.mode,
          r_ohm: rEff,
          c_farad: data.c,
          v_inicial: data.v0,
          v_final: data.vf,
          t_final: data.duration,
          num_puntos: 1200,
        });
        if (!result.valido) {
          UI.toast(result.error || "La simulación no es válida.", "error");
          return;
        }
        this.result = result;
        this.result.capacitance_f = data.c;
        this.result.mode = data.mode;
        this.data = data;
        this._tauFired = false;
        this.buildChargeModel(data);
        this.selectedTime = 0;
        this.renderChargeChart();
        this.setSelectedTime(0, { silent: true });
        this.ensureScene();
        this.startPlayback();
        const tag = document.getElementById("sim-tau-tag");
        if (tag) tag.textContent = `τ = ${this.formatNumber(result.tau_segundos, 2)} s`;
        UI.toast("Simulación iniciada. Los datos están identificados como SIMULACIÓN.", "info");
      } catch (error) {
        UI.toast(error.message, "error");
      } finally {
        if (runButton) { runButton.disabled = false; runButton.textContent = "Reproducir en 3D"; }
      }
    }

    /**
     * Aplica los parámetros sin iniciar la reproducción: recalcula τ, Qmax y
     * redibuja la curva q(t). El usuario puede después elegir un instante.
     */
    async applyParameters(silent = false) {
      const data = this.read();
      const rEff = this.effectiveResistance(data);
      if (!(rEff > 0) || !(data.c > 0) || !(data.duration > 0)) {
        if (!silent) UI.toast("Revisa R (según el tipo de evento), C y la duración: deben ser mayores que cero.", "warning");
        return;
      }
      this.updateHint(false);
      try {
        const result = await API.simulate({
          modo: data.mode,
          r_ohm: rEff,
          c_farad: data.c,
          v_inicial: data.v0,
          v_final: data.vf,
          t_final: data.duration,
          num_puntos: 1200,
        });
        if (!result.valido) {
          if (!silent) UI.toast(result.error || "La simulación no es válida.", "error");
          return;
        }
        this.result = result;
        this.result.capacitance_f = data.c;
        this.result.mode = data.mode;
        this.data = data;
        this.buildChargeModel(data);
        const maxTime = 5 * this.chargeModel.tau;
        if (this.scene) this.scene.setCapacitance(data.c, this.capacitanceParts(data.c));
        if (!this._hasApplied) {
          // Primer arranque: mostrar directamente el punto didáctico de 1τ.
          this.selectedTime = this.chargeModel.tau;
          this._hasApplied = true;
        }
        this.selectedTime = Core.clamp(this.selectedTime, 0, maxTime);
        this.renderChargeChart();
        this.setSelectedTime(this.selectedTime, { silent: true });
        const tag = document.getElementById("sim-tau-tag");
        if (tag) tag.textContent = `τ = ${this.formatNumber(result.tau_segundos, 2)} s`;
        if (!silent) UI.toast("Parámetros aplicados: q(t), Qmax y τ actualizados.", "ok");
      } catch (error) {
        if (!silent) UI.toast(error.message, "error");
      }
    }

    buildChargeModel(data) {
      const tau = Number(this.result && this.result.tau_segundos);
      if (!(tau > 0)) { this.chargeModel = null; return; }
      // Para la carga, Qmax = C · Vf. Para la descarga, la referencia de llenado
      // es la carga inicial Q0 = C · V0 (el nivel alto del evento).
      const vHigh = Math.max(data.v0, data.vf);
      const qMaxC = Core.qMaxC(data.c, vHigh);
      const q0C = data.c * data.v0;
      const qInfC = data.mode === "DESCARGA" ? data.c * data.vf : qMaxC;
      const xEnd = 5 * tau;
      const steps = 320;
      const times = [];
      const chargesC = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = (xEnd * i) / steps;
        times.push(t);
        chargesC.push(Core.chargeAtTimeGeneralC(t, q0C, qInfC, tau));
      }
      this.chargeModel = {
        times,
        chargesC,
        qMaxC,
        q0C,
        qInfC,
        tau,
        c: data.c,
        ceiling: vHigh,
        xStart: 0,
        mode: data.mode,
        source: "SIMULACIÓN",
      };
    }

    chargeAt(time) {
      if (!this.chargeModel) return 0;
      return Core.chargeAtTimeGeneralC(
        time,
        this.chargeModel.q0C,
        this.chargeModel.qInfC,
        this.chargeModel.tau
      );
    }

    chartModel() {
      if (!this.chargeModel) return null;
      return Object.assign({}, this.chargeModel, {
        selected: {
          time: this.selectedTime,
          chargeC: this.chargeAt(this.selectedTime),
        },
      });
    }

    renderChargeChart() {
      if (!this.charts) return;
      this.charts.plotCharge("chart-sim", this.chartModel());
    }

    currentFractions(voltage) {
      const parts = this.capacitanceParts(this.data ? this.data.c : 0);
      const ceiling = this.data ? Math.max(this.data.v0, this.data.vf) : 0;
      return parts.map((ci) => {
        const max = ci * ceiling;
        return max > 0 ? Core.clamp((ci * voltage) / max, 0, 1) : 0;
      });
    }

    pushSceneState(charge) {
      if (!this.scene || !charge) return;
      const parts = this.capacitanceParts(this.data ? this.data.c : 0);
      const perCapacitorC = parts.map((ci) => ci * charge.voltage);
      const perCapacitorMaxC = parts.map((ci) => ci * charge.ceiling);
      this.scene.setChargeState({
        level: charge.level,
        qTotalC: charge.qC,
        qMaxC: charge.qMaxC,
        perCapacitorC,
        perCapacitorMaxC,
        perCapacitorFraction: charge.fractions,
        voltage: charge.voltage,
        ceiling: charge.ceiling,
        mode: this.data ? (this.data.mode === "DESCARGA" ? "D" : "C") : "C",
      });
    }

    /** Cambia el instante seleccionado y sincroniza gráfica, HUD y 3D. */
    setSelectedTime(time, options = {}) {
      if (!this.chargeModel) return;
      const tau = this.chargeModel.tau;
      const maxTime = 5 * tau;
      const t = Core.clamp(Number(time) || 0, 0, maxTime);
      this.selectedTime = t;
      const qC = this.chargeAt(t);
      const base = this.chargeModel.mode === "DESCARGA" ? this.chargeModel.q0C : this.chargeModel.qMaxC;
      const pct = base > 0 ? Core.clamp((qC / base) * 100, 0, 100) : 0;
      const voltage = this.data && this.data.c > 0 ? qC / this.data.c : 0;
      const fractions = this.currentFractions(voltage);
      const level = this.chargeModel.qMaxC > 0
        ? Core.clamp(qC / this.chargeModel.qMaxC, 0, 1)
        : 0;
      this.currentCharge = {
        time: t,
        qC,
        pct,
        level,
        voltage,
        ceiling: this.data ? Math.max(this.data.v0, this.data.vf) : 0,
        qMaxC: this.chargeModel.qMaxC,
        tau,
        fractions,
      };

      this.updateChargeHud(qC, pct, tau, this.chargeModel.qMaxC);
      this.updateCheckStrip(t, qC, pct, voltage);
      this.updateCalcPanel();
      this.setText("sq-time", `${this.formatNumber(t, 2)} s`);
      this.pushSceneState(this.currentCharge);
      this.updateReadouts(voltage);
      this.updateCapNote();
      if (this.charts && !options.skipChart) {
        this.charts.updateChargeMarker("chart-sim", this.chartModel());
      }

      const slider = document.getElementById("sim-time");
      if (slider && !options.fromSlider) {
        slider.max = String(maxTime);
        slider.step = String(Math.max(0.001, maxTime / 600));
        slider.value = String(t);
      } else if (slider && options.fromSlider) {
        slider.max = String(maxTime);
        slider.step = String(Math.max(0.001, maxTime / 600));
      }
      const input = document.getElementById("sim-time-input");
      if (input) {
        input.max = String(maxTime);
        input.value = t.toFixed(2);
      }
    }

    updateChargeHud(qC, pct, tau, qMaxC) {
      this.setText("sq-total", this.formatNumber(qC * 1000, 2));
      this.setText("sq-percent", `${this.formatNumber(pct, 1)} % ${this.chargeModel && this.chargeModel.mode === "DESCARGA" ? "de Q₀" : "de Qmax"}`);
      this.setText("sq-tau", this.formatNumber(tau, 2) + " s");
      this.setText("sq-qmax", this.formatNumber(qMaxC * 1000, 2) + " mC");
    }

    /**
     * Verificación del punto seleccionado con los despejes del profesor.
     * En simulación el punto pertenece a la curva, así que el tiempo
     * recalculado debe coincidir con el instante y τ con R·C.
     */
    updateCheckStrip(t, qC, pct, voltage) {
      if (!this.chargeModel) return;
      const model = this.chargeModel;
      const qMaxC = model.qMaxC;
      const q0C = model.q0C;
      const qInfC = model.qInfC;
      const discharge = String(model.mode || "CARGA").toUpperCase() === "DESCARGA";
      const tauEst = discharge
        ? Core.tauFromPointDecayC(t, qC, q0C, qInfC)
        : Core.tauFromPointChargeC(t, qC, qMaxC, q0C);
      const tCalc = discharge
        ? Core.timeForDecayC(model.tau, qC, q0C, qInfC)
        : Core.timeForChargeC(model.tau, qC, qMaxC, q0C);
      this.setText("sc-volt", `${this.formatNumber(voltage, 2)} V`);
      this.setText("sc-q", `${this.formatNumber(qC * 1000, 2)} mC`);
      this.setText("sc-pct", `${this.formatNumber(pct, 1)} %`);
      this.setText("sc-tauest", tauEst !== null ? `${this.formatNumber(tauEst, 2)} s` : "—");
      this.setText("sc-timecalc", tCalc !== null ? `${this.formatNumber(tCalc, 2)} s` : "—");
      const note = document.getElementById("sc-note");
      if (note) {
        note.textContent = (tauEst === null || tCalc === null)
          ? "Sin estimación válida en este punto: t = 0, q = 0 o q = Qmax quedan fuera del dominio del despeje."
          : "Comprobación: el tiempo recalculado debe coincidir con el instante y τ estimado con R · C.";
      }
    }

    /**
     * Panel «Comprueba el cálculo» de la simulación. Usa exactamente los mismos
     * parámetros y el mismo instante que la gráfica y los cuatro condensadores.
     * Los resultados se identifican siempre como SIMULACIÓN — DATOS SINTÉTICOS.
     */
    updateCalcPanel() {
      const Calc = global.RCCalc;
      const model = this.chargeModel;
      const data = this.data;
      if (!Calc || !model || !data) return;
      const r = this.effectiveResistance(data);
      const vHigh = Math.max(Number(data.v0) || 0, Number(data.vf) || 0);
      const t = Number(this.selectedTime) || 0;
      const qC = this.chargeAt(t);
      const discharge = String(model.mode || "CARGA").toUpperCase() === "DESCARGA";
      Calc.update("calc-sim", {
        r,
        rCharge: data.r,
        rDischarge: data.rDischarge,
        c: data.c,
        ve: vHigh,
        v0: data.v0,
        t,
        qC,
        qMaxC: model.qMaxC,
        q0C: model.q0C,
        qInfC: model.qInfC,
        mode: model.mode,
        tau: model.tau,
        nominal: true,
        synthetic: true,
        measured: null,
        summary: null,
        componentsText: "Valores del modelo de simulación (no componentes físicos)",
        source: "SIMULACIÓN — DATOS SINTÉTICOS",
        rNote: discharge ? "resistencia de descarga del modelo" : "resistencia de carga del modelo",
        v0Note: "voltaje inicial del modelo",
        veNote: discharge ? "voltaje inicial del modelo" : "voltaje techo del modelo",
      });
    }

    updateReadouts(voltage) {
      if (!this.data) return;
      const c = this.data.c;
      const vf = this.data.vf;
      const energy = Core.energyJ(c, voltage);
      const refEnergy = Core.energyJ(c, Math.max(vf, 0.001));
      const energyPct = refEnergy > 0 ? Core.clamp((energy / refEnergy) * 100, 0, 100) : 0;
      this.setText("sim-energy", FMT.number(energy, 4));
      this.setText("sim-energy-pct", FMT.percent(energyPct, 1));
      this.setText("sim-energy-ref", `Ref.: ${FMT.number(refEnergy, 4)} J`);
      const fill = document.getElementById("sim-energy-fill");
      if (fill) fill.style.width = `${energyPct}%`;
      const states = [
        ["sim-led-30", voltage >= vf * 0.30],
        ["sim-led-60", voltage >= vf * 0.60],
        ["sim-led-90", voltage >= vf * 0.90],
      ];
      states.forEach(([id, on]) => {
        const element = document.getElementById(id);
        if (element) element.classList.toggle("is-on", Boolean(on));
      });
    }

    /** Describe el reparto nominal vigente sin afirmar igualdad si no la hay. */
    capacitanceSummary() {
      const totalF = this.data ? this.data.c : this.read().c;
      const parts = this.capacitanceParts(totalF);
      const micro = (value) => this.formatNumber((Number(value) || 0) * 1e6, 0);
      const equal = parts.every((value) => Math.abs(value - parts[0]) < 1e-15);
      return equal
        ? `4 × ${micro(parts[0])} µF en paralelo`
        : parts.map((value, index) => `C${index + 1} = ${micro(value)} µF`).join(" · ");
    }

    updateCapNote() {
      const note = document.getElementById("sim-cap-note");
      if (!note) return;
      const fallback = `Hipótesis nominal: ${this.capacitanceSummary()}. Clic en un condensador para ver su carga individual.`;
      if (!this.currentCharge) {
        note.textContent = fallback;
        return;
      }
      const parts = this.capacitanceParts(this.data ? this.data.c : 0);
      if (this.selectedCapIndex !== null) {
        const index = this.selectedCapIndex;
        const ci = parts[index];
        const qi = ci * this.currentCharge.voltage;
        const qmaxi = ci * this.currentCharge.ceiling;
        const pct = qmaxi > 0 ? (qi / qmaxi) * 100 : 0;
        note.textContent = `C${index + 1} · ${this.formatNumber(ci * 1e6, 0)} µF (nominal) · q${index + 1} = ${this.formatNumber(qi * 1000, 2)} mC · ${this.formatNumber(pct, 1)} % de su Qmax.`;
      } else {
        note.textContent = fallback;
      }
    }

    showCapacitor(index) {
      this.selectedCapIndex = index;
      this.updateCapNote();
      if (!this.currentCharge) return;
      const parts = this.capacitanceParts(this.data ? this.data.c : 0);
      const ci = Number(parts[index]) || 0;
      const qi = ci * this.currentCharge.voltage;
      const qmaxi = ci * this.currentCharge.ceiling;
      const pct = qmaxi > 0 ? Core.clamp((qi / qmaxi) * 100, 0, 100) : 0;
      UI.toast(
        `C${index + 1}: q${index + 1} = ${this.formatNumber(qi * 1000, 2)} mC ` +
          `(${this.formatNumber(pct, 1)} % de su Qmax) · hipótesis nominal ${this.formatNumber(ci * 1e6, 0)} µF.`,
        "info",
        5000
      );
    }

    applyParametersLive() {
      if (this._applyTimer) window.clearTimeout(this._applyTimer);
      this._applyTimer = window.setTimeout(() => {
        this._applyTimer = null;
        this.applyParameters(true);
      }, 260);
    }

    pausePlaybackForUser() {
      if (this.running) this.stop(false, true);
    }

    /**
     * Detiene la reproducción y devuelve la escena al instante 0. No altera
     * la telemetría ni las sesiones.
     */
    reset() {
      if (this.running) this.stop(false, true);
      this.selectedTime = 0;
      this.selectedCapIndex = null;
      if (this.chargeModel) {
        this.setSelectedTime(0, { silent: true });
      } else {
        this.setText("sq-time", "0.00 s");
        this.setText("sq-total", "0.00");
        this.setText("sq-percent", "0,0 % de Qmax");
        const scene = this.ensureScene();
        if (scene) {
          const high = this.data ? Math.max(this.data.v0, this.data.vf) : 0;
          scene.setChargeState({
            level: 0, qTotalC: 0, qMaxC: Core.qMaxC(this.data ? this.data.c : 0, high),
            perCapacitorC: [0, 0, 0, 0], perCapacitorFraction: [0, 0, 0, 0],
            voltage: this.data ? this.data.v0 : 0, ceiling: high,
            mode: this.data ? (this.data.mode === "DESCARGA" ? "D" : "C") : "C",
          });
        }
      }
      const stale = document.getElementById("sim-scene-stale");
      if (stale) stale.classList.add("hidden");
      this.updateCapNote();
      UI.toast("Simulación reiniciada al instante 0 s.", "ok");
    }

    startPlayback() {
      this.stop(false, true);
      this.running = true;
      this._startedAt = performance.now();
      this._lastFrame = 0;
      const stopButton = document.getElementById("btn-sim-stop");
      const runButton = document.getElementById("btn-sim-run");
      if (stopButton) stopButton.classList.remove("hidden");
      if (runButton) runButton.classList.add("hidden");
      const stale = document.getElementById("sim-scene-stale");
      if (stale) stale.classList.add("hidden");
      if (this.onStart) this.onStart();
      const loop = () => {
        if (!this.running) return;
        this._raf = requestAnimationFrame(loop);
        const elapsed = ((performance.now() - this._startedAt) / 1000) * this.speed;
        const endTime = this.chargeModel && this.chargeModel.times.length
          ? this.chargeModel.times[this.chargeModel.times.length - 1]
          : this.result.tiempo[this.result.tiempo.length - 1];
        if (elapsed >= endTime) {
          this.applyAt(endTime);
          this.stop(true);
          UI.toast("Simulación completada (5τ).", "ok");
          return;
        }
        if (elapsed - this._lastFrame >= 0.04) {
          this._lastFrame = elapsed;
          this.applyAt(elapsed);
        }
      };
      this._raf = requestAnimationFrame(loop);
    }

    applyAt(time) {
      if (!this.chargeModel) return;
      this.setSelectedTime(time);
      if (!this._tauFired && Number(time) >= this.chargeModel.tau) {
        this._tauFired = true;
        if (this.onTau) {
          const mode = this.chargeModel.mode;
          const tau = this.chargeModel.tau;
          const qAtTau = this.chargeAt(tau);
          this.onTau({
            mode,
            time_s: tau,
            absolute_time_s: tau,
            voltage_v: this.currentCharge ? this.currentCharge.voltage : 0,
            threshold_v: this.currentCharge ? this.currentCharge.voltage : 0,
            charge_c: qAtTau,
            percent: mode === "CARGA" ? Core.TAU_CHARGE_FACTOR * 100 : Core.TAU_DISCHARGE_FACTOR * 100,
            v0_v: this.data.v0,
            vf_v: this.data.vf,
            provisional: false,
            confirmed: true,
            origin: "SIMULACION",
          }, true);
        }
      }
    }

    updateChartMarker(time) {
      if (!this.charts || !this.chargeModel) return;
      this.selectedTime = time;
      this.charts.updateChargeMarker("chart-sim", this.chartModel());
    }

    stop(notify = false, silent = false) {
      this.running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
      const stopButton = document.getElementById("btn-sim-stop");
      const runButton = document.getElementById("btn-sim-run");
      if (stopButton) stopButton.classList.add("hidden");
      if (runButton) runButton.classList.remove("hidden");
      const stale = document.getElementById("sim-scene-stale");
      if (stale) stale.classList.add("hidden");
      if (!silent && this.onStop) this.onStop();
      if (notify) UI.toast("Simulación detenida.", "info");
    }
  }

  global.SimulatorPanel = SimulatorPanel;
})(typeof globalThis !== "undefined" ? globalThis : this);
