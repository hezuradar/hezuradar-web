"use strict";

// Detección de pedidos con importes manipulados (assets/js/order-integrity.js). La tienda
// no tiene servidor: el pedido lo arma el navegador y Firestore no puede comprobar precios
// ni sumas, así que el panel tiene que avisar antes de confirmar y cobrar.

const { loadBrowserModule } = require("./helpers");
const I = loadBrowserModule("assets/js/order-integrity.js").HA_ORDER_INTEGRITY;

const CATALOG = [
  { id: "cejuela", price: 10 },
  { id: "selleta", price: 6 },
];
const unitPriceFor = (p) => p.price;

function order(overrides) {
  return {
    status: "pendiente",
    items: [
      { id: "cejuela", title: "Cejuela", price: 10, qty: 2 },
      { id: "selleta", title: "Selleta", price: 6, qty: 1 },
    ],
    subtotal: 26,
    shippingCost: 5.6,
    total: 31.6,
    ...overrides,
  };
}

const issues = (o) => I.orderIssues(o, CATALOG, unitPriceFor);

test("un pedido correcto no tiene avisos", () => {
  assertEqual(issues(order()).length, 0);
});

test("el recargo de PayPal sumado al total no es un aviso", () => {
  assertEqual(issues(order({ paymentMethod: "paypal", total: 33.02 })).length, 0);
});

test("detecta un precio unitario distinto del catálogo", () => {
  const o = order({ items: [{ id: "cejuela", title: "Cejuela", price: 0.5, qty: 2 }], subtotal: 1, total: 6.6 });
  const out = issues(o);
  assertTrue(out.some((m) => m.includes("Precio distinto del catálogo en: Cejuela")), out.join(" | "));
});

test("detecta un total rebajado aunque las líneas estén bien", () => {
  const out = issues(order({ total: 0.01 }));
  assertTrue(out.some((m) => m.includes("El total guardado (0,01 €) es menor")), out.join(" | "));
});

test("detecta un subtotal que no es la suma de las líneas", () => {
  const out = issues(order({ subtotal: 1, total: 6.6 }));
  assertTrue(out.some((m) => m.includes("El subtotal guardado (1,00 €) no cuadra")), out.join(" | "));
});

test("detecta un producto inventado que no está en el catálogo", () => {
  const items = [...order().items, { id: "regalo", title: "Bloque gratis", price: 0, qty: 1 }];
  const out = issues(order({ items }));
  assertTrue(out.some((m) => m.includes("no está en el catálogo: Bloque gratis")), out.join(" | "));
});

test("detecta una línea con precio negativo o cantidad no entera", () => {
  const items = [
    ...order().items,
    { id: "selleta", title: "Descuento falso", price: -20, qty: 1 },
    { id: "selleta", title: "Media selleta", price: 6, qty: 0.5 },
  ];
  const out = issues(order({ items }));
  assertTrue(out.some((m) => m.includes("cantidad o precio no válidos: Descuento falso, Media selleta")), out.join(" | "));
});

test("las sumas se comprueban aunque el catálogo no se haya podido cargar", () => {
  const out = I.orderIssues(order({ total: 0.01 }), [], unitPriceFor);
  assertTrue(out.some((m) => m.includes("es menor que productos + envío")), out.join(" | "));
});

test("muchas líneas con precios por tramo redondeadas como en la cesta no dan falso aviso", () => {
  const cat = [{ id: "pua", price: 1.333 }];
  const items = Array.from({ length: 10 }, (_, i) => ({ id: "pua", title: "Púa " + i, price: 1.333, qty: 1 }));
  // cart.js: cada línea a 1,33 → subtotal 13,30 (sin redondear por línea serían 13,33)
  const out = I.orderIssues({ status: "pendiente", items, subtotal: 13.3, shippingCost: 0, total: 13.3 }, cat, (p) => p.price);
  assertEqual(out.length, 0, out.join(" | "));
});

test("los pedidos ya confirmados no se marcan", () => {
  assertEqual(issues(order({ status: "confirmado", total: 0.01 })).length, 0);
});
