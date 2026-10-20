"use strict";

// Render de la tarjeta de pedido con el código REAL de assets/js/admin-orders.js dentro de un
// DOM mínimo simulado. Comprueba que el HTML de la checklist (casillas, contador, sello, pill)
// coincide con el estado guardado, y que las URLs peligrosas no llegan al src.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./helpers");

/* ---------------- DOM mínimo ---------------- */

function makeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    attributes: {},
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    innerHTML: "",
    textContent: "",
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    focus() {},
    contains() { return false; },
    closest() { return null; },
  };
  return el;
}

// Carga el módulo con un export adicional solo para la prueba (orderCard vive dentro del IIFE).
function loadOrderCard() {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/admin-orders.js"), "utf8");
  const patched = src.replace(
    /\}\)\(\);\s*$/,
    "  window.__TEST_orderCard = orderCard;\n})();\n"
  );
  const win = { HA_FIREBASE_ENABLED: false, HA_CATALOG_TEMPLATE: { unitPriceFor: (p) => p.price } };
  win.window = win;
  const sandbox = {
    window: win,
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      createElement: (t) => makeEl(t),
      activeElement: null,
      body: makeEl("body"),
    },
    console,
    setTimeout,
    clearTimeout,
    URL,
    Intl,
    encodeURIComponent,
    decodeURIComponent,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Set,
    Map,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: "admin-orders.js" });
  return sandbox.window.__TEST_orderCard;
}

const orderCard = loadOrderCard();

const baseOrder = {
  docId: "p1",
  orderCode: "HA-1",
  status: "pendiente",
  createdAt: { toDate: () => new Date("2026-10-20T10:00:00Z") },
  items: [
    { productId: "abc", id: "abc", title: "Cejuela de prueba", qty: 2, price: 10, image: "/images/products/x.webp" },
    { productId: "def", id: "def", title: "Silleta de prueba", qty: 1, price: 8, image: "" },
  ],
  customer: { name: "Cliente", phone: "600000000" },
  shipping: {},
};

test("orderCard dibuja una casilla de checklist por línea", () => {
  const html = orderCard({ ...baseOrder });
  assertEqual((html.match(/class="oi-prep"/g) || []).length, 2);
});

test("orderCard sin marcas no muestra sello ni contador de completado", () => {
  const html = orderCard({ ...baseOrder });
  assertFalse(html.includes("prep-seal"));
  assertFalse(html.includes("prep-pill"));
  assertTrue(html.includes("0 de 2"), "debería indicar 0 de 2");
});

test("orderCard con una línea marcada muestra el contador y el pill", () => {
  const html = orderCard({ ...baseOrder, prepared: { "abc#0": true } });
  assertTrue(html.includes("1 de 2"));
  assertTrue(html.includes("order-item-row prepared"));
  assertTrue(html.includes("prep-pill"));
  assertFalse(html.includes("prep-seal"), "aún no están todas");
});

test("orderCard con todas marcadas muestra el sello Listo para enviar", () => {
  const html = orderCard({ ...baseOrder, prepared: { "abc#0": true, "def#0": true } });
  assertTrue(html.includes("2 de 2"));
  assertTrue(html.includes("prep-seal") && html.includes("Listo para enviar"));
  assertTrue(/prep-pill done/.test(html));
});

test("orderCard marca como checked solo las casillas ya preparadas", () => {
  const html = orderCard({ ...baseOrder, prepared: { "abc#0": true } });
  assertTrue(/id="prep-p1-0"[^>]*checked/.test(html), "la línea 0 debería ir marcada");
  assertFalse(/id="prep-p1-1"[^>]*checked/.test(html), "la línea 1 no debería ir marcada");
});

test("orderCard no deja pasar una URL peligrosa al src de la imagen", () => {
  const html = orderCard({
    ...baseOrder,
    items: [{ productId: "x", id: "x", title: "Evil", qty: 1, price: 5, image: "javascript:alert(1)" }],
  });
  assertFalse(html.includes("javascript:alert(1)"), "se coló javascript: en el src");
});

test("orderCard sin líneas no muestra el bloque de checklist", () => {
  const html = orderCard({ ...baseOrder, items: [] });
  assertFalse(html.includes("prep-block"));
});
