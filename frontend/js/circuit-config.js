/**
 * RC LAB 3D — Configuración declarada del circuito.
 *
 * El estudiante declara resistencias y condensadores individuales (Ω y µF),
 * elige serie o paralelo, asigna las resistencias de carga/descarga e indica
 * el voltaje de alimentación. Las equivalencias se calculan con las fórmulas
 * de serie y paralelo. Los valores de fábrica son la configuración base
 * documentada y se marcan como ilustrativos/nominales: no son mediciones.
 *
 * El estado se guarda en localStorage y se publica mediante `onChange` para
 * que app.js y simulator.js actualicen gráficas, escena 3D y cálculos.
 */
(function (global) {
  "use strict";

  const Core = global.RCCore
    || (typeof require === "function" ? require("./core.js") : null);
  const STORAGE_KEY = "rc_lab_circuit_config_v1";
  const ROLES = ["carga", "descarga", "ambas"];

  const DEFAULT_STATE = {
    version: 1,
    resistorTopology: "serie",
    capacitorTopology: "paralelo",
    supplyVoltage: 5,
    measuredCeqUf: null,
    measuredReqChargeOhm: null,
    measuredReqDischargeOhm: null,
    resistors: [
      { id: "r1", ohm: 4700, role: "ambas", origin: "ilustrativo" },
    ],
    capacitors: [
      { id: "c1", uf: 1000, origin: "nominal" },
      { id: "c2", uf: 1000, origin: "nominal" },
      { id: "c3", uf: 1000, origin: "nominal" },
      { id: "c4", uf: 1000, origin: "nominal" },
    ],
  };

  let sequence = 0;

  function nextId(prefix) {
    sequence += 1;
    return `${prefix}${Date.now().toString(36)}${sequence}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultState() {
    return clone(DEFAULT_STATE);
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function trimZeros(text) {
    if (!text.includes(",")) return text;
    return text.replace(/0+$/, "").replace(/,$/, "");
  }

  function groupThousands(text) {
    return String(text).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  function fmt(value, digits = 2) {
    if (!Number.isFinite(Number(value))) return "—";
    return trimZeros(Number(value).toFixed(digits).replace(".", ","));
  }

  function fmtComponent(value) {
    if (!Number.isFinite(Number(value))) return "—";
    const number = Number(value);
    if (Math.abs(number - Math.round(number)) < 1e-9) return groupThousands(Math.round(number));
    return trimZeros(groupThousands(number.toFixed(3))).replace(".", ",");
  }

  function fmtR(value) {
    return `${fmtComponent(value)} Ω`;
  }

  function fmtF(value) {
    if (!(Number(value) > 0)) return "—";
    return `${fmt(value, 6)} F`;
  }

  function fmtUf(valueFarads) {
    if (!(Number(valueFarads) > 0)) return "—";
    return `${fmtComponent(Number(valueFarads) * 1e6)} µF`;
  }

  function originLabel(origin) {
    const value = String(origin || "").toLowerCase();
    if (value === "ilustrativo") return "valor ilustrativo · confirmar en el montaje";
    if (value === "nominal") return "valor nominal documentado";
    if (value === "medido") return "valor medido";
    return "valor declarado";
  }

  function normalizeRole(role) {
    const value = String(role || "").toLowerCase();
    return ROLES.indexOf(value) !== -1 ? value : "ambas";
  }

  function normalizeOrigin(origin, fallback) {
    const value = String(origin || "").toLowerCase();
    if (["ilustrativo", "nominal", "medido", "declarado"].indexOf(value) !== -1) return value;
    return fallback;
  }

  function normalizeResistor(item, index) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id || `r${index + 1}`),
      ohm: toNumber(source.ohm),
      role: normalizeRole(source.role),
      origin: normalizeOrigin(source.origin, "declarado"),
    };
  }

  function normalizeCapacitor(item, index) {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id || `c${index + 1}`),
      uf: toNumber(source.uf),
      origin: normalizeOrigin(source.origin, "declarado"),
    };
  }

  function normalizeState(raw) {
    const base = defaultState();
    if (!raw || typeof raw !== "object") return base;

    const state = {
      version: 1,
      resistorTopology: raw.resistorTopology === "paralelo" ? "paralelo" : "serie",
      capacitorTopology: raw.capacitorTopology === "serie" ? "serie" : "paralelo",
      supplyVoltage: toNumber(raw.supplyVoltage),
      measuredCeqUf: toNumber(raw.measuredCeqUf),
      measuredReqChargeOhm: toNumber(raw.measuredReqChargeOhm),
      measuredReqDischargeOhm: toNumber(raw.measuredReqDischargeOhm),
      resistors: Array.isArray(raw.resistors)
        ? raw.resistors.map(normalizeResistor)
        : base.resistors,
      capacitors: Array.isArray(raw.capacitors)
        ? raw.capacitors.map(normalizeCapacitor)
        : base.capacitors,
    };
    if (state.resistors.length === 0) {
      state.resistors.push({ id: nextId("r"), ohm: null, role: "ambas", origin: "declarado" });
    }
    if (state.capacitors.length === 0) {
      state.capacitors.push({ id: nextId("c"), uf: null, origin: "declarado" });
    }
    return state;
  }

  function validResistors(state, role) {
    return state.resistors.filter((item) => {
      if (!(Number(item.ohm) > 0)) return false;
      if (!role) return true;
      return item.role === role || item.role === "ambas";
    });
  }

  function validCapacitors(state) {
    return state.capacitors.filter((item) => Number(item.uf) > 0);
  }

  function roleLabel(role) {
    if (role === "carga") return "carga";
    if (role === "descarga") return "descarga";
    return "carga y descarga";
  }

  /**
   * Fórmula de Req con los componentes del grupo. No inventa un valor: si no
   * hay componentes válidos devuelve el texto de dato pendiente.
   */
  function resistanceFormula(items, topology, measuredOhm) {
    if (measuredOhm > 0) return `Req (medida) = ${fmtR(measuredOhm)}`;
    if (items.length === 0) return "Req = dato pendiente de configurar";
    const values = items.map((item) => item.ohm);
    const names = values.map((_, index) => `R${index + 1}`);
    const numbers = values.map((value) => fmtComponent(value)).join(" + ");
    const result = Core.equivalentResistance(values, topology);
    if (!(result > 0)) return "Req = dato pendiente de configurar";
    if (String(topology) === "paralelo") {
      return `1/Req = ${names.map((name) => `1/${name}`).join(" + ")} = ${values
        .map((value) => `1/${fmtComponent(value)}`)
        .join(" + ")} → Req = ${fmtR(result)}`;
    }
    return `Req = ${names.join(" + ")} = ${numbers} = ${fmtR(result)}`;
  }

  function capacitanceFormula(items, topology, measuredF) {
    if (measuredF > 0) return `Ceq (medida) = ${fmtF(measuredF)} = ${fmtUf(measuredF)}`;
    if (items.length === 0) return "Ceq = dato pendiente de configurar";
    const values = items.map((item) => item.uf * 1e-6);
    const names = values.map((_, index) => `C${index + 1}`);
    const numbers = values.map((value) => fmtComponent(value * 1e6)).join(" + ");
    const result = Core.equivalentCapacitance(values, topology);
    if (!(result > 0)) return "Ceq = dato pendiente de configurar";
    if (String(topology) === "serie") {
      return `1/Ceq = ${names.map((name) => `1/${name}`).join(" + ")} = ${values
        .map((value) => `1/${fmtComponent(value * 1e6)}`)
        .join(" + ")} → Ceq = ${fmtUf(result)} = ${fmtF(result)}`;
    }
    return `Ceq = ${names.join(" + ")} = ${numbers} µF = ${fmtUf(result)} = ${fmtF(result)}`;
  }

  function componentsText(state) {
    const resistors = validResistors(state, null)
      .map((item) => `${fmtR(item.ohm)} (${roleLabel(item.role)})`)
      .join(" + ");
    const caps = validCapacitors(state)
      .map((item) => fmtComponent(item.uf))
      .join(" + ");
    const left = resistors || "sin resistencias declaradas";
    const right = caps
      ? `${caps} µF en ${state.capacitorTopology}`
      : "sin condensadores declarados";
    return `${left} · ${right}`;
  }

  /**
   * Resume el estado y calcula Req, Ceq, τ y Qmax. Es una función pura para
   * poder probarla con Node sin DOM.
   */
  function summarize(rawState) {
    const state = normalizeState(rawState);
    const caps = validCapacitors(state);
    const calcCeqF = Core.equivalentCapacitance(
      caps.map((item) => item.uf * 1e-6),
      state.capacitorTopology
    );
    const measuredCeqF = state.measuredCeqUf > 0 ? state.measuredCeqUf * 1e-6 : null;
    const ceq = measuredCeqF || calcCeqF;

    const chargeItems = validResistors(state, "carga");
    const dischargeItems = validResistors(state, "descarga");
    const calcReqCharge = Core.equivalentResistance(
      chargeItems.map((item) => item.ohm),
      state.resistorTopology
    );
    const calcReqDischarge = Core.equivalentResistance(
      dischargeItems.map((item) => item.ohm),
      state.resistorTopology
    );
    const reqCarga = state.measuredReqChargeOhm > 0 ? state.measuredReqChargeOhm : calcReqCharge;
    const reqDescarga = state.measuredReqDischargeOhm > 0
      ? state.measuredReqDischargeOhm
      : calcReqDischarge;

    const tauCarga = Core.tauOf(reqCarga, ceq);
    const tauDescarga = Core.tauOf(reqDescarga, ceq);
    const ve = state.supplyVoltage > 0 ? state.supplyVoltage : null;
    const qMaxC = Core.qMaxC(ceq, ve);

    const pending = {
      ceq: !(ceq > 0),
      reqCarga: !(reqCarga > 0),
      reqDescarga: !(reqDescarga > 0),
      ve: !(ve > 0),
    };

    const capacitancePartsF = caps.length === 4
      ? caps.map((item) => item.uf * 1e-6)
      : null;

    return {
      state,
      ve,
      ceq,
      calcCeqF,
      reqCarga,
      reqDescarga,
      tauCarga,
      tauDescarga,
      qMaxC,
      ceqSource: measuredCeqF ? "medido" : (ceq > 0 ? "calculado" : "pendiente"),
      reqCargaSource: state.measuredReqChargeOhm > 0 ? "medido" : (reqCarga > 0 ? "calculado" : "pendiente"),
      reqDescargaSource: state.measuredReqDischargeOhm > 0 ? "medido" : (reqDescarga > 0 ? "calculado" : "pendiente"),
      ceqFormula: capacitanceFormula(caps, state.capacitorTopology, measuredCeqF),
      reqCargaFormula: resistanceFormula(chargeItems, state.resistorTopology, state.measuredReqChargeOhm),
      reqDescargaFormula: resistanceFormula(dischargeItems, state.resistorTopology, state.measuredReqDischargeOhm),
      componentsText: componentsText(state),
      capacitancePartsF,
      pending,
      hasPending: Object.keys(pending).some((key) => pending[key]),
    };
  }

  function loadState() {
    try {
      if (typeof localStorage === "undefined") return defaultState();
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) return defaultState();
      return normalizeState(JSON.parse(text));
    } catch (error) {
      return defaultState();
    }
  }

  function saveState(state) {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      /* almacenamiento no disponible: la sesión sigue en memoria */
    }
  }

  class CircuitConfigPanel {
    constructor(options = {}) {
      if (typeof document === "undefined" || !document.getElementById) return;
      this.onChange = typeof options.onChange === "function" ? options.onChange : null;
      this.onContinue = typeof options.onContinue === "function" ? options.onContinue : null;
      this.state = options.state ? normalizeState(options.state) : loadState();
      this._lastSummary = null;
      this._renderAll();
      this._bind();
      this.emit();
    }

    summary() {
      return summarize(this.state);
    }

    _find(kind, id) {
      const list = kind === "resistor" ? this.state.resistors : this.state.capacitors;
      return list.find((item) => item.id === id) || null;
    }

    _renderAll() {
      const resTopology = document.getElementById("cfg-res-topology");
      if (resTopology) resTopology.value = this.state.resistorTopology;
      const capTopology = document.getElementById("cfg-cap-topology");
      if (capTopology) capTopology.value = this.state.capacitorTopology;
      const supply = document.getElementById("cfg-supply");
      if (supply) supply.value = this.state.supplyVoltage === null ? "" : String(this.state.supplyVoltage);
      const measuredC = document.getElementById("cfg-measured-c");
      if (measuredC) measuredC.value = this.state.measuredCeqUf === null ? "" : String(this.state.measuredCeqUf);
      const measuredRc = document.getElementById("cfg-measured-r-charge");
      if (measuredRc) measuredRc.value = this.state.measuredReqChargeOhm === null ? "" : String(this.state.measuredReqChargeOhm);
      const measuredRd = document.getElementById("cfg-measured-r-discharge");
      if (measuredRd) measuredRd.value = this.state.measuredReqDischargeOhm === null ? "" : String(this.state.measuredReqDischargeOhm);
      this._renderResistors();
      this._renderCapacitors();
      this._renderSummary();
    }

    _renderResistors() {
      const list = document.getElementById("cfg-resistors-list");
      if (!list) return;
      list.innerHTML = "";
      this.state.resistors.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "component-row";
        row.dataset.id = item.id;

        const valueLabel = document.createElement("label");
        valueLabel.className = "component-value";
        const valueCaption = document.createElement("span");
        valueCaption.textContent = `R${index + 1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0.001";
        input.step = "1";
        input.dataset.field = "value";
        input.value = item.ohm === null ? "" : String(item.ohm);
        input.setAttribute("aria-label", `Resistencia ${index + 1} en ohmios`);
        const unit = document.createElement("span");
        unit.className = "component-unit";
        unit.textContent = "Ω";
        valueLabel.append(valueCaption, input, unit);

        const roleLabelElement = document.createElement("label");
        roleLabelElement.className = "component-role";
        const roleCaption = document.createElement("span");
        roleCaption.textContent = "Uso";
        const role = document.createElement("select");
        role.dataset.field = "role";
        role.setAttribute("aria-label", `Uso de la resistencia ${index + 1}`);
        [["carga", "Carga"], ["descarga", "Descarga"], ["ambas", "Carga y descarga"]].forEach(([value, text]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = text;
          role.appendChild(option);
        });
        role.value = item.role;
        roleLabelElement.append(roleCaption, role);

        const origin = document.createElement("small");
        origin.className = "component-origin";
        origin.textContent = originLabel(item.origin);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-icon btn-ghost";
        remove.dataset.action = "remove";
        remove.setAttribute("aria-label", `Eliminar resistencia ${index + 1}`);
        remove.textContent = "×";

        row.append(valueLabel, roleLabelElement, origin, remove);
        list.appendChild(row);
      });
    }

    _renderCapacitors() {
      const list = document.getElementById("cfg-capacitors-list");
      if (!list) return;
      list.innerHTML = "";
      this.state.capacitors.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "component-row";
        row.dataset.id = item.id;

        const valueLabel = document.createElement("label");
        valueLabel.className = "component-value";
        const valueCaption = document.createElement("span");
        valueCaption.textContent = `C${index + 1}`;
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0.000001";
        input.step = "1";
        input.dataset.field = "value";
        input.value = item.uf === null ? "" : String(item.uf);
        input.setAttribute("aria-label", `Condensador ${index + 1} en microfaradios`);
        const unit = document.createElement("span");
        unit.className = "component-unit";
        unit.textContent = "µF";
        valueLabel.append(valueCaption, input, unit);

        const origin = document.createElement("small");
        origin.className = "component-origin";
        origin.textContent = originLabel(item.origin);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-icon btn-ghost";
        remove.dataset.action = "remove";
        remove.setAttribute("aria-label", `Eliminar condensador ${index + 1}`);
        remove.textContent = "×";

        row.append(valueLabel, origin, remove);
        list.appendChild(row);
      });
    }

    _renderSummary() {
      const box = document.getElementById("cfg-summary");
      if (!box) return;
      const summary = this.summary();
      this._lastSummary = summary;
      box.innerHTML = "";

      const addRow = (label, value, formula, pending) => {
        const item = document.createElement("div");
        item.className = `config-eq${pending ? " is-pending" : ""}`;
        const head = document.createElement("div");
        head.className = "config-eq-head";
        const name = document.createElement("span");
        name.textContent = label;
        const result = document.createElement("strong");
        result.textContent = value;
        head.append(name, result);
        const detail = document.createElement("code");
        detail.textContent = formula;
        item.append(head, detail);
        box.appendChild(item);
      };

      addRow(
        "Req de carga",
        summary.reqCarga > 0 ? fmtR(summary.reqCarga) : "Dato pendiente",
        summary.reqCargaFormula,
        summary.pending.reqCarga
      );
      addRow(
        "Req de descarga",
        summary.reqDescarga > 0 ? fmtR(summary.reqDescarga) : "Dato pendiente",
        summary.reqDescargaFormula,
        summary.pending.reqDescarga
      );
      addRow(
        "Ceq",
        summary.ceq > 0 ? `${fmtUf(summary.ceq)} · ${fmtF(summary.ceq)}` : "Dato pendiente",
        summary.ceqFormula,
        summary.pending.ceq
      );
      addRow(
        "τ de carga",
        summary.tauCarga > 0 ? `${fmt(summary.tauCarga, 2)} s` : "Dato pendiente",
        summary.pending.reqCarga || summary.pending.ceq
          ? "τ = Req × Ceq · faltan datos por configurar"
          : `τ = ${fmtR(summary.reqCarga)} × ${fmtF(summary.ceq)} = ${fmt(summary.tauCarga, 2)} s`,
        summary.pending.reqCarga || summary.pending.ceq
      );
      addRow(
        "τ de descarga",
        summary.tauDescarga > 0 ? `${fmt(summary.tauDescarga, 2)} s` : "Dato pendiente",
        summary.pending.reqDescarga || summary.pending.ceq
          ? "τ = Req × Ceq · faltan datos por configurar"
          : `τ = ${fmtR(summary.reqDescarga)} × ${fmtF(summary.ceq)} = ${fmt(summary.tauDescarga, 2)} s`,
        summary.pending.reqDescarga || summary.pending.ceq
      );
      addRow(
        "Qmax de referencia",
        summary.qMaxC > 0 ? `${fmt(summary.qMaxC * 1000, 2)} mC` : "Dato pendiente",
        summary.pending.ceq || summary.pending.ve
          ? "Qmax = Ceq × Ve · faltan datos por configurar"
          : `Qmax = ${fmtF(summary.ceq)} × ${fmt(summary.ve, 2)} V = ${fmt(summary.qMaxC * 1000, 2)} mC`,
        summary.pending.ceq || summary.pending.ve
      );

      const note = document.createElement("p");
      note.className = "config-summary-note";
      note.textContent = summary.hasPending
        ? "Hay datos pendientes. El laboratorio mostrará «Dato pendiente de configurar» en lugar de inventar un resultado."
        : "Valores declarados por el estudiante. No son una medición certificada del montaje.";
      box.appendChild(note);
    }

    _bind() {
      const addResistor = document.getElementById("btn-add-resistor");
      if (addResistor) addResistor.addEventListener("click", () => {
        this.state.resistors.push({ id: nextId("r"), ohm: null, role: "ambas", origin: "declarado" });
        this._renderResistors();
        this.emit();
      });
      const addCapacitor = document.getElementById("btn-add-capacitor");
      if (addCapacitor) addCapacitor.addEventListener("click", () => {
        this.state.capacitors.push({ id: nextId("c"), uf: null, origin: "declarado" });
        this._renderCapacitors();
        this.emit();
      });
      const reset = document.getElementById("btn-config-reset");
      if (reset) reset.addEventListener("click", () => {
        this.state = defaultState();
        this._renderAll();
        this.emit();
      });
      const cont = document.getElementById("btn-config-continue");
      if (cont) cont.addEventListener("click", () => {
        this.emit();
        if (this.onContinue) this.onContinue(this.summary());
      });

      const resTopology = document.getElementById("cfg-res-topology");
      if (resTopology) resTopology.addEventListener("change", () => {
        this.state.resistorTopology = resTopology.value === "paralelo" ? "paralelo" : "serie";
        this.emit();
      });
      const capTopology = document.getElementById("cfg-cap-topology");
      if (capTopology) capTopology.addEventListener("change", () => {
        this.state.capacitorTopology = capTopology.value === "serie" ? "serie" : "paralelo";
        this.emit();
      });

      const bindNumber = (id, key) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener("input", () => {
          this.state[key] = toNumber(input.value);
          this.emit();
        });
      };
      bindNumber("cfg-supply", "supplyVoltage");
      bindNumber("cfg-measured-c", "measuredCeqUf");
      bindNumber("cfg-measured-r-charge", "measuredReqChargeOhm");
      bindNumber("cfg-measured-r-discharge", "measuredReqDischargeOhm");

      this._bindList("cfg-resistors-list", "resistor");
      this._bindList("cfg-capacitors-list", "capacitor");
    }

    _bindList(listId, kind) {
      const list = document.getElementById(listId);
      if (!list) return;
      const valueKey = kind === "resistor" ? "ohm" : "uf";
      list.addEventListener("input", (event) => {
        const input = event.target && event.target.closest
          ? event.target.closest("input[data-field='value']")
          : null;
        if (!input) return;
        const row = input.closest("[data-id]");
        const item = row ? this._find(kind, row.dataset.id) : null;
        if (!item) return;
        item[valueKey] = toNumber(input.value);
        item.origin = "declarado";
        const origin = row.querySelector(".component-origin");
        if (origin) origin.textContent = originLabel(item.origin);
        this.emit();
      });
      list.addEventListener("change", (event) => {
        const select = event.target && event.target.closest
          ? event.target.closest("select[data-field='role']")
          : null;
        if (!select || kind !== "resistor") return;
        const row = select.closest("[data-id]");
        const item = row ? this._find(kind, row.dataset.id) : null;
        if (!item) return;
        item.role = normalizeRole(select.value);
        this.emit();
      });
      list.addEventListener("click", (event) => {
        const button = event.target && event.target.closest
          ? event.target.closest("button[data-action='remove']")
          : null;
        if (!button) return;
        const row = button.closest("[data-id]");
        if (!row) return;
        if (kind === "resistor") {
          this.state.resistors = this.state.resistors.filter((item) => item.id !== row.dataset.id);
          if (this.state.resistors.length === 0) {
            this.state.resistors.push({ id: nextId("r"), ohm: null, role: "ambas", origin: "declarado" });
          }
          this._renderResistors();
        } else {
          this.state.capacitors = this.state.capacitors.filter((item) => item.id !== row.dataset.id);
          if (this.state.capacitors.length === 0) {
            this.state.capacitors.push({ id: nextId("c"), uf: null, origin: "declarado" });
          }
          this._renderCapacitors();
        }
        this.emit();
      });
    }

    emit() {
      this._renderSummary();
      saveState(this.state);
      if (this.onChange) this.onChange(this.summary());
    }
  }

  const api = {
    STORAGE_KEY,
    DEFAULT_STATE,
    defaultState,
    normalizeState,
    summarize,
    loadState,
    saveState,
    CircuitConfigPanel,
  };
  global.RCCircuitConfig = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
