"use strict";

// Pestaña Clientes del panel: búsqueda por campos y orden (assets/js/admin-customers.js) y
// tarjeta de cliente (customerCardHtml de assets/js/admin-orders.js). Los datos de cliente los
// escribe cualquiera al hacer un pedido, así que la tarjeta tiene que escaparlos.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadBrowserModule, ROOT } = require("./helpers");

const C = loadBrowserModule("assets/js/admin-customers.js").HA_CUSTOMERS;

const ana = {
  key: "p:34667237332",
  name: "Ána Pérez",
  phone: "667 23 73 32",
  email: "ana@ejemplo.com",
  address: "Calle Mayor 3",
  postalCode: "20560",
  city: "Oñati",
  province: "Gipuzkoa",
  orderCount: 3,
  totalSpent: 45.5,
  firstOrderAt: "2026-01-10T10:00:00Z",
  lastOrderAt: "2026-10-01T10:00:00Z",
};
const bea = {
  key: "e:bea@ejemplo.com",
  name: "Bea López",
  phone: "",
  email: "bea@ejemplo.com",
  address: "Gran Vía 1",
  postalCode: "28013",
  city: "Madrid",
  province: "Madrid",
  orderCount: 1,
  totalSpent: 120,
  firstOrderAt: "2026-05-01T10:00:00Z",
  lastOrderAt: "2026-05-01T10:00:00Z",
};
const sinCiudad = {
  key: "n:carlos",
  name: "Carlos",
  phone: "",
  email: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  orderCount: 2,
  totalSpent: 0,
  firstOrderAt: "2025-12-01T10:00:00Z",
  lastOrderAt: "2026-08-01T10:00:00Z",
};
const all = [ana, bea, sinCiudad];
const names = (list) => list.map((c) => c.name);

/* ---------------- Búsqueda ---------------- */

test("clientes: sin búsqueda se muestran todos", () => {
  assertEqual(C.filterCustomers(all, "   ", "all").length, 3);
});

test("clientes: busca en todos los campos (ciudad, provincia, CP, dirección, email)", () => {
  assertEqual(names(C.filterCustomers(all, "madrid", "all")), ["Bea López"]);
  assertEqual(names(C.filterCustomers(all, "gipuzkoa", "all")), ["Ána Pérez"]);
  assertEqual(names(C.filterCustomers(all, "20560", "all")), ["Ána Pérez"]);
  assertEqual(names(C.filterCustomers(all, "gran vía", "all")), ["Bea López"]);
  assertEqual(names(C.filterCustomers(all, "bea@", "all")), ["Bea López"]);
});

test("clientes: ignora tildes y mayúsculas", () => {
  assertEqual(names(C.filterCustomers(all, "ANA PEREZ", "all")), ["Ána Pérez"]);
  assertEqual(names(C.filterCustomers(all, "onati", "all")), ["Ána Pérez"]);
});

test("clientes: cada palabra puede estar en un campo distinto", () => {
  assertEqual(names(C.filterCustomers(all, "ana oñati", "all")), ["Ána Pérez"]);
  assertEqual(C.filterCustomers(all, "ana madrid", "all").length, 0);
});

test("clientes: el teléfono se encuentra con o sin espacios", () => {
  assertEqual(names(C.filterCustomers(all, "667237", "all")), ["Ána Pérez"]);
  assertEqual(names(C.filterCustomers(all, "667 237 332", "phone")), ["Ána Pérez"]);
});

test("clientes: limitar a un campo no busca en los demás", () => {
  assertEqual(C.filterCustomers(all, "madrid", "name").length, 0);
  assertEqual(names(C.filterCustomers(all, "madrid", "city")), ["Bea López"]);
  assertEqual(names(C.filterCustomers(all, "28013", "postalCode")), ["Bea López"]);
  assertEqual(C.filterCustomers(all, "28013", "email").length, 0);
});

test("clientes: un campo desconocido busca en todos", () => {
  assertEqual(names(C.filterCustomers(all, "madrid", "noexiste")), ["Bea López"]);
});

test("clientes: datos raros (null, números) no rompen la búsqueda", () => {
  const raro = { name: null, phone: 600111222, email: undefined };
  assertTrue(C.customerMatches(raro, "600111", "all"));
  assertFalse(C.customerMatches(raro, "zzz", "all"));
});

/* ---------------- Orden ---------------- */

test("clientes: por defecto, último pedido más reciente primero", () => {
  assertEqual(names(C.sortCustomers(all)), ["Ána Pérez", "Carlos", "Bea López"]);
});

