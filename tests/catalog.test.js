"use strict";

// Precios por cantidad y descuentos (assets/js/catalog-template.js). Es la regla que
// comparten la tienda, la cesta y el panel, así que un error aquí cobra mal.

const { loadBrowserModule } = require("./helpers");
const C = loadBrowserModule("assets/js/catalog-template.js").HA_CATALOG_TEMPLATE;

test("unitPriceFor usa el precio base con una sola unidad", () => {
  const p = { price: 10, priceTiers: [{ minQty: 10, price: 8 }, { minQty: 50, price: 6 }] };
  assertEqual(C.unitPriceFor(p, 1), 10);
});

test("unitPriceFor aplica el tramo que corresponde a la cantidad", () => {
  const p = { price: 10, priceTiers: [{ minQty: 10, price: 8 }, { minQty: 50, price: 6 }] };
  assertEqual(C.unitPriceFor(p, 9), 10);
  assertEqual(C.unitPriceFor(p, 10), 8);
  assertEqual(C.unitPriceFor(p, 49), 8);
  assertEqual(C.unitPriceFor(p, 50), 6);
  assertEqual(C.unitPriceFor(p, 500), 6);
});

test("unitPriceFor aplica el descuento en % encima del tramo", () => {
  const p = { price: 10, discountPercent: 25, priceTiers: [{ minQty: 10, price: 8 }] };
  // 8 del tramo, 25% menos = 6
  assertEqual(C.unitPriceFor(p, 10), 6);
  // 10 base, 25% menos = 7.5
  assertEqual(C.unitPriceFor(p, 1), 7.5);
});

test("unitPriceFor redondea a dos decimales sin arrastrar errores binarios", () => {
  const p = { price: 9.99, discountPercent: 33 };
  assertEqual(C.unitPriceFor(p, 1), 6.69);
});

test("unitPriceFor ignora tramos inválidos o desordenados", () => {
  const p = {
    price: 10,
    priceTiers: [
      { minQty: 50, price: 6 },
      { minQty: 10, price: 8 },
      { minQty: 1, price: 1 }, // minQty 1 no es un tramo real
      { minQty: 5, price: "ocho" }, // precio no numérico
      null,
    ],
  };
  assertEqual(C.unitPriceFor(p, 1), 10);
  assertEqual(C.unitPriceFor(p, 10), 8);
  assertEqual(C.unitPriceFor(p, 50), 6);
});

test("unitPriceFor funciona sin tramos ni descuento", () => {
  assertEqual(C.unitPriceFor({ price: 12.3 }, 7), 12.3);
});

test("effectivePrice redondea el descuento a dos decimales", () => {
  assertEqual(C.effectivePrice({ price: 9.99, discountPercent: 33 }), 6.69);
  assertEqual(C.effectivePrice({ price: 20, discountPercent: 15 }), 17);
  assertEqual(C.effectivePrice({ price: 20 }), 20);
});

test("isOutOfStock solo con stock numérico menor o igual que cero", () => {
  assertTrue(C.isOutOfStock({ stock: 0 }));
  assertTrue(C.isOutOfStock({ stock: -3 }));
  assertFalse(C.isOutOfStock({ stock: 1 }));
  // Sin stock declarado el producto se considera disponible.
  assertFalse(C.isOutOfStock({}));
});

test("thumbPath deriva la miniatura conservando la extensión", () => {
  assertEqual(C.thumbPath("images/products/a_0.webp"), "images/products/a_0-thumb.webp");
  assertEqual(C.thumbPath(""), "");
});

test("categoryList pone Todo delante y ordena el resto", () => {
  const list = C.categoryList([{ category: "Púas" }, { category: "Hueso" }, { category: "Hueso" }]);
  assertEqual(list, ["Todo", "Hueso", "Púas"]);
});

test("sortByCategory pone hueso, cuerno, madre perla y accesorios, y respeta el orden dentro de cada una", () => {
  const products = [
    { id: "a1", category: "Accesorios" },
    { id: "m1", category: "Madre perla y abalone" },
    { id: "c1", category: "Cuerno" },
    { id: "x1", category: "Otra" },
    { id: "h1", category: "Hueso" },
    { id: "c2", category: "Cuerno" },
    { id: "h2", category: "Hueso" },
  ];
  const ids = C.sortByCategory(products).map((p) => p.id).join(",");
  assertEqual(ids, "h1,h2,c1,c2,m1,a1,x1");
  // No modifica el array original.
  assertEqual(products[0].id, "a1");
});
