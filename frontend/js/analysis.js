/**
 * RC LAB 3D — Panel de análisis científico.
 * Configura parámetros, ejecuta el ajuste y presenta resultados con advertencias
 * explícitas cuando el modelo ideal no describe los datos.
 */
(function (global) {
  "use strict";

  const API = global.API;
  const FMT = global.FMT;
  const UI = global.UI;

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  class AnalysisPanel {
    constructor(store, charts, options = {}) {
      this.store = store;
      this.charts = charts;
      this.onRequestSessions = options.onRequestSessions || null;
      this.config = null;
      this.lastResult = null;
      this.lastSessionId = null;
      this.bind();
    }

    bind() {
      const save = document.getElementById("btn-config-save");
      if (save) save.addEventListener("click", () => this.saveConfig(true));
      const run = document.getElementById("btn-analysis-run");
      if (run) run.addEventListener("click", () => this.runCurrent());
      const session = document.getElementById("btn-analysis-session");
      if (session) session.addEventListener("click", () => {
        if (this.onRequestSessions) this.onRequestSessions();
        UI.toast("Selecciona una sesión del historial para analizarla.", "info");
      });

      ["cfg-c", "cfg-rcharge", "cfg-rdischarge", "cfg-vref", "cfg-tol-r", "cfg-tol-c", "cfg-tol-vref"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) input.addEventListener("change", () => this.updateTauHint());
      });
    }

    async loadConfig() {
      try {
        const data = await API.getConfig();
        this.applyConfig(data.config || {});
      } catch (error) {
        console.warn(error);
        UI.toast(error.message, "error");
      }
    }

    applyConfig(config) {
      this.config = config;
      const set = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value === null || value === undefined ? "" : value;
      };
      set("cfg-c", config.capacitancia_f);
      set("cfg-rcharge", config.resistencia_carga_ohm);
      set("cfg-rdischarge", config.resistencia_descarga_ohm);
      set("cfg-vref", config.vref_v);
      set("cfg-tol-r", config.tolerancia_r_pct);
      set("cfg-tol-c", config.tolerancia_c_pct);
      set("cfg-tol-vref", config.tolerancia_vref_pct);
      if (Number.isFinite(Number(config.capacitancia_f))) this.store.setCapacitance(config.capacitancia_f);
      this.updateTauHint();
    }

    readConfig() {
      const value = (id) => {
        const input = document.getElementById(id);
        if (!input || input.value === "") return null;
        const parsed = Number(input.value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      return {
        capacitancia_f: value("cfg-c"),
        resistencia_carga_ohm: value("cfg-rcharge"),
        resistencia_descarga_ohm: value("cfg-rdischarge"),
        vref_v: value("cfg-vref"),
        tolerancia_r_pct: value("cfg-tol-r"),
        tolerancia_c_pct: value("cfg-tol-c"),
        tolerancia_vref_pct: value("cfg-tol-vref"),
      };
    }

    async saveConfig(notify = true) {
      const payload = this.readConfig();
      try {
        const data = await API.saveConfig(payload);
        this.applyConfig(data.config || {});
        if (notify) UI.toast("Parámetros del circuito guardados.", "ok");
        return data;
      } catch (error) {
        UI.toast(error.message, "error");
        throw error;
      }
    }

    updateTauHint() {
      const hint = document.getElementById("config-hint");
      if (!hint) return;
      const config = this.readConfig();
      const c = Number(config.capacitancia_f);
      const rCharge = Number(config.resistencia_carga_ohm);
      const rDischarge = Number(config.resistencia_descarga_ohm);
      const parts = [];
      if (c > 0 && rCharge > 0) parts.push(`τ de carga nominal: ${FMT.seconds(rCharge * c, 2)}`);
      if (c > 0 && rDischarge > 0) parts.push(`τ de descarga declarado: ${FMT.seconds(rDischarge * c, 2)}`);
      if (parts.length === 0) parts.push("Completa C y R para calcular τ teórico.");
      if (!Number.isFinite(rDischarge) || rDischarge <= 0) parts.push("La resistencia de descarga no está verificada.");
      hint.textContent = parts.join(" · ");
    }

    interval() {
      const start = document.getElementById("analysis-start");
      const end = document.getElementById("analysis-end");
      return {
        start_s: start && start.value !== "" ? Number(start.value) : null,
        end_s: end && end.value !== "" ? Number(end.value) : null,
      };
    }

    setStatus(message, kind = "") {
      const element = document.getElementById("analysis-status");
      if (!element) return;
      element.textContent = message;
      element.className = `analysis-status${kind ? ` is-${kind}` : ""}`;
    }

    async runCurrent() {
      this.setStatus("Analizando los datos actuales…");
      try {
        await this.saveConfig(false);
        const range = this.interval();
        const result = await API.analyze({
          session_id: null,
          start_s: range.start_s,
          end_s: range.end_s,
        });
        this.render(result, null);
      } catch (error) {
        this.setStatus(error.message, "error");
        UI.toast(error.message, "error");
      }
    }

    async analyzeSession(sessionId) {
      this.setStatus(`Analizando la sesión ${sessionId}…`);
      try {
        const range = this.interval();
        const result = await API.analyze({
          session_id: sessionId,
          start_s: range.start_s,
          end_s: range.end_s,
        });
        this.render(result, sessionId);
        UI.toast("Sesión analizada. Revisa las gráficas y advertencias.", "ok");
      } catch (error) {
        this.setStatus(error.message, "error");
        UI.toast(error.message, "error");
      }
    }

    render(result, sessionId) {
      this.lastResult = result;
      this.lastSessionId = sessionId;
      const warningsBox = document.getElementById("analysis-warnings");
      if (warningsBox) warningsBox.innerHTML = "";

      if (!result || !result.valido) {
        const reason = (result && result.motivo) || "No hay datos suficientes para analizar.";
        this.setStatus(reason, "error");
        this.resetCards();
        this.charts.plotAnalysis(result, this.store.capacitanceF);
        this.addWarning(reason, "warning");
        return;
      }

      const segments = result.segmentos || [];
      const charge = this.pick(segments, "CARGA");
      const discharge = this.pick(segments, "DESCARGA");
      const capacitance = Number((result.parametros && result.parametros.capacitancia_f) || this.store.capacitanceF);
      this.store.setCapacitance(capacitance);

      this.setStatus(
        `Análisis completado · ${result.num_muestras} muestras · ${FMT.seconds(result.duracion_total_s, 1)} · fuente temporal: ${result.tiempo_fuente === "device_millis" ? "millis() del Arduino" : "host"}`,
        "ok"
      );

      const tauChargeTheoretical = charge ? toNumber(charge.tau_teorica_s) : null;
      const tauDischargeTheoretical = discharge ? toNumber(discharge.tau_teorica_s) : null;
      const tauChargeExp = charge ? toNumber(charge.tau_experimental_s) : null;
      const tauDischargeExp = discharge ? toNumber(discharge.tau_experimental_s) : null;

      this.setText("r-tau-charge", Number.isFinite(tauChargeTheoretical) ? FMT.seconds(tauChargeTheoretical, 2) : "—");
      this.setText("r-tau-discharge", Number.isFinite(tauDischargeTheoretical) ? FMT.seconds(tauDischargeTheoretical, 2) : "—");
      const tauDischargeNote = document.getElementById("r-tau-discharge-note");
      if (tauDischargeNote) {
        tauDischargeNote.textContent = Number.isFinite(tauDischargeTheoretical)
          ? "R descarga declarada"
          : "R descarga no verificada";
      }

      const expParts = [];
      if (Number.isFinite(tauChargeExp)) expParts.push(`Carga ${FMT.seconds(tauChargeExp, 2)}`);
      if (Number.isFinite(tauDischargeExp)) expParts.push(`Descarga ${FMT.seconds(tauDischargeExp, 2)}`);
      this.setText("r-tau-exp", expParts.length ? expParts.join(" · ") : "—");
      const expNote = document.getElementById("r-tau-exp-note");
      if (expNote) {
        expNote.textContent = expParts.length
          ? "Interpolado en el cruce característico"
          : "Sin cruce confirmado";
      }

      const errorParts = [];
      if (charge && toNumber(charge.error_rel_pct) !== null) errorParts.push(`Carga ${FMT.percent(charge.error_rel_pct, 2)}`);
      if (discharge && toNumber(discharge.error_rel_pct) !== null) errorParts.push(`Descarga ${FMT.percent(discharge.error_rel_pct, 2)}`);
      this.setText("r-error", errorParts.length ? errorParts.join(" · ") : "—");

      const rmseParts = [];
      const r2Parts = [];
      [charge, discharge].forEach((segment) => {
        if (!segment || !segment.ajuste || !segment.ajuste.valido) return;
        const label = segment.modo === "CARGA" ? "Carga" : "Descarga";
        rmseParts.push(`${label} ${FMT.number(segment.ajuste.rmse_v, 4)} V`);
        r2Parts.push(`${label} ${FMT.number(segment.ajuste.r2, 4)}`);
      });
      this.setText("r-rmse", rmseParts.length ? rmseParts.join(" · ") : "—");
      this.setText("r-r2", r2Parts.length ? r2Parts.join(" · ") : "—");
      const r2Note = document.getElementById("r-r2-note");
      if (r2Note) {
        const qualities = [charge, discharge]
          .filter((segment) => segment && segment.ajuste && segment.ajuste.valido)
          .map((segment) => `${segment.modo === "CARGA" ? "Carga" : "Descarga"}: ${segment.ajuste.calidad}`);
        r2Note.textContent = qualities.length ? qualities.join(" · ") : "Sin ajuste válido";
      }
      this.setText("r-samples", String(result.num_muestras || 0));
      this.setText("r-time-source", result.tiempo_fuente === "device_millis" ? "millis()" : "Host");
      const samplesNote = document.getElementById("r-samples-note");
      if (samplesNote) {
        samplesNote.textContent = `${segments.length} segmento(s) detectado(s)`;
      }

      (result.advertencias || []).forEach((warning) => this.addWarning(warning, "warning"));
      segments.forEach((segment) => {
        if (segment.motivo) this.addWarning(`${segment.modo}: ${segment.motivo}.`, "warning");
        if (segment.ajuste && segment.ajuste.valido && Number(segment.ajuste.r2) < 0.85) {
          this.addWarning(
            `${segment.modo}: R² = ${FMT.number(segment.ajuste.r2, 4)}. La respuesta no debe presentarse como un RC pasivo ideal; revisa el efecto del MOSFET y del control.`,
            "warning"
          );
        }
      });
      if (!charge) this.addWarning("No se detectó un segmento de carga con duración y variación suficientes.", "info");
      if (!discharge) this.addWarning("No se detectó un segmento de descarga con duración y variación suficientes.", "info");
      if (warningsBox && warningsBox.children.length === 0) {
        this.addWarning("El ajuste es consistente con el modelo dentro de los datos disponibles. Esto no sustituye la validación física con instrumentos independientes.", "ok");
      }

      this.charts.plotAnalysis(result, capacitance);
    }

    pick(segments, mode) {
      const candidates = segments.filter((segment) => segment.modo === mode);
      return candidates.sort((a, b) => (b.num_muestras || 0) - (a.num_muestras || 0))[0] || null;
    }

    setText(id, value) {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    }

    resetCards() {
      ["r-tau-charge", "r-tau-discharge", "r-tau-exp", "r-error", "r-rmse", "r-r2", "r-samples", "r-time-source"].forEach((id) => this.setText(id, "—"));
    }

    addWarning(message, kind = "info") {
      const box = document.getElementById("analysis-warnings");
      if (!box) return;
      const node = document.createElement("div");
      node.className = `alert alert-${kind}`;
      node.textContent = message;
      box.appendChild(node);
    }
  }

  global.AnalysisPanel = AnalysisPanel;
})(typeof globalThis !== "undefined" ? globalThis : this);
