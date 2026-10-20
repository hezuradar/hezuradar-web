"use strict";

// Checklist de preparación física de pedidos y saneado de URLs (assets/js/admin-orders.js).

const { loadBrowserModule } = require("./helpers");
const I = loadBrowserModule("assets/js/admin-orders.js").HA_ORDERS_INTERNALS;

/* ---------------- Claves de línea ---------------- */

test("prepKeyPart escapa los caracteres que Firestore trata como ruta de campo", () => {
  assertEqual(I.prepKeyPart("a.b"), "a%2Eb");
  assertEqual(I.prepKeyPart("a/b"), "a%2Fb");
  assertEqual(I.prepKeyPart("a[b]"), "a%5Bb%5D");
  assertEqual(I.prepKeyPart("a*b"), "a%2Ab");
  // El propio % se escapa primero, para que la vuelta sea inequívoca.
  assertEqual(I.prepKeyPart("100%"), "100%25");
  assertEqual(I.prepKeyPart("100%25"), "100%2525");
});

test("prepKeyPart no deja pasar títulos con punto y porcentaje mezclados", () => {
  // Dos títulos distintos no deben producir la misma clave.
  assertFalse(I.prepKeyPart("12% · soporte v2.0") === I.prepKeyPart("12%2 · soporte v2.0"));
});

test("prepLineKeys usa el id del producto cuando existe", () => {
  const keys = I.prepLineKeys([{ id: "abc", title: "Cejuela" }]);
  assertEqual(keys, ["abc#0"]);
});

test("prepLineKeys usa el título en las líneas manuales (sin id)", () => {
  const keys = I.prepLineKeys([{ title: "Pieza a medida" }]);
  assertEqual(keys, ["Pieza a medida#0"]);
});

test("prepLineKeys desambigua dos líneas idénticas con un contador", () => {
  const keys = I.prepLineKeys([{ id: "abc" }, { id: "abc" }, { id: "abc" }]);
  assertEqual(keys, ["abc#0", "abc#1", "abc#2"]);
});

test("prepLineKeys aguanta una lista vacía o con huecos", () => {
  assertEqual(I.prepLineKeys([]), []);
  assertEqual(I.prepLineKeys(null), []);
  // Una línea sin id ni título recibe una clave de reserva por posición.
  const keys = I.prepLineKeys([{}]);
  assertEqual(keys.length, 1);
  assertTrue(keys[0].startsWith("line0"), "se esperaba una clave de reserva: " + keys[0]);
});

/* ---------------- Estado guardado ---------------- */

test("preparedState solo conserva las marcas de líneas que siguen existiendo", () => {
  const o = {
    items: [{ id: "abc" }, { id: "def" }],
    prepared: { "abc#0": true, "def#0": true, "vieja#0": true },
  };
  assertEqual(I.preparedState(o), { "abc#0": true, "def#0": true });
});

test("preparedState ignora un valor falso o corrupto en el pedido", () => {
  assertEqual(I.preparedState({ items: [{ id: "abc" }], prepared: { "abc#0": false } }), {});
  // Si el campo no es un objeto (documento manipulado), se trata como vacío.
  assertEqual(I.preparedState({ items: [{ id: "abc" }], prepared: "basura" }), {});
  assertEqual(I.preparedState({ items: [{ id: "abc" }], prepared: [1, 2] }), {});
  assertEqual(I.preparedState({ items: [{ id: "abc" }] }), {});
});

test("preparedState no deja que un prototipo contaminado marque líneas", () => {
  // El estado devuelto debe ser un objeto limpio, sin heredar de Object.prototype.
  const state = I.preparedState({ items: [{ id: "abc" }] });
  assertEqual(Object.getPrototypeOf(state), Object.prototype);
  assertEqual(Object.keys(state), []);
});

/* ---------------- Contadores ---------------- */

