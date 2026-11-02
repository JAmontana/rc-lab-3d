/**
 * RC LAB 3D — Núcleo de cálculo puro.
 *
 * Este archivo no toca el DOM. Se puede probar con Node:
 *   node --test tests/frontend/
 *
 * Contiene las ecuaciones RC, los umbrales característicos, la interpolación
 * del cruce de tau, el desempaquetado de millis() y un rastreador de eventos
 * que dispara cada pausa didáctica una sola vez.
 */
(function (global) {
  "use strict";

  const TAU_CHARGE_FACTOR = 1 - Math.exp(-1); // 0.6321205588285577
  const TAU_DISCHARGE_FACTOR = Math.exp(-1);  // 0.36787944117144233
  const MILLIS_MOD = 4294967296;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

  function median(values) {
    if (!values || values.length === 0) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function chargeAt(t, v0, vf, tau) {
    if (!isFiniteNumber(tau) || tau <= 0) return v0;
    return vf - (vf - v0) * Math.exp(-t / tau);
  }

  function dischargeAt(t, v0, vf, tau) {
    if (!isFiniteNumber(tau) || tau <= 0) return v0;
    return vf + (v0 - vf) * Math.exp(-t / tau);
  }

  function modelAt(mode, t, v0, vf, tau) {
    return String(mode).toUpperCase() === "DESCARGA"
      ? dischargeAt(t, v0, vf, tau)
      : chargeAt(t, v0, vf, tau);
  }

  const energyJ = (capacitanceF, voltageV) => 0.5 * capacitanceF * voltageV * voltageV;
  const chargeC = (capacitanceF, voltageV) => capacitanceF * voltageV;

  function characteristicPoint(mode, v0, vf) {
    if (String(mode).toUpperCase() === "DESCARGA") {
      return {
        mode: "DESCARGA",
        voltage_v: vf + TAU_DISCHARGE_FACTOR * (v0 - vf),
        factor: TAU_DISCHARGE_FACTOR,
        percent: TAU_DISCHARGE_FACTOR * 100,
        label: "36,8 % restante",
      };
    }
    return {
      mode: "CARGA",
      voltage_v: v0 + TAU_CHARGE_FACTOR * (vf - v0),
      factor: TAU_CHARGE_FACTOR,
      percent: TAU_CHARGE_FACTOR * 100,
      label: "63,2 % de la variación",
    };
  }

  /** Desempaqueta millis() de Arduino a segundos relativos. */
  function unwrapMillis(values) {
    if (!values || values.length === 0) return { times: [], resetAt: -1 };
    const out = new Array(values.length);
    let offset = 0;
    let previous = null;
    let resetAt = -1;

    for (let i = 0; i < values.length; i += 1) {
      const raw = Number(values[i]);
      if (!Number.isFinite(raw)) return { times: [], resetAt: -1 };
      if (previous === null) {
        out[i] = 0;
      } else {
        let delta = raw - previous;
        if (delta < -(MILLIS_MOD / 2)) delta += MILLIS_MOD; // desbordamiento
        if (delta < 0) {
          resetAt = i;
          offset = out[i - 1] || 0;
          delta = 0;
        }
        out[i] = offset + (out[i - 1] - offset) + delta / 1000;
        if (resetAt === i) out[i] = out[i - 1];
      }
      previous = raw;
    }
    return { times: out, resetAt };
  }

  /**
   * Interpola el primer cruce de un umbral con confirmación posterior.
   * Evita disparar por una única fluctuación del ADC.
   *
   * @param {number[]} times segundos
   * @param {number[]} values voltios
   * @param {number} threshold
   * @param {number} confirm número de muestras posteriores que deben quedar del mismo lado
   */
  function interpolateCrossing(times, values, threshold, confirm = 2) {
    if (!times || !values || times.length < confirm + 2 || times.length !== values.length) {
      return null;
    }
    if (!Number.isFinite(threshold)) return null;

    for (let i = 1; i < values.length; i += 1) {
      const before = values[i - 1];
      const after = values[i];
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      const ascending = after >= before;
      const crosses = ascending
        ? before <= threshold && after >= threshold
        : before >= threshold && after <= threshold;
      if (!crosses) continue;

      // Confirmación: el cruce no puede ser un pico aislado.
      let confirmed = true;
      for (let k = 1; k <= confirm; k += 1) {
        if (i - 1 + k >= values.length) { confirmed = false; break; }
        const probe = values[i - 1 + k];
        if (ascending ? probe < threshold : probe > threshold) { confirmed = false; break; }
      }
      if (!confirmed) continue;

      const denominator = after - before;
      const fraction = Math.abs(denominator) < 1e-12 ? 0 : clamp((threshold - before) / denominator, 0, 1);
      return {
        time_s: times[i - 1] + fraction * (times[i] - times[i - 1]),
        voltage_v: threshold,
        index_before: i - 1,
        index_after: i,
        fraction,
        direction: ascending ? "subida" : "bajada",
      };
    }
    return null;
  }

  /**
   * Estima la asíntota de una exponencial con tres puntos separados.
   * Sirve para obtener un tau provisional en vivo. Se marca como estimación.
   */
  function estimateAsymptote(values, mode, fallback) {
    if (!values || values.length < 6) return fallback;
    const n = values.length;
    const i1 = Math.max(0, Math.floor(n * 0.35));
    const i2 = Math.floor(n * 0.65);
    const i3 = n - 1;
    const v1 = values[i1];
    const v2 = values[i2];
    const v3 = values[i3];
    const denominator = v1 - 2 * v2 + v3;
    if (Math.abs(denominator) < 1e-7) return fallback;
    let asymptote = (v1 * v3 - v2 * v2) / denominator;
    if (!Number.isFinite(asymptote)) return fallback;
    const last = values[n - 1];
    if (String(mode).toUpperCase() === "CARGA") {
      asymptote = clamp(asymptote, Math.max(last, fallback), Math.max(fallback, last + 1e-3) + 5);
    } else {
      asymptote = clamp(asymptote, Math.min(0, last) - 5, Math.min(last, fallback));
    }
    return asymptote;
  }

  /**
   * Rastreador de segmentos y eventos tau.
   * Una instancia consume muestras normalizadas (con voltaje_tanque, estado,
   * device_time_ms o monotonic_time) y devuelve eventos didácticos.
   */
  class TauTracker {
    constructor(options = {}) {
      this.capacitanceF = options.capacitanceF || 0.004;
      this.mode = null;
      this.segment = [];
      this.tail = [];
      this.events = [];
      this.segments = [];
      this.lastDeviceMs = null;
      this.timeBase = 0;
      this.timeCursor = 0;
      this.lastTime = null;
      this.fired = false;
    }

    reset() {
      this.mode = null;
      this.segment = [];
      this.tail = [];
      this.events = [];
      this.segments = [];
      this.lastDeviceMs = null;
      this.timeBase = 0;
      this.timeCursor = 0;
      this.lastTime = null;
      this.fired = false;
    }

    _timeOf(sample) {
      const device = sample && sample.device_time_ms;
      if (Number.isFinite(device)) {
        const raw = Number(device);
        if (this.lastDeviceMs === null) {
          this.lastTime = 0;
        } else {
          let delta = raw - this.lastDeviceMs;
          if (delta < -(MILLIS_MOD / 2)) delta += MILLIS_MOD;
          if (delta < 0) {
            // Reinicio del Arduino: no se puede prolongar el segmento anterior.
            this._finalize("reinicio_dispositivo");
            this.timeBase = this.timeCursor;
            delta = 0;
          }
          this.timeCursor += delta / 1000;
          this.lastTime = this.timeCursor - this.timeBase;
        }
        this.lastDeviceMs = raw;
        return this.lastTime;
      }
      const host = sample && (sample.monotonic_time || sample.timestamp_host);
      if (Number.isFinite(host)) {
        if (this.lastTime === null) this.timeBase = host;
        this.lastTime = host - this.timeBase;
        return this.lastTime;
      }
      return null;
    }

    push(sample) {
      if (!sample) return null;
      const voltage = Number(sample.voltaje_tanque);
      if (!Number.isFinite(voltage)) return null;
      const state = String(sample.estado || "S").toUpperCase();
      const time = this._timeOf(sample);
      if (time === null) return null;

      const point = {
        t: time,
        v: voltage,
        ceiling: Number.isFinite(Number(sample.voltaje_techo)) ? Number(sample.voltaje_techo) : null,
        state,
      };

      if (state === "C" || state === "D") {
        if (this.mode !== state) {
          this._finalize("cambio_de_estado");
          this.mode = state;
          this.segment = [];
          this.tail = [];
          this.fired = false;
        }
        this.segment.push(point);
        this.tail = [];
        return this._maybeEmitLive();
      }

      if (this.mode && state === "S") {
        this.tail.push(point);
        if (this.tail.length >= 5) this._finalize("estabilizado");
      }
      return null;
    }

    _segmentRange() {
      if (this.segment.length < 4) return null;
      const first = this.segment.slice(0, Math.min(3, this.segment.length)).map((p) => p.v);
      const v0 = median(first);
      const tailValues = this.tail.length >= 3
        ? this.tail.slice(-5).map((p) => p.v)
        : this.segment.slice(-4).map((p) => p.v);
      let vf = median(tailValues);
      let vfSource = this.tail.length >= 3 ? "medido_cola" : "ultimas_muestras";
      const highs = this.segment.map((p) => p.v);

      if (this.mode === "C") {
        // Sin cola estable, el techo medido por A1 es la referencia más
        // estable. No se usa la última muestra como si fuera la asíntota.
        if (this.tail.length < 3) {
          const ceiling = this.segment[this.segment.length - 1].ceiling;
          if (ceiling !== null && ceiling > v0 + 0.2) {
            vf = ceiling;
            vfSource = "techo_medido";
          } else if (this.segment.length >= 6) {
            const estimate = estimateAsymptote(highs, "CARGA", vf);
            if (Number.isFinite(estimate) && estimate > vf + 1e-6) {
              vf = estimate;
              vfSource = "asintota_estimada";
            }
          }
        }
        if (vf <= v0 + 0.02) { vf = Math.max(...highs); vfSource = "maximo_observado"; }
      } else {
        // En descarga el objetivo del firmware es llevar el banco a 0 V.
        // Mientras no haya cola medida se usa esa hipótesis y se marca el
        // evento como provisional; al finalizar se recalcula con Vf medido.
        if (this.tail.length < 3) {
          if (v0 > 0.2) {
            vf = 0.0;
            vfSource = "hipotesis_cero";
          } else if (this.segment.length >= 6) {
            const estimate = estimateAsymptote(highs, "DESCARGA", vf);
            if (Number.isFinite(estimate) && estimate < vf - 1e-6) {
              vf = estimate;
              vfSource = "asintota_estimada";
            }
          }
        }
        if (vf >= v0 - 0.02) { vf = Math.min(...highs); vfSource = "minimo_observado"; }
      }
      return { v0, vf, vfSource };
    }

    _maybeEmitLive() {
      if (this.fired || this.segment.length < 8) return null;
      const range = this._segmentRange();
      if (!range) return null;
      const { v0, vf } = range;
      if (Math.abs(vf - v0) < 0.2) return null;

      const modeName = this.mode === "C" ? "CARGA" : "DESCARGA";
      const tp = characteristicPoint(modeName, v0, vf);
      const threshold = tp.voltage_v;
      const times = this.segment.map((p) => p.t);
      const values = this.segment.map((p) => p.v);
      const crossing = interpolateCrossing(times, values, threshold, 2);
      if (!crossing) return null;

      this.fired = true;
      const start = this.segment[0].t;
      const event = {
        id: `tau-${this.mode}-${Math.round(start * 1000)}-${this.events.length}`,
        mode: this.mode === "C" ? "CARGA" : "DESCARGA",
        time_s: crossing.time_s - start,
        absolute_time_s: crossing.time_s,
        voltage_v: crossing.voltage_v,
        v0_v: v0,
        vf_v: vf,
        vf_source: range.vfSource,
        threshold_v: threshold,
        percent: tp.percent,
        label: tp.label,
        provisional: this.tail.length < 3,
        confirmed: false,
        samples: this.segment.length,
      };
      this.events.push(event);
      return event;
    }

    _finalize(reason) {
      if (!this.mode || this.segment.length < 8) {
        this.mode = null;
        this.segment = [];
        this.tail = [];
        return null;
      }
      const range = this._segmentRange();
      const start = this.segment[0].t;
      const end = (this.tail.length ? this.tail[this.tail.length - 1] : this.segment[this.segment.length - 1]).t;
      const summary = {
        mode: this.mode === "C" ? "CARGA" : "DESCARGA",
        start_s: start,
        end_s: end,
        duration_s: end - start,
        samples: this.segment.length,
        v0_v: range ? range.v0 : null,
        vf_v: range ? range.vf : null,
        vf_source: range ? range.vfSource : null,
        reason,
      };

      // Actualiza el evento ya disparado con el Vf medido de la cola y
      // recalcula el cruce con el umbral corregido.
      const existing = this.events.length ? this.events[this.events.length - 1] : null;
      if (existing && existing.mode === summary.mode && range && Math.abs(summary.start_s - (existing.absolute_time_s - existing.time_s)) < 1e-6) {
        const tp = characteristicPoint(summary.mode, range.v0, range.vf);
        const times = this.segment.map((p) => p.t);
        const values = this.segment.map((p) => p.v);
        const corrected = interpolateCrossing(times, values, tp.voltage_v, 2);
        existing.vf_v = range.vf;
        existing.vf_source = range.vfSource;
        existing.v0_v = range.v0;
        existing.threshold_v = tp.voltage_v;
        existing.percent = tp.percent;
        existing.label = tp.label;
        existing.confirmed = true;
        existing.provisional = false;
        if (corrected) {
          existing.time_s = corrected.time_s - start;
          existing.absolute_time_s = corrected.time_s;
          existing.voltage_v = corrected.voltage_v;
        }
      } else if (!this.fired && range && Math.abs(range.vf - range.v0) >= 0.2) {
        const tp = characteristicPoint(summary.mode, range.v0, range.vf);
        const times = this.segment.map((p) => p.t);
        const values = this.segment.map((p) => p.v);
        const crossing = interpolateCrossing(times, values, tp.voltage_v, 2);
        if (crossing) {
          const event = {
            id: `tau-${this.mode}-${Math.round(start * 1000)}-final`,
            mode: summary.mode,
            time_s: crossing.time_s - start,
            absolute_time_s: crossing.time_s,
            voltage_v: crossing.voltage_v,
            v0_v: range.v0,
            vf_v: range.vf,
            vf_source: range.vfSource,
            threshold_v: tp.voltage_v,
            percent: tp.percent,
            label: tp.label,
            provisional: false,
            confirmed: true,
            samples: this.segment.length,
          };
          this.events.push(event);
          summary.event = event;
        } else {
          summary.incomplete = "No se alcanzó el cruce característico con confirmación suficiente";
        }
      }
      this.segments.push(summary);
      this.mode = null;
      this.segment = [];
      this.tail = [];
      this.fired = false;
      return summary;
    }

    flush() {
      return this._finalize("fin_de_flujo");
    }
  }

  const RCCore = {
    TAU_CHARGE_FACTOR,
    TAU_DISCHARGE_FACTOR,
    MILLIS_MOD,
    clamp,
    median,
    chargeAt,
    dischargeAt,
    modelAt,
    energyJ,
    chargeC,
    characteristicPoint,
    unwrapMillis,
    interpolateCrossing,
    estimateAsymptote,
    TauTracker,
  };

  global.RCCore = RCCore;
  if (typeof module !== "undefined" && module.exports) module.exports = RCCore;
})(typeof globalThis !== "undefined" ? globalThis : this);
