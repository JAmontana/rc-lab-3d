/**
 * RC LAB 3D — Simulación teórica independiente.
 *
 * Reproduce la curva RC ideal en la escena 3D y en la gráfica. Está etiquetada
 * permanentemente como SIMULACIÓN y nunca crea sesiones ni se mezcla con el
 * flujo serial real.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore;
  const API = global.API;
  const FMT = global.FMT;
  const UI = global.UI;

  class SimulatorPanel {
    constructor(options = {}) {
      this.onStart = options.onStart || null;
      this.onStop = options.onStop || null;
      this.onTau = options.onTau || null;
      this.charts = options.charts || null;
      this.scene = null;
      this.result = null;
      this.running = false;
      this._raf = null;
      this._startedAt = 0;
      this._tauFired = false;
      this._lastFrame = 0;
      this.speed = 2;
      this.current = null;
      this.bind();
      this.updateHint();
    }

    bind() {
      const run = document.getElementById("btn-sim-run");
      if (run) run.addEventListener("click", () => this.run());
      const stop = document.getElementById("btn-sim-stop");
      if (stop) stop.addEventListener("click", () => this.stop(true));
      ["sim-mode", "sim-r", "sim-c", "sim-vf", "sim-v0"].forEach((id) => {
        const element = document.getElementById(id);
        if (element) {
          element.addEventListener("input", () => this.updateHint(true));
          element.addEventListener("change", () => this.updateHint(true));
        }
      });
      const duration = document.getElementById("sim-duration");
      if (duration) duration.addEventListener("change", () => this.updateHint(false));
    }

    ensureScene() {
      if (this.scene || !global.RCLab3D) return this.scene;
      this.scene = new global.RCLab3D("scene-sim", {
        simulation: true,
        onSelect: (component) => {
          if (global.RCShowComponent) global.RCShowComponent(component, "sim");
        },
      });
      return this.scene;
    }

    read() {
      const number = (id) => Number(document.getElementById(id).value);
      return {
        mode: document.getElementById("sim-mode").value,
        r: number("sim-r"),
        c: number("sim-c"),
        vf: number("sim-vf"),
        v0: number("sim-v0"),
        duration: number("sim-duration"),
      };
    }

    updateHint(autoDuration = false) {
      const data = this.read();
      const tau = data.r * data.c;
      const hint = document.getElementById("sim-tau-hint");
      if (hint && Number.isFinite(tau) && tau > 0) {
        hint.textContent = `τ = ${FMT.seconds(tau, 2)} · 1τ = ${FMT.seconds(tau, 2)} · 5τ ≈ ${FMT.seconds(5 * tau, 1)}`;
      } else if (hint) {
        hint.textContent = "Completa R y C con valores positivos.";
      }
      if (autoDuration) {
        const duration = document.getElementById("sim-duration");
        if (duration && Number.isFinite(tau) && tau > 0) {
          duration.value = Math.max(1, Math.min(100000, Math.round(5 * tau)));
        }
      }
    }

    async run() {
      const data = this.read();
      if (!(data.r > 0) || !(data.c > 0) || !(data.duration > 0)) {
        UI.toast("Revisa R, C y la duración: deben ser mayores que cero.", "warning");
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
          r_ohm: data.r,
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
        this._tauFired = false;
        this.charts.plotSimulation(result);
        this.ensureScene();
        this.startPlayback();
        const tag = document.getElementById("sim-tau-tag");
        if (tag) tag.textContent = `τ = ${FMT.seconds(result.tau_segundos, 2)}`;
        const what = document.getElementById("sim-what");
        if (what) {
          what.textContent = `Reproducción a ×${this.speed} del modelo ${data.mode.toLowerCase()} con R = ${data.r} Ω y C = ${data.c} F. La curva es ideal: no incluye tolerancias ni el control activo.`;
        }
        UI.toast("Simulación iniciada. Los datos están identificados como SIMULACIÓN.", "info");
      } catch (error) {
        UI.toast(error.message, "error");
      } finally {
        if (runButton) { runButton.disabled = false; runButton.textContent = "Reproducir en 3D"; }
      }
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
        if (elapsed >= this.result.tiempo[this.result.tiempo.length - 1]) {
          this.applyAt(this.result.tiempo[this.result.tiempo.length - 1]);
          this.stop(true);
          UI.toast("Simulación completada.", "ok");
          return;
        }
        if (elapsed - this._lastFrame >= 0.04) {
          this._lastFrame = elapsed;
          this.applyAt(elapsed);
        }
      };
      this._raf = requestAnimationFrame(loop);
    }

    sampleAt(time) {
      const xs = this.result.tiempo;
      const ys = this.result.voltaje;
      if (time <= xs[0]) return ys[0];
      if (time >= xs[xs.length - 1]) return ys[ys.length - 1];
      let low = 0;
      let high = xs.length - 1;
      while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (xs[mid] <= time) low = mid; else high = mid;
      }
      const span = xs[high] - xs[low];
      const fraction = span > 0 ? (time - xs[low]) / span : 0;
      return ys[low] + (ys[high] - ys[low]) * fraction;
    }

    applyAt(time) {
      if (!this.result) return;
      const voltage = this.sampleAt(time);
      const v0 = this.result.v_inicial;
      const vf = this.result.v_final;
      const c = this.result.capacitance_f;
      const mode = this.result.mode;
      const tolerance = 0.01;
      let state = "S";
      if (mode === "CARGA" && voltage < vf - tolerance) state = "C";
      if (mode === "DESCARGA" && voltage > vf + tolerance) state = "D";

      const pwm = mode === "DESCARGA" && time < 0.8 ? Math.max(0, 255 - Math.floor(time / 0.015) * 5) : 0;
      const gain = 1470 / 470;
      const adc = Math.round(Math.min(5, Math.max(0, voltage / gain)) / 5 * 1023);
      const sample = {
        voltaje_tanque: voltage,
        voltaje_techo: vf,
        estado: state,
        device_time_ms: Math.round(time * 1000),
        pwm,
        adc_a0: adc,
        adc_a1: 0,
        origen: "SIMULACION",
      };
      sample.derived = {
        voltage,
        ceiling: vf,
        voltagePct: vf > 0 ? (voltage / vf) * 100 : 0,
        energyJ: Core.energyJ(c, voltage),
        refEnergyJ: Core.energyJ(c, Math.max(vf, 0.001)),
        energyPct: vf > 0 ? Core.clamp((voltage * voltage) / (vf * vf) * 100, 0, 100) : 0,
        chargeC: Core.chargeC(c, voltage),
        leds: {
          red: voltage >= vf * 0.30,
          amber60: voltage >= vf * 0.60,
          amber90: voltage >= vf * 0.90,
        },
      };
      this.current = sample;
      if (this.scene) this.scene.updateFromSample(sample);
      this.updateReadouts(sample);
      this.updateChartMarker(time, voltage);

      if (!this._tauFired && time >= this.result.tau_segundos) {
        this._tauFired = true;
        if (this.onTau) {
          this.onTau({
            mode,
            time_s: this.result.tau_segundos,
            absolute_time_s: this.result.tau_segundos,
            voltage_v: this.result.punto_tau.voltage_v,
            threshold_v: this.result.punto_tau.voltage_v,
            percent: this.result.punto_tau.percent || (mode === "CARGA" ? Core.TAU_CHARGE_FACTOR * 100 : Core.TAU_DISCHARGE_FACTOR * 100),
            v0_v: v0,
            vf_v: vf,
            provisional: false,
            confirmed: true,
            origin: "SIMULACION",
          }, true);
        }
      }
    }

    updateReadouts(sample) {
      const d = sample.derived;
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("sim-energy", FMT.number(d.energyJ, 4));
      set("sim-energy-pct", FMT.percent(d.energyPct, 1));
      set("sim-energy-ref", `Ref.: ${FMT.number(d.refEnergyJ, 4)} J`);
      const fill = document.getElementById("sim-energy-fill");
      if (fill) fill.style.width = `${Core.clamp(d.energyPct, 0, 100)}%`;
      const states = [["sim-led-30", d.leds.red], ["sim-led-60", d.leds.amber60], ["sim-led-90", d.leds.amber90]];
      states.forEach(([id, on]) => {
        const element = document.getElementById(id);
        if (element) element.classList.toggle("is-on", Boolean(on));
      });
    }

    updateChartMarker(time, voltage) {
      if (!this.charts || !this.result) return;
      try {
        Plotly.update("chart-sim", { 2: { x: [time], y: [voltage] } });
      } catch (error) { /* gráfica aún no lista */ }
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
      if (stale) stale.classList.remove("hidden");
      if (this.scene) this.scene.setStale(true);
      if (!silent && this.onStop) this.onStop();
      if (notify) UI.toast("Simulación detenida.", "info");
    }
  }

  global.SimulatorPanel = SimulatorPanel;
})(typeof globalThis !== "undefined" ? globalThis : this);