test("clientes: ordena por nombre ignorando tildes", () => {
  assertEqual(names(C.sortCustomers(all, "name:asc")), ["Ána Pérez", "Bea López", "Carlos"]);
  assertEqual(names(C.sortCustomers(all, "name:desc")), ["Carlos", "Bea López", "Ána Pérez"]);
});

test("clientes: ordena por nº de pedidos y por total gastado", () => {
  assertEqual(names(C.sortCustomers(all, "orderCount:desc")), ["Ána Pérez", "Carlos", "Bea López"]);
  assertEqual(names(C.sortCustomers(all, "totalSpent:desc")), ["Bea López", "Ána Pérez", "Carlos"]);
  assertEqual(names(C.sortCustomers(all, "totalSpent:asc")), ["Carlos", "Ána Pérez", "Bea López"]);
});

test("clientes: cliente desde (primer pedido) más antiguo primero", () => {
  assertEqual(names(C.sortCustomers(all, "firstOrderAt:asc")), ["Carlos", "Ána Pérez", "Bea López"]);
});

test("clientes: sin ciudad va al final al ordenar por ciudad", () => {
  assertEqual(names(C.sortCustomers(all, "city:asc")), ["Bea López", "Ána Pérez", "Carlos"]);
});

test("clientes: ordenar no modifica la lista original", () => {
  const copy = all.slice();
  C.sortCustomers(all, "name:desc");
  assertEqual(names(all), names(copy));
});

test("clientes: todas las opciones de orden tienen etiqueta y funcionan", () => {
  Object.entries(C.SORT_OPTIONS).forEach(([value, opt]) => {
    assertTrue(!!opt.label, "sin etiqueta: " + value);
    assertEqual(C.sortCustomers(all, value).length, 3, value);
  });
});

/* ---------------- Tarjeta ---------------- */

function loadCustomerCard() {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/admin-orders.js"), "utf8");
  const patched = src.replace(/\}\)\(\);\s*$/, "  window.__TEST_customerCard = customerCardHtml;\n})();\n");
  const win = { HA_FIREBASE_ENABLED: false, HA_CUSTOMERS: C };
  win.window = win;
  const noop = () => null;
  const sandbox = {
    window: win,
    document: { addEventListener() {}, getElementById: noop, querySelector: noop, querySelectorAll: () => [] },
    console,
    Intl,
    Date,
    URL,
    Blob: function () {},
    localStorage: { getItem: noop, setItem() {}, removeItem() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: "admin-orders.js" });
  return win.__TEST_customerCard;
}

const customerCard = loadCustomerCard();

test("tarjeta: muestra contacto, dirección, nº de pedidos y total", () => {
  const html = customerCard(ana);
  ["Ána Pérez", "667 23 73 32", "ana@ejemplo.com", "Calle Mayor 3, 20560 Oñati (Gipuzkoa)", "Ver pedidos (3)"].forEach((t) =>
    assertTrue(html.includes(t), "falta: " + t)
  );
  assertTrue(/45,50\s€/.test(html), "falta el total gastado");
});

test("tarjeta: incluye todas las acciones (WhatsApp, email, editar, borrar)", () => {
  const html = customerCard(ana);
  assertTrue(html.includes('href="https://wa.me/34667237332"'), "WhatsApp");
  assertTrue(html.includes('href="mailto:ana@ejemplo.com"'), "email");
  assertTrue(html.includes('href="tel:+34667237332"'), "llamar");
  assertTrue(html.includes(`id="cust-edit-${ana.key}"`) && html.includes(`id="cust-del-${ana.key}"`));
});

test("tarjeta: sin teléfono no ofrece WhatsApp y marca el dato vacío", () => {
  const html = customerCard(bea);
  assertFalse(html.includes("wa.me"));
  assertTrue(html.includes("Sin datos"));
});

test("tarjeta: escapa los datos que escribe el cliente", () => {
  const evil = {
    ...ana,
    key: 'p:1"><img src=x onerror=alert(1)>',
    name: "<script>alert(1)</script>",
    email: '"><svg onload=alert(1)>@x.com',
    address: "<b>calle</b>",
    city: "<i>x</i>",
  };
  const html = customerCard(evil);
  assertFalse(html.includes("<script>"), "nombre sin escapar");
  assertFalse(html.includes("<svg"), "email sin escapar");
  assertFalse(html.includes("<img"), "clave sin escapar");
  assertFalse(html.includes("<b>calle"), "dirección sin escapar");
  assertFalse(html.includes('mailto:"'), "un email inválido no debe ir a mailto");
});
