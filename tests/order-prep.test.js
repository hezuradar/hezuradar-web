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
  // El catálogo guarda la ruta sin barra inicial: se normaliza para que la miniatura salga.
  assertEqual(I.safeImageUrl("images/products/a.webp"), "/images/products/a.webp");
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

test("safeImageUrl normaliza la ruta relativa del catálogo pero no admite esquemas", () => {
  // Caso real: el catálogo guarda "images/products/<uuid>_0.webp" sin barra inicial.
  assertEqual(I.safeImageUrl("images/products/x_0.webp"), "/images/products/x_0.webp");
  // Un esquema escondido dentro de una ruta se sigue rechazando.
  assertEqual(I.safeImageUrl("javascript:alert(1)//x"), "");
  assertEqual(I.safeImageUrl("images/../../etc"), "");
  assertEqual(I.safeImageUrl("C:/windows/x.png"), "");
});

test("safeImageUrl reapunta a WebP las fotos de producto con la extensión antigua", () => {
  // Los pedidos guardados antes de la migración conservan la ruta .jpg, que da 404 porque
  // el original se borró. El .webp equivalente sí existe y es el que debe servirse.
  assertEqual(
    I.safeImageUrl("/images/products/4a02d78d-72ff-496d-a3d3-66622ce8dd62_0.jpg"),
    "/images/products/4a02d78d-72ff-496d-a3d3-66622ce8dd62_0.webp"
  );
  assertEqual(
    I.safeImageUrl("images/products/4a02d78d-72ff-496d-a3d3-66622ce8dd62_0.jpg"),
    "/images/products/4a02d78d-72ff-496d-a3d3-66622ce8dd62_0.webp"
  );
  assertEqual(I.safeImageUrl("/images/products/a_0.jpeg"), "/images/products/a_0.webp");
  assertEqual(I.safeImageUrl("images/products/a_0.JPG"), "/images/products/a_0.webp");
  // El .webp ya correcto no se toca.
  assertEqual(I.safeImageUrl("/images/products/a_0.webp"), "/images/products/a_0.webp");
  // La reescritura es SOLO para fotos de producto: otras rutas .jpg se dejan intactas.
  assertEqual(I.safeImageUrl("/images/site/hero/foto.jpg"), "/images/site/hero/foto.jpg");
  assertEqual(I.safeImageUrl("https://ejemplo.com/foto.jpg"), "https://ejemplo.com/foto.jpg");
  assertEqual(I.safeImageUrl("data:image/jpeg;base64,iVBORw0KGgo="), "data:image/jpeg;base64,iVBORw0KGgo=");
  // No se inventan ficheros: un .jpg de producto anidado en subcarpeta no cumple el patrón.
  assertEqual(I.safeImageUrl("/images/products/sub/x.jpg"), "/images/products/sub/x.jpg");
});

test("isOldProductPhoto detecta solo las fotos de producto con extensión antigua", () => {
  // Casos reales de pedidos guardados: ruta relativa sin barra inicial.
  assertTrue(I.isOldProductPhoto("images/products/f51b1859-58b4-4e0e-91d5-785efb72509c_0.jpg"));
  assertTrue(I.isOldProductPhoto("/images/products/f51b1859-58b4-4e0e-91d5-785efb72509c_0.jpg"));
  assertTrue(I.isOldProductPhoto("images/products/a_0.jpeg"));
  assertTrue(I.isOldProductPhoto("images/products/a_0.JPG"));
  // Lo que NO hay que tocar.
  assertFalse(I.isOldProductPhoto("images/products/a_0.webp"));
  assertFalse(I.isOldProductPhoto("/images/site/hero/foto.jpg"));
  assertFalse(I.isOldProductPhoto("https://ejemplo.com/foto.jpg"));
  assertFalse(I.isOldProductPhoto("data:image/jpeg;base64,iVBORw0KGgo="));
  assertFalse(I.isOldProductPhoto("images/products/sub/x.jpg"));
  assertFalse(I.isOldProductPhoto(""));
  assertFalse(I.isOldProductPhoto(null));
  assertFalse(I.isOldProductPhoto(undefined));
});

test("toWebpIfProductPhoto respeta las rutas que no son fotos de producto", () => {
  assertEqual(I.toWebpIfProductPhoto("/images/products/a_0.jpg"), "/images/products/a_0.webp");
  assertEqual(I.toWebpIfProductPhoto("/images/products/a_0.webp"), "/images/products/a_0.webp");
  assertEqual(I.toWebpIfProductPhoto("/images/site/hero/foto.jpg"), "/images/site/hero/foto.jpg");
  assertEqual(I.toWebpIfProductPhoto("/otra/ruta.jpg"), "/otra/ruta.jpg");
});

test("safeLinkUrl solo admite http y https", () => {
  assertEqual(I.safeLinkUrl("https://drive.google.com/x"), "https://drive.google.com/x");
  assertEqual(I.safeLinkUrl("http://ejemplo.com"), "http://ejemplo.com");
  assertEqual(I.safeLinkUrl("javascript:alert(1)"), "");
  assertEqual(I.safeLinkUrl("data:text/html,x"), "");
  assertEqual(I.safeLinkUrl("/ruta-interna"), "");
  assertEqual(I.safeLinkUrl(""), "");
});
