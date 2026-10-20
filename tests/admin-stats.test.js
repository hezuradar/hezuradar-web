"use strict";

// Saneado de URLs de imagen del panel de estadísticas (assets/js/admin-stats.js).
// Es el mismo módulo de saneado que el panel de pedidos: el ranking se alimenta de pedidos
// que puede crear cualquier visitante, así que `r.image` es texto de un tercero.

const fs = require("fs");
const path = require("path");

// admin-stats.js no expone API propia, así que se evalúa solo la zona del saneador.
function loadSafeImageUrl() {
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", "js", "admin-stats.js"), "utf8");
  const start = src.indexOf("const DATA_IMAGE_RE");
  const end = src.indexOf("})();", start);
  if (start < 0 || end < 0) throw new Error("no se encontró safeImageUrl en admin-stats.js");
  return new Function("window", src.slice(start, end) + "\n return { safeImageUrl }; ")({}).safeImageUrl;
}

const safeImageUrl = loadSafeImageUrl();

test("admin-stats: la ruta relativa del catálogo se normaliza (miniatura visible)", () => {
  // El catálogo guarda "images/products/<uuid>_0.webp", sin barra inicial. Sin normalizar,
  // safeImageUrl la descartaba y el ranking salía sin miniatura.
  assertEqual(safeImageUrl("images/products/x_0.webp"), "/images/products/x_0.webp");
  assertEqual(safeImageUrl("/images/products/x_0.webp"), "/images/products/x_0.webp");
});

test("admin-stats: no deja pasar host, esquema ni escape de ruta", () => {
  assertEqual(safeImageUrl("//evil.com/x.png"), "");
  assertEqual(safeImageUrl("/\\evil.com/x.png"), "");
  assertEqual(safeImageUrl("javascript:alert(1)"), "");
  assertEqual(safeImageUrl("data:text/html;base64,PHNjcmlwdD4="), "");
  assertEqual(safeImageUrl("images/../../etc"), "");
  assertEqual(safeImageUrl("C:/windows/x.png"), "");
  assertEqual(safeImageUrl(null), "");
});

test("admin-stats: sigue admitiendo http(s) y data:image", () => {
  assertEqual(safeImageUrl("https://hezuradar.com/a.webp"), "https://hezuradar.com/a.webp");
  assertEqual(safeImageUrl("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=");
  assertEqual(safeImageUrl("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "");
});
