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
      this._init();
    }

    _init() {
      this.initCharts();
      this.initScene();
      this.initSimulator();
      this.initAnalysis();
      this.bindTabs();
      this.bindConnection();
      this.bindSession();
      this.bindTauModal();
      this.bindStaticActions();
      this.bindStore();
      this.loadPorts();
      this.refreshStatus();
      this.loadSessions();
      this.connectWebSocket();

      this.statusTimer = window.setInterval(() => this.refreshStatus(), 2600);
      this.ageTimer = window.setInterval(() => this.updateAge(), 500);
    }

    /* ------------------------------------------------------------------ */
    /* Inicialización                                                      */
    /* ------------------------------------------------------------------ */
    initCharts() {
      this.charts = new global.RCCharts(this.store, {
        onInsight: (event) => this.renderInsight(event),
      });
      this.charts.initLive();
    }

    initScene() {
      if (!global.RCLab3D) return;
      this.scene = new global.RCLab3D("scene-live", {
        onSelect: (component) => this.showComponentCard(component),
      });
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
        onTau: (event, isSimulation) => this.showTauModal(event, isSimulation),
      });
    }

    initAnalysis() {
      this.analysis = new global.AnalysisPanel(this.store, this.charts, {
        onRequestSessions: () => this.switchView("view-sessions"),
      });
      this.analysis.loadConfig().then(() => {
        const c = this.analysis.config && this.analysis.config.capacitancia_f;
        if (Number.isFinite(Number(c))) this.store.setCapacitance(c);
        this.updateCapLabel();
      });
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
      const tabs = Array.from(document.querySelectorAll(".tab"));
      tabs.forEach((tab) => {
        const active = tab.getAttribute("data-view") === viewId;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
      });
      document.querySelectorAll(".view").forEach((view) => view.classList.toggle("is-active", view.id === viewId));

      if (viewId === "view-analysis") {
        window.setTimeout(() => this.charts.resizeAll(), 60);
      }
      if (viewId === "view-sim") {
        this.simulator.ensureScene();
        if (this.simulator.result) this.charts.plotSimulation(this.simulator.result);
        window.setTimeout(() => this.charts.resizeAll(), 80);
      }
      if (viewId === "view-lab" && this.scene) {
        window.setTimeout(() => {
          this.scene.resize();
          this.charts.resizeAll();
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

    async startSynthetic() {
      try {
        const data = await API.startSynthetic();
        UI.toast(data.message || "Emulador iniciado.", "info");
        this.lastStatus = data.serial;
        this.applySerialStatus(data.serial);
        this.store.reset("inicio_simulacion");
        this.charts.clearLive();
        this.updateCapLabel();
      } catch (error) {
        UI.toast(error.message, "error");
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
        this.store.setCapacitance(payload.config.capacitancia_f);
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
      this.updateMetrics(sample);
      if (this.scene) this.scene.updateFromSample(sample);
      this.charts.scheduleLive();
      const staleEl = document.getElementById("scene-stale");
      if (staleEl) staleEl.classList.add("hidden");
      if (this.scene) this.scene.setStale(false);

      if (sample.anomalia && sample.mensaje_anomalia) {
        this.showLabAlert(sample.mensaje_anomalia, "warning", `anomaly-${Math.round(sample.t_rel)}`);
      }
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
        text.textContent = "Cuando la señal alcance el 63,2 % de la carga o el 36,8 % restante de la descarga, aparecerá aquí el tiempo experimental.";
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
          ? "En un τ de carga, el condensador ha recorrido el 63,212 % de la variación total entre V₀ y V_f. La curva continuará acercándose al voltaje techo sin alcanzarlo exactamente en un tiempo finito."
          : "En un τ de descarga queda el 36,788 % de la variación inicial respecto al nivel final. Ese nivel final se mide; no se supone cero.";
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
      if (session && session.valid_samples !== undefined) {
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

      const practice = document.getElementById("btn-start-practice");
      if (practice) practice.addEventListener("click", () => this.switchView("view-lab"));

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
        const tau = document.getElementById("m-tau");
        if (tau) tau.textContent = "—";
        const note = document.getElementById("m-tau-note");
        if (note) note.textContent = "Se calcula al cruzar el umbral";
        UI.toast("Vista limpiada. La adquisición continúa.", "info");
      });
    }

    showComponentCard(component) {
      const card = document.getElementById("component-card");
      if (!card || !component) return;
      const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
      set("cc-kicker", component.kicker || "Componente");
      set("cc-title", component.title);
      set("cc-what", component.what);
      set("cc-role", component.role);
      card.classList.remove("hidden");
    }

    hideComponentCard() {
      const card = document.getElementById("component-card");
      if (card) card.classList.add("hidden");
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
