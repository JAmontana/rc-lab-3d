/**
 * RC LAB 3D — Almacén único de telemetría.
 *
 * Toda la interfaz (3D, gráficas, métricas y pausas) consume el mismo flujo
 * validado. El almacén conserva los valores reales recibidos y calcula solo
 * magnitudes derivadas: energía, carga, porcentajes y eventos tau.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore;

  class TelemetryStore {
    constructor(options = {}) {
      this.capacitanceF = options.capacitanceF || 0.004;
      this.maxSamples = options.maxSamples || 20000;
      this.samples = [];
      this.current = null;
      this.status = null;
      this.session = null;
      this.origin = null;
      this.lastSampleAt = 0;
      this.lastDeviceMs = null;
      this.timeCursor = 0;
      this.tracker = new Core.TauTracker({ capacitanceF: this.capacitanceF });
      this.tauEvents = [];
      this.segments = [];
      this.listeners = { sample: [], event: [], status: [], stale: [] };
      this._rateWindow = [];
      this._stale = false;
      this._hostBase = undefined;
      this._timer = global.setInterval ? global.setInterval(() => this._checkStale(), 500) : null;
    }

    on(type, callback) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(callback);
      return () => {
        this.listeners[type] = this.listeners[type].filter((fn) => fn !== callback);
      };
    }

    _emit(type, payload) {
      (this.listeners[type] || []).forEach((callback) => {
        try { callback(payload); } catch (error) { console.error(`Error en listener ${type}`, error); }
      });
    }

    setCapacitance(value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        this.capacitanceF = parsed;
        this.tracker.capacitanceF = parsed;
      }
    }

    reset(reason = "manual") {
      this.samples = [];
      this.current = null;
      this.origin = null;
      this.lastSampleAt = 0;
      this.lastDeviceMs = null;
      this.timeCursor = 0;
      this._hostBase = undefined;
      this.tauEvents = [];
      this.segments = [];
      this._rateWindow = [];
      this._stale = false;
      this.tracker.reset();
      this._emit("event", { type: "RESET", reason });
    }

    normalize(raw) {
      const sample = Object.assign({}, raw);
      sample.voltaje_tanque = Number(sample.voltaje_tanque);
      sample.voltaje_techo = Number(sample.voltaje_techo);
      sample.estado = String(sample.estado || "S").toUpperCase();
      sample.origen = String(sample.origen || "SERIAL").toUpperCase();
      sample.pwm = sample.pwm === null || sample.pwm === undefined ? null : Number(sample.pwm);
      sample.adc_a0 = Number.isFinite(Number(sample.adc_a0)) ? Number(sample.adc_a0) : null;
      sample.adc_a1 = Number.isFinite(Number(sample.adc_a1)) ? Number(sample.adc_a1) : null;

      const device = Number(sample.device_time_ms);
      if (Number.isFinite(device)) {
        if (this.lastDeviceMs === null) {
          this.timeCursor = 0;
        } else {
          let delta = device - this.lastDeviceMs;
          if (delta < -(Core.MILLIS_MOD / 2)) delta += Core.MILLIS_MOD;
          if (delta >= 0) this.timeCursor += delta / 1000;
        }
        this.lastDeviceMs = device;
        sample.t_rel = this.timeCursor;
        sample.device_ms_normalized = device;
      } else {
        const host = Number(sample.monotonic_time || sample.timestamp_host);
        if (Number.isFinite(host)) {
          if (this._hostBase === undefined) this._hostBase = host;
          sample.t_rel = host - this._hostBase;
        } else {
          sample.t_rel = 0;
        }
      }
      return sample;
    }

    ingest(raw) {
      if (!raw || !Number.isFinite(Number(raw.voltaje_tanque))) return null;
      const sample = this.normalize(raw);
      if (!Number.isFinite(sample.voltaje_tanque)) return null;

      if (this.origin && this.origin !== sample.origen) {
        // Cambio de fuente: no mezclar datos reales con simulación.
        this.reset("cambio_de_origen");
      }
      this.origin = sample.origen;
      this.current = sample;
      this.lastSampleAt = Date.now();
      this.samples.push(sample);
      if (this.samples.length > this.maxSamples) this.samples.shift();
      this._rateWindow.push(this.lastSampleAt);
      this._pruneRate();
      if (this._stale) { this._stale = false; this._emit("stale", false); }

      const derived = this.derive(sample);
      sample.derived = derived;
      const event = this.tracker.push(sample);
      if (event) {
        event.id = `${this.origin || "SERIE"}-${event.id}`;
        event.origin = this.origin;
        event.capacitance_f = this.capacitanceF;
        this.tauEvents.push(event);
        this._emit("event", { type: "TAU", event });
      }
      this._emit("sample", sample);
      return sample;
    }

    derive(sample) {
      const v = sample.voltaje_tanque;
      const ceiling = sample.voltaje_techo;
      const c = this.capacitanceF;
      const energy = Core.energyJ(c, v);
      const refEnergy = Core.energyJ(c, Math.max(ceiling, 0.001));
      const voltagePct = ceiling > 0.05 ? (v / ceiling) * 100 : 0;
      const leds = {
        red: ceiling > 0.05 && v >= ceiling * 0.30,
        amber60: ceiling > 0.05 && v >= ceiling * 0.60,
        amber90: ceiling > 0.05 && v >= ceiling * 0.90,
      };
      return {
        voltage: v,
        ceiling,
        voltagePct: Core.clamp(voltagePct, 0, 200),
        energyJ: energy,
        energyPct: refEnergy > 0 ? Core.clamp((energy / refEnergy) * 100, 0, 100) : 0,
        refEnergyJ: refEnergy,
        chargeC: Core.chargeC(c, v),
        leds,
      };
    }

    _pruneRate() {
      const now = Date.now();
      this._rateWindow = this._rateWindow.filter((stamp) => now - stamp <= 2000);
    }

    getRate() {
      this._pruneRate();
      if (this._rateWindow.length < 2) return 0;
      const span = (this._rateWindow[this._rateWindow.length - 1] - this._rateWindow[0]) / 1000;
      return span > 0 ? (this._rateWindow.length - 1) / span : 0;
    }

    getAge() {
      return this.lastSampleAt ? (Date.now() - this.lastSampleAt) / 1000 : null;
    }

    isStale(threshold = 3.5) {
      const age = this.getAge();
      return age !== null && age > threshold;
    }

    _checkStale() {
      if (!this.current) return;
      const stale = this.isStale();
      if (stale !== this._stale) {
        this._stale = stale;
        this._emit("stale", stale);
      }
    }

    setStatus(status) {
      this.status = status;
      this._emit("status", status);
    }

    setSession(session) {
      this.session = session;
      this._emit("status", { serial: this.status ? this.status.serial : null, session });
    }

    series(source = this.samples) {
      return source.map((sample) => ({
        t: sample.t_rel,
        v: sample.voltaje_tanque,
        ceiling: sample.voltaje_techo,
        state: sample.estado,
        energy: sample.derived ? sample.derived.energyJ : Core.energyJ(this.capacitanceF, sample.voltaje_tanque),
        charge: sample.derived ? sample.derived.chargeC : Core.chargeC(this.capacitanceF, sample.voltaje_tanque),
      }));
    }
  }

  global.TelemetryStore = TelemetryStore;
  if (typeof module !== "undefined" && module.exports) module.exports = TelemetryStore;
})(typeof globalThis !== "undefined" ? globalThis : this);
