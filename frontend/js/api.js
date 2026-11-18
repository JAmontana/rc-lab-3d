/**
 * RC LAB 3D — Cliente de API y utilidades de interfaz.
 * Traduce errores técnicos a mensajes comprensibles y conserva el detalle
 * para la consola y el diagnóstico.
 */
(function (global) {
  "use strict";

  class ApiError extends Error {
    constructor(message, status, detail) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.detail = detail;
    }
  }

  function friendlyMessage(status, detail) {
    if (status === 400) return detail || "La operación no es válida con el estado actual del laboratorio.";
    if (status === 404) return "No se encontró el recurso solicitado.";
    if (status === 422) return "Los datos enviados no tienen el formato esperado. Revisa los campos.";
    if (status >= 500) return "El servidor no pudo completar la operación. Revisa la terminal y /api/diagnostics.";
    return detail || "No se pudo completar la operación.";
  }

  async function request(path, options = {}) {
    const config = Object.assign({ headers: {} }, options);
    if (config.body && typeof config.body !== "string") {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(config.body);
    }
    let response;
    try {
      response = await fetch(path, config);
    } catch (error) {
      throw new ApiError("No se pudo contactar con el servidor local. ¿Está ejecutándose start.ps1?", 0, String(error));
    }
    const contentType = response.headers.get("content-type") || "";
    let payload = null;
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    } else {
      payload = await response.text().catch(() => "");
    }
    if (!response.ok) {
      let detail = payload && payload.detail ? payload.detail : payload;
      if (Array.isArray(detail)) {
        detail = detail.map((item) => item.msg || item.detail || String(item)).join("; ");
      }
      if (!detail && typeof payload === "string") detail = payload.slice(0, 200);
      throw new ApiError(friendlyMessage(response.status, detail), response.status, detail);
    }
    return payload;
  }

  const API = {
    ApiError,
    request,
    ports: () => request("/api/ports"),
    connect: (port, baudrate = 9600) => request("/api/connect", { method: "POST", body: { port, baudrate } }),
    disconnect: () => request("/api/disconnect", { method: "POST" }),
    startSynthetic: (options = {}) => request("/api/synthetic/start", { method: "POST", body: options }),
    stopSynthetic: () => request("/api/synthetic/stop", { method: "POST" }),
    status: () => request("/api/status"),
    diagnostics: () => request("/api/diagnostics"),
    getConfig: () => request("/api/config"),
    saveConfig: (body) => request("/api/config", { method: "PUT", body }),
    startSession: () => request("/api/session/start", { method: "POST" }),
    stopSession: () => request("/api/session/stop", { method: "POST" }),
    annotate: (text, categoria = "NOTA") => request("/api/session/annotate", { method: "POST", body: { text, categoria } }),
    sessions: () => request("/api/sessions"),
    session: (id, includeSamples = false) =>
      request(`/api/sessions/${encodeURIComponent(id)}?include_samples=${includeSamples ? "true" : "false"}`),
    analyze: (body) => request("/api/math/analyze", { method: "POST", body }),
    fit: (body) => request("/api/math/fit", { method: "POST", body }),
    simulate: (body) => request("/api/math/simulate", { method: "POST", body }),
    exportUrl: (id, fmt) => `/api/sessions/${encodeURIComponent(id)}/export/${fmt}`,
    currentExportUrl: (fmt) => `/api/session/export/${fmt}`,
  };

  /* ------------------------------------------------------------------ */
  /* Formato                                                             */
  /* ------------------------------------------------------------------ */
  const FMT = {
    number(value, digits = 3) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      return Number(value).toFixed(digits);
    },
    seconds(value, digits = 2) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      const v = Number(value);
      if (v < 1) return `${(v * 1000).toFixed(0)} ms`;
      if (v < 60) return `${v.toFixed(digits)} s`;
      const min = Math.floor(v / 60);
      const sec = v % 60;
      return `${min} min ${sec.toFixed(1)} s`;
    },
    percent(value, digits = 1) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      return `${Number(value).toFixed(digits)} %`;
    },
    sci(value, digits = 3) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
      const v = Number(value);
      if (v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) >= 10000)) return v.toExponential(digits);
      return v.toFixed(digits);
    },
    time(value) {
      if (!value) return "—";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("es-CO");
    },
    state(value) {
      return { C: "CARGANDO", D: "DESCARGANDO", S: "ESTABLE" }[String(value || "").toUpperCase()] || "—";
    },
  };

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */
  function toast(message, kind = "info", timeout = 4200) {
    const region = document.getElementById("toast-region");
    if (!region) return;
    const node = document.createElement("div");
    node.className = `toast is-${kind}`;
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(() => {
      node.style.opacity = "0";
      node.style.transition = "opacity .25s ease";
      window.setTimeout(() => node.remove(), 260);
    }, timeout);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  global.API = API;
  global.FMT = FMT;
  global.UI = { toast, escapeHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = { API, FMT, UI: { toast, escapeHtml } };
})(typeof globalThis !== "undefined" ? globalThis : this);
