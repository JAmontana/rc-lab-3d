/**
 * Controlador Principal del Frontend para RC LAB 3D.
 * Conexión WebSocket, gestión de eventos de interfaz, selección de puertos COM,
 * anotaciones y sincronización en tiempo real.
 */

class AppController {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.isSynthetic = false;
    this.lastSampleTime = 0;
    this.timerInterval = null;

    this.initUI();
    this.initWebSocket();
    this.loadPorts();
  }

  initUI() {
    // Navegación por pestañas
    const tabButtons = document.querySelectorAll(".tab-btn");
    tabButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        tabButtons.forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-view").forEach(v => v.classList.remove("active"));

        btn.classList.add("active");
        const target = btn.getAttribute("data-tab");
        const view = document.getElementById(target);
        if (view) view.classList.add("active");

        // Si se abre la pestaña de circuito 3D completo o de gráficas, reajustar vistas
        if (target === "tab-3d" && !circuit3DFull) {
          circuit3DFull = new CircuitScene3D("scene3d-canvas-full");
        }
        if (target === "tab-charts") {
          scienceCharts.updateAllPlots();
        }
      });
    });

    // Botones de conexión
    document.getElementById("btn-refresh-ports").addEventListener("click", () => this.loadPorts());
    document.getElementById("btn-connect").addEventListener("click", () => this.connectSerial());
    document.getElementById("btn-disconnect").addEventListener("click", () => this.disconnectSerial());
    document.getElementById("btn-synthetic").addEventListener("click", () => this.startSynthetic());

    // Botones de sesión y exportación
    document.getElementById("btn-annotate-charge").addEventListener("click", () => this.annotate("Inicio manual de ciclo de Carga", "EVENTO_CARGA"));
    document.getElementById("btn-annotate-discharge").addEventListener("click", () => this.annotate("Inicio manual de ciclo de Descarga", "EVENTO_DESCARGA"));
    document.getElementById("btn-export-csv").addEventListener("click", () => window.open("/api/session/export/csv", "_blank"));
    document.getElementById("btn-export-json").addEventListener("click", () => window.open("/api/session/export/json", "_blank"));
    document.getElementById("btn-clear-charts").addEventListener("click", () => scienceCharts.clear());

    // Botón reporte
    const btnReport = document.getElementById("btn-print-report");
    if (btnReport) btnReport.addEventListener("click", () => window.print());

    // Refrescar sesiones
    const btnRefSessions = document.getElementById("btn-refresh-sessions");
    if (btnRefSessions) btnRefSessions.addEventListener("click", () => this.loadSessionsList());

    // Monitor de última muestra
    this.timerInterval = setInterval(() => {
      if (this.lastSampleTime > 0) {
        const diff = (Date.now() - this.lastSampleTime) / 1000.0;
        document.getElementById("lbl-time-since-sample").innerText = `${diff.toFixed(1)}s`;
        if (diff > 2.5 && this.connected) {
          document.getElementById("status-indicator-dot").className = "status-dot error";
          document.getElementById("status-text-label").innerText = "DATOS OBSOLETOS";
        }
      }
    }, 500);
  }

  initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("Conectado al WebSocket de telemetría.");
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "SAMPLE") {
          this.handleSample(msg.data);
        } else if (msg.type === "STATUS_INIT") {
          this.updateConnectionState(msg.serial);
        }
      } catch (e) {
        console.error("Error al procesar mensaje WS:", e);
      }
    };

    this.ws.onclose = () => {
      setTimeout(() => this.initWebSocket(), 2000);
    };
  }

  async loadPorts() {
    const select = document.getElementById("com-port-select");
    select.innerHTML = "<option>Buscando puertos...</option>";
    try {
      const resp = await fetch("/api/ports");
      const data = await resp.json();
      select.innerHTML = "";

      if (data.ports.length === 0) {
        select.innerHTML = "<option value=''>Sin puertos COM físicos</option>";
        return;
      }

      data.ports.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.device;
        opt.innerText = `${p.device} (${p.description})`;
        if (p.is_arduino) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (e) {
      select.innerHTML = "<option>Error al consultar puertos</option>";
    }
  }

  async connectSerial() {
    const port = document.getElementById("com-port-select").value;
    if (!port) {
      alert("Seleccione un puerto COM válido o use el 'Modo Test' para emulación física.");
      return;
    }

    try {
      const resp = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: port, baudrate: 115200 })
      });
      const data = await resp.json();
      if (resp.ok) {
        this.setConnectedUI(true, false, port);
      } else {
        alert("Error de conexión: " + data.detail);
      }
    } catch (e) {
      alert("Error al conectar: " + e);
    }
  }

  async disconnectSerial() {
    try {
      await fetch("/api/disconnect", { method: "POST" });
      this.setConnectedUI(false, false, null);
    } catch (e) {
      console.error(e);
    }
  }

  async startSynthetic() {
    try {
      const resp = await fetch("/api/synthetic/start", { method: "POST" });
      if (resp.ok) {
        this.setConnectedUI(true, true, "EMULADOR_SINTETICO");
      }
    } catch (e) {
      alert("Error al iniciar modo sintético: " + e);
    }
  }

  async annotate(text, categoria = "NOTA") {
    try {
      await fetch("/api/session/annotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text, categoria: categoria })
      });
      alert(`Anotación registrada: [${categoria}] ${text}`);
    } catch (e) {
      console.error(e);
    }
  }

  setConnectedUI(connected, isSynthetic, portName) {
    this.connected = connected;
    this.isSynthetic = isSynthetic;

    const btnConnect = document.getElementById("btn-connect");
    const btnDisconnect = document.getElementById("btn-disconnect");
    const dot = document.getElementById("status-indicator-dot");
    const label = document.getElementById("status-text-label");

    if (connected) {
      btnConnect.style.display = "none";
      btnDisconnect.style.display = "inline-flex";
      dot.className = isSynthetic ? "status-dot synthetic" : "status-dot active";
      label.innerText = isSynthetic ? "TEST SINTÉTICO (15ms)" : `CONECTADO (${portName})`;
    } else {
      btnConnect.style.display = "inline-flex";
      btnDisconnect.style.display = "none";
      dot.className = "status-dot";
      label.innerText = "DESCONECTADO";
    }
  }

  updateConnectionState(serialStatus) {
    if (serialStatus && serialStatus.connected) {
      this.setConnectedUI(true, serialStatus.is_synthetic, serialStatus.port);
    }
  }

  handleSample(sample) {
    this.lastSampleTime = Date.now();

    // Actualizar valores numéricos
    document.getElementById("val-v-real").innerText = sample.voltaje_real.toFixed(2);
    document.getElementById("val-v-target").innerText = sample.voltaje_objetivo.toFixed(2);
    document.getElementById("val-v-pot").innerText = sample.limite_pot.toFixed(2);
    document.getElementById("val-error-tracking").innerText = sample.error_seguimiento.toFixed(2);
    document.getElementById("val-pct-scale").innerText = `${sample.porcentaje_escala.toFixed(1)}%`;

    // Barra de escala
    document.getElementById("bar-v-real").style.width = `${Math.min(100, Math.max(0, sample.porcentaje_escala))}%`;

    // Modo inferido
    const lblMode = document.getElementById("lbl-inferred-mode");
    lblMode.innerText = `${sample.modo_estimado} (${Math.round(sample.confianza_modo * 100)}%)`;
    lblMode.style.color = sample.modo_estimado === "CARGA" ? "var(--amber-charge)" : (sample.modo_estimado === "DESCARGA" ? "var(--purple-discharge)" : "var(--cyan-primary)");

    // LEDs virtuales
    document.getElementById("vled-1").className = sample.led1_logico ? "virtual-led active" : "virtual-led";
    document.getElementById("vled-2").className = sample.led2_logico ? "virtual-led active" : "virtual-led";
    document.getElementById("vled-3").className = sample.led3_logico ? "virtual-led active" : "virtual-led";
    document.getElementById("vled-4").className = sample.led4_logico ? "virtual-led active" : "virtual-led";

    // Contadores de sesión
    const validCount = parseInt(document.getElementById("lbl-valid-samples").innerText) || 0;
    document.getElementById("lbl-valid-samples").innerText = (validCount + 1).toString();

    // Actualizar gráficas y gemelo 3D
    if (scienceCharts) scienceCharts.addSample(sample);
    if (circuit3D) circuit3D.updateFromSample(sample);
    if (circuit3DFull) circuit3DFull.updateFromSample(sample);
  }

  async loadSessionsList() {
    const container = document.getElementById("sessions-list-container");
    container.innerHTML = "<p>Cargando lista de sesiones...</p>";
    try {
      const resp = await fetch("/api/status");
      const data = await resp.json();
      const meta = data.session;
      if (meta && meta.session_id) {
        container.innerHTML = `
          <div style="background:rgba(10,16,28,0.8); padding:16px; border-radius:8px; border:1px solid var(--border-subtle);">
            <h3>Sesión Actual: <span style="color:var(--cyan-primary);">${meta.session_id}</span></h3>
            <p style="color:var(--text-muted); margin-top:6px;">Muestras Registradas: <strong>${meta.valid_samples}</strong> | Anotaciones: <strong>${meta.annotations_count}</strong></p>
            <div style="margin-top:12px; display:flex; gap:10px;">
              <a href="/api/session/export/csv" class="btn" target="_blank">Descargar CSV</a>
              <a href="/api/session/export/json" class="btn" target="_blank">Descargar JSON</a>
            </div>
          </div>
        `;
      } else {
        container.innerHTML = "<p style='color:var(--text-muted);'>No hay sesiones activas registradas en la memoria local actual.</p>";
      }
    } catch (e) {
      container.innerHTML = `<p style="color:var(--red-alert);">Error al cargar sesiones: ${e}</p>`;
    }
  }
}

// Iniciar aplicación
document.addEventListener("DOMContentLoaded", () => {
  window.app = new AppController();
});
