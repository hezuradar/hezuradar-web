"use strict";

// Pantalla de Productos del panel (assets/js/admin-products-view.js): filtros, avisos de
// calidad, orden de fotos y el resolvedor que muestra las fotos recién subidas.

const { loadBrowserModule } = require("./helpers");
const V = loadBrowserModule("assets/js/admin-products-view.js").HA_PRODUCTS_VIEW;

const base = (over) =>
  Object.assign(
    {
      id: "x",
      title: "Selleta o cordal de hueso de búfalo ámbar 80 × 2 × 12 mm",
      description: "Hueso de búfalo ámbar.",
      price: 4,
      sku: "RR0075",
      category: "Hueso",
      subcategory: "Selleta",
      stock: 50,
      images: ["images/products/x_1_0.webp"],
      updatedAt: "2026-11-10",
    },
    over
  );

test("stockState distingue sin control, agotado, poco y suficiente", () => {
  assertEqual(V.stockState(null), "none");
  assertEqual(V.stockState(0), "out");
  assertEqual(V.stockState(3), "low");
  assertEqual(V.stockState(V.LOW_STOCK), "low");
  assertEqual(V.stockState(50), "ok");
});

test("un producto bien rellenado no tiene avisos", () => {
  assertEqual(V.productIssues(base()), []);
});

test("avisa de los fallos que tenía el alta de la selleta de búfalo", () => {
  const issues = V.productIssues(base({ title: "Selleta de hueso de bufalo ambar  80 × 2x 12 mm", subcategory: null }));
  assertTrue(issues.includes("Espacios de más en el título"), "doble espacio");
  assertTrue(issues.includes("Medidas con «x» en vez de «×»"), "2x");
  assertTrue(issues.includes("Sin subcategoría"), "subcategoría");
});

test("avisa de producto sin fotos, sin descripción y sin categoría", () => {
  const issues = V.productIssues(base({ images: [], description: "  ", category: "Otros" }));
  assertEqual(issues, ["Sin fotos", "Sin descripción", "Sin categoría"]);
});

test("la búsqueda ignora tildes y mayúsculas y busca también por SKU", () => {
  const list = [base(), base({ id: "y", title: "Cejuela de cuerno negro", sku: "RR0001", category: "Cuerno" })];
  assertEqual(V.filterProducts(list, { query: "BUFALO ambar" }).map((p) => p.id), ["x"]);
  assertEqual(V.filterProducts(list, { query: "rr0001" }).map((p) => p.id), ["y"]);
});

test("filtra por categoría, por estado de stock y por productos con avisos", () => {
  const list = [base(), base({ id: "o", stock: 0 }), base({ id: "c", category: "Cuerno", subcategory: null })];
  assertEqual(V.filterProducts(list, { category: "Cuerno" }).map((p) => p.id), ["c"]);
  assertEqual(V.filterProducts(list, { stock: "out" }).map((p) => p.id), ["o"]);
  assertEqual(V.filterProducts(list, { stock: "issues" }).map((p) => p.id), ["c"]);
});

test("ordena por más reciente por defecto y por stock pone primero lo agotado", () => {
  const list = [base({ id: "a", updatedAt: "2026-01-01", stock: 3 }), base({ id: "b", updatedAt: "2026-11-01", stock: 0 }), base({ id: "c", updatedAt: "2026-06-01", stock: 40 })];
  assertEqual(V.filterProducts(list, {}).map((p) => p.id), ["b", "c", "a"]);
  assertEqual(V.filterProducts(list, { sort: "stock" }).map((p) => p.id), ["b", "a", "c"]);
});

test("filterProducts no modifica la lista original", () => {
  const list = [base({ id: "a", price: 9 }), base({ id: "b", price: 1 })];
  V.filterProducts(list, { sort: "priceAsc" });
  assertEqual(list.map((p) => p.id), ["a", "b"]);
});

test("moveImage cambia la foto principal sin mutar el array", () => {
  const imgs = ["a", "b", "c"];
  assertEqual(V.moveImage(imgs, 2, 0), ["c", "a", "b"]);
  assertEqual(imgs, ["a", "b", "c"]);
  assertEqual(V.moveImage(imgs, 0, 5), ["a", "b", "c"], "fuera de rango no cambia nada");
});
