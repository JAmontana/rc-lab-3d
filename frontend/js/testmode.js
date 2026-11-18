/**
 * RC LAB 3D — Recorrido integral de demostración (modo Test).
 *
 * Orquesta únicamente la presentación: la fuente sintética del backend sigue
 * adquiriendo y guardando mientras una pausa didáctica congela la escena y las
 * gráficas. Los datos se identifican siempre como SIMULACIÓN.
 */
(function (global) {
  "use strict";

  const API = global.API;
  const FMT = global.FMT;
  const UI = global.UI;

  const SCENARIO_LABELS = {
    completo: "carga + descarga",
    carga: "solo carga",
    descarga: "solo descarga",
  };

  class TestDemoPanel {
    constructor(app) {
      this.app = app;
      this.running = false;
      this.paused = false;
      this.starting = false;
      this._finishing = false;
      this._pauseSource = null;
      this._pausedAt = 0;
      this.deadline = 0;
      this._timer = null;
      this.plan = null;
      this._chargeTau = false;
      this._dischargeTau = false;
      this.bind();
      this.updateButtons();
    }

    $(id) {
      return document.getElementById(id);
    }

    bind() {
      const start = this.$("btn-test-start");
      if (start) start.addEventListener("click", () => this.start());
      const pause = this.$("btn-test-pause");
      if (pause) pause.addEventListener("click", () => this.pause("user"));
      const resume = this.$("btn-test-continue");
      if (resume) resume.addEventListener("click", () => this.resume("user"));
      const reset = this.$("btn-test-reset");
      if (reset) reset.addEventListener("click", () => this.reset());
    }

    selectedScenario() {
      const select = this.$("test-scenario");
      return select && SCENARIO_LABELS[select.value] ? select.value : "completo";
    }

    selectedCeiling() {
      const select = this.$("test-ceiling");
      const value = select ? Number(select.value) : 4.0;
      return Number.isFinite(value) ? Math.min(5, Math.max(0.1, value)) : 4.0;
    }

    setStatus(text, kind) {
      const status = this.$("test-status");
      if (status) {
        status.textContent = text;
        status.className = `test-status${kind ? ` is-${kind}` : ""}`;
      }
    }

    updateProgress(percent) {
      const fill = this.$("test-progress-fill");
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }

    updateButtons() {
      const start = this.$("btn-test-start");
      const pause = this.$("btn-test-pause");
      const resume = this.$("btn-test-continue");
      const scenario = this.$("test-scenario");
      const ceiling = this.$("test-ceiling");
      const busy = this.starting;

      if (start) {
        start.disabled = busy || this.running;
        start.textContent = this.running ? "Demostración en curso" : "Iniciar demostración";
      }
      if (pause) pause.disabled = busy || !this.running || this.paused;
      if (resume) resume.disabled = busy || !this.running || !this.paused;
      if (scenario) scenario.disabled = busy || this.running;
      if (ceiling) ceiling.disabled = busy || this.running;
    }

    async start() {
      if (this.starting || this.running) return;
      this.starting = true;
      this.updateButtons();
      this.setStatus("Preparando emulación sintética…", "wait");
      try {
        await this.stopCurrent(false);
        const scenario = this.selectedScenario();
        const ceiling = this.selectedCeiling();
        const data = await this.app.startSynthetic({
          scenario,
          voltaje_techo_v: ceiling,
          speed: 8,
        });
        this.plan = (data && data.plan) || null;
        this._chargeTau = false;
        this._dischargeTau = false;
        this._pauseSource = null;
        this.paused = false;
        this.running = true;
        const real = this.plan && Number(this.plan.real_duration_s);
        const duration = Number.isFinite(real) && real > 0 ? real : 24;
        this.deadline = performance.now() + (duration + 1.5) * 1000;
        this.updateProgress(0);
        this.app.setPresentationPaused(false);
        const tau = this.plan && Number(this.plan.tau_s);
        this.setStatus(
          `${SCENARIO_LABELS[scenario]} · techo ${FMT.number(ceiling, 1)} V` +
            (Number.isFinite(tau) ? ` · τ = ${FMT.seconds(tau, 2)}` : ""),
          "run"
        );
        await this.ensureSession();
        this._timer = window.setInterval(() => this.tick(), 500);
        UI.toast("Demostración sintética iniciada. La sesión se guardará al terminar.", "info", 5000);
      } catch (error) {
        this.running = false;
        this.setStatus(`No se pudo iniciar: ${error.message || error}`, "error");
        UI.toast(error.message || String(error), "error", 8000);
      } finally {
        this.starting = false;
        this.updateButtons();
      }
    }

    async ensureSession() {
      const summary = this.app._sessionSummary;
      if (summary && summary.active) return;
      const data = await API.startSession();
      if (data && data.session) {
        this.app._sessionSummary = data.session;
        this.app.applySessionStatus(data.session);
      }
    }

    async stopCurrent(saveMessage) {
      if (this._timer) {
        window.clearInterval(this._timer);
        this._timer = null;
      }
      const status = this.app.lastStatus && this.app.lastStatus.serial;
      const active = status && (status.is_synthetic || status.connection_state === "SIMULACION_ACTIVA");
      this.running = false;
      this.paused = false;
      this._pauseSource = null;
      this.app.setPresentationPaused(false);
      this.updateButtons();
      if (active) {
        await this.app.stopSynthetic();
        if (saveMessage !== false) {
          this.setStatus("Demostración detenida · sesión sintética guardada.", "ok");
        }
      } else {
        this.app.refreshStatus();
      }
    }

    async reset() {
      if (this.starting) return;
      this.starting = true;
      this.updateButtons();
      this.setStatus("Reiniciando demostración…", "wait");
      try {
        await this.stopCurrent(false);
        this.app.hideTauModal();
        this.app.store.reset("reinicio_demostracion");
        this.app.charts.clearLive();
        this.app.renderInsight(null);
        if (this.app.resetLiveCaption) this.app.resetLiveCaption();
        const tau = document.getElementById("m-tau");
        if (tau) tau.textContent = "—";
        this.plan = null;
        this._chargeTau = false;
        this._dischargeTau = false;
        this.updateProgress(0);
        this.setStatus("Listo para iniciar una nueva demostración.", "idle");
      } catch (error) {
        this.setStatus(`No se pudo reiniciar: ${error.message || error}`, "error");
      } finally {
        this.starting = false;
        this.updateButtons();
      }
    }

    pause(source) {
      if (!this.running || this.paused) return;
      this.paused = true;
      this._pauseSource = source || "user";
      this._pausedAt = performance.now();
      this.app.setPresentationPaused(true);
      this.setStatus(
        this._pauseSource === "tau"
          ? "Pausa didáctica · la adquisición continúa en segundo plano"
          : "Presentación en pausa · la adquisición continúa en segundo plano",
        "pause"
      );
      this.updateButtons();
    }

    resume(source) {
      if (!this.running || !this.paused) return;
      if (source === "tau" && this._pauseSource !== "tau") return;
      this.paused = false;
      this._pauseSource = null;
      this.deadline += Math.max(0, performance.now() - this._pausedAt);
      this.app.setPresentationPaused(false);
      this.setStatus("Presentación reanudada · los datos no se interrumpieron.", "run");
      this.updateButtons();
    }

    onTau(event) {
      if (!this.running || !event) return;
      if (event.mode === "CARGA") this._chargeTau = true;
      if (event.mode === "DESCARGA") this._dischargeTau = true;
      const point = event.mode === "CARGA" ? "63,2 % de carga" : "36,8 % restante de descarga";
      this.setStatus(`${point} alcanzado · 1τ = ${FMT.seconds(event.time_s, 2)}`, "tau");
      this.pause("tau");
    }

    onSample(sample) {
      if (!this.running || !sample) return;
      const derived = sample.derived || {};
      const pct = Number.isFinite(derived.voltagePct) ? derived.voltagePct : 0;
      this.updateProgress(pct);
      if (this.paused) return;

      const leds = derived.leds || {};
      const lit = [leds.red, leds.amber60, leds.amber90].filter(Boolean).length;
      if (sample.estado === "C") {
        this.setStatus(`Carga · ${FMT.percent(pct, 1)} del techo · ${lit}/3 LEDs`, "run");
      } else if (sample.estado === "D") {
        this.setStatus(`Descarga · ${FMT.percent(pct, 1)} del techo · ${lit}/3 LEDs`, "discharge");
      } else {
        this.setStatus(`Régimen estable · ${FMT.percent(pct, 1)} del techo`, "run");
      }
    }

    tick() {
      if (!this.running) return;
      if (!this.paused && performance.now() >= this.deadline) {
        this.finish();
      }
    }

    async finish() {
      if (this._finishing || !this.running) return;
      this._finishing = true;
      this.setStatus("Recorrido completado · guardando sesión sintética…", "wait");
      try {
        await this.stopCurrent(false);
        this.updateProgress(100);
        this.setStatus(
          "Demostración completada. Sesión guardada: exporta CSV/JSON o consúltala en Sesiones.",
          "ok"
        );
        const exportHint = this.$("test-note");
        if (exportHint) {
          exportHint.textContent =
            "Recorrido completado: conexión simulada, carga, 63,2 %, descarga, 36,8 %, Q/E y ajuste disponibles. " +
            "La sesión sintética ya está guardada y no se mezcla con datos del Arduino.";
        }
        UI.toast("Recorrido de demostración completado y sesión guardada.", "ok", 7000);
        if (this.app.analyzeLatestSynthetic) {
          this.app.analyzeLatestSynthetic();
        }
      } catch (error) {
        this.setStatus(`La demostración terminó con un aviso: ${error.message || error}`, "error");
      } finally {
        this._finishing = false;
        this.updateButtons();
      }
    }
  }

  global.TestDemoPanel = TestDemoPanel;
  if (typeof module !== "undefined" && module.exports) module.exports = { TestDemoPanel };
})(typeof globalThis !== "undefined" ? globalThis : this);
