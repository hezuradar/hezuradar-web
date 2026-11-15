"use strict";

// Selector de pedidos de la hoja de etiquetas (assets/js/admin-label-picker.js).

const { loadBrowserModule } = require("./helpers");
const L = loadBrowserModule("assets/js/admin-label-picker.js").HA_LABEL_PICKER;

const ORDERS = [
  { docId: "a1", orderCode: "HA-001", customer: { name: "Ane" }, shipping: { postalCode: "20560", city: "Oñati" }, createdAt: "2026-11-14T10:00:00" },
  { docId: "b2", orderCode: "HA-002", customer: { name: "Jon" }, shipping: { postalCode: "35001", city: "Las Palmas" }, createdAt: "2026-11-15T09:00:00" },
  { docId: "c3", orderCode: "HA-003", customer: {}, shipping: {} },
];

test("cada pedido sale como una fila marcada con su código, nombre y localidad", () => {
  const html = L.rowsHtml(ORDERS);
  assertEqual((html.match(/data-pick="/g) || []).length, 3);
  assertEqual((html.match(/ checked>/g) || []).length, 3);
  assertTrue(html.includes("HA-002") && html.includes("Jon") && html.includes("35001 Las Palmas"), html);
  assertTrue(html.includes("14/11/2026"), "fecha del pedido");
  assertTrue(html.includes("Sin nombre"), "pedido sin nombre de cliente");
});

test("el nombre del cliente se escapa en el HTML de la fila", () => {
  const html = L.rowsHtml([{ docId: "x", customer: { name: '<img src=x onerror="1">' }, shipping: {} }]);
  assertTrue(!html.includes("<img"), html);
  assertTrue(html.includes("&lt;img"), html);
});

test("solo se imprimen los pedidos marcados, en el orden de la lista", () => {
  const chosen = L.selectedOrders(ORDERS, ["c3", "a1"]);
  assertEqual(chosen.map((o) => o.docId).join(","), "a1,c3");
  assertEqual(L.selectedOrders(ORDERS, []).length, 0);
});
