/**
 * RC LAB 3D — Controlador principal.
 *
 * Coordina conexión, telemetría, escena 3D, gráficas, sesiones y pausas
 * didácticas. La adquisición nunca se detiene para mostrar una explicación.
 */
(function (global) {
  "use strict";

  const API = global.API;
  const FMT = global.FMT;
  const UI = global.UI;
  const Core = global.RCCore;

  class AppController {
    constructor() {
      this.store = new global.TelemetryStore({ capacitanceF: 0.004, maxSamples: 30000 });
      this.scene = null;
      this.simScene = null;
      this.charts = null;
      this.analysis = null;
      this.simulator = null;
      this.ws = null;
      this.wsRetry = 0;
      this.statusTimer = null;
      this.ageTimer = null;
      this.lastStatus = null;
      this._sessionSummary = null;
      this._modalEvent = null;
      this._pausedByModal = false;
      this._userPausedCharts = false;
      this._sessionsLoaded = false;
      this._ports = [];
      this._presentationPaused = false;
      this.testDemo = null;
      this.circuitConfig = null;
      this._circuitSummary = null;
      this._configApplyTimer = null;
      this._backendSyncTimer = null;
      this.initErrors = [];
      // Parámetros de referencia del montaje para q(t). R es la resistencia
      // declarada (nominal, ilustrativa o medida); A1 sigue siendo voltaje techo.
      this.liveRef = {
        c: 0.004,
        rCharge: 4700,
        rDischarge: 4700,
        tau: 18.8,
        tauDischarge: 18.8,
        ceiling: 5,
        source: "nominal",
        pending: {},
      };
      this._latestSample = null;
      this._liveFollowing = true;
      this._liveSelection = null;
      this._liveSceneState = null;
      this._selectedCapIndex = null;
      global.app = this;
      this._init();
    }

    _init() {
      // La navegación se registra primero: un fallo de un módulo visual no
      // debe dejar toda la interfaz bloqueada.
      this._run("navegación", () => this.bindTabs());
      this._run("configuración del circuito", () => this.initCircuitConfig());
      this._run("conexión", () => this.bindConnection());
      this._run("sesiones", () => this.bindSession());
      this._run("pausa didáctica", () => this.bindTauModal());
      this._run("acciones", () => this.bindStaticActions());
      this._run("carga en vivo", () => this.bindLiveChargeControls());
      this._run("almacén", () => this.bindStore());
      this._run("gráficas", () => this.initCharts());
      this._run("escena 3D", () => this.initScene());
      this._run("simulador", () => this.initSimulator());
      this._run("análisis", () => this.initAnalysis());
      this._run("modo test", () => this.initTestDemo());

      this._run("puertos", () => this.loadPorts());
      this._run("estado inicial", () => this.refreshStatus());
      this._run("historial", () => this.loadSessions());
      this._run("WebSocket", () => this.connectWebSocket());

      this.statusTimer = window.setInterval(() => this.refreshStatus(), 15000);
      this.ageTimer = window.setInterval(() => this.updateAge(), 500);
    }

    _run(label, fn) {
      try {
        const result = fn();
        if (result && typeof result.catch === "function") {
          result.catch((error) => this._reportInitError(label, error));
        }
        return result;
      } catch (error) {
        this._reportInitError(label, error);
        return null;
      }
    }

    _reportInitError(label, error) {
      console.error(`Error al inicializar ${label}`, error);
      this.initErrors.push({ label, error });
      if (global.UI && global.UI.toast) {
        global.UI.toast(`No se pudo inicializar ${label}: ${error.message || error}`, "error", 9000);
      }
    }

    /* ------------------------------------------------------------------ */
    /* Inicialización                                                      */
    /* ------------------------------------------------------------------ */
    initCircuitConfig() {
      if (!global.RCCircuitConfig || !global.RCCircuitConfig.CircuitConfigPanel) return;
      this.circuitConfig = new global.RCCircuitConfig.CircuitConfigPanel({
        onChange: (summary) => this.applyCircuitSummary(summary),
        onContinue: (summary) => {
          this.applyCircuitSummary(summary, { immediate: true });
          if (this.simulator) this.simulator.applyCircuitConfig(summary);
          this.switchView("view-lab");
          UI.toast("Circuito guardado. El laboratorio usará estos valores.", "ok");
        },
      });
    }

    initCharts() {
      this.charts = new global.RCCharts(this.store, {
        onInsight: (event) => this.renderInsight(event),
        onRange: (maxVolts) => this.showLabAlert(
          `Medición fuera de la escala de 5,5 V (${FMT.number(maxVolts, 2)} V). ` +
            "Los datos se conservan sin recortar; revisa la calibración del divisor y la fuente.",
          "warning",
          "out-of-range"
        ),
      });
      this.charts.initLive();
      this.charts.bindChargeClick("chart-live", (time) => this.selectLiveTime(time, true));
      // El resumen de «Configurar circuito» ya está disponible antes que las
      // gráficas. Si no existiera, se conserva la referencia nominal.
      if (this._circuitSummary) {
        this.applyCircuitSummary(this._circuitSummary, { immediate: true });
      } else {
        this.applyLiveReference({ capacitancia_f: 0.004, resistencia_carga_ohm: 4700 });
      }
      this.renderLiveCharge(null);
      if (this.charts.renderAnalysisEmptyState) this.charts.renderAnalysisEmptyState();
    }

    initScene() {
      if (!global.RCLab3D) return;
      this.scene = new global.RCLab3D("scene-live", {
        onSelect: (component) => this.showComponentCard(component),
        onCapacitorSelect: (index, snapshot) => this.showCapacitorCard(index, snapshot),
      });
      if (!this.scene || !this.scene.renderer) {
        this.showSceneDiagnostic("No se pudo iniciar WebGL. Revisa la aceleración gráfica del navegador.");
      } else {
        this.scene.setCapacitance(this.liveRef.c, this.capacitanceParts(this.liveRef.c));
        if (this._liveSceneState) this.scene.setChargeState(this._liveSceneState);
      }
      global.RCShowComponent = (component, target) => {
        if (!component) return;
        if (target === "sim") {
          UI.toast(`${component.title}: ${component.what} ${component.role}`, "info", 8000);
        } else {
          this.showComponentCard(component);
        }
      };
    }

    initSimulator() {
      this.simulator = new global.SimulatorPanel({
        charts: this.charts,
        onStart: () => this.setSimulationVisual(true),
        onStop: () => this.setSimulationVisual(false),
        onTau: (event, isSimulation) => {
          this.showTauModal(event, isSimulation);
          const scene = this.simulator && this.simulator.scene;
          if (scene && scene.flashTau) scene.flashTau(event);
        },
      });
      if (this._circuitSummary && this.simulator.applyCircuitConfig) {
        this.simulator.applyCircuitConfig(this._circuitSummary);
      }
    }

    initAnalysis() {
      this.analysis = new global.AnalysisPanel(this.store, this.charts, {
        onRequestSessions: () => this.switchView("view-sessions"),
      });
      this.analysis.loadConfig().then(() => {
        const config = this.analysis.config || {};
        if (this._circuitSummary) {
          // La configuración declarada manda: los campos del análisis se
          // muestran sincronizados, sin que el valor por defecto del backend
          // sobrescriba lo que el estudiante acaba de declarar.
          this.analysis.applyConfig(Object.assign({}, config, {
            capacitancia_f: this.liveRef.c,
            resistencia_carga_ohm: this.liveRef.rCharge,
            resistencia_descarga_ohm: this.liveRef.rDischarge,
            vref_v: this.liveRef.ceiling,
          }));
        } else {
          const c = config.capacitancia_f;
          if (Number.isFinite(Number(c))) this.store.setCapacitance(c);
          this.applyLiveReference(config);
        }
        this.updateCapLabel();
      });
    }

    initTestDemo() {
      if (!global.TestDemoPanel) return;
      this.testDemo = new global.TestDemoPanel(this);
    }

    bindStore() {
      this.store.on("sample", (sample) => this.onSample(sample));
      this.store.on("event", (message) => {
        if (message.type === "TAU") {
          this.onTauEvent(message.event);
        }
      });
      this.store.on("stale", (stale) => this.onStale(stale));
    }

    /* ------------------------------------------------------------------ */
    /* Pestañas                                                            */
    /* ------------------------------------------------------------------ */
    bindTabs() {
      const tabs = Array.from(document.querySelectorAll(".tab"));
      tabs.forEach((tab) => {
        tab.addEventListener("click", () => this.switchView(tab.getAttribute("data-view")));
      });
    }

    switchView(viewId) {
      const nav = global.RCNavigation;
      if (nav) {
        if (!nav.activate(viewId)) return;
      } else {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.forEach((tab) => {
          const active = tab.getAttribute("data-view") === viewId;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
        });
        document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));
      }

      if (viewId === "view-analysis") {
        if (this.charts) {
          window.setTimeout(() => {
            this.charts.resizeAll();
            if (this.charts.reflowAnalysis) this.charts.reflowAnalysis();
          }, 70);
        }
      }
      if (viewId === "view-sim") {
        if (this.simulator) this.simulator.ensureScene();
        if (this.simulator && this.simulator.chargeModel) {
          this.simulator.renderChargeChart();
          this.simulator.setSelectedTime(this.simulator.selectedTime, { silent: true });
        } else if (this.simulator && this.simulator.result && this.charts) {
          this.charts.plotSimulation(this.simulator.result);
        }
        if (this.charts) window.setTimeout(() => this.charts.resizeAll(), 80);
      }
      if (viewId === "view-lab" && this.scene) {
        window.setTimeout(() => {
          this.scene.resize();
          if (this.charts) this.charts.resizeAll();
        }, 60);
      }
      if (viewId === "view-sessions") {
        this.loadSessions();
      }
    }

    /* ------------------------------------------------------------------ */
    /* Conexión                                                            */
    /* ------------------------------------------------------------------ */
    bindConnection() {
      const refresh = document.getElementById("btn-refresh-ports");
      if (refresh) refresh.addEventListener("click", () => this.loadPorts());
      const connect = document.getElementById("btn-connect");
      if (connect) connect.addEventListener("click", () => this.connectSerial());
      const disconnect = document.getElementById("btn-disconnect");
      if (disconnect) disconnect.addEventListener("click", () => this.disconnectSerial());
      const synthetic = document.getElementById("btn-synthetic");
      if (synthetic) synthetic.addEventListener("click", () => this.toggleSynthetic());
      const exitSim = document.getElementById("btn-exit-sim");
      if (exitSim) exitSim.addEventListener("click", () => this.stopSynthetic());
    }

    async loadPorts() {
      const select = document.getElementById("port-select");
      if (!select) return;
      select.disabled = true;
      select.innerHTML = "<option value=''>Buscando puertos…</option>";
      try {
        const data = await API.ports();
        this._ports = data.ports || [];
        select.innerHTML = "";
        if (this._ports.length === 0) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "Sin puertos detectados";
          select.appendChild(option);
          const connect = document.getElementById("btn-connect");
          if (connect) connect.disabled = true;
          return;
        }
        this._ports.forEach((port) => {
          const option = document.createElement("option");
          option.value = port.device;
          option.textContent = `${port.device} — ${port.description || "puerto serial"}`;
          if (port.is_arduino) option.selected = true;
          select.appendChild(option);
        });
        const connect = document.getElementById("btn-connect");
        if (connect) connect.disabled = false;
      } catch (error) {
        select.innerHTML = "<option value=''>Error al consultar puertos</option>";
        UI.toast(error.message, "error");
      } finally {
        select.disabled = false;
      }
    }

    async connectSerial() {
      const select = document.getElementById("port-select");
      const port = select ? select.value : "";
      if (!port) {
        UI.toast("No se detectó el Arduino. Revisa el cable USB y pulsa actualizar.", "warning");
        return;
      }
      const button = document.getElementById("btn-connect");
      if (button) { button.disabled = true; button.textContent = "Conectando…"; }
      this.setChip("wait", "Abriendo puerto");
      try {
        const data = await API.connect(port, 9600);
        UI.toast(data.message || "Puerto abierto. Esperando la primera trama válida.", "info");
        this.lastStatus = data.serial;
        this.applySerialStatus(data.serial);
        this.watchFirstFrame();
      } catch (error) {
        UI.toast(error.message, "error");
        this.setChip("error", "Error de conexión");
      } finally {
        if (button) { button.disabled = false; button.textContent = "Conectar Arduino"; }
      }
    }

    watchFirstFrame() {
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        await this.refreshStatus();
        const status = this.lastStatus && this.lastStatus.serial;
        if (!status) return;
        if (status.has_valid_frame || status.connection_state === "ERROR" || attempts >= 8) {
          window.clearInterval(timer);
        }
      }, 900);
    }

    async disconnectSerial() {
      try {
        const data = await API.disconnect();
        UI.toast(data.message || "Puerto desconectado.", "info");
        await this.refreshStatus();
        await this.loadSessions();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    async toggleSynthetic() {
      const status = this.lastStatus && this.lastStatus.serial;
      if (status && status.is_synthetic) {
        await this.stopSynthetic();
      } else {
        await this.startSynthetic();
      }
    }

    async startSynthetic(options = {}) {
      try {
        const data = await API.startSynthetic(options);
        UI.toast(data.message || "Emulador iniciado.", "info");
        this.lastStatus = data.serial;
        this.applySerialStatus(data.serial);
        this.store.reset("inicio_simulacion");
        this._userPausedCharts = false;
        this._presentationPaused = false;
        if (this.charts) {
          this.charts.setLivePaused(false);
          this.charts.clearLive();
        }
        this.renderInsight(null);
        this.updateCapLabel();
        this.resetLiveCaption();
        return data;
      } catch (error) {
        UI.toast(error.message, "error");
        throw error;
      }
    }

    async stopSynthetic() {
      try {
        const data = await API.stopSynthetic();
        UI.toast(data.message || "Emulador detenido.", "info");
        await this.refreshStatus();
        await this.loadSessions();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    async refreshStatus() {
      try {
        const data = await API.status();
        this.applyStatus(data);
      } catch (error) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        this.setChip("error", "Sin servidor local");
      }
    }

    applyStatus(payload) {
      if (!payload) return;
      this.lastStatus = payload;
      this.store.setStatus(payload);
      if (payload.serial) this.applySerialStatus(payload.serial);
      if (payload.session) {
        this._sessionSummary = payload.session;
        this.applySessionStatus(payload.session);
      }
      if (payload.config && Number.isFinite(Number(payload.config.capacitancia_f))) {
        if (this._circuitSummary) {
          // La configuración declarada por el estudiante tiene prioridad sobre
          // los valores por defecto del backend.
          this.store.setCapacitance(this.liveRef.c);
        } else {
          this.store.setCapacitance(payload.config.capacitancia_f);
          this.applyLiveReference(payload.config);
        }
        this.updateCapLabel();
      }
    }

    applySerialStatus(serial) {
      if (!serial) return;
      const state = serial.connection_state || "DESCONECTADO";
      const isSim = Boolean(serial.is_synthetic) || state === "SIMULACION_ACTIVA";
      const labels = {
        DESCONECTADO: ["default", "Desconectado"],
        ESPERANDO_PRIMERA_TRAMA: ["wait", "Esperando primera trama"],
        SIN_DATOS_VALIDOS: ["error", "Sin datos válidos"],
        TRANSMITIENDO: ["ok", "Transmitiendo"],
        DATOS_OBSOLETOS: ["error", "Datos obsoletos"],
        SIMULACION_ACTIVA: ["sim", "Simulación"],
        ERROR: ["error", "Error de conexión"],
      };
      const [kind, label] = labels[state] || ["default", state];
      this.setChip(kind, label);

      const btnConnect = document.getElementById("btn-connect");
      const btnDisconnect = document.getElementById("btn-disconnect");
      const btnSynthetic = document.getElementById("btn-synthetic");
      const btnExitSim = document.getElementById("btn-exit-sim");
      const showDisconnect = serial.port_open || serial.is_synthetic;
      if (btnConnect) btnConnect.classList.toggle("hidden", showDisconnect);
      if (btnDisconnect) btnDisconnect.classList.toggle("hidden", !showDisconnect);
      if (btnSynthetic) btnSynthetic.textContent = serial.is_synthetic ? "Detener prueba" : "Modo prueba";
      if (btnExitSim) btnExitSim.classList.toggle("hidden", !serial.is_synthetic);

      const simBadge = document.getElementById("sim-badge");
      if (simBadge) simBadge.classList.toggle("hidden", !isSim);
      if (this.scene) this.scene.setSimulation(isSim);
      if (this.simulator && this.simulator.scene) this.simulator.scene.setSimulation(true);

      const stale = state === "DATOS_OBSOLETOS" || state === "SIN_DATOS_VALIDOS";
      if (this.scene) this.scene.setStale(stale);
      const staleEl = document.getElementById("scene-stale");
      if (staleEl) {
        staleEl.textContent = state === "SIN_DATOS_VALIDOS" ? "Sin datos válidos del firmware" : "Última muestra obsoleta";
        staleEl.classList.toggle("hidden", !stale);
      }
    }

    setChip(kind, label) {
      const chip = document.getElementById("connection-chip");
      const text = document.getElementById("connection-label");
      if (chip) {
        chip.classList.remove("is-ok", "is-wait", "is-sim", "is-error");
        if (kind === "ok") chip.classList.add("is-ok");
        if (kind === "wait") chip.classList.add("is-wait");
        if (kind === "sim") chip.classList.add("is-sim");
        if (kind === "error") chip.classList.add("is-error");
      }
      if (text) text.textContent = label;
    }

    /* ------------------------------------------------------------------ */
    /* WebSocket                                                           */
    /* ------------------------------------------------------------------ */
    connectWebSocket() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/ws/live`;
      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        console.error(error);
        window.setTimeout(() => this.connectWebSocket(), 2000);
        return;
      }

      this.ws.onopen = () => {
        this.wsRetry = 0;
        this.ws.send(JSON.stringify({ action: "STATUS" }));
      };
      this.ws.onmessage = (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch (error) { return; }
        if (message.type === "SAMPLE" && message.data) {
          this.store.ingest(message.data);
        } else if (message.type === "STATUS" || message.type === "STATUS_INIT") {
          this.applyStatus(message);
        }
      };
      this.ws.onclose = () => {
        this.wsRetry = Math.min(this.wsRetry + 1, 10);
        window.setTimeout(() => this.connectWebSocket(), Math.min(8000, 1000 * this.wsRetry));
        if (!this.lastStatus) this.setChip("error", "Reconectando…");
      };
      this.ws.onerror = () => {
        try { this.ws.close(); } catch (error) { /* sin acción */ }
      };
    }

    /* ------------------------------------------------------------------ */
    /* Telemetría                                                          */
    /* ------------------------------------------------------------------ */
    onSample(sample) {
      if (this.testDemo) this.testDemo.onSample(sample);
      if (this._presentationPaused) return;
      this.renderSample(sample);
    }

    renderSample(sample) {
      this._latestSample = sample;
      this.updateMetrics(sample);
      this.updateLiveCaption(sample);
      if (this.scene) this.scene.updateFromSample(sample);
      if (this.charts) this.charts.scheduleLive();
      this.updateLiveMeta(sample);
      this.renderLiveCharge(sample);
      const staleEl = document.getElementById("scene-stale");
      if (staleEl) staleEl.classList.add("hidden");
      if (this.scene) this.scene.setStale(false);

      if (sample.anomalia && sample.mensaje_anomalia) {
        this.showLabAlert(sample.mensaje_anomalia, "warning", `anomaly-${Math.round(sample.t_rel)}`);
      }
      const measured = Number(sample.voltaje_tanque);
      if (Number.isFinite(measured) && measured > 5.5) {
        this.showLabAlert(
          `Voltaje medido fuera de la escala de 5,5 V (${FMT.number(measured, 2)} V). ` +
            "No se recorta el dato; verifica calibración y divisor.",
          "warning",
          "out-of-range"
        );
      }
    }

    /* ------------------------------------------------------------------ */
    /* Carga eléctrica q(t) en el montaje físico                           */
    /* ------------------------------------------------------------------ */
    bindLiveChargeControls() {
      const slider = document.getElementById("live-time");
      if (slider) {
        slider.addEventListener("input", () => {
          this._liveFollowing = false;
          this.selectLiveTime(Number(slider.value), true);
        });
      }
      const now = document.getElementById("btn-live-now");
      if (now) now.addEventListener("click", () => this.followLive());
      const timeInput = document.getElementById("live-time-input");
      if (timeInput) {
        timeInput.addEventListener("change", () => {
          this._liveFollowing = false;
          this.selectLiveTime(Number(timeInput.value), false);
        });
      }

      // La resistencia y el voltaje pueden corregirse manualmente desde la
      // configuración declarada. A1 no se convierte en ohmios.
      ["cfg-c", "cfg-rcharge", "cfg-rdischarge", "cfg-vref"].forEach((id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("change", () => this.syncLiveReferenceFromInputs());
      });
    }

    syncLiveReferenceFromInputs() {
      const read = (id) => {
        const input = document.getElementById(id);
        if (!input || input.value === "") return null;
        const value = Number(input.value);
        return Number.isFinite(value) ? value : null;
      };
      this.applyLiveReference({
        capacitancia_f: read("cfg-c"),
        resistencia_carga_ohm: read("cfg-rcharge"),
        resistencia_descarga_ohm: read("cfg-rdischarge"),
        vref_v: read("cfg-vref"),
      });
      if (this._latestSample) this.renderLiveCharge(this._latestSample);
    }

    /**
     * Aplica el resumen de «Configurar circuito» al laboratorio en vivo.
     * Actualiza la referencia de q(t), la escena 3D, la gráfica y el panel de
     * cálculo. El backend recibe los valores equivalentes con un pequeño
     * retardo para no escribir en cada pulsación.
     */
    applyCircuitSummary(summary, options = {}) {
      if (!summary) return;
      this._circuitSummary = summary;
      this.liveRef.c = summary.ceq > 0 ? summary.ceq : this.liveRef.c;
      this.liveRef.rCharge = summary.reqCarga > 0 ? summary.reqCarga : null;
      this.liveRef.rDischarge = summary.reqDescarga > 0 ? summary.reqDescarga : null;
      this.liveRef.ceiling = summary.ve > 0 ? summary.ve : this.liveRef.ceiling;
      this.liveRef.pending = summary.pending || {};
      this.liveRef.tau = Core.tauOf(this.liveRef.rCharge, this.liveRef.c);
      this.liveRef.tauDischarge = Core.tauOf(this.liveRef.rDischarge, this.liveRef.c);
      this.liveRef.source = summary.ceqSource || "configurado";
      if (summary.ceq > 0) this.store.setCapacitance(summary.ceq);
      this.capacitancePartsF = summary.capacitancePartsF;
      this.updateCapLabel();

      const apply = () => {
        if (this.charts) {
          this.charts.setLiveParams({
            c: this.liveRef.c,
            rCharge: this.liveRef.rCharge,
            rDischarge: this.liveRef.rDischarge,
            tau: this.liveRef.tau,
            tauDischarge: this.liveRef.tauDischarge,
            ceiling: this.liveRef.ceiling,
            pending: this.liveRef.pending,
          });
        }
        if (this.scene) {
          this.scene.setCapacitance(this.liveRef.c, this.capacitanceParts(this.liveRef.c));
        }
        if (this.simulator && this.simulator.setCapacitanceParts) {
          this.simulator.setCapacitanceParts(summary.capacitancePartsF);
        }
        const qmaxEl = document.getElementById("lq-qmax");
        const qMaxC = Core.qMaxC(this.liveRef.c, this.liveRef.ceiling);
        if (qmaxEl) {
          qmaxEl.textContent = qMaxC > 0
            ? `${this.formatNumber(qMaxC * 1000, 2)} mC`
            : "—";
        }
        const tauEl = document.getElementById("lq-tau");
        if (tauEl) {
          tauEl.textContent = Number.isFinite(this.liveRef.tau)
            ? `${this.formatNumber(this.liveRef.tau, 2)} s`
            : "—";
        }
        if (this._latestSample) this.renderLiveCharge(this._latestSample);
        else this.renderLiveCharge(null);
      };

      window.clearTimeout(this._configApplyTimer);
      this._configApplyTimer = window.setTimeout(apply, options.immediate ? 0 : 90);
      this.scheduleBackendConfigSync(summary);
    }

    scheduleBackendConfigSync(summary) {
      if (!API || typeof API.saveConfig !== "function") return;
      window.clearTimeout(this._backendSyncTimer);
      this._backendSyncTimer = window.setTimeout(() => {
        const body = {};
        if (summary.ceq > 0) {
          body.capacitancia_f = summary.ceq;
          body.capacitancia_origen = summary.ceqSource === "medido" ? "MEDIDO" : "NOMINAL";
        }
        if (summary.reqCarga > 0) {
          body.resistencia_carga_ohm = summary.reqCarga;
          body.resistencia_origen = summary.reqCargaSource === "medido" ? "MEDIDO" : "NOMINAL";
        }
        if (summary.reqDescarga > 0) body.resistencia_descarga_ohm = summary.reqDescarga;
        if (summary.ve > 0) body.vref_v = summary.ve;
        if (Object.keys(body).length === 0) return;
        API.saveConfig(body)
          .then((data) => {
            if (this.analysis && data && data.config) this.analysis.applyConfig(data.config);
          })
          .catch((error) => console.warn("No se pudo sincronizar /api/config", error));
      }, 700);
    }

    /**
     * Fija la R y la C de referencia de q(t). Para el modo físico, el techo
     * se toma de A1 en cada muestra; `vref_v` solo es un respaldo.
     */
    applyLiveReference(config = {}) {
      const c = Number(config.capacitancia_f);
      if (Number.isFinite(c) && c > 0) this.liveRef.c = c;
      const r = Number(config.resistencia_carga_ohm);
      if (Number.isFinite(r) && r > 0) this.liveRef.rCharge = r;
      const rd = Number(config.resistencia_descarga_ohm);
      if (Number.isFinite(rd) && rd > 0) this.liveRef.rDischarge = rd;
      const vref = Number(config.vref_v);
      if (Number.isFinite(vref) && vref > 0 && !this._latestSample) this.liveRef.ceiling = vref;
      this.liveRef.tau = Core.tauOf(this.liveRef.rCharge, this.liveRef.c);
      this.liveRef.tauDischarge = Core.tauOf(this.liveRef.rDischarge, this.liveRef.c);
      if (this.charts) {
        this.charts.setLiveParams({
          c: this.liveRef.c,
          rCharge: this.liveRef.rCharge,
          rDischarge: this.liveRef.rDischarge,
          tau: this.liveRef.tau,
          tauDischarge: this.liveRef.tauDischarge,
          ceiling: this.liveRef.ceiling,
        });
      }
      if (this.scene) this.scene.setCapacitance(this.liveRef.c, this.capacitanceParts(this.liveRef.c));
      const tauEl = document.getElementById("lq-tau");
      if (tauEl) {
        tauEl.textContent = Number.isFinite(this.liveRef.tau)
          ? `${this.formatNumber(this.liveRef.tau, 2)} s`
          : "—";
      }
      const qmaxEl = document.getElementById("lq-qmax");
      const qMaxC = Core.qMaxC(this.liveRef.c, this.liveRef.ceiling);
      if (qmaxEl) {
        qmaxEl.textContent = qMaxC > 0 ? `${this.formatNumber(qMaxC * 1000, 2)} mC` : "—";
      }
    }

    formatNumber(value, digits = 2) {
      return Number.isFinite(Number(value))
        ? Number(value).toFixed(digits).replace(".", ",")
        : "—";
    }

    /** Reparto declarado por «Configurar circuito»; si no hay 4, reparto igual. */
    capacitanceParts(totalF) {
      if (!(Number(totalF) > 0)) return [0, 0, 0, 0];
      if (Array.isArray(this.capacitancePartsF) && this.capacitancePartsF.length === 4) {
        return this.capacitancePartsF.slice();
      }
      const each = Number(totalF) / 4;
      return [each, each, each, each];
    }

    liveStateFromSample(sample) {
      const c = this.liveRef.c || this.store.capacitanceF;
      const voltage = Number(sample.voltaje_tanque) || 0;
      const measuredCeiling = Number(sample.voltaje_techo);
      const ceiling = measuredCeiling > 0.05 ? measuredCeiling : this.liveRef.ceiling;
      const qTotalC = Core.chargeC(c, voltage);
      const qMaxC = Core.qMaxC(c, ceiling);
      const parts = this.capacitanceParts(c);
      const perCapacitorC = parts.map((ci) => ci * voltage);
      const perCapacitorMaxC = parts.map((ci) => ci * ceiling);
      const perCapacitorFraction = parts.map((ci, index) => {
        const max = perCapacitorMaxC[index];
        return max > 0 ? Core.clamp(perCapacitorC[index] / max, 0, 1) : 0;
      });
      return {
        level: qMaxC > 0 ? Core.clamp(qTotalC / qMaxC, 0, 1) : 0,
        qTotalC,
        qMaxC,
        perCapacitorC,
        perCapacitorMaxC,
        perCapacitorFraction,
        voltage,
        ceiling,
        mode: sample.estado === "D" ? "D" : (sample.estado === "C" ? "C" : "S"),
      };
    }

    liveStateFromModel(model, selection) {
      const c = this.liveRef.c || this.store.capacitanceF;
      const qTotalC = Number(selection && selection.chargeC) || 0;
      const qMaxC = Number(model && model.qMaxC) || 0;
      const ceiling = c > 0 ? qMaxC / c : this.liveRef.ceiling;
      const voltage = c > 0 ? qTotalC / c : 0;
      const parts = this.capacitanceParts(c);
      const perCapacitorC = parts.map((ci) => ci * voltage);
      const perCapacitorMaxC = parts.map((ci) => ci * ceiling);
      const perCapacitorFraction = parts.map((ci, index) => {
        const max = perCapacitorMaxC[index];
        return max > 0 ? Core.clamp(perCapacitorC[index] / max, 0, 1) : 0;
      });
      return {
        level: qMaxC > 0 ? Core.clamp(qTotalC / qMaxC, 0, 1) : 0,
        qTotalC,
        qMaxC,
        perCapacitorC,
        perCapacitorMaxC,
        perCapacitorFraction,
        voltage,
        ceiling,
        mode: model && model.mode === "DESCARGA" ? "D" : "C",
      };
    }

    updateLiveMeta(sample) {
      const ceiling = Number(sample && sample.voltaje_techo);
      if (Number.isFinite(ceiling) && ceiling > 0.05) this.liveRef.ceiling = ceiling;
      const qMaxC = Core.qMaxC(this.liveRef.c, this.liveRef.ceiling);
      const qmaxEl = document.getElementById("lq-qmax");
      if (qmaxEl) {
        qmaxEl.textContent = qMaxC > 0 ? `${this.formatNumber(qMaxC * 1000, 2)} mC` : "—";
      }
      const tauEl = document.getElementById("lq-tau");
      if (tauEl) {
        tauEl.textContent = Number.isFinite(this.liveRef.tau)
          ? `${this.formatNumber(this.liveRef.tau, 2)} s`
          : "—";
      }
    }

    updateLiveHud(model, selection) {
      const qC = Number(selection && selection.chargeC) || 0;
      const qMaxC = Number(model && model.qMaxC) || 0;
      const base = model && model.mode === "DESCARGA" ? Number(model.q0C) || 0 : qMaxC;
      const pct = base > 0 ? Core.clamp((qC / base) * 100, 0, 100) : 0;
      const mouse = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      mouse("lq-total", this.formatNumber(qC * 1000, 2));
      mouse("lq-percent", `${this.formatNumber(pct, 1)} % ${model && model.mode === "DESCARGA" ? "de Q₀" : "de Qmax"}`);
      mouse("lq-time", `${this.formatNumber(selection && selection.time, 2)} s`);
      mouse("lq-tau", Number.isFinite(Number(model && model.tau))
        ? `${this.formatNumber(model.tau, 2)} s`
        : "—");
      mouse("lq-qmax", qMaxC > 0 ? `${this.formatNumber(qMaxC * 1000, 2)} mC` : "—");
    }

    updateLiveTimeControl(model, value) {
      const slider = document.getElementById("live-time");
      if (!slider || !model) return;
      const min = Number.isFinite(model.xStart) ? model.xStart : 0;
      const max = Number.isFinite(model.xEnd) ? model.xEnd : min + 1;
      const step = Math.max(0.001, (max - min) / 600);
      const clamped = Core.clamp(Number(value) || 0, min, max);
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String(step);
      slider.value = String(clamped);
      const input = document.getElementById("live-time-input");
      if (input) {
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.value = clamped.toFixed(2);
      }
    }

    /**
     * Comprobación del punto mostrado: q_exp = Ceq · Vc frente a la fórmula
     * del profesor, variación Δq y tau estimado cuando el dominio lo permite.
     * En la curva nominal no hay muestra física: se identifica como SIMULACIÓN.
     */
    updateLiveCheck(model, selection) {
      const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      };
      const note = document.getElementById("live-check-note");
      if (!model || !selection) {
        ["lc-volt", "lc-qexp", "lc-qtheory", "lc-diff", "lc-tauest", "lc-timecalc"].forEach((id) => set(id, "—"));
        if (note) note.textContent = "Selecciona un instante para comprobar q(t).";
        return;
      }
      const c = Number(model.c) > 0 ? Number(model.c) : this.liveRef.c;
      const qC = Number(selection.chargeC) || 0;
      const qMaxC = Number(model.qMaxC) || 0;
      const q0C = Number(model.q0C) || 0;
      const qInfC = Number(model.qInfC) || 0;
      const discharge = String(model.mode || "CARGA").toUpperCase() === "DESCARGA";
      const samples = Array.isArray(this.store.samples) ? this.store.samples : [];
      const current = this.store.current || this._latestSample;
      const synthetic = Boolean(current && String(current.origen || "").toUpperCase() === "SIMULACION");
      const physical = !model.nominal && samples.length > 0 && !synthetic;

      if (!physical) {
        const t = Math.max(0, (Number(selection.time) || 0) - (Number(model.xStart) || 0));
        const voltage = c > 0 ? qC / c : 0;
        const tauEst = discharge
          ? Core.tauFromPointDecayC(t, qC, q0C, qInfC)
          : Core.tauFromPointChargeC(t, qC, qMaxC, q0C);
        const tCalc = discharge
          ? Core.timeForDecayC(model.tau, qC, q0C, qInfC)
          : Core.timeForChargeC(model.tau, qC, qMaxC, q0C);
        set("lc-volt", `${this.formatNumber(voltage, 2)} V`);
        set("lc-qexp", `${this.formatNumber(qC * 1000, 2)} mC`);
        set("lc-qtheory", `${this.formatNumber(qC * 1000, 2)} mC`);
        set("lc-diff", "0,00 mC");
        set("lc-tauest", tauEst !== null ? `${this.formatNumber(tauEst, 2)} s` : "—");
        set("lc-timecalc", tCalc !== null ? `${this.formatNumber(tCalc, 2)} s` : "—");
        if (note) {
          note.textContent = synthetic
            ? "Modo prueba (SIMULACIÓN — DATOS SINTÉTICOS): la comprobación usa el modelo, no una medición del Arduino."
            : ((tauEst === null || tCalc === null)
              ? "Curva nominal (SIMULACIÓN): sin datos físicos. En t = 0 o q = 0 no hay estimación válida."
              : "Curva nominal (SIMULACIÓN): sin datos físicos. La comprobación usa el modelo, no una muestra del Arduino.");
        }
        return;
      }

      // Muestra física más cercana dentro del evento actual.
      const xStart = Number(model.xStart) || 0;
      let nearest = null;
      let best = Infinity;
      samples.forEach((sample) => {
        const t = Number(sample.t_rel);
        if (!Number.isFinite(t) || t < xStart - 1e-9) return;
        const distance = Math.abs(t - Number(selection.time));
        if (distance < best) { best = distance; nearest = sample; }
      });
      if (!nearest) {
        if (note) note.textContent = "No hay muestras válidas del evento actual para comprobar.";
        return;
      }
      const measuredV = Number(nearest.voltaje_tanque) || 0;
      const sampleT = Number(nearest.t_rel) || 0;
      const elapsed = Math.max(0, sampleT - xStart);
      const qExp = c * measuredV;
      const qTheory = Core.chargeAtTimeGeneralC(elapsed, q0C, qInfC, Number(model.tau));
      const diff = qExp - qTheory;
      const tauEst = discharge
        ? Core.tauFromPointDecayC(elapsed, qExp, q0C, qInfC)
        : Core.tauFromPointChargeC(elapsed, qExp, qMaxC, q0C);
      const tCalc = discharge
        ? Core.timeForDecayC(model.tau, qExp, q0C, qInfC)
        : Core.timeForChargeC(model.tau, qExp, qMaxC, q0C);
      set("lc-volt", `${this.formatNumber(measuredV, 2)} V`);
      set("lc-qexp", `${this.formatNumber(qExp * 1000, 2)} mC`);
      set("lc-qtheory", `${this.formatNumber(qTheory * 1000, 2)} mC`);
      set("lc-diff", `${diff >= 0 ? "+" : "−"}${this.formatNumber(Math.abs(diff) * 1000, 2)} mC`);
      set("lc-tauest", tauEst !== null ? `${this.formatNumber(tauEst, 2)} s` : "—");
      set("lc-timecalc", tCalc !== null ? `${this.formatNumber(tCalc, 2)} s` : "—");
      if (note) {
        note.textContent = `Muestra física más cercana: t = ${this.formatNumber(sampleT, 2)} s · q_exp = Ceq · Vc; q teórica con la fórmula del profesor. τ estimado puede variar por ruido y tolerancias.`;
      }
    }

    /**
     * Panel «Comprueba el cálculo» del laboratorio en vivo. Pasa al panel los
     * equivalentes declarados y, si hay muestras físicas válidas, la misma
     * muestra más cercana para comparar q(t) con q_exp = Ceq · Vc.
     */
    updateCalcPanel(model, selection) {
      const Calc = global.RCCalc;
      if (!Calc || !model || !selection) return;
      const summary = this._circuitSummary || null;
      const discharge = String(model.mode || "CARGA").toUpperCase() === "DESCARGA";
      const c = summary && summary.pending && summary.pending.ceq
        ? null
        : (Number(summary && summary.ceq) > 0
          ? Number(summary.ceq)
          : (Number(model.c) > 0 ? Number(model.c) : this.liveRef.c));
      const rCharge = Number(summary && summary.reqCarga) > 0
        ? Number(summary.reqCarga)
        : (Number(this.liveRef.rCharge) > 0 ? Number(this.liveRef.rCharge) : null);
      const rDischarge = Number(summary && summary.reqDescarga) > 0
        ? Number(summary.reqDescarga)
        : (Number(this.liveRef.rDischarge) > 0 ? Number(this.liveRef.rDischarge) : null);
      const r = discharge ? rDischarge : rCharge;
      const tau = Core.tauOf(r, c);
      // En el montaje físico manda el techo medido por A1. La alimentación
      // declarada es la referencia de respaldo; si está pendiente, el cálculo
      // teórico no debe inventar Qmax.
      let ve = Number(model.ceiling) > 0
        ? Number(model.ceiling)
        : (Number(summary && summary.ve) > 0 ? Number(summary.ve) : Number(this.liveRef.ceiling));
      const xStart = Number(model.xStart) || 0;
      const t = Math.max(0, (Number(selection.time) || 0) - xStart);
      const qC = Number(selection.chargeC) || 0;
      const samples = Array.isArray(this.store.samples) ? this.store.samples : [];
      const current = this.store.current || this._latestSample;
      const synthetic = Boolean(current && String(current.origen || "").toUpperCase() === "SIMULACION");
      const physical = !model.nominal && samples.length > 0 && !synthetic;

      let measured = null;
      if (physical) {
        let nearest = null;
        let best = Infinity;
        samples.forEach((sample) => {
          const sampleT = Number(sample.t_rel);
          if (!Number.isFinite(sampleT) || sampleT < xStart - 1e-9) return;
          const distance = Math.abs(sampleT - Number(selection.time));
          if (distance < best) { best = distance; nearest = sample; }
        });
        if (nearest) {
          const voltage = Number(nearest.voltaje_tanque) || 0;
          measured = {
            voltage,
            qC: c * voltage,
            time: Number(nearest.t_rel) || 0,
          };
        }
      }

      Calc.update("calc-live", {
        r,
        rCharge,
        rDischarge,
        c,
        ve,
        t,
        qC,
        qMaxC: model.qMaxC,
        q0C: model.q0C,
        qInfC: model.qInfC,
        v0: c > 0 ? Number(model.q0C) / c : null,
        mode: model.mode,
        tau,
        nominal: Boolean(model.nominal),
        synthetic,
        measured,
        summary,
        pending: summary ? summary.pending : {},
        source: synthetic
          ? "MODO PRUEBA · SIMULACIÓN"
          : (physical ? "MEDICIÓN FÍSICA" : "REFERENCIA NOMINAL · SIMULACIÓN"),
        v0Note: synthetic ? "voltaje inicial del emulador" : (physical ? "voltaje inicial medido" : "voltaje inicial nominal"),
        veNote: synthetic
          ? "techo del emulador (SIMULACIÓN)"
          : (physical ? "techo medido por A1" : "voltaje de alimentación configurado"),
      });
    }

    /**
     * Recalcula q(t), el HUD, el nivel 3D y la tarjeta individual para el
     * instante mostrado. En modo "seguir" usa la última muestra; si el usuario
     * movió el cursor, conserva el instante elegido.
     */
    renderLiveCharge(sample) {
      if (!this.charts) return;
      const model = this.charts.buildLiveChargeModel();
      if (!model) {
        if (sample) {
          const state = this.liveStateFromSample(sample);
          this._liveSceneState = state;
          if (this.scene) this.scene.setChargeState(state);
        }
        return;
      }
      let selection;
      if (this._liveFollowing) {
        selection = model.selected || { time: model.xStart, chargeC: model.q0C };
      } else {
        const time = Core.clamp(
          this._liveSelection ? this._liveSelection.time : model.selected.time,
          model.xStart,
          model.xEnd
        );
        const chargeC = Core.chargeAtTimeGeneralC(time - model.xStart, model.q0C, model.qInfC, model.tau);
        selection = { time, chargeC };
        this._liveSelection = selection;
        this.charts.setLiveSelected(selection);
      }
      const state = this.liveStateFromModel(model, selection);
      this._liveSceneState = state;
      if (this.scene) this.scene.setChargeState(state);
      this.updateLiveHud(model, selection);
      this.updateLiveCheck(model, selection);
      this.updateCalcPanel(model, selection);
      this.updateLiveTimeControl(model, selection.time);
      if (this._selectedCapIndex !== undefined && this._selectedCapIndex !== null) {
        this.showCapacitorCard(this._selectedCapIndex, state);
      }
    }

    selectLiveTime(time, fromSlider = false) {
      if (!this.charts) return;
      const model = this.charts.buildLiveChargeModel();
      if (!model) return;
      const t = Core.clamp(Number(time) || 0, model.xStart, model.xEnd);
      const chargeC = Core.chargeAtTimeGeneralC(t - model.xStart, model.q0C, model.qInfC, model.tau);
      this._liveFollowing = false;
      this._liveSelection = { time: t, chargeC };
      this.charts.setLiveSelected(this._liveSelection);
      const state = this.liveStateFromModel(model, this._liveSelection);
      this._liveSceneState = state;
      if (this.scene) this.scene.setChargeState(state);
      this.updateLiveHud(model, this._liveSelection);
      this.updateLiveCheck(model, this._liveSelection);
      this.updateCalcPanel(model, this._liveSelection);
      this.updateLiveTimeControl(model, t);
      if (this._selectedCapIndex !== undefined && this._selectedCapIndex !== null) {
        this.showCapacitorCard(this._selectedCapIndex, state);
      }
    }

    followLive() {
      this._liveFollowing = true;
      this._liveSelection = null;
      this._selectedCapIndex = null;
      if (this.charts) this.charts.setLiveSelected(null);
      const sample = this.store.current || this._latestSample;
      this.renderLiveCharge(sample || null);
    }


    setPresentationPaused(paused) {
      const next = Boolean(paused);
      this._presentationPaused = next;
      if (this.charts) this.charts.setLivePaused(next || this._userPausedCharts);
      if (!next) {
        if (this.store.current) this.renderSample(this.store.current);
        if (this.charts) this.charts.scheduleLive();
      }
    }

    resetLiveCaption() {
      const title = document.getElementById("live-caption-title");
      const text = document.getElementById("live-caption-text");
      if (title) title.textContent = "Sin datos todavía";
      if (text) text.textContent = " — Inicia una sesión o el Modo prueba y aquí verás qué está ocurriendo en el banco.";
    }

    updateLiveCaption(sample) {
      const title = document.getElementById("live-caption-title");
      const text = document.getElementById("live-caption-text");
      if (!title || !text) return;
      const state = sample.estado === "C" ? "Cargando el banco"
        : sample.estado === "D" ? "Descargando el banco"
        : "Banco en equilibrio";
      const voltage = Number(sample.voltaje_tanque);
      const ceiling = Number(sample.voltaje_techo);
      const v = Number.isFinite(voltage) ? FMT.number(voltage, 2) : "—";
      const c = Number.isFinite(ceiling) ? FMT.number(ceiling, 2) : "—";
      const pct = Number.isFinite(voltage) && Number.isFinite(ceiling) && ceiling > 0.05
        ? Math.round((voltage / ceiling) * 100)
        : null;
      const mode = sample.origen === "SIMULACION" ? "SIMULACIÓN" : "MEDICIÓN REAL";
      title.textContent = `${mode} — ${state}`;
      text.textContent = pct === null
        ? " — Esperando tramas válidas para describir el evento."
        : ` — ${v} V de ${c} V de techo (${pct} % del recorrido). La carga q = C·Vc se estima a partir del voltaje medido; no es un sensor de carga. El núcleo interno crece o cae con ella y el anillo amarillo marca el techo del potenciómetro.`;
    }

    updateMetrics(sample) {
      const d = sample.derived || {};
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("m-voltage", FMT.number(d.voltage, 3));
      set("m-ceiling", FMT.number(d.ceiling, 3));
      set("m-voltage-note", d.ceiling > 0.05 ? `${FMT.percent(d.voltagePct, 1)} del voltaje techo` : "Voltaje techo no válido");

      const stateEl = document.getElementById("m-state");
      if (stateEl) {
        stateEl.textContent = FMT.state(sample.estado);
        stateEl.className = `metric-value metric-state-value state-${
          sample.estado === "C" ? "charge" : sample.estado === "D" ? "discharge" : "stable"
        }`;
      }
      set("m-state-note", `${sample.protocolo || "R1"} · ${sample.origen === "SIMULACION" ? "simulación" : "serial"} · confianza ${FMT.percent((sample.estado_confianza || 0) * 100, 0)}`);

      set("m-energy", FMT.number(d.energyJ, 4));
      set("m-energy-pct", `${FMT.percent(d.energyPct, 1)} de la referencia`);
      set("m-energy-ref", `Ref.: ${FMT.number(d.refEnergyJ, 4)} J`);
      const energyFill = document.getElementById("energy-fill");
      if (energyFill) energyFill.style.width = `${Core.clamp(d.energyPct || 0, 0, 100)}%`;

      set("m-charge", FMT.number(d.chargeC, 5));
      set("m-charge-note", `Q = C · V · C = ${FMT.number(this.store.capacitanceF, 4)} F`);
      const chargeFill = document.getElementById("charge-fill");
      if (chargeFill) chargeFill.style.width = `${Core.clamp(d.voltagePct || 0, 0, 100)}%`;
      this.updateCapLabel();

      const leds = d.leds || {};
      this.setLed("led-30", leds.red);
      this.setLed("led-60", leds.amber60);
      this.setLed("led-90", leds.amber90);

      set("m-rate", FMT.number(this.store.getRate(), 1));
      const invalid = this.store.samples.filter((item) => item.valida === false).length;
      const corrupt = (this.lastStatus && this.lastStatus.serial && this.lastStatus.serial.corrupt_lines) || 0;
      set("m-invalid", `${invalid} inválidas · ${corrupt} líneas descartadas`);
      set("m-samples", String(this.store.samples.length));
    }

    updateAge() {
      const age = this.store.getAge();
      const element = document.getElementById("m-age");
      if (element) {
        element.textContent = age === null ? "Última muestra: —" : `Última muestra: hace ${FMT.seconds(age, 1)}`;
      }
      if (this._sessionSummary && this._sessionSummary.active) {
        const elapsed = this._sessionSummary.elapsed_seconds || 0;
        const sessionElapsed = document.getElementById("session-elapsed");
        if (sessionElapsed) sessionElapsed.textContent = FMT.seconds(elapsed, 0);
      }
    }

    setLed(id, on) {
      const el = document.getElementById(id);
      if (el) el.classList.toggle("is-on", Boolean(on));
    }

    updateCapLabel() {
      const el = document.getElementById("m-cap-value");
      if (el) el.textContent = `C = ${FMT.number(this.store.capacitanceF, 4)} F`;
    }

    onStale(stale) {
      const el = document.getElementById("scene-stale");
      if (el) el.classList.toggle("hidden", !stale);
      if (this.scene) this.scene.setStale(stale);
    }

    renderInsight(event) {
      const box = document.getElementById("tau-insight");
      const title = document.getElementById("tau-insight-title");
      const text = document.getElementById("tau-insight-text");
      if (!box || !title || !text) return;
      if (!event) {
        box.classList.remove("is-complete");
        title.textContent = "Todavía no hay un cruce característico";
        text.textContent = "Cuando la señal alcance el 63,2 % de la carga o el 36,8 % restante de la descarga, aparecerá aquí el tiempo experimental. 1τ no completa el proceso: una carga práctica (≈99,3 %) requiere cerca de 5τ.";
        return;
      }
      box.classList.add("is-complete");
      const mode = event.mode === "CARGA" ? "carga" : "descarga";
      title.textContent = `${event.mode === "CARGA" ? "Carga" : "Descarga"}: 1τ = ${FMT.seconds(event.time_s, 2)}`;
      const provisional = event.provisional ? " Valor provisional: el nivel final todavía no estaba estabilizado." : " Nivel final confirmado con la cola de muestras.";
      text.textContent = `El voltaje interpolado fue ${FMT.number(event.voltage_v, 3)} V (${FMT.percent(event.percent, 1)} de la variación). ${mode}.${provisional} La adquisición continuó sin interrupción.`;
      const metric = document.getElementById("m-tau");
      if (metric) metric.textContent = FMT.seconds(event.time_s, 2);
      const note = document.getElementById("m-tau-note");
      if (note) note.textContent = `${event.mode === "CARGA" ? "Carga" : "Descarga"} · ${event.label}`;
    }

    onTauEvent(event) {
      if (this.scene) this.scene.flashTau && this.scene.flashTau(event);
      this.charts.addTauEvent(event);
      if (this.testDemo) this.testDemo.onTau(event);
      this.showTauModal(event, false);
      this.showLabAlert(
        `Se alcanzó 1τ de ${event.mode.toLowerCase()} a ${FMT.number(event.voltage_v, 3)} V. La adquisición continúa.`,
        "ok",
        `tau-${event.id}`
      );
    }

    showLabAlert(message, kind = "info", key = "") {
      const box = document.getElementById("lab-alerts");
      if (!box) return;
      if (key) {
        const existing = box.querySelector(`[data-key="${CSS.escape(key)}"]`);
        if (existing) return;
      }
      const node = document.createElement("div");
      node.className = `alert alert-${kind}`;
      node.textContent = message;
      if (key) node.setAttribute("data-key", key);
      box.appendChild(node);
      while (box.children.length > 5) box.removeChild(box.firstChild);
      window.setTimeout(() => node.remove(), 12000);
    }

    /* ------------------------------------------------------------------ */
    /* Pausa didáctica                                                     */
    /* ------------------------------------------------------------------ */
    bindTauModal() {
      const close = () => this.hideTauModal();
      const continueButton = document.getElementById("btn-tau-continue");
      if (continueButton) continueButton.addEventListener("click", close);
      const later = document.getElementById("btn-tau-later");
      if (later) later.addEventListener("click", () => {
        close();
        const insight = document.getElementById("tau-insight");
        if (insight) insight.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const repeat = document.getElementById("btn-tau-repeat");
      if (repeat) repeat.addEventListener("click", () => {
        const title = document.getElementById("tau-modal-title");
        if (title) {
          title.style.transform = "scale(1.03)";
          window.setTimeout(() => { title.style.transform = ""; }, 180);
        }
      });
      const modal = document.getElementById("tau-modal");
      if (modal) {
        modal.addEventListener("click", (event) => {
          if (event.target === modal) close();
        });
        modal.addEventListener("keydown", (event) => {
          if (event.key === "Escape") close();
          if (event.key === "Tab") {
            const focusable = modal.querySelectorAll("button");
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        });
      }
    }

    showTauModal(event, isSimulation) {
      const modal = document.getElementById("tau-modal");
      if (!modal || !event) return;
      const previousEvent = this._modalEvent;
      this._modalEvent = event;
      const kicker = document.getElementById("tau-modal-kicker");
      const title = document.getElementById("tau-modal-title");
      const time = document.getElementById("tau-modal-time");
      const voltage = document.getElementById("tau-modal-voltage");
      const percent = document.getElementById("tau-modal-percent");
      const text = document.getElementById("tau-modal-text");

      if (kicker) kicker.textContent = `${isSimulation ? "SIMULACIÓN · " : ""}${event.mode === "CARGA" ? "Carga" : "Descarga"} · punto característico`;
      if (title) title.textContent = `Se alcanzó 1τ de ${event.mode === "CARGA" ? "carga" : "descarga"}`;
      if (time) time.textContent = FMT.seconds(event.time_s, 2);
      if (voltage) voltage.textContent = `${FMT.number(event.voltage_v, 3)} V`;
      if (percent) percent.textContent = `1τ · ${FMT.number(event.percent, 1)} %`;
      if (text) {
        const base = event.mode === "CARGA"
          ? "En un τ de carga, el condensador ha recorrido el 63,212 % de la variación total entre V₀ y V_f. La curva continuará acercándose al voltaje techo sin alcanzarlo exactamente en un tiempo finito: una carga práctica (≈99,3 %) requiere cerca de 5τ, no 1τ."
          : "En un τ de descarga queda el 36,788 % de la variación inicial respecto al nivel final. Ese nivel final se mide; no se supone cero. Un vaciado práctico (≈99,3 % recorrido) requiere cerca de 5τ.";
        const note = event.provisional
          ? " El nivel final usado para este aviso es provisional; el análisis posterior lo recalcula con la cola de muestras."
          : " El nivel final fue confirmado con las muestras posteriores.";
        text.textContent = `${base}${note} La adquisición y el almacenamiento continúan en segundo plano; esta pausa solo controla la presentación visual.`;
      }

      if (!modal.classList.contains("hidden") && previousEvent && previousEvent.id === event.id) {
        // Ya está abierto para el mismo evento: no repetir.
        return;
      }
      modal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
      this._pausedByModal = !this.charts.livePaused;
      if (this._pausedByModal) this.charts.setLivePaused(true);
      const button = document.getElementById("btn-tau-continue");
      if (button) window.setTimeout(() => button.focus(), 30);
    }

    hideTauModal() {
      const modal = document.getElementById("tau-modal");
      if (!modal) return;
      modal.classList.add("hidden");
      document.body.style.overflow = "";
      if (this.testDemo) this.testDemo.resume("tau");
      if (this._pausedByModal) {
        this.charts.setLivePaused(this._userPausedCharts);
        this._pausedByModal = false;
      }
      this._modalEvent = null;
    }

    /* ------------------------------------------------------------------ */
    /* Sesiones                                                            */
    /* ------------------------------------------------------------------ */
    bindSession() {
      const start = document.getElementById("btn-session-start");
      if (start) start.addEventListener("click", () => this.startSession());
      const stop = document.getElementById("btn-session-stop");
      if (stop) stop.addEventListener("click", () => this.stopSession());
      const load = document.getElementById("btn-annotate-load");
      if (load) load.addEventListener("click", () => this.annotate("Inicio manual de carga", "EVENTO_CARGA"));
      const discharge = document.getElementById("btn-annotate-discharge");
      if (discharge) discharge.addEventListener("click", () => this.annotate("Inicio manual de descarga", "EVENTO_DESCARGA"));
      const csv = document.getElementById("btn-export-csv");
      if (csv) csv.addEventListener("click", () => this.exportCurrent("csv"));
      const json = document.getElementById("btn-export-json");
      if (json) json.addEventListener("click", () => this.exportCurrent("json"));
      const refresh = document.getElementById("btn-refresh-sessions");
      if (refresh) refresh.addEventListener("click", () => this.loadSessions());
    }

    async startSession() {
      try {
        const data = await API.startSession();
        UI.toast(`Sesión iniciada: ${data.session.session_id}`, "ok");
        this._sessionSummary = data.session;
        this.applySessionStatus(data.session);
        await this.refreshStatus();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    async stopSession() {
      try {
        const data = await API.stopSession();
        UI.toast(`Sesión guardada: ${data.session.session_id}`, "ok");
        this._sessionSummary = data.session;
        this.applySessionStatus(data.session);
        await this.refreshStatus();
        await this.loadSessions();
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    async annotate(text, category) {
      try {
        await API.annotate(text, category);
        UI.toast(`Anotación registrada: ${text}`, "ok");
      } catch (error) {
        UI.toast(error.message, "error");
      }
    }

    applySessionStatus(session) {
      const active = Boolean(session && session.active);
      const id = document.getElementById("session-id");
      const origin = document.getElementById("session-origin");
      const elapsed = document.getElementById("session-elapsed");
      const start = document.getElementById("btn-session-start");
      const stop = document.getElementById("btn-session-stop");
      const currentOrigin = document.getElementById("current-origin-tag");

      if (id) id.textContent = session && session.session_id ? session.session_id : "NINGUNA";
      if (origin) {
        origin.textContent = session && session.session_id
          ? `${session.origen || "—"} · ${session.protocolo || "—"} · ${session.samples_count || 0} muestras`
          : "Sin origen";
      }
      if (elapsed) elapsed.textContent = session && session.session_id ? FMT.seconds(session.elapsed_seconds || 0, 0) : "0 s";
      if (start) start.classList.toggle("hidden", active);
      if (stop) stop.classList.toggle("hidden", !active);
      if (currentOrigin) {
        currentOrigin.textContent = session && session.session_id
          ? `${session.origen || "—"} · ${session.protocolo || "—"}`
          : "—";
      }
      this.renderCurrentSession(session);
      if (session && session.active && session.valid_samples !== undefined) {
        const samples = document.getElementById("m-samples");
        if (samples) samples.textContent = String(session.valid_samples);
      }
    }

    renderCurrentSession(session) {
      const box = document.getElementById("current-session-box");
      if (!box) return;
      if (!session || !session.session_id) {
        box.textContent = "No hay una sesión activa. Conecta una fuente con tramas válidas y pulsa «Iniciar sesión».";
        return;
      }
      box.innerHTML = `
        <strong>${UI.escapeHtml(session.session_id)}</strong>
        <div class="current-session-grid">
          <div><span>Origen</span><strong>${UI.escapeHtml(session.origen || "—")}</strong></div>
          <div><span>Muestras válidas</span><strong>${session.valid_samples || 0}</strong></div>
          <div><span>Duración</span><strong>${FMT.seconds(session.elapsed_seconds || 0, 1)}</strong></div>
          <div><span>Voltaje techo</span><strong>${session.voltaje_techo_v ? `${FMT.number(session.voltaje_techo_v, 2)} V` : "—"}</strong></div>
        </div>
        <div class="session-actions" style="margin-top:10px;">
          <button class="btn btn-small" data-current-export="csv">Exportar CSV</button>
          <button class="btn btn-small" data-current-export="json">Exportar JSON</button>
        </div>`;
      box.querySelectorAll("[data-current-export]").forEach((button) => {
        button.addEventListener("click", () => this.exportCurrent(button.getAttribute("data-current-export")));
      });
    }

    exportCurrent(fmt) {
      if (!this._sessionSummary || !this._sessionSummary.session_id) {
        UI.toast("No hay una sesión para exportar. Inicia una sesión primero.", "warning");
        return;
      }
      window.open(API.currentExportUrl(fmt), "_blank");
    }

    /**
     * Tras la demostración completa, analiza automáticamente la sesión
     * sintética más reciente para que el panel de Análisis y sus gráficas
     * queden poblados. No cambia de pestaña ni interrumpe la presentación.
     */
    async analyzeLatestSynthetic() {
      try {
        const data = await API.sessions();
        const synthetic = (data.sessions || [])
          .filter((session) => String(session.origen || "").toUpperCase() === "SIMULACION")
          .sort((a, b) => String(b.session_id).localeCompare(String(a.session_id)));
        if (synthetic.length === 0) return null;
        const latest = synthetic[0].session_id;
        if (this.analysis) {
          await this.analysis.analyzeSession(latest);
        }
        return latest;
      } catch (error) {
        console.warn("No se pudo analizar automáticamente la sesión sintética.", error);
        return null;
      }
    }

    async loadSessions() {
      const container = document.getElementById("sessions-list");
      if (!container) return;
      container.innerHTML = "<p class='empty'>Cargando historial…</p>";
      try {
        const data = await API.sessions();
        const sessions = data.sessions || [];
        const count = document.getElementById("sessions-count");
        if (count) count.textContent = `${sessions.length} sesión(es)`;
        if (sessions.length === 0) {
          container.innerHTML = "<p class='empty'>Todavía no hay sesiones guardadas en disco.</p>";
          return;
        }
        container.innerHTML = "";
        sessions.forEach((session) => container.appendChild(this.renderSessionRow(session)));
      } catch (error) {
        container.innerHTML = `<p class='empty'>No se pudo leer el historial: ${UI.escapeHtml(error.message)}</p>`;
      }
    }

    renderSessionRow(session) {
      const row = document.createElement("div");
      row.className = "session-row";
      const legacy = Number(session.schema_version) < 2;
      const origin = String(session.origen || "SERIAL");
      const originClass = legacy ? "origin-legacy" : origin === "SIMULACION" ? "origin-sim" : "origin-serial";
      const originLabel = legacy ? "LEGACY" : origin;
      row.innerHTML = `
        <div>
          <div class="session-row-id">${UI.escapeHtml(session.session_id)}</div>
          <div class="session-row-sub">${UI.escapeHtml(FMT.time(session.created_at))} · ${UI.escapeHtml(session.file || "")}</div>
        </div>
        <div class="session-row-cell"><span>Origen</span><em class="origin-tag ${originClass}">${UI.escapeHtml(originLabel)}</em></div>
        <div class="session-row-cell"><span>Muestras</span>${session.samples || 0}</div>
        <div class="session-row-cell"><span>Duración</span>${FMT.seconds(session.duracion_s || 0, 1)}</div>
        <div class="session-row-actions">
          <button class="btn btn-small" data-action="analyze">Analizar</button>
          <button class="btn btn-small" data-action="csv">CSV</button>
          <button class="btn btn-small" data-action="json">JSON</button>
        </div>`;
      row.querySelectorAll("[data-action]").forEach((button) => {
        button.addEventListener("click", () => {
          const action = button.getAttribute("data-action");
          if (action === "analyze") {
            this.switchView("view-analysis");
            this.analysis.analyzeSession(session.session_id);
          } else {
            window.open(API.exportUrl(session.session_id, action), "_blank");
          }
        });
      });
      return row;
    }

    /* ------------------------------------------------------------------ */
    /* Acciones estáticas y escena                                         */
    /* ------------------------------------------------------------------ */
    bindStaticActions() {
      const general = document.getElementById("btn-view-general");
      if (general) general.addEventListener("click", () => this.scene && this.scene.setView("general"));
      const cap = document.getElementById("btn-view-cap");
      if (cap) cap.addEventListener("click", () => this.scene && this.scene.setView("capacitor"));
      const guided = document.getElementById("btn-view-guided");
      if (guided) guided.addEventListener("click", () => this.scene && this.scene.setView("guided"));
      const reset = document.getElementById("btn-reset-camera");
      if (reset) reset.addEventListener("click", () => this.scene && this.scene.setView("general", true));

      document.querySelectorAll(".js-enter-lab").forEach((button) => {
        button.addEventListener("click", () => this.switchView("view-lab"));
      });
      document.querySelectorAll(".js-config").forEach((button) => {
        button.addEventListener("click", () => this.switchView("view-config"));
      });

      const closeComponent = document.getElementById("btn-close-component");
      if (closeComponent) closeComponent.addEventListener("click", () => this.hideComponentCard());

      const pause = document.getElementById("btn-live-pause");
      if (pause) pause.addEventListener("click", () => {
        this._userPausedCharts = !this._userPausedCharts;
        this.charts.setLivePaused(this._userPausedCharts);
        pause.textContent = this._userPausedCharts ? "Reanudar vista" : "Pausar vista";
        pause.setAttribute("aria-pressed", this._userPausedCharts ? "true" : "false");
      });
      const clear = document.getElementById("btn-live-clear");
      if (clear) clear.addEventListener("click", () => {
        this.charts.clearLive();
        this.store.reset("limpiar_vista");
        this.renderInsight(null);
        this.resetLiveCaption();
        this._latestSample = null;
        this._liveFollowing = true;
        this._liveSelection = null;
        this._liveSceneState = null;
        this._selectedCapIndex = null;
        this.charts.liveCleared = true;
        this.renderLiveCharge(null);
        this.charts.updateLive(true);
        const tau = document.getElementById("m-tau");
        if (tau) tau.textContent = "—";
        const note = document.getElementById("m-tau-note");
        if (note) note.textContent = "Se calcula al cruzar el umbral";
        UI.toast("Vista limpiada. La referencia nominal queda en 0 s; la adquisición continúa.", "info");
      });
    }

    showComponentCard(component) {
      const card = document.getElementById("component-card");
      if (!card || !component) return;
      this._selectedCapIndex = null;
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("cc-kicker", component.kicker || "Componente");
      set("cc-title", component.title);
      set("cc-what", component.what);
      set("cc-role", component.role);
      card.classList.remove("hidden");
    }

    /**
     * Ficha de carga individual al seleccionar uno de los cuatro
     * condensadores: qi(t) = Ci · Vc. La suma coincide con q(t) del banco.
     */
    showCapacitorCard(index, snapshot) {
      const card = document.getElementById("component-card");
      const state = snapshot || this._liveSceneState;
      if (!card || !state) return;
      const i = Number(index);
      if (!Number.isInteger(i) || i < 0 || i > 3) return;
      this._selectedCapIndex = i;
      const perC = Array.isArray(state.perCapacitorC) ? state.perCapacitorC : [];
      const perMax = Array.isArray(state.perCapacitorMaxC) ? state.perCapacitorMaxC : [];
      const ceiling = Number(state.ceiling) || 0;
      const qi = Number(perC[i]) || 0;
      const qmaxi = Number(perMax[i]) || 0;
      const parts = this.capacitanceParts(this.liveRef.c);
      const ciNominal = Number(parts[i]) || (this.liveRef.c / 4);
      const ci = qmaxi > 0 && ceiling > 0 ? qmaxi / ceiling : ciNominal;
      const equalParts = parts.every((value) => Math.abs(value - parts[0]) < 1e-15);
      const nominalText = equalParts
        ? `hipótesis de 4 × ${this.formatNumber(parts[0] * 1e6, 0)} µF en paralelo`
        : parts.map((value, idx) => `C${idx + 1} = ${this.formatNumber(value * 1e6, 0)} µF`).join(" · ");
      const pct = qmaxi > 0 ? Core.clamp((qi / qmaxi) * 100, 0, 100) : 0;
      const total = perC.reduce((sum, q) => sum + (Number(q) || 0), 0);
      const voltage = Number(state.voltage) || 0;
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("cc-kicker", `CONDENSADOR ${i + 1} · CARGA INDIVIDUAL`);
      set("cc-title", `q${i + 1}(t) = ${this.formatNumber(qi * 1000, 2)} mC`);
      set("cc-what", `q${i + 1} = C${i + 1} · Vc = ${this.formatNumber(ci * 1e6, 0)} µF × ${this.formatNumber(voltage, 2)} V. Capacitancia nominal: ${nominalText}.`);
      set("cc-role", `Nivel interno: ${this.formatNumber(pct, 1)} % de su Qmax. Σ qi = ${this.formatNumber(total * 1000, 2)} mC, igual a la carga total q(t) del banco.`);
      card.classList.remove("hidden");
    }

    hideComponentCard() {
      const card = document.getElementById("component-card");
      if (card) card.classList.add("hidden");
    }

    showSceneDiagnostic(message) {
      const container = document.getElementById("scene-live");
      if (!container) return;
      let box = container.querySelector(".scene-diagnostic");
      if (!box) {
        box = document.createElement("div");
        box.className = "scene-diagnostic";
        container.appendChild(box);
      }
      box.innerHTML = `<strong>Escena 3D no disponible</strong><p></p><small>Diagnóstico: ${UI.escapeHtml(message)}</small>`;
      box.querySelector("p").textContent =
        "El resto del laboratorio sigue operativo. Puedes usar las gráficas, el modo prueba y las sesiones.";
    }

    setSimulationVisual(active) {
      const badge = document.getElementById("sim-badge");
      if (badge) badge.classList.toggle("hidden", !active);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!global.RCCore || !global.TelemetryStore || !global.RCCharts || !global.RCLab3D) {
      console.error("Faltan módulos de RC LAB 3D.");
      return;
    }
    global.app = new AppController();
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
