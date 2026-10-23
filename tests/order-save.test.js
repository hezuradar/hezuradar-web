"use strict";

// Al guardar un pedido desde la pantalla emergente, la tarjeta se repinta con lo guardado
// (mergeSavedOrder) sin esperar a la escucha de Firestore: si no, el botón de Seguimiento
// no aparecía hasta recargar la página.

const fs = require("fs");
const path = require("path");
const { loadBrowserModule, ROOT } = require("./helpers");

const I = loadBrowserModule("assets/js/admin-orders.js").HA_ORDERS_INTERNALS;
const JS = fs.readFileSync(path.join(ROOT, "assets", "js", "admin-orders.js"), "utf8");

const existing = {
  docId: "d1",
  orderCode: "HA-1",
  status: "confirmado",
  trackingNumber: "",
  createdAt: "2026-10-20T10:00:00Z",
  customer: { name: "Prueba", phone: "600000000", email: "a@ejemplo.com" },
  shipping: { address: "C/ X", postalCode: "20560", city: "Oñati", province: "Gipuzkoa", notes: "" },
  items: [{ title: "Cejuela", qty: 1, price: 10 }],
  customerEmailSentAt: "2026-10-20T10:05:00Z",
  driveExportedAt: "2026-10-20T10:06:00Z",
};

test("guardar pedido: el número de seguimiento y el estado nuevos quedan en el pedido", () => {
  const out = I.mergeSavedOrder(existing, { trackingNumber: "PQ123456789ES", status: "enviado" }, []);
  assertEqual(out.trackingNumber, "PQ123456789ES");
  assertEqual(out.status, "enviado");
  assertEqual(out.docId, "d1");
});

test("guardar pedido: se conservan los campos que el formulario no toca", () => {
  const out = I.mergeSavedOrder(existing, { trackingNumber: "PQ1" }, []);
  assertEqual(out.createdAt, existing.createdAt);
  assertEqual(out.driveExportedAt, existing.driveExportedAt);
});

test("guardar pedido: los campos borrados desaparecen y el original no cambia", () => {
  const out = I.mergeSavedOrder(existing, { customer: { name: "Prueba", phone: "600000000", email: "b@ejemplo.com" } }, [
    "customerEmailSentAt",
  ]);
  assertFalse("customerEmailSentAt" in out);
  assertEqual(out.customer.email, "b@ejemplo.com");
  assertEqual(existing.customerEmailSentAt, "2026-10-20T10:05:00Z");
  assertEqual(existing.customer.email, "a@ejemplo.com");
});

test("guardar pedido: tras actualizar se repinta la lista sin esperar a Firestore", () => {
  const save = JS.slice(JS.indexOf("async function saveOrder"), JS.indexOf("function mergeSavedOrder"));
  assertTrue(/mergeSavedOrder\(o, savedFields, deletedFields\)/.test(save), "no aplica lo guardado");
  assertTrue(/renderOrders\(\)/.test(save), "no repinta los pedidos tras guardar");
  assertTrue(/showSavedOrder\(savedDocId\)/.test(save), "no avisa de dónde ha quedado el pedido");
});
