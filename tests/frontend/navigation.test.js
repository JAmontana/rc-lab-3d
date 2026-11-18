"use strict";

/**
 * Prueba de navegación de las cinco vistas sin navegador.
 * Verifica el estado activo, aria-selected y que la vista anterior se oculte.
 *   node --test tests/frontend
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Navigation = require("../../frontend/js/navigation.js");

function makeClassList() {
  const values = new Set();
  return {
    toggle(name, force) {
      const on = force === undefined ? !values.has(name) : Boolean(force);
      if (on) values.add(name);
      else values.delete(name);
      return on;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function makeElement(id, extra) {
  const attrs = Object.assign({}, extra || {});
  return {
    id,
    classList: makeClassList(),
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
  };
}

function makeDocument() {
  const views = Navigation.VIEW_IDS.map((id) => makeElement(id));
  views[0].classList.toggle("is-active", true);
  const tabs = Navigation.VIEW_IDS.map((id) => {
    const tab = makeElement(null, { "data-view": id });
    tab.classList.toggle("is-active", id === "view-lab");
    return tab;
  });
  return {
    views,
    tabs,
    querySelectorAll(selector) {
      if (selector === ".view") return views;
      if (selector === ".tab[data-view]") return tabs;
      return [];
    },
  };
}

test("la navegación conoce exactamente las seis vistas", () => {
  assert.deepEqual(Navigation.VIEW_IDS, [
    "view-lab",
    "view-analysis",
    "view-sim",
    "view-learn",
    "view-config",
    "view-sessions",
  ]);
});

test("activar cada vista oculta las demás y actualiza aria-selected", () => {
  const doc = makeDocument();
  for (const viewId of Navigation.VIEW_IDS) {
    assert.equal(Navigation.activate(viewId, doc), true);
    const activeViews = doc.views.filter((view) => view.classList.contains("is-active"));
    assert.equal(activeViews.length, 1, `debe haber una sola vista activa en ${viewId}`);
    assert.equal(activeViews[0].id, viewId);

    doc.tabs.forEach((tab) => {
      const expected = tab.getAttribute("data-view") === viewId;
      assert.equal(tab.classList.contains("is-active"), expected);
      assert.equal(tab.getAttribute("aria-selected"), expected ? "true" : "false");
    });
  }
});

test("una vista desconocida no altera el estado", () => {
  const doc = makeDocument();
  Navigation.activate("view-analysis", doc);
  assert.equal(Navigation.activate("view-inventada", doc), false);
  const active = doc.views.filter((view) => view.classList.contains("is-active"));
  assert.equal(active.length, 1);
  assert.equal(active[0].id, "view-analysis");
});

test("index.html declara las seis vistas y sus pestañas", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "..", "frontend", "index.html"),
    "utf8"
  );
  for (const viewId of Navigation.VIEW_IDS) {
    assert.match(html, new RegExp(`id="${viewId}"`), `falta la vista ${viewId}`);
    assert.match(html, new RegExp(`data-view="${viewId}"`), `falta la pestaña ${viewId}`);
  }
  assert.match(html, /js\/navigation\.js[\s\S]*js\/app\.js/, "navigation.js debe cargarse antes de app.js");
  assert.match(html, /SIMULACIÓN — DATOS SINTÉTICOS/, "el modo Test debe estar etiquetado");
});
