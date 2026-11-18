/**
 * RC LAB 3D — Navegación entre las cinco vistas.
 *
 * Función pura sobre el DOM: no conoce la telemetría ni reinicia módulos.
 * Se puede probar con un DOM mínimo sin navegador.
 */
(function (global) {
  "use strict";

  const VIEW_IDS = ["view-lab", "view-analysis", "view-sim", "view-learn", "view-config", "view-sessions"];

  function isKnown(viewId) {
    return VIEW_IDS.indexOf(viewId) !== -1;
  }

  function list(root, selector) {
    const found = root.querySelectorAll(selector);
    return Array.prototype.slice.call(found || []);
  }

  function activate(viewId, root) {
    const doc = root || global.document;
    if (!doc || !isKnown(viewId)) return false;

    list(doc, ".tab[data-view]").forEach((tab) => {
      const active = tab.getAttribute("data-view") === viewId;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });

    list(doc, ".view").forEach((view) => {
      view.classList.toggle("is-active", view.id === viewId);
    });

    return true;
  }

  const api = { VIEW_IDS: VIEW_IDS.slice(), isKnown, activate };
  global.RCNavigation = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