test("prepCounts cuenta las referencias preparadas sobre el total", () => {
  const o = { items: [{ id: "a" }, { id: "b" }, { id: "c" }], prepared: { "a#0": true, "c#0": true } };
  assertEqual(I.prepCounts(o), { total: 3, done: 2, all: false });
});

test("prepCounts marca all cuando están todas preparadas", () => {
  const o = { items: [{ id: "a" }, { id: "b" }], prepared: { "a#0": true, "b#0": true } };
  assertEqual(I.prepCounts(o), { total: 2, done: 2, all: true });
});

test("prepCounts nunca da all con un pedido sin líneas", () => {
  assertEqual(I.prepCounts({ items: [], prepared: {} }), { total: 0, done: 0, all: false });
});

test("prepCounts ignora marcas de líneas que ya no están", () => {
  const o = { items: [{ id: "a" }], prepared: { "a#0": true, "borrada#0": true } };
  assertEqual(I.prepCounts(o), { total: 1, done: 1, all: true });
});

test("prepCounts no confunde líneas repetidas al marcar solo una", () => {
  const o = { items: [{ id: "a" }, { id: "a" }], prepared: { "a#0": true } };
  assertEqual(I.prepCounts(o), { total: 2, done: 1, all: false });
});

/* ---------------- URLs saneadas ---------------- */

test("safeImageUrl admite rutas del catálogo, http(s) y data:image", () => {
  assertEqual(I.safeImageUrl("/images/products/a.webp"), "/images/products/a.webp");
  assertEqual(I.safeImageUrl("images/products/a.webp"), "");
  assertEqual(I.safeImageUrl("https://hezuradar.com/a.webp"), "https://hezuradar.com/a.webp");
  assertEqual(I.safeImageUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
});

test("safeImageUrl rechaza esquemas peligrosos y datos que no son imagen", () => {
  assertEqual(I.safeImageUrl("javascript:alert(1)"), "");
  assertEqual(I.safeImageUrl("data:text/html;base64,PHNjcmlwdD4="), "");
  assertEqual(I.safeImageUrl("vbscript:msgbox(1)"), "");
  assertEqual(I.safeImageUrl(""), "");
  assertEqual(I.safeImageUrl(null), "");
  assertEqual(I.safeImageUrl("   "), "");
});

test("safeImageUrl no se deja engañar por mayúsculas ni espacios previos", () => {
  assertEqual(I.safeImageUrl("  javascript:alert(1)"), "");
  assertEqual(I.safeImageUrl("JAVASCRIPT:alert(1)"), "");
  assertEqual(I.safeImageUrl("HTTPS://hezuradar.com/a.webp"), "HTTPS://hezuradar.com/a.webp");
});

test("safeImageUrl rechaza URLs protocol-relative (//host y /\\host)", () => {
  // Un pedido lo puede crear cualquiera: sin esto, "//evil.com/x.png" cargaría una imagen
  // de un servidor ajeno dentro del panel del admin (fuga de IP / contenido externo).
  assertEqual(I.safeImageUrl("//evil.com/x.png"), "");
  assertEqual(I.safeImageUrl("/\\evil.com/x.png"), "");
  assertEqual(I.safeImageUrl("\\/evil.com/x.png"), "");
  assertEqual(I.safeImageUrl(" //evil.com/x.png"), "");
  // Las rutas relativas legítimas del catálogo siguen pasando.
  assertEqual(I.safeImageUrl("/images/products/a.webp"), "/images/products/a.webp");
});

test("safeLinkUrl solo admite http y https", () => {
  assertEqual(I.safeLinkUrl("https://drive.google.com/x"), "https://drive.google.com/x");
  assertEqual(I.safeLinkUrl("http://ejemplo.com"), "http://ejemplo.com");
  assertEqual(I.safeLinkUrl("javascript:alert(1)"), "");
  assertEqual(I.safeLinkUrl("data:text/html,x"), "");
  assertEqual(I.safeLinkUrl("/ruta-interna"), "");
  assertEqual(I.safeLinkUrl(""), "");
});
